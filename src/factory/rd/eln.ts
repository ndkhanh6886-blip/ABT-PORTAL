import { z } from "zod";
import type { Tx } from "../core/db";
import { writeAudit } from "../core/audit";
import { authorize, authorizeAnywhere, hasFactoryPermission, type AuthzActor } from "../core/authz";
import { invalid, notFound } from "../core/errors";
import { readAttachment, saveAttachment } from "../core/files";
import { nextNumber } from "../core/numbering";
import { insertRecord, parseInput, updateRecord } from "../core/records";
import { defineMachine, listAllowedActions, runTransition } from "../core/stateMachine";
import { assertUsable } from "../asset/service";
import { allocate, findCandidates } from "../inv/allocation";
import { createStockDocument, stockDocumentMachine } from "../inv/documents";
import { getItem, toBaseQty } from "../master/service";
import "./permissions";

export type ExperimentStatus = "PLANNED" | "IN_PROGRESS" | "SUBMITTED" | "APPROVED" | "SUPERSEDED" | "CANCELLED";

export interface ExperimentRow {
  id: string;
  code: string;
  project_id: string;
  title: string;
  objective: string;
  hypothesis: string | null;
  protocol_summary: string | null;
  conclusion: string | null;
  status: ExperimentStatus;
  revision: number;
  parent_experiment_id: string | null;
  started_at: string | null;
  finished_at: string | null;
  submitted_by: number | null;
  submitted_at: string | null;
  approved_by: number | null;
  approved_at: string | null;
  supersede_reason: string | null;
  created_by: number | null;
  version: number;
}

async function expOwner(tx: Tx, projectId: string): Promise<string> {
  const p = (await tx.query("SELECT owner_org_unit_id FROM rd.project WHERE id = $1", [projectId])).rows[0];
  if (!p) throw notFound("dự án R&D");
  return p.owner_org_unit_id;
}

/**
 * Electronic Lab Notebook (ELN) state machine (docs/nha-may/02 §7.4 & ALCOA+ / 21 CFR Part 11):
 * PLANNED → IN_PROGRESS (start) → SUBMITTED (submit) → APPROVED (approve ✍) | IN_PROGRESS (return 📝 / withdraw 📝).
 * Once APPROVED, the experiment is immutable; revising creates a new revision and transitions the old one to SUPERSEDED.
 */
export const experimentMachine = defineMachine<ExperimentStatus, ExperimentRow>({
  entityType: "rd_experiment",
  table: "rd.experiment",
  states: ["PLANNED", "IN_PROGRESS", "SUBMITTED", "APPROVED", "SUPERSEDED", "CANCELLED"],
  terminal: ["SUPERSEDED", "CANCELLED"],
  scopeOf: (row, tx) => expOwner(tx!, row.project_id),
  transitions: [
    {
      action: "start",
      from: "PLANNED",
      to: "IN_PROGRESS",
      permission: "rd.eln.write",
      guards: [
        {
          code: "PROJECT_ACTIVE",
          message: "Dự án phải đang ở trạng thái ACTIVE mới được bắt đầu thí nghiệm.",
          check: async ({ tx, row }) => {
            const p = (await tx.query("SELECT status FROM rd.project WHERE id = $1", [row.project_id])).rows[0];
            return p?.status === "ACTIVE";
          },
        },
      ],
      patch: () => ({ started_at: new Date() }),
    },
    {
      action: "submit",
      from: "IN_PROGRESS",
      to: "SUBMITTED",
      permission: "rd.eln.write",
      guards: [
        {
          code: "NO_ENTRIES",
          message: "Thí nghiệm cần ít nhất một mục nhật ký / kết quả (ELN entry) trước khi gửi duyệt.",
          check: async ({ tx, row }) => {
            const r = await tx.query("SELECT 1 FROM rd.experiment_entry WHERE experiment_id = $1 LIMIT 1", [row.id]);
            return (r.rowCount ?? 0) > 0;
          },
        },
        {
          code: "NO_CONCLUSION",
          message: "Vui lòng nhập kết luận thí nghiệm (conclusion) trước khi gửi duyệt.",
          check: ({ row, payload }) => Boolean((payload.conclusion as string)?.trim() || row.conclusion?.trim()),
        },
      ],
      patch: ({ actor, row, payload }) => ({
        conclusion: ((payload.conclusion as string)?.trim() || row.conclusion) ?? null,
        finished_at: new Date(),
        submitted_by: actor.userId,
        submitted_at: new Date(),
      }),
    },
    {
      action: "withdraw",
      from: "SUBMITTED",
      to: "IN_PROGRESS",
      permission: "rd.eln.write",
      reasonRequired: true,
    },
    {
      action: "return",
      from: "SUBMITTED",
      to: "IN_PROGRESS",
      permission: "rd.eln.approve",
      reasonRequired: true,
    },
    {
      action: "approve",
      from: "SUBMITTED",
      to: "APPROVED",
      permission: "rd.eln.approve",
      signature: "APPROVED",
      guards: [
        {
          code: "SELF_APPROVAL",
          message: "Người phê duyệt sổ thí nghiệm điện tử (ELN) phải khác người thực hiện / gửi duyệt.",
          check: ({ actor, row }) => row.submitted_by !== actor.userId && row.created_by !== actor.userId,
        },
      ],
      patch: ({ actor }) => ({ approved_by: actor.userId, approved_at: new Date() }),
    },
    {
      action: "supersede",
      from: "APPROVED",
      to: "SUPERSEDED",
      permission: "rd.eln.write",
      reasonRequired: true,
      patch: ({ reason }) => ({ supersede_reason: reason }),
    },
    {
      action: "cancel",
      from: ["PLANNED", "IN_PROGRESS"],
      to: "CANCELLED",
      permission: "rd.eln.write",
      reasonRequired: true,
      guards: [
        {
          code: "HAS_MATERIALS",
          message: "Thí nghiệm đã xuất nguyên liệu kho R&D, không được hủy ngang (hãy ghi nhận kết quả và đóng thí nghiệm).",
          check: async ({ tx, row }) => {
            const m = await tx.query("SELECT 1 FROM rd.experiment_material WHERE experiment_id = $1 LIMIT 1", [row.id]);
            return !m.rowCount;
          },
        },
      ],
    },
  ],
});

const createExpSchema = z.object({
  project_id: z.string().uuid("chọn dự án R&D"),
  title: z.string().trim().min(3, "nhập tiêu đề thí nghiệm").max(300),
  objective: z.string().trim().min(5, "nhập mục tiêu thí nghiệm").max(3000),
  hypothesis: z.string().trim().max(3000).optional().nullable(),
  protocol_summary: z.string().trim().max(4000).optional().nullable(),
  performer_name: z.string().trim().max(150).optional().nullable(),
  wbs_task_code: z.string().trim().max(60).optional().nullable(),
  start_now: z.boolean().default(false),
});

export async function createExperiment(tx: Tx, actor: AuthzActor, input: unknown) {
  const d = parseInput(createExpSchema, input);
  const owner = await expOwner(tx, d.project_id);
  await authorize(tx, actor, "rd.eln.write", owner);
  const code = await nextNumber(tx, "RD_EXPERIMENT");
  const exp = await insertRecord<ExperimentRow>(tx, actor, "rd.experiment", "rd_experiment", {
    code,
    project_id: d.project_id,
    title: d.title,
    objective: d.objective,
    hypothesis: d.hypothesis ?? null,
    protocol_summary: d.protocol_summary ?? null,
    performer_name: d.performer_name?.trim() || actor.name || null,
    wbs_task_code: d.wbs_task_code?.trim() || null,
  });
  if (d.start_now) {
    return runTransition(tx, experimentMachine, actor, { id: exp.id, action: "start", expectedVersion: exp.version });
  }
  return exp;
}

export async function updateExperimentMeta(tx: Tx, actor: AuthzActor, id: string, input: unknown) {
  const raw = (input ?? {}) as Record<string, unknown>;
  const cur = (await tx.query("SELECT * FROM rd.experiment WHERE id = $1 FOR UPDATE", [id])).rows[0] as ExperimentRow | undefined;
  if (!cur) throw notFound("thí nghiệm ELN");
  const owner = await expOwner(tx, cur.project_id);
  await authorize(tx, actor, "rd.eln.write", owner);
  if (!["PLANNED", "IN_PROGRESS"].includes(cur.status)) {
    throw invalid("Chỉ được sửa mục tiêu / quy trình / kết luận khi thí nghiệm đang ở trạng thái PLANNED hoặc IN_PROGRESS.");
  }
  const schema = z.object({
    title: z.string().trim().min(3).max(300).optional(),
    objective: z.string().trim().min(5).max(3000).optional(),
    hypothesis: z.string().trim().max(3000).optional().nullable(),
    protocol_summary: z.string().trim().max(4000).optional().nullable(),
    conclusion: z.string().trim().max(4000).optional().nullable(),
  });
  const d = parseInput(schema, input);
  return updateRecord<ExperimentRow>(tx, actor, "rd.experiment", "rd_experiment", id, Number(raw.version ?? cur.version), d);
}

const entrySchema = z.object({
  entry_type: z.enum(["TEXT", "TABLE", "OBSERVATION", "IMAGE", "RAW_DATA", "RESULT"]).default("OBSERVATION"),
  title: z.string().trim().max(250).optional().nullable(),
  content: z.record(z.unknown()).default({}),
});

/**
 * Appends an ELN notebook entry. Allowed while IN_PROGRESS or SUBMITTED (append-only addendum);
 * completely locked once APPROVED or SUPERSEDED.
 */
export async function addExperimentEntry(tx: Tx, actor: AuthzActor, experimentId: string, input: unknown) {
  const exp = (await tx.query("SELECT * FROM rd.experiment WHERE id = $1 FOR UPDATE", [experimentId])).rows[0] as ExperimentRow | undefined;
  if (!exp) throw notFound("thí nghiệm ELN");
  const owner = await expOwner(tx, exp.project_id);
  await authorize(tx, actor, "rd.eln.write", owner);
  if (!["IN_PROGRESS", "SUBMITTED"].includes(exp.status)) {
    throw invalid(`Không thể ghi thêm nhật ký khi thí nghiệm đang ở trạng thái ${exp.status}.`);
  }
  const d = parseInput(entrySchema, input);
  const seq = Number((await tx.query("SELECT coalesce(max(seq), 0) + 1 AS s FROM rd.experiment_entry WHERE experiment_id = $1", [experimentId])).rows[0].s);
  const row = (
    await tx.query(
      `INSERT INTO rd.experiment_entry (experiment_id, seq, entry_type, title, content, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [experimentId, seq, d.entry_type, d.title ?? null, JSON.stringify(d.content), actor.userId]
    )
  ).rows[0];
  await writeAudit(tx, actor, {
    entityType: "rd_experiment",
    entityId: experimentId,
    action: "add_entry",
    changes: { entry: [null, `#${seq} (${d.entry_type}) ${d.title ?? ""}`.trim()] },
  });
  return row;
}

export async function attachExperimentEntryFile(
  tx: Tx,
  actor: AuthzActor,
  experimentId: string,
  file: { fileName: string; mimeType: string; data: Buffer; title?: string }
) {
  const exp = (await tx.query("SELECT * FROM rd.experiment WHERE id = $1 FOR UPDATE", [experimentId])).rows[0] as ExperimentRow | undefined;
  if (!exp) throw notFound("thí nghiệm ELN");
  const owner = await expOwner(tx, exp.project_id);
  await authorize(tx, actor, "rd.eln.write", owner);
  if (!["IN_PROGRESS", "SUBMITTED"].includes(exp.status)) {
    throw invalid(`Không thể đính kèm dữ liệu thô khi thí nghiệm ở trạng thái ${exp.status}.`);
  }
  const category = file.mimeType.startsWith("image/") ? "IMAGE" : "RAW_DATA";
  const att = await saveAttachment(tx, actor, { entityType: "rd_experiment", entityId: experimentId, category, ...file });
  const seq = Number((await tx.query("SELECT coalesce(max(seq), 0) + 1 AS s FROM rd.experiment_entry WHERE experiment_id = $1", [experimentId])).rows[0].s);
  const row = (
    await tx.query(
      `INSERT INTO rd.experiment_entry (experiment_id, seq, entry_type, title, content, attachment_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [experimentId, seq, category === "IMAGE" ? "IMAGE" : "RAW_DATA", file.title || file.fileName, JSON.stringify({ file_name: file.fileName, sha256: att.sha256 }), att.id, actor.userId]
    )
  ).rows[0];
  return row;
}

export async function readExperimentEntryFile(tx: Tx, actor: AuthzActor, experimentId: string, entryId: string) {
  const exp = (await tx.query("SELECT project_id FROM rd.experiment WHERE id = $1", [experimentId])).rows[0];
  if (!exp) throw notFound("thí nghiệm ELN");
  await authorize(tx, actor, "rd.view", await expOwner(tx, exp.project_id));
  const entry = (await tx.query("SELECT attachment_id FROM rd.experiment_entry WHERE id = $1 AND experiment_id = $2", [entryId, experimentId])).rows[0];
  if (!entry?.attachment_id) throw notFound("file dữ liệu thô");
  return readAttachment(tx, entry.attachment_id);
}

const consumeMaterialSchema = z.object({
  warehouse_id: z.string().uuid("chọn kho R&D"),
  item_id: z.string().uuid("chọn hóa chất / vật tư"),
  lot_id: z.string().uuid().optional().nullable(), // optional: if omitted, FEFO selects automatically
  qty: z.coerce.number().positive("lượng xuất phải > 0"),
  uom: z.string().trim().min(1),
  role_in_exp: z.string().trim().max(200).optional().nullable(),
});

/**
 * Issues R&D materials from an R&D warehouse for an IN_PROGRESS experiment:
 * - Only RELEASED, unexpired lots are eligible (FEFO allocation or explicit lot selection).
 * - Posts an `ISSUE` (`reason_code = 'RND'`) stock document in the same transaction so the append-only ledger stays exact.
 */
export async function consumeExperimentMaterial(tx: Tx, actor: AuthzActor, experimentId: string, input: unknown) {
  const d = parseInput(consumeMaterialSchema, input);
  const exp = (await tx.query("SELECT * FROM rd.experiment WHERE id = $1 FOR UPDATE", [experimentId])).rows[0] as ExperimentRow | undefined;
  if (!exp) throw notFound("thí nghiệm ELN");
  const owner = await expOwner(tx, exp.project_id);
  await authorize(tx, actor, "rd.eln.write", owner);
  if (exp.status !== "IN_PROGRESS") {
    throw invalid("Chỉ được xuất nguyên liệu kho R&D khi thí nghiệm đang thực hiện (IN_PROGRESS).");
  }
  const item = await getItem(tx, d.item_id);
  const needBase = Math.round((await toBaseQty(tx, item, d.qty, d.uom)) * 1e6) / 1e6;
  let cands = await findCandidates(tx, item.id, [d.warehouse_id], { lock: true });
  if (d.lot_id) cands = cands.filter((c) => c.lot_id === d.lot_id);
  const plan = allocate(cands, needBase);
  if (plan.shortfall > 1e-9) {
    throw invalid(
      `Không đủ tồn khả dụng (đã giải phóng, còn hạn) cho ${item.code}: cần ${needBase} ${item.base_uom}, thiếu ${plan.shortfall}.`,
      undefined,
      "INSUFFICIENT_STOCK"
    );
  }

  const doc = await createStockDocument(
    tx,
    actor,
    {
      doc_type: "ISSUE",
      reason_code: "RND",
      warehouse_id: d.warehouse_id,
      source_entity_type: "EXPERIMENT",
      source_entity_id: experimentId,
      notes: `Xuất cho thí nghiệm ELN ${exp.code}: ${d.role_in_exp ?? item.name}`,
      lines: plan.picks.map((p) => ({
        item_id: item.id,
        lot_id: p.candidate.lot_id,
        from_location_id: p.candidate.location_id,
        qty: p.qty,
        uom: item.base_uom,
      })),
    },
    { trusted: true }
  );
  await runTransition(tx, stockDocumentMachine, actor, { id: doc.id, action: "post", expectedVersion: doc.version }, { trusted: true });

  const inserted = [];
  for (const p of plan.picks) {
    const row = (
      await tx.query(
        `INSERT INTO rd.experiment_material (experiment_id, item_id, lot_id, warehouse_id, location_id, qty, uom, qty_base, stock_document_id, role_in_exp, issued_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
        [experimentId, item.id, p.candidate.lot_id, d.warehouse_id, p.candidate.location_id, p.qty, item.base_uom, p.qty, doc.id, d.role_in_exp ?? null, actor.userId]
      )
    ).rows[0];
    inserted.push(row);
  }
  await writeAudit(tx, actor, {
    entityType: "rd_experiment",
    entityId: experimentId,
    action: "consume_material",
    changes: { item: [null, `${item.code} (${needBase} ${item.base_uom}) — phiếu ${doc.code}`] },
  });
  return inserted;
}

const useAssetSchema = z.object({
  asset_id: z.string().uuid("chọn thiết bị phòng lab"),
  run_params: z.record(z.unknown()).default({}),
});

/**
 * Records lab equipment usage in an IN_PROGRESS experiment.
 * Enforces `assertUsable`: equipment that is `OUT_OF_CALIBRATION` or `UNDER_MAINTENANCE` is blocked immediately.
 */
export async function logExperimentAsset(tx: Tx, actor: AuthzActor, experimentId: string, input: unknown) {
  const d = parseInput(useAssetSchema, input);
  const exp = (await tx.query("SELECT * FROM rd.experiment WHERE id = $1 FOR UPDATE", [experimentId])).rows[0] as ExperimentRow | undefined;
  if (!exp) throw notFound("thí nghiệm ELN");
  const owner = await expOwner(tx, exp.project_id);
  await authorize(tx, actor, "rd.eln.write", owner);
  if (exp.status !== "IN_PROGRESS") {
    throw invalid("Chỉ gắn thiết bị khi thí nghiệm đang ở trạng thái IN_PROGRESS.");
  }
  const asset = await assertUsable(tx, d.asset_id);
  const row = (
    await tx.query(
      `INSERT INTO rd.experiment_asset (experiment_id, asset_id, run_params, used_by)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [experimentId, asset.id, JSON.stringify(d.run_params), actor.userId]
    )
  ).rows[0];
  await writeAudit(tx, actor, {
    entityType: "rd_experiment",
    entityId: experimentId,
    action: "use_asset",
    changes: { asset: [null, asset.code] },
  });
  return row;
}

/**
 * Creates a new revision of an APPROVED experiment (docs/nha-may/02 §7.4):
 * - Marks the approved experiment as `SUPERSEDED` with the mandatory reason.
 * - Creates a new experiment in `IN_PROGRESS` with `revision = old.revision + 1` and `parent_experiment_id = old.id`,
 *   copying the objective, hypothesis, protocol, conclusion and existing notebook entries.
 */
export async function createExperimentRevision(tx: Tx, actor: AuthzActor, experimentId: string, input: unknown) {
  const { reason } = parseInput(z.object({ reason: z.string().trim().min(5, "nhập lý do tạo phiên bản sửa đổi (tối thiểu 5 ký tự)").max(1000) }), input);
  const oldExp = (await tx.query("SELECT * FROM rd.experiment WHERE id = $1 FOR UPDATE", [experimentId])).rows[0] as ExperimentRow | undefined;
  if (!oldExp) throw notFound("thí nghiệm ELN");
  const owner = await expOwner(tx, oldExp.project_id);
  await authorize(tx, actor, "rd.eln.write", owner);
  if (oldExp.status !== "APPROVED") {
    throw invalid("Chỉ tạo phiên bản mới cho thí nghiệm đã được phê duyệt (APPROVED).");
  }

  await runTransition(tx, experimentMachine, actor, { id: oldExp.id, action: "supersede", expectedVersion: oldExp.version, reason }, { trusted: true });
  const newCode = `${oldExp.code.replace(/-R\d+$/, "")}-R${oldExp.revision + 1}`;
  const rev = await insertRecord<ExperimentRow>(tx, actor, "rd.experiment", "rd_experiment", {
    code: newCode,
    project_id: oldExp.project_id,
    title: oldExp.title,
    objective: oldExp.objective,
    hypothesis: oldExp.hypothesis,
    protocol_summary: oldExp.protocol_summary,
    conclusion: oldExp.conclusion,
    status: "IN_PROGRESS",
    revision: oldExp.revision + 1,
    parent_experiment_id: oldExp.id,
    started_at: new Date(),
  });

  // Copy entries from the previous revision so the researcher can append/amend
  await tx.query(
    `INSERT INTO rd.experiment_entry (experiment_id, seq, entry_type, title, content, attachment_id, created_by)
     SELECT $1, seq, entry_type, title, content, attachment_id, created_by
       FROM rd.experiment_entry WHERE experiment_id = $2 ORDER BY seq`,
    [rev.id, oldExp.id]
  );
  return getExperimentDetail(tx, actor, rev.id);
}

export async function listExperiments(tx: Tx, actor: AuthzActor, projectId?: string) {
  await authorizeAnywhere(tx, actor, "rd.view");
  const rows = (
    await tx.query(
      `SELECT e.*, p.code AS project_code, p.name AS project_name, p.owner_org_unit_id,
              coalesce(nullif(e.performer_name, ''), cb.display_name) AS created_by_name,
              coalesce(nullif(e.performer_name, ''), cb.display_name) AS performer_name,
              ab.display_name AS approved_by_name,
              (SELECT count(*)::int FROM rd.experiment_entry en WHERE en.experiment_id = e.id) AS entry_count,
              (SELECT count(*)::int FROM rd.experiment_material em WHERE em.experiment_id = e.id) AS material_count
         FROM rd.experiment e
         JOIN rd.project p ON p.id = e.project_id
         LEFT JOIN core.user_profile cb ON cb.user_id = e.created_by
         LEFT JOIN core.user_profile ab ON ab.user_id = e.approved_by
        WHERE ($1::uuid IS NULL OR e.project_id = $1)
        ORDER BY e.created_at DESC LIMIT 300`,
      [projectId ?? null]
    )
  ).rows;
  const visible = [];
  for (const r of rows) {
    if (await hasFactoryPermission(tx, actor, "rd.view", r.owner_org_unit_id)) visible.push(r);
  }
  return visible;
}

export async function getExperimentDetail(tx: Tx, actor: AuthzActor, id: string) {
  const exp = (
    await tx.query(
      `SELECT e.*, p.code AS project_code, p.name AS project_name, p.owner_org_unit_id,
              coalesce(nullif(e.performer_name, ''), cb.display_name) AS created_by_name,
              coalesce(nullif(e.performer_name, ''), cb.display_name) AS performer_name,
              sb.display_name AS submitted_by_name, ab.display_name AS approved_by_name,
              pe.code AS parent_code
         FROM rd.experiment e
         JOIN rd.project p ON p.id = e.project_id
         LEFT JOIN core.user_profile cb ON cb.user_id = e.created_by
         LEFT JOIN core.user_profile sb ON sb.user_id = e.submitted_by
         LEFT JOIN core.user_profile ab ON ab.user_id = e.approved_by
         LEFT JOIN rd.experiment pe ON pe.id = e.parent_experiment_id
        WHERE e.id = $1`,
      [id]
    )
  ).rows[0];
  if (!exp) throw notFound("thí nghiệm ELN");
  await authorize(tx, actor, "rd.view", exp.owner_org_unit_id);

  const entries = (
    await tx.query(
      `SELECT en.*, up.display_name AS created_by_name, a.file_name AS attachment_name
         FROM rd.experiment_entry en
         LEFT JOIN core.user_profile up ON up.user_id = en.created_by
         LEFT JOIN core.attachment a ON a.id = en.attachment_id
        WHERE en.experiment_id = $1 ORDER BY en.seq ASC`,
      [id]
    )
  ).rows;

  const materials = (
    await tx.query(
      `SELECT m.*, m.qty::float AS qty, i.code AS item_code, i.name AS item_name, l.code AS lot_code, l.expiry_date,
              d.code AS document_code, up.display_name AS issued_by_name
         FROM rd.experiment_material m
         JOIN master.item i ON i.id = m.item_id
         JOIN inv.lot l ON l.id = m.lot_id
         JOIN inv.stock_document d ON d.id = m.stock_document_id
         LEFT JOIN core.user_profile up ON up.user_id = m.issued_by
        WHERE m.experiment_id = $1 ORDER BY m.issued_at ASC`,
      [id]
    )
  ).rows;

  const assets = (
    await tx.query(
      `SELECT ea.*, a.code AS asset_code, a.name AS asset_name, a.asset_type, up.display_name AS used_by_name
         FROM rd.experiment_asset ea
         JOIN asset.asset a ON a.id = ea.asset_id
         LEFT JOIN core.user_profile up ON up.user_id = ea.used_by
        WHERE ea.experiment_id = $1 ORDER BY ea.used_at ASC`,
      [id]
    )
  ).rows;

  const signatures = (
    await tx.query(
      "SELECT id, meaning, signer_name, signed_at, auth_method, record_hash FROM core.e_signature WHERE entity_type = 'rd_experiment' AND entity_id = $1 ORDER BY signed_at",
      [id]
    )
  ).rows;

  const actions = await listAllowedActions(tx, experimentMachine, actor, exp);
  return { ...exp, entries, materials, assets, signatures, actions };
}
