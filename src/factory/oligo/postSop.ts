import { z } from "zod";
import type { Tx } from "../core/db";
import { writeAudit } from "../core/audit";
import { authorize, authorizeAnywhere, registerPermissions, type AuthzActor } from "../core/authz";
import { conflict, invalid, notFound } from "../core/errors";
import { parseInput } from "../core/records";
import { runTransition } from "../core/stateMachine";
import { assertUsable } from "../asset/service";
import { drawFromInstrument } from "../asset/slots";
import { recordColumnRun } from "../asset/columns";
import { allocate, findCandidates } from "../inv/allocation";
import { createStockDocument, stockDocumentMachine } from "../inv/documents";
import { getItem, toBaseQty } from "../master/service";

registerPermissions([{ code: "oligo.sop.manage", description: "Cấu hình phương pháp và quy trình SOP sau tổng hợp Oligo" }]);

const PURIFICATIONS = ["DESALT", "OPC", "HPLC", "PAGE"] as const;

const fieldSchema = z
  .object({
    key: z.string().trim().regex(/^[a-z][a-z0-9_]{0,39}$/, "mã trường: chữ thường, số, _"),
    label: z.string().trim().min(1).max(100),
    type: z.enum(["NUMBER", "TEXT", "EQUIPMENT", "REAGENT", "COLUMN"]),
    unit: z.string().trim().max(20).optional().nullable(),
    required: z.boolean().default(true),
    item_id: z.string().uuid().optional().nullable(),
    default_qty: z.coerce.number().min(0).optional().nullable(),
    uom: z.string().trim().max(20).optional().nullable(),
  })
  .refine((f) => f.type !== "REAGENT" || (f.item_id && f.uom), { message: "trường hóa chất cần mã hàng và đơn vị" });
export type StepField = z.infer<typeof fieldSchema>;

const methodSchema = z.object({
  category: z.string().trim().min(1).max(60),
  name: z.string().trim().min(1).max(100),
  kind: z.enum(["STANDARD", "QUANTIFICATION"]).default("STANDARD"),
  target_hours: z.coerce.number().positive().max(1000).optional().nullable(),
  fields: z.array(fieldSchema).max(30),
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
});

function checkFields(fields: StepField[]) {
  if (new Set(fields.map((f) => f.key)).size !== fields.length) throw invalid("Trùng mã trường trong phương pháp.");
}

/** Library of step methods: what is recorded at a step (numbers, text, equipment used, reagents consumed). */
export async function saveMethod(tx: Tx, actor: AuthzActor, id: string | null, input: unknown) {
  await authorizeAnywhere(tx, actor, "oligo.sop.manage");
  const raw = (input ?? {}) as Record<string, unknown>;
  const data = parseInput(methodSchema, input);
  checkFields(data.fields);
  for (const f of data.fields) if (f.type === "REAGENT") await getItem(tx, f.item_id!);
  if (!id) {
    const m = (
      await tx.query(
        "INSERT INTO oligo.ps_method (category, name, kind, target_hours, fields, status, created_by, updated_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $7) RETURNING *",
        [data.category, data.name, data.kind, data.target_hours ?? null, JSON.stringify(data.fields), data.status, actor.userId]
      )
    ).rows[0];
    await writeAudit(tx, actor, { entityType: "oligo_ps_method", entityId: m.id, action: "create", changes: { name: [null, `${data.category} / ${data.name}`] } });
    return m;
  }
  const cur = (await tx.query("SELECT * FROM oligo.ps_method WHERE id = $1 FOR UPDATE", [id])).rows[0];
  if (!cur) throw notFound("phương pháp");
  if (cur.version !== Number(raw.version)) throw conflict("Phương pháp vừa được người khác sửa. Tải lại.", "STALE_VERSION");
  await tx.query(
    "UPDATE oligo.ps_method SET category = $2, name = $3, kind = $4, target_hours = $5, fields = $6, status = $7, version = version + 1, updated_at = now(), updated_by = $8 WHERE id = $1",
    [id, data.category, data.name, data.kind, data.target_hours ?? null, JSON.stringify(data.fields), data.status, actor.userId]
  );
  await writeAudit(tx, actor, {
    entityType: "oligo_ps_method",
    entityId: id,
    action: "update",
    changes: { fields: [JSON.stringify(cur.fields), JSON.stringify(data.fields)], status: [cur.status, data.status] },
    reason: typeof raw.reason === "string" ? raw.reason : null,
  });
  return (await tx.query("SELECT * FROM oligo.ps_method WHERE id = $1", [id])).rows[0];
}

const workflowSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(1000).optional().nullable(),
  purifications: z.array(z.enum(PURIFICATIONS)).max(4).default([]),
  steps: z.array(z.object({ method_id: z.string().uuid(), name: z.string().trim().max(100).optional().nullable() })).min(1, "quy trình cần ít nhất một bước").max(30),
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
});

/**
 * A workflow = methods in order, the default for some purifications. It must measure OD exactly once (QC takes
 * OD / nmol from there). A change is a new revision; records already started keep the steps they started with.
 */
export async function saveWorkflow(tx: Tx, actor: AuthzActor, id: string | null, input: unknown) {
  await authorizeAnywhere(tx, actor, "oligo.sop.manage");
  const raw = (input ?? {}) as Record<string, unknown>;
  const data = parseInput(workflowSchema, input);
  const methods = (await tx.query("SELECT id, name, kind, status FROM oligo.ps_method WHERE id = ANY($1::uuid[])", [data.steps.map((s) => s.method_id)])).rows;
  for (const s of data.steps) {
    const m = methods.find((x) => x.id === s.method_id);
    if (!m) throw notFound("phương pháp");
    if (m.status !== "ACTIVE") throw invalid(`Phương pháp "${m.name}" đang ngừng dùng.`);
  }
  const quant = data.steps.filter((s) => methods.find((m) => m.id === s.method_id)!.kind === "QUANTIFICATION").length;
  if (quant !== 1) throw invalid("Quy trình phải có đúng một bước đo OD (phương pháp loại Định lượng).", undefined, "QUANTIFICATION_STEP");
  if (data.status === "ACTIVE" && data.purifications.length) {
    const clash = (
      await tx.query("SELECT name, purifications FROM oligo.ps_workflow WHERE status = 'ACTIVE' AND purifications && $1::text[] AND id IS DISTINCT FROM $2", [data.purifications, id])
    ).rows[0];
    if (clash) throw conflict(`Quy trình "${clash.name}" đã là mặc định cho ${clash.purifications.join(", ")}.`, "WORKFLOW_CLASH");
  }
  if (!id) {
    const w = (
      await tx.query(
        "INSERT INTO oligo.ps_workflow (name, description, purifications, steps, status, created_by, updated_by) VALUES ($1, $2, $3, $4, $5, $6, $6) RETURNING *",
        [data.name, data.description ?? null, data.purifications, JSON.stringify(data.steps), data.status, actor.userId]
      )
    ).rows[0];
    await writeAudit(tx, actor, { entityType: "oligo_ps_workflow", entityId: w.id, action: "create", changes: { name: [null, data.name], steps: [null, data.steps.length] } });
    return w;
  }
  const cur = (await tx.query("SELECT * FROM oligo.ps_workflow WHERE id = $1 FOR UPDATE", [id])).rows[0];
  if (!cur) throw notFound("quy trình");
  if (cur.version !== Number(raw.version)) throw conflict("Quy trình vừa được người khác sửa. Tải lại.", "STALE_VERSION");
  const stepsChanged = JSON.stringify(cur.steps) !== JSON.stringify(data.steps);
  await tx.query(
    `UPDATE oligo.ps_workflow SET name = $2, description = $3, purifications = $4, steps = $5, status = $6, revision = revision + $7, version = version + 1, updated_at = now(), updated_by = $8 WHERE id = $1`,
    [id, data.name, data.description ?? null, data.purifications, JSON.stringify(data.steps), data.status, stepsChanged ? 1 : 0, actor.userId]
  );
  await writeAudit(tx, actor, {
    entityType: "oligo_ps_workflow",
    entityId: id,
    action: "update",
    changes: { steps: [JSON.stringify(cur.steps), JSON.stringify(data.steps)], purifications: [cur.purifications.join(","), data.purifications.join(",")], status: [cur.status, data.status] },
    reason: typeof raw.reason === "string" ? raw.reason : null,
  });
  return (await tx.query("SELECT * FROM oligo.ps_workflow WHERE id = $1", [id])).rows[0];
}

export async function listSop(tx: Tx, actor: AuthzActor) {
  await authorize(tx, actor, "oligo.view");
  const methods = (await tx.query("SELECT *, target_hours::float AS target_hours FROM oligo.ps_method ORDER BY category, name")).rows;
  const workflows = (await tx.query("SELECT * FROM oligo.ps_workflow ORDER BY status, name")).rows;
  return { methods, workflows };
}

export interface FrozenStep {
  step_no: number;
  method_id: string;
  name: string;
  category: string;
  kind: "STANDARD" | "QUANTIFICATION";
  target_hours: number | null;
  fields: StepField[];
}

/** The active workflow of a purification with its methods frozen into the record (null: built-in basic steps). */
export async function workflowFor(tx: Tx, purification: string): Promise<{ id: string; revision: number; steps: FrozenStep[] } | null> {
  const w = (await tx.query("SELECT * FROM oligo.ps_workflow WHERE status = 'ACTIVE' AND $1 = ANY(purifications) LIMIT 1", [purification])).rows[0];
  if (!w) return null;
  const methods = (await tx.query("SELECT * FROM oligo.ps_method WHERE id = ANY($1::uuid[])", [w.steps.map((s: any) => s.method_id)])).rows;
  const steps = w.steps.map((s: any, i: number) => {
    const m = methods.find((x) => x.id === s.method_id);
    return { step_no: i + 1, method_id: m.id, name: s.name || m.name, category: m.category, kind: m.kind, target_hours: m.target_hours == null ? null : Number(m.target_hours), fields: m.fields };
  });
  return { id: w.id, revision: w.revision, steps };
}

const logSchema = z.object({
  sequence_ids: z.array(z.string().uuid()).min(1, "chọn trình tự").max(200),
  step_no: z.coerce.number().int().min(1),
  values: z.record(z.union([z.string(), z.number(), z.null()])).default({}),
});

/** Checks a step's values against its fields; returns clean values (numbers as numbers). */
async function cleanValues(tx: Tx, step: FrozenStep, values: Record<string, unknown>) {
  const out: Record<string, string | number | null> = {};
  for (const f of step.fields) {
    const v = values[f.key];
    const empty = v == null || String(v).trim() === "";
    if (empty) {
      if (f.required && f.type !== "REAGENT") throw invalid(`Bước "${step.name}": nhập "${f.label}".`, undefined, "STEP_FIELD_MISSING");
      out[f.key] = f.type === "REAGENT" ? (f.default_qty ?? null) : null;
      continue;
    }
    if (f.type === "NUMBER" || f.type === "REAGENT") {
      const n = Number(String(v).replace(",", "."));
      if (!Number.isFinite(n) || (f.type === "REAGENT" && n < 0)) throw invalid(`Bước "${step.name}": "${f.label}" phải là số.`);
      out[f.key] = n;
    } else if (f.type === "EQUIPMENT") {
      await assertUsable(tx, String(v)); // out of service / calibration due → refused
      out[f.key] = String(v);
    } else if (f.type === "COLUMN") {
      // a purification column: each sequence run on it counts one run of its depreciation
      const c = (await tx.query("SELECT status FROM asset.lc_column WHERE id = $1", [String(v)])).rows[0];
      if (!c || c.status !== "ACTIVE") throw invalid(`Bước "${step.name}": cột sắc ký không có hoặc đã thanh lý.`, undefined, "COLUMN_RETIRED");
      out[f.key] = String(v);
    } else out[f.key] = String(v).trim().slice(0, 1000);
  }
  return out;
}

/**
 * Records a step for one or several sequences (as OligoFlow's batch step logging): only the next step of each
 * record, in order. Reagent fields are issued from stock (FEFO) for every sequence; equipment must be usable;
 * the OD step needs the measurement saved first. The last step completes the SOP.
 */
export async function logStep(tx: Tx, actor: AuthzActor, input: unknown) {
  const data = parseInput(logSchema, input);
  const ids = [...new Set(data.sequence_ids)].sort();
  const done = [];
  for (const seqId of ids) {
    const s = (await tx.query("SELECT id, code, org_unit_id, status FROM oligo.oligo_sequence WHERE id = $1 FOR UPDATE", [seqId])).rows[0];
    if (!s) throw notFound("trình tự");
    await authorize(tx, actor, "oligo.post.manage", s.org_unit_id);
    const rec = (await tx.query("SELECT * FROM oligo.post_process WHERE sequence_id = $1 AND status <> 'VOID' FOR UPDATE", [seqId])).rows[0];
    if (!rec || s.status !== "POST_PROCESSING" || rec.status !== "OPEN") throw invalid(`${s.code}: không ở bước hậu tổng hợp đang mở.`);
    if (!rec.workflow_steps) throw invalid(`${s.code}: hồ sơ không theo quy trình SOP.`);
    const steps: FrozenStep[] = rec.workflow_steps;
    const logged = Number((await tx.query("SELECT count(*) FROM oligo.ps_step_log WHERE post_process_id = $1", [rec.id])).rows[0].count);
    if (data.step_no !== logged + 1) throw invalid(`${s.code}: bước tiếp theo là bước ${logged + 1}${steps[logged] ? ` (${steps[logged].name})` : ""}.`, undefined, "STEP_ORDER");
    const step = steps[data.step_no - 1];
    if (!step) throw invalid(`${s.code}: quy trình chỉ có ${steps.length} bước.`);
    if (step.kind === "QUANTIFICATION" && !(Number(rec.od_total) > 0)) throw invalid(`${s.code}: lưu kết quả đo OD trước khi xác nhận bước "${step.name}".`, undefined, "OD_MISSING");
    const values = await cleanValues(tx, step, data.values);
    const docId = await issueStepReagents(tx, actor, s, rec.id, step, values);
    for (const f of step.fields.filter((x) => x.type === "COLUMN" && values[x.key])) {
      await recordColumnRun(tx, actor, String(values[f.key]), { post_process_id: rec.id, sequence_code: s.code, step_name: step.name });
    }
    await tx.query("INSERT INTO oligo.ps_step_log (post_process_id, step_no, method_id, step_name, values, stock_document_id, performed_by) VALUES ($1, $2, $3, $4, $5, $6, $7)", [
      rec.id, step.step_no, step.method_id, step.name, JSON.stringify(values), docId, actor.userId,
    ]);
    if (data.step_no === steps.length) {
      await tx.query("UPDATE oligo.post_process SET cleavage_done = true, deprotection_done = true, purification_done = true, version = version + 1, updated_at = now() WHERE id = $1", [rec.id]);
    }
    await writeAudit(tx, actor, { entityType: "oligo_post_process", entityId: rec.id, action: "log_step", changes: { [`step ${step.step_no}`]: [null, step.name], values: [null, JSON.stringify(values)] } });
    done.push(s.code);
  }
  return { logged: done };
}

async function issueStepReagents(tx: Tx, actor: AuthzActor, s: any, recId: string, step: FrozenStep, values: Record<string, unknown>): Promise<string | null> {
  const lines = [];
  const warehouses = (await tx.query("SELECT id FROM master.warehouse WHERE owner_org_unit_id = $1 AND status = 'ACTIVE'", [s.org_unit_id])).rows.map((r) => r.id);
  // instruments used in this step (e.g. the HPLC): their installed bottles feed the step's reagents first
  const instruments = step.fields.filter((f) => f.type === "EQUIPMENT" && values[f.key]).map((f) => String(values[f.key]));
  let firstDoc: string | null = null;
  for (const f of step.fields.filter((x) => x.type === "REAGENT")) {
    const qtyIn = Number(values[f.key] ?? 0);
    if (!(qtyIn > 0)) continue;
    const item = await getItem(tx, f.item_id!);
    let qty = Math.round((await toBaseQty(tx, item, qtyIn, f.uom!)) * 1e6) / 1e6;
    if (instruments.length) {
      const drawn = await drawFromInstrument(tx, actor, instruments, item.id, qty, { type: "OLIGO_POST_PROCESS", id: recId, ref: `${s.code} · ${step.name}` });
      firstDoc ??= drawn.docs[0] ?? null;
      qty = drawn.left;
      if (qty <= 1e-9) continue;
    }
    const plan = allocate(await findCandidates(tx, item.id, warehouses, { lock: true }), qty);
    if (plan.shortfall > 1e-9) throw invalid(`${s.code}: không đủ tồn ${item.code} cho bước "${step.name}" (${qtyIn} ${f.uom}).`, undefined, "INSUFFICIENT_STOCK");
    for (const p of plan.picks) lines.push({ item_id: item.id, lot_id: p.candidate.lot_id, from_location_id: p.candidate.location_id, qty: p.qty, uom: item.base_uom });
  }
  if (!lines.length) return firstDoc;
  // one issue document per warehouse; the log keeps the first (all carry the record as source)
  const byWh = new Map<string, typeof lines>();
  for (const l of lines) {
    const wh = (await tx.query("SELECT warehouse_id FROM master.location WHERE id = $1", [l.from_location_id])).rows[0].warehouse_id;
    byWh.set(wh, [...(byWh.get(wh) ?? []), l]);
  }
  let first: string | null = firstDoc;
  for (const [wh, whLines] of byWh) {
    const doc = await createStockDocument(
      tx,
      actor,
      { doc_type: "ISSUE", reason_code: "POST_SYNTHESIS", warehouse_id: wh, source_entity_type: "OLIGO_POST_PROCESS", source_entity_id: recId, lines: whLines },
      { trusted: true }
    );
    await runTransition(tx, stockDocumentMachine, actor, { id: doc.id, action: "post", expectedVersion: doc.version }, { trusted: true });
    first ??= doc.id;
  }
  return first;
}

/** All logged steps of a record, for the post-processing screen and the batch record. */
export async function stepLogs(tx: Tx, recId: string) {
  return (
    await tx.query(
      `SELECT l.step_no, l.step_name, l.values, l.performed_at, p.display_name AS performed_by_name, d.code AS stock_document_code
         FROM oligo.ps_step_log l LEFT JOIN core.user_profile p ON p.user_id = l.performed_by LEFT JOIN inv.stock_document d ON d.id = l.stock_document_id
        WHERE l.post_process_id = $1 ORDER BY l.step_no`,
      [recId]
    )
  ).rows;
}
