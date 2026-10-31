import { z } from "zod";
import type { Tx } from "../core/db";
import { writeAudit } from "../core/audit";
import { authorize, authorizeAnywhere, hasFactoryPermission, type AuthzActor } from "../core/authz";
import { conflict, invalid, notFound } from "../core/errors";
import { nextNumber } from "../core/numbering";
import { insertRecord, parseInput, updateRecord } from "../core/records";
import { defineMachine, listAllowedActions, runTransition } from "../core/stateMachine";
import "./permissions";

export type ModelStatus = "DEVELOPMENT" | "COMMERCIAL" | "DISCONTINUED";
export type RevisionStatus = "DRAFT" | "RELEASED" | "OBSOLETE";
export type EcoStatus =
  | "DRAFT"
  | "IMPACT_ASSESSMENT"
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "REJECTED"
  | "IMPLEMENTED"
  | "CLOSED";

export interface DeviceModelRow {
  id: string;
  code: string;
  name: string;
  org_unit_id: string;
  item_id: string | null;
  category: string;
  current_revision_id: string | null;
  warranty_months: number;
  required_burn_in_hours: string;
  fqc_spec_id: string | null;
  rd_project_id: string | null;
  description: string | null;
  specs_json?: Record<string, unknown>;
  accessories_standard?: unknown[];
  accessories_optional?: unknown[];
  status: ModelStatus;
  version: number;
}

export interface ModelRevisionRow {
  id: string;
  model_id: string;
  revision: string;
  firmware_version: string | null;
  firmware_release_id?: string | null;
  dmr_summary: string;
  dmr_attachment_id: string | null;
  eco_request_id: string | null;
  effectivity_type: "IMMEDIATE" | "FROM_DATE" | "FROM_SERIAL";
  effectivity_value: string | null;
  released_by: number | null;
  released_at: string | null;
  status: RevisionStatus;
  version: number;
  created_by: number | null;
}

export interface EcoRequestRow {
  id: string;
  code: string;
  model_id: string;
  target_revision: string;
  title: string;
  reason: string;
  change_summary: string;
  impact_documents: string | null;
  impact_training: string | null;
  impact_stock: string | null;
  impact_open_orders: string | null;
  impact_regulatory: string | null;
  effectivity_type: "IMMEDIATE" | "FROM_DATE" | "FROM_SERIAL";
  effectivity_value: string | null;
  proposer_id: number;
  approved_by: number | null;
  approved_at: string | null;
  implemented_by: number | null;
  implemented_at: string | null;
  closed_by: number | null;
  closed_at: string | null;
  verification_note: string | null;
  status: EcoStatus;
  version: number;
}

async function modelOwner(tx: Tx, modelId: string): Promise<string> {
  const m = (await tx.query("SELECT org_unit_id FROM device.device_model WHERE id = $1", [modelId])).rows[0];
  if (!m) throw notFound("model thiết bị");
  return m.org_unit_id;
}

/**
 * Model Revision (DMR) state machine (docs/nha-may/02 §10.6):
 * DRAFT → RELEASED ✍ → OBSOLETE.
 * Releasing a revision automatically marks any prior RELEASED revision of the same model as OBSOLETE
 * before the unique index `model_revision_one_released` is checked, and sets `device_model.current_revision_id`.
 */
export const modelRevisionMachine = defineMachine<RevisionStatus, ModelRevisionRow>({
  entityType: "device_model_revision",
  table: "device.model_revision",
  states: ["DRAFT", "RELEASED", "OBSOLETE"],
  terminal: ["OBSOLETE"],
  scopeOf: (row, tx) => modelOwner(tx!, row.model_id),
  transitions: [
    {
      action: "release",
      from: "DRAFT",
      to: "RELEASED",
      permission: "device.model.manage",
      signature: "APPROVED",
      guards: [
        {
          code: "BOM_REQUIRED",
          message: "Phiên bản thiết kế (DMR) phải có ít nhất 1 dòng cấu trúc linh kiện (BOM) trước khi phát hành.",
          check: async ({ tx, row }) => {
            const b = await tx.query("SELECT 1 FROM device.model_bom_line WHERE revision_id = $1 LIMIT 1", [row.id]);
            return (b.rowCount ?? 0) > 0;
          },
        },
        {
          code: "FIRMWARE_RELEASE_NOT_APPROVED",
          message: "Bản phát hành phần mềm/Firmware liên kết (IEC 62304) phải ở trạng thái Đã phát hành (RELEASED).",
          check: async ({ tx, row }) => {
            if (!row.firmware_release_id) return true;
            const sw = (await tx.query("SELECT status FROM rd.software_release WHERE id = $1", [row.firmware_release_id])).rows[0];
            return sw?.status === "RELEASED";
          },
        },
      ],
      beforeUpdate: async ({ tx, actor, row }) => {
        const priors = (
          await tx.query(
            `SELECT id, version FROM device.model_revision
              WHERE model_id = $1 AND id <> $2 AND status = 'RELEASED' FOR UPDATE`,
            [row.model_id, row.id]
          )
        ).rows;
        for (const p of priors) {
          await runTransition(
            tx,
            modelRevisionMachine,
            actor,
            {
              id: p.id,
              action: "obsolete",
              expectedVersion: p.version,
              reason: `Thay thế bởi phiên bản thiết kế mới ${row.revision}`,
            },
            { trusted: true }
          );
        }
      },
      patch: ({ actor }) => ({ released_by: actor.userId, released_at: new Date() }),
      effects: async ({ tx, actor, updated }) => {
        await tx.query(
          `UPDATE device.device_model
              SET current_revision_id = $2,
                  status = CASE WHEN status = 'DEVELOPMENT' THEN 'COMMERCIAL' ELSE status END,
                  version = version + 1, updated_at = now(), updated_by = $3
            WHERE id = $1`,
          [updated.model_id, updated.id, actor.userId]
        );
      },
    },
    {
      action: "obsolete",
      from: "RELEASED",
      to: "OBSOLETE",
      permission: "device.model.manage",
      reasonRequired: true,
    },
  ],
});

/**
 * Engineering Change Order (ECO) state machine (docs/nha-may/02 §4.5 & §10.6):
 * DRAFT → IMPACT_ASSESSMENT → PENDING_APPROVAL → APPROVED ✍ | REJECTED 📝 → IMPLEMENTED → CLOSED.
 * - Moving IMPACT_ASSESSMENT → PENDING_APPROVAL requires all 5 impact assessment dimensions to be documented.
 * - Moving APPROVED → IMPLEMENTED atomically releases the target `model_revision` and obsoletes the old one.
 */
export const ecoMachine = defineMachine<EcoStatus, EcoRequestRow>({
  entityType: "device_eco",
  table: "device.eco_request",
  states: ["DRAFT", "IMPACT_ASSESSMENT", "PENDING_APPROVAL", "APPROVED", "REJECTED", "IMPLEMENTED", "CLOSED"],
  terminal: ["REJECTED", "CLOSED"],
  scopeOf: (row, tx) => modelOwner(tx!, row.model_id),
  transitions: [
    {
      action: "start_impact",
      from: "DRAFT",
      to: "IMPACT_ASSESSMENT",
      permission: "device.eco.propose",
    },
    {
      action: "submit_approval",
      from: "IMPACT_ASSESSMENT",
      to: "PENDING_APPROVAL",
      permission: "device.eco.propose",
      guards: [
        {
          code: "IMPACT_INCOMPLETE",
          message:
            "Phải điền đầy đủ 5 mục đánh giá ảnh hưởng (Tài liệu DMR/SOP, Đào tạo, Tồn kho linh kiện, Lệnh lắp ráp đang chạy, Hồ sơ đăng ký lưu hành) trước khi trình duyệt ECO.",
          check: ({ row }) =>
            Boolean(
              row.impact_documents?.trim() &&
                row.impact_training?.trim() &&
                row.impact_stock?.trim() &&
                row.impact_open_orders?.trim() &&
                row.impact_regulatory?.trim()
            ),
        },
      ],
    },
    {
      action: "approve",
      from: "PENDING_APPROVAL",
      to: "APPROVED",
      permission: "device.eco.approve",
      signature: "APPROVED",
      guards: [
        {
          code: "SELF_APPROVAL",
          message: "Người phê duyệt thay đổi kỹ thuật (ECO) phải khác người đề xuất.",
          check: ({ actor, row }) => row.proposer_id !== actor.userId,
        },
      ],
      patch: ({ actor }) => ({ approved_by: actor.userId, approved_at: new Date() }),
    },
    {
      action: "reject",
      from: ["IMPACT_ASSESSMENT", "PENDING_APPROVAL"],
      to: "REJECTED",
      permission: "device.eco.approve",
      reasonRequired: true,
    },
    {
      action: "implement",
      from: "APPROVED",
      to: "IMPLEMENTED",
      permission: "device.eco.approve",
      guards: [
        {
          code: "TARGET_REVISION_MISSING",
          message: "Cần tạo bản nháp phiên bản thiết kế (Model Revision) tương ứng với target_revision và có BOM trước khi ban hành hiệu lực ECO.",
          check: async ({ tx, row }) => {
            const rev = (
              await tx.query(
                "SELECT id FROM device.model_revision WHERE model_id = $1 AND revision = $2",
                [row.model_id, row.target_revision]
              )
            ).rows[0];
            if (!rev) return false;
            const bom = await tx.query("SELECT 1 FROM device.model_bom_line WHERE revision_id = $1 LIMIT 1", [rev.id]);
            return (bom.rowCount ?? 0) > 0;
          },
        },
      ],
      patch: ({ actor }) => ({ implemented_by: actor.userId, implemented_at: new Date() }),
      effects: async ({ tx, actor, updated }) => {
        // Supersede previous RELEASED revision first so the partial unique index is satisfied
        await tx.query(
          `UPDATE device.model_revision
              SET status = 'OBSOLETE', version = version + 1, updated_at = now(), updated_by = $2
            WHERE model_id = $1 AND status = 'RELEASED'`,
          [updated.model_id, actor.userId]
        );
        const rev = (
          await tx.query(
            `UPDATE device.model_revision
                SET status = 'RELEASED', eco_request_id = $3, effectivity_type = $4, effectivity_value = $5,
                    released_by = $6, released_at = now(), version = version + 1, updated_at = now(), updated_by = $6
              WHERE model_id = $1 AND revision = $2
              RETURNING id`,
            [
              updated.model_id,
              updated.target_revision,
              updated.id,
              updated.effectivity_type,
              updated.effectivity_value,
              actor.userId,
            ]
          )
        ).rows[0];
        await tx.query(
          `UPDATE device.device_model
              SET current_revision_id = $2,
                  status = CASE WHEN status = 'DEVELOPMENT' THEN 'COMMERCIAL' ELSE status END,
                  version = version + 1, updated_at = now(), updated_by = $3
            WHERE id = $1`,
          [updated.model_id, rev.id, actor.userId]
        );
      },
    },
    {
      action: "close",
      from: "IMPLEMENTED",
      to: "CLOSED",
      permission: "device.eco.approve",
      guards: [
        {
          code: "VERIFICATION_REQUIRED",
          message: "Nhập kết quả xác minh sau triển khai ECO (verification_note) trước khi đóng.",
          check: ({ row, payload }) => Boolean((payload.verification_note as string)?.trim() || row.verification_note?.trim()),
        },
      ],
      patch: ({ actor, row, payload }) => ({
        verification_note: ((payload.verification_note as string)?.trim() || row.verification_note) ?? null,
        closed_by: actor.userId,
        closed_at: new Date(),
      }),
    },
  ],
});

const createModelSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{2,30}$/, "Mã model gồm chữ, số, gạch ngang")
    .transform((s) => s.toUpperCase())
    .optional(),
  name: z.string().trim().min(3, "nhập tên model thiết bị").max(250),
  org_unit_id: z.string().uuid("chọn phòng Kỹ thuật – Công nghệ"),
  item_id: z.string().uuid().optional().nullable(),
  category: z
    .enum(["THERMAL_CYCLER", "EXTRACTOR", "CENTRIFUGE", "SPIN_COLUMN_SYSTEM", "INCUBATOR", "SPECTROPHOTOMETER", "OTHER"])
    .default("THERMAL_CYCLER"),
  warranty_months: z.coerce.number().int().min(0).max(120).default(12),
  required_burn_in_hours: z.coerce.number().min(0).max(500).default(48),
  fqc_spec_id: z.string().uuid().optional().nullable(),
  rd_project_id: z.string().uuid().optional().nullable(),
  description: z.string().trim().max(3000).optional().nullable(),
  specs_json: z.record(z.string(), z.unknown()).optional(),
  accessories_standard: z.array(z.unknown()).optional(),
  accessories_optional: z.array(z.unknown()).optional(),
});

export async function createDeviceModel(tx: Tx, actor: AuthzActor, input: unknown) {
  const d = parseInput(createModelSchema, input);
  await authorize(tx, actor, "device.model.manage", d.org_unit_id);
  const code = d.code ?? (await nextNumber(tx, "DEVICE_MODEL"));
  const dup = await tx.query("SELECT 1 FROM device.device_model WHERE code = $1", [code]);
  if (dup.rowCount) throw conflict(`Mã model thiết bị ${code} đã tồn tại.`, "DUPLICATE_CODE");
  return insertRecord<DeviceModelRow>(tx, actor, "device.device_model", "device_model", {
    code,
    name: d.name,
    org_unit_id: d.org_unit_id,
    item_id: d.item_id ?? null,
    category: d.category,
    warranty_months: d.warranty_months,
    required_burn_in_hours: d.required_burn_in_hours,
    fqc_spec_id: d.fqc_spec_id ?? null,
    rd_project_id: d.rd_project_id ?? null,
    description: d.description ?? null,
    specs_json: JSON.stringify(d.specs_json ?? {}),
    accessories_standard: JSON.stringify(d.accessories_standard ?? []),
    accessories_optional: JSON.stringify(d.accessories_optional ?? []),
  });
}

const createRevisionSchema = z.object({
  model_id: z.string().uuid("chọn model thiết bị"),
  revision: z
    .string()
    .trim()
    .regex(/^[A-Z0-9._-]{1,16}$/i, "Ký hiệu phiên bản (ví dụ A, B, 1.0)")
    .transform((s) => s.toUpperCase()),
  firmware_version: z.string().trim().max(60).optional().nullable(),
  firmware_release_id: z.string().uuid().optional().nullable(),
  dmr_summary: z.string().trim().min(5, "nhập tóm tắt hồ sơ thiết kế gốc (DMR)").max(4000),
  eco_request_id: z.string().uuid().optional().nullable(),
  effectivity_type: z.enum(["IMMEDIATE", "FROM_DATE", "FROM_SERIAL"]).default("IMMEDIATE"),
  effectivity_value: z.string().trim().max(100).optional().nullable(),
  clone_from_revision_id: z.string().uuid().optional().nullable(),
});

export async function createModelRevision(tx: Tx, actor: AuthzActor, input: unknown) {
  const d = parseInput(createRevisionSchema, input);
  const owner = await modelOwner(tx, d.model_id);
  await authorize(tx, actor, "device.model.manage", owner);
  const dup = await tx.query("SELECT 1 FROM device.model_revision WHERE model_id = $1 AND revision = $2", [d.model_id, d.revision]);
  if (dup.rowCount) throw conflict(`Phiên bản ${d.revision} của model này đã tồn tại.`, "DUPLICATE_REVISION");

  let fwVersion = d.firmware_version ?? null;
  if (d.firmware_release_id) {
    const sw = (await tx.query("SELECT version_tag, status FROM rd.software_release WHERE id = $1", [d.firmware_release_id])).rows[0];
    if (!sw) throw notFound("bản phát hành Firmware (rd.software_release)");
    if (sw.status !== "RELEASED") {
      throw invalid("Chỉ được gắn kết với bản phát hành Firmware đã được phê duyệt phát hành (RELEASED).");
    }
    if (!fwVersion) fwVersion = sw.version_tag;
  }

  const rev = await insertRecord<ModelRevisionRow>(tx, actor, "device.model_revision", "device_model_revision", {
    model_id: d.model_id,
    revision: d.revision,
    firmware_version: fwVersion,
    firmware_release_id: d.firmware_release_id ?? null,
    dmr_summary: d.dmr_summary,
    eco_request_id: d.eco_request_id ?? null,
    effectivity_type: d.effectivity_type,
    effectivity_value: d.effectivity_value ?? null,
  });

  if (d.clone_from_revision_id) {
    await tx.query(
      `INSERT INTO device.model_bom_line (revision_id, line_no, station_code, component_item_id, qty_per_unit, uom, source_type, is_critical, requires_serial, tracking_type, drawing_code, notes, created_by, updated_by)
       SELECT $1, line_no, station_code, component_item_id, qty_per_unit, uom, source_type, is_critical, requires_serial, tracking_type, drawing_code, notes, $2, $2
         FROM device.model_bom_line WHERE revision_id = $3 ORDER BY line_no`,
      [rev.id, actor.userId, d.clone_from_revision_id]
    );
  }
  return rev;
}

const bomLineSchema = z.object({
  revision_id: z.string().uuid("chọn phiên bản thiết kế"),
  station_code: z.enum(["STATION_1_MECH", "STATION_2_PCB", "STATION_3_FW", "STATION_4_FQC"]),
  component_item_id: z.string().uuid("chọn linh kiện / vật tư"),
  qty_per_unit: z.coerce.number().positive("định mức phải > 0"),
  uom: z.string().trim().min(1),
  source_type: z.enum(["BUY", "MAKE", "SUBCONTRACT"]).default("BUY"),
  is_critical: z.boolean().default(true),
  requires_serial: z.boolean().default(false),
  tracking_type: z.enum(["SERIAL", "LOT", "BULK"]).optional(),
  drawing_code: z.string().trim().max(120).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
});

export async function addModelBomLine(tx: Tx, actor: AuthzActor, input: unknown) {
  const d = parseInput(bomLineSchema, input);
  const rev = (await tx.query("SELECT * FROM device.model_revision WHERE id = $1 FOR UPDATE", [d.revision_id])).rows[0] as
    | ModelRevisionRow
    | undefined;
  if (!rev) throw notFound("phiên bản thiết kế DMR");
  const owner = await modelOwner(tx, rev.model_id);
  await authorize(tx, actor, "device.model.manage", owner);
  if (rev.status !== "DRAFT") {
    throw invalid("Chỉ được thêm/sửa cấu trúc BOM khi phiên bản thiết kế đang ở trạng thái Nháp (DRAFT).");
  }
  const nextLine = Number(
    (await tx.query("SELECT coalesce(max(line_no), 0) + 1 AS n FROM device.model_bom_line WHERE revision_id = $1", [d.revision_id])).rows[0].n
  );
  const trackingType = d.tracking_type ?? (d.requires_serial ? "SERIAL" : "LOT");
  const requiresSerial = trackingType === "SERIAL" ? true : d.requires_serial;
  const row = (
    await tx.query(
      `INSERT INTO device.model_bom_line (revision_id, line_no, station_code, component_item_id, qty_per_unit, uom, source_type, is_critical, requires_serial, tracking_type, drawing_code, notes, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13) RETURNING *`,
      [
        d.revision_id,
        nextLine,
        d.station_code,
        d.component_item_id,
        d.qty_per_unit,
        d.uom,
        d.source_type,
        d.is_critical,
        requiresSerial,
        trackingType,
        d.drawing_code ?? null,
        d.notes ?? null,
        actor.userId,
      ]
    )
  ).rows[0];
  await writeAudit(tx, actor, {
    entityType: "device_model_revision",
    entityId: d.revision_id,
    action: "add_bom_line",
    changes: { line: [null, `#${nextLine} (${d.station_code}) qty=${d.qty_per_unit} ${d.uom}`] },
  });
  return row;
}

const createEcoSchema = z.object({
  model_id: z.string().uuid("chọn model thiết bị"),
  target_revision: z
    .string()
    .trim()
    .regex(/^[A-Z0-9._-]{1,16}$/i, "Ký hiệu phiên bản đích (ví dụ B)")
    .transform((s) => s.toUpperCase()),
  title: z.string().trim().min(3, "nhập tiêu đề ECO").max(300),
  reason: z.string().trim().min(5, "nhập lý do thay đổi kỹ thuật").max(2000),
  change_summary: z.string().trim().min(5, "nhập tóm tắt nội dung thay đổi").max(4000),
  effectivity_type: z.enum(["IMMEDIATE", "FROM_DATE", "FROM_SERIAL"]).default("IMMEDIATE"),
  effectivity_value: z.string().trim().max(100).optional().nullable(),
  impact_documents: z.string().trim().max(2000).optional().nullable(),
  impact_training: z.string().trim().max(2000).optional().nullable(),
  impact_stock: z.string().trim().max(2000).optional().nullable(),
  impact_open_orders: z.string().trim().max(2000).optional().nullable(),
  impact_regulatory: z.string().trim().max(2000).optional().nullable(),
});

export async function createEcoRequest(tx: Tx, actor: AuthzActor, input: unknown) {
  const d = parseInput(createEcoSchema, input);
  const owner = await modelOwner(tx, d.model_id);
  await authorize(tx, actor, "device.eco.propose", owner);
  const code = await nextNumber(tx, "DEVICE_ECO");
  return insertRecord<EcoRequestRow>(tx, actor, "device.eco_request", "device_eco", {
    code,
    model_id: d.model_id,
    target_revision: d.target_revision,
    title: d.title,
    reason: d.reason,
    change_summary: d.change_summary,
    effectivity_type: d.effectivity_type,
    effectivity_value: d.effectivity_value ?? null,
    impact_documents: d.impact_documents ?? null,
    impact_training: d.impact_training ?? null,
    impact_stock: d.impact_stock ?? null,
    impact_open_orders: d.impact_open_orders ?? null,
    impact_regulatory: d.impact_regulatory ?? null,
    proposer_id: actor.userId,
  });
}

export async function updateEcoImpact(tx: Tx, actor: AuthzActor, ecoId: string, input: unknown) {
  const raw = (input ?? {}) as Record<string, unknown>;
  const cur = (await tx.query("SELECT * FROM device.eco_request WHERE id = $1 FOR UPDATE", [ecoId])).rows[0] as EcoRequestRow | undefined;
  if (!cur) throw notFound("yêu cầu thay đổi kỹ thuật (ECO)");
  const owner = await modelOwner(tx, cur.model_id);
  await authorize(tx, actor, "device.eco.propose", owner);
  if (!["DRAFT", "IMPACT_ASSESSMENT"].includes(cur.status)) {
    throw invalid("Chỉ cập nhật đánh giá ảnh hưởng khi ECO đang ở trạng thái DRAFT hoặc IMPACT_ASSESSMENT.");
  }
  const schema = z.object({
    impact_documents: z.string().trim().min(2, "nhập ảnh hưởng tài liệu DMR/SOP").max(2000),
    impact_training: z.string().trim().min(2, "nhập ảnh hưởng đào tạo").max(2000),
    impact_stock: z.string().trim().min(2, "nhập phương án xử lý tồn kho linh kiện cũ").max(2000),
    impact_open_orders: z.string().trim().min(2, "nhập ảnh hưởng lệnh lắp ráp đang chạy").max(2000),
    impact_regulatory: z.string().trim().min(2, "nhập ảnh hưởng hồ sơ đăng ký lưu hành").max(2000),
  });
  const d = parseInput(schema, input);
  return updateRecord<EcoRequestRow>(tx, actor, "device.eco_request", "device_eco", ecoId, Number(raw.version ?? cur.version), d);
}

export async function listDeviceModels(tx: Tx, actor: AuthzActor) {
  await authorizeAnywhere(tx, actor, "device.view");
  const rows = (
    await tx.query(
      `SELECT m.*, m.required_burn_in_hours::float AS required_burn_in_hours,
              u.name AS org_unit_name, it.code AS item_code, it.name AS item_name,
              r.revision AS current_revision, r.firmware_version AS current_firmware,
              (SELECT count(*)::int FROM device.device_unit du WHERE du.model_id = m.id) AS unit_count
         FROM device.device_model m
         JOIN core.org_unit u ON u.id = m.org_unit_id
         LEFT JOIN master.item it ON it.id = m.item_id
         LEFT JOIN device.model_revision r ON r.id = m.current_revision_id
        ORDER BY m.code ASC`
    )
  ).rows;
  const visible = [];
  for (const r of rows) {
    if (await hasFactoryPermission(tx, actor, "device.view", r.org_unit_id)) visible.push(r);
  }
  return visible;
}

export async function getDeviceModelDetail(tx: Tx, actor: AuthzActor, id: string) {
  const model = (
    await tx.query(
      `SELECT m.*, m.required_burn_in_hours::float AS required_burn_in_hours,
              u.name AS org_unit_name, it.code AS item_code, it.name AS item_name,
              qs.code AS fqc_spec_code, qs.name AS fqc_spec_name
         FROM device.device_model m
         JOIN core.org_unit u ON u.id = m.org_unit_id
         LEFT JOIN master.item it ON it.id = m.item_id
         LEFT JOIN qms.qc_spec qs ON qs.id = m.fqc_spec_id
        WHERE m.id = $1`,
      [id]
    )
  ).rows[0];
  if (!model) throw notFound("model thiết bị");
  await authorize(tx, actor, "device.view", model.org_unit_id);

  const revisions = (
    await tx.query(
      `SELECT r.*, up.display_name AS released_by_name, ec.code AS eco_code,
              sw.code AS firmware_release_code, sw.version_tag AS firmware_release_tag, sw.safety_class AS firmware_safety_class
         FROM device.model_revision r
         LEFT JOIN core.user_profile up ON up.user_id = r.released_by
         LEFT JOIN device.eco_request ec ON ec.id = r.eco_request_id
         LEFT JOIN rd.software_release sw ON sw.id = r.firmware_release_id
        WHERE r.model_id = $1 ORDER BY r.created_at DESC`,
      [id]
    )
  ).rows;

  for (const rev of revisions) {
    rev.bom_lines = (
      await tx.query(
        `SELECT bl.*, bl.qty_per_unit::float AS qty_per_unit, it.code AS item_code, it.name AS item_name
           FROM device.model_bom_line bl
           JOIN master.item it ON it.id = bl.component_item_id
          WHERE bl.revision_id = $1 ORDER BY bl.line_no ASC`,
        [rev.id]
      )
    ).rows;
    rev.actions = await listAllowedActions(tx, modelRevisionMachine, actor, rev);
  }

  const ecos = (
    await tx.query(
      `SELECT e.*, pr.display_name AS proposer_name, ap.display_name AS approved_by_name
         FROM device.eco_request e
         LEFT JOIN core.user_profile pr ON pr.user_id = e.proposer_id
         LEFT JOIN core.user_profile ap ON ap.user_id = e.approved_by
        WHERE e.model_id = $1 ORDER BY e.created_at DESC`,
      [id]
    )
  ).rows;
  for (const e of ecos) {
    e.actions = await listAllowedActions(tx, ecoMachine, actor, e);
  }

  return { ...model, revisions, ecos };
}
