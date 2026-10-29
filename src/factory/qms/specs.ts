import { z } from "zod";
import type { Tx } from "../core/db";
import { writeAudit } from "../core/audit";
import { authorize, type AuthzActor } from "../core/authz";
import { conflict, invalid, notFound } from "../core/errors";
import { nextNumber } from "../core/numbering";
import { parseInput } from "../core/records";
import { defineMachine, runTransition, type TransitionRequest } from "../core/stateMachine";
import "./permissions";

type SpecStatus = "DRAFT" | "EFFECTIVE" | "OBSOLETE";
export interface QcSpec {
  id: string;
  code: string;
  spec_version: number;
  item_id: string | null;
  applies_to: string;
  status: SpecStatus;
  version: number;
  created_by: number | null;
}

const parameterSchema = z
  .object({
    name: z.string().trim().min(1, "tên chỉ tiêu bắt buộc").max(200),
    method: z.string().trim().max(200).optional().nullable(),
    unit: z.string().trim().max(30).optional().nullable(),
    value_type: z.enum(["NUMERIC", "TEXT", "PASS_FAIL"]),
    lower_limit: z.coerce.number().optional().nullable(),
    upper_limit: z.coerce.number().optional().nullable(),
    target: z.string().trim().max(200).optional().nullable(),
    is_critical: z.boolean().default(true),
    // Oligo only: value computed by the server from the sequence (e.g. ΔMW), and purifications the parameter applies to (none = all)
    derived_metric: z.enum(["MW_DELTA_DA", "OD_TOTAL", "YIELD_NMOL", "YIELD_UG"]).optional().nullable(),
    oligo_purifications: z.array(z.enum(["DESALT", "OPC", "HPLC", "PAGE"])).max(4).optional().nullable(),
  })
  .refine((p) => p.value_type === "NUMERIC" || (p.lower_limit == null && p.upper_limit == null), { message: "chỉ chỉ tiêu dạng số mới có giới hạn" })
  .refine((p) => p.lower_limit == null || p.upper_limit == null || p.lower_limit <= p.upper_limit, { message: "giới hạn dưới phải ≤ giới hạn trên" })
  .refine((p) => !p.derived_metric || p.value_type === "NUMERIC", { message: "chỉ tiêu tính tự động phải là dạng số" });

const draftSchema = z.object({
  name: z.string().trim().min(1, "bắt buộc").max(200),
  applies_to: z.enum(["ITEM", "RECEIPT", "PRODUCT", "OLIGO", "DEVICE_MODEL"]),
  item_id: z.string().uuid().optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  parameters: z.array(parameterSchema).min(1, "cần ít nhất một chỉ tiêu").max(100),
});
const oligoOnly = (applies: string, params: z.infer<typeof parameterSchema>[]) => {
  if (applies !== "OLIGO" && params.some((p) => p.derived_metric || p.oligo_purifications?.length)) throw invalid("Chỉ tiêu tính tự động / theo kiểu tinh sạch chỉ dùng cho tiêu chuẩn Oligo.");
};

export const specMachine = defineMachine<SpecStatus, QcSpec>({
  entityType: "qc_spec",
  table: "qms.qc_spec",
  states: ["DRAFT", "EFFECTIVE", "OBSOLETE"],
  terminal: ["OBSOLETE"],
  transitions: [
    {
      action: "approve",
      from: "DRAFT",
      to: "EFFECTIVE",
      permission: "qms.spec.approve",
      signature: "APPROVED",
      guards: [
        { code: "SAME_PERSON", message: "Người phê duyệt phải khác người soạn tiêu chuẩn.", check: ({ actor, row }) => row.created_by !== actor.userId },
        {
          code: "NO_PARAMS",
          message: "Tiêu chuẩn chưa có chỉ tiêu nào.",
          check: async ({ tx, row }) => ((await tx.query("SELECT 1 FROM qms.qc_spec_parameter WHERE spec_id = $1", [row.id])).rowCount ?? 0) > 0,
        },
      ],
      patch: () => ({ effective_at: new Date() }),
    },
    { action: "supersede", from: "EFFECTIVE", to: "OBSOLETE", permission: "qms.spec.approve" },
    { action: "obsolete", from: "EFFECTIVE", to: "OBSOLETE", permission: "qms.spec.approve", reasonRequired: true },
  ],
});

async function insertParameters(tx: Tx, specId: string, params: z.infer<typeof parameterSchema>[]) {
  let seq = 0;
  for (const p of params) {
    await tx.query(
      `INSERT INTO qms.qc_spec_parameter (spec_id, seq, name, method, unit, value_type, lower_limit, upper_limit, target, is_critical, derived_metric, oligo_purifications)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [specId, ++seq, p.name, p.method ?? null, p.unit ?? null, p.value_type, p.lower_limit ?? null, p.upper_limit ?? null, p.target ?? null, p.is_critical, p.derived_metric ?? null, p.oligo_purifications?.length ? p.oligo_purifications : null]
    );
  }
}

/** New specification (revision 1) or, with `fromCode`, the next revision of an existing one — always as DRAFT. */
export async function createSpecDraft(tx: Tx, actor: AuthzActor, input: unknown, fromCode?: string): Promise<QcSpec> {
  await authorize(tx, actor, "qms.spec.manage");
  const data = parseInput(draftSchema, input);
  if (["ITEM", "RECEIPT", "PRODUCT"].includes(data.applies_to) && !data.item_id) throw invalid("Tiêu chuẩn cho vật tư / thành phẩm phải chọn vật tư.");
  oligoOnly(data.applies_to, data.parameters);
  let code: string;
  let revision = 1;
  if (fromCode) {
    const last = (await tx.query("SELECT max(spec_version) AS v FROM qms.qc_spec WHERE code = $1", [fromCode])).rows[0];
    if (!last.v) throw notFound("tiêu chuẩn QC");
    if ((await tx.query("SELECT 1 FROM qms.qc_spec WHERE code = $1 AND status = 'DRAFT'", [fromCode])).rowCount) {
      throw conflict("Tiêu chuẩn này đang có một bản nháp. Hoàn tất hoặc sửa bản nháp đó.", "DRAFT_EXISTS");
    }
    code = fromCode;
    revision = Number(last.v) + 1;
  } else {
    code = await nextNumber(tx, "QC_SPEC");
  }
  const spec = (
    await tx.query(
      `INSERT INTO qms.qc_spec (code, spec_version, name, applies_to, item_id, notes, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7) RETURNING *`,
      [code, revision, data.name, data.applies_to, data.item_id ?? null, data.notes ?? null, actor.userId]
    )
  ).rows[0] as QcSpec;
  await insertParameters(tx, spec.id, data.parameters);
  await writeAudit(tx, actor, { entityType: "qc_spec", entityId: spec.id, action: "create", changes: { code: [null, `${code} rev ${revision}`], parameters: [null, data.parameters.length] } });
  return spec;
}

/** Replaces name / parameters of a DRAFT; an effective specification is never edited (make a new revision). */
export async function updateSpecDraft(tx: Tx, actor: AuthzActor, id: string, input: unknown): Promise<QcSpec> {
  await authorize(tx, actor, "qms.spec.manage");
  const { version, ...rest } = parseInput(draftSchema.extend({ version: z.number().int().min(0) }), input);
  const cur = (await tx.query("SELECT * FROM qms.qc_spec WHERE id = $1 FOR UPDATE", [id])).rows[0];
  if (!cur) throw notFound("tiêu chuẩn QC");
  if (cur.status !== "DRAFT") throw invalid("Chỉ sửa được bản nháp. Tạo phiên bản mới để thay đổi tiêu chuẩn đang hiệu lực.");
  if (cur.version !== version) throw conflict("Tiêu chuẩn vừa được người khác sửa. Tải lại rồi thực hiện lại.", "STALE_VERSION");
  oligoOnly(cur.applies_to, rest.parameters);
  await tx.query("DELETE FROM qms.qc_spec_parameter WHERE spec_id = $1", [id]);
  await insertParameters(tx, id, rest.parameters);
  const upd = (
    await tx.query("UPDATE qms.qc_spec SET name = $2, notes = $3, version = version + 1, updated_at = now(), updated_by = $4 WHERE id = $1 RETURNING *", [
      id,
      rest.name,
      rest.notes ?? null,
      actor.userId,
    ])
  ).rows[0];
  await writeAudit(tx, actor, { entityType: "qc_spec", entityId: id, action: "update_draft", changes: { parameters: [null, rest.parameters.length] } });
  return upd;
}

/** Approval makes the draft effective and, in the same transaction, supersedes the previous effective revision. */
export async function approveSpec(tx: Tx, actor: AuthzActor, req: TransitionRequest, signed: boolean): Promise<QcSpec> {
  const draft = (await tx.query("SELECT * FROM qms.qc_spec WHERE id = $1", [req.id])).rows[0] as QcSpec | undefined;
  if (!draft) throw notFound("tiêu chuẩn QC");
  const previous = (
    await tx.query("SELECT id, version FROM qms.qc_spec WHERE status = 'EFFECTIVE' AND applies_to = $1 AND item_id IS NOT DISTINCT FROM $2 AND id <> $3", [
      draft.applies_to,
      draft.item_id,
      draft.id,
    ])
  ).rows;
  for (const p of previous) await runTransition(tx, specMachine, actor, { id: p.id, action: "supersede", expectedVersion: p.version });
  return runTransition(tx, specMachine, actor, req, { signerAuthenticated: signed });
}

export async function findEffectiveSpec(tx: Tx, itemId: string, appliesTo: string[]): Promise<QcSpec | null> {
  return (
    (
      await tx.query("SELECT * FROM qms.qc_spec WHERE status = 'EFFECTIVE' AND item_id = $1 AND applies_to = ANY($2::text[]) ORDER BY array_position($2::text[], applies_to) LIMIT 1", [
        itemId,
        appliesTo,
      ])
    ).rows[0] ?? null
  );
}

export async function getSpec(tx: Tx, id: string) {
  const spec = (await tx.query("SELECT s.*, i.code AS item_code, i.name AS item_name FROM qms.qc_spec s LEFT JOIN master.item i ON i.id = s.item_id WHERE s.id = $1", [id])).rows[0];
  if (!spec) throw notFound("tiêu chuẩn QC");
  const parameters = (await tx.query("SELECT * FROM qms.qc_spec_parameter WHERE spec_id = $1 ORDER BY seq", [id])).rows;
  return { ...spec, parameters };
}

export async function listSpecs(tx: Tx, actor: AuthzActor) {
  await authorize(tx, actor, "qms.qc.view");
  return (
    await tx.query(
      `SELECT s.id, s.code, s.spec_version, s.name, s.applies_to, s.status, s.version, s.effective_at, s.created_by, i.code AS item_code, i.name AS item_name,
              (SELECT count(*)::int FROM qms.qc_spec_parameter p WHERE p.spec_id = s.id) AS parameter_count
         FROM qms.qc_spec s LEFT JOIN master.item i ON i.id = s.item_id
        ORDER BY s.code, s.spec_version DESC`
    )
  ).rows;
}
