import { z } from "zod";
import type { Tx } from "../core/db";
import { authorize, authorizeAnywhere, hasFactoryPermission, type AuthzActor } from "../core/authz";
import { invalid, notFound } from "../core/errors";
import { nextNumber } from "../core/numbering";
import { enqueueEvent } from "../core/outbox";
import { insertRecord, parseInput } from "../core/records";
import { defineMachine, listAllowedActions, runTransition } from "../core/stateMachine";
import "./permissions";

export type TransferStatus = "DRAFT" | "SUBMITTED" | "ACCEPTED" | "COMPLETED";
export type SwReleaseStatus = "DRAFT" | "RELEASED" | "WITHDRAWN";

export interface TechTransferRow {
  id: string;
  code: string;
  project_id: string;
  target_domain: "KIT" | "OLIGO" | "DEVICE" | "SOFTWARE";
  target_org_unit_id: string;
  title: string;
  product_item_id: string | null;
  bom_specification: unknown[];
  routing_steps: unknown[];
  qc_spec_id: string | null;
  created_qc_spec_id: string | null;
  stability_summary: string;
  validation_summary: string;
  status: TransferStatus;
  submitted_by: number | null;
  submitted_at: string | null;
  accepted_by: number | null;
  accepted_at: string | null;
  completed_by: number | null;
  completed_at: string | null;
  pilot_lot_ref: string | null;
  notes: string | null;
  version: number;
}

export interface SwReleaseRow {
  id: string;
  code: string;
  project_id: string;
  version_tag: string;
  target_kind: "FIRMWARE" | "ASSAY_CALLER" | "LIMS_PLUGIN" | "STANDALONE";
  safety_class?: "CLASS_A" | "CLASS_B" | "CLASS_C";
  srs_traceability?: { req_id: string; title: string; test_case_id: string; result: "PASS" | "FAIL" }[];
  soup_list?: { name: string; version: string; vendor?: string; cybersecurity_note?: string }[];
  known_anomalies?: { bug_id: string; severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"; description: string; status: "OPEN" | "RESOLVED" }[];
  release_notes: string;
  checksum_sha256: string | null;
  attachment_id: string | null;
  validation_summary: string | null;
  status: SwReleaseStatus;
  released_by: number | null;
  released_at: string | null;
  withdraw_reason: string | null;
  created_by: number | null;
  version: number;
}

async function projectOwner(tx: Tx, projectId: string): Promise<string> {
  const p = (await tx.query("SELECT owner_org_unit_id FROM rd.project WHERE id = $1", [projectId])).rows[0];
  if (!p) throw notFound("dự án R&D");
  return p.owner_org_unit_id;
}

/**
 * Technology Transfer state machine (docs/nha-may/02 §7.6):
 * DRAFT → SUBMITTED (by R&D) → ACCEPTED ✍ (signed by receiving production department head) → COMPLETED.
 * When ACCEPTED:
 * - Emits `TechTransferAccepted` outbox event.
 * - If `product_item_id` is linked and no DRAFT QC spec exists yet for the product, automatically creates a
 *   DRAFT `qms.qc_spec` from the project's passed TPP parameters (`rd.spec_evaluation`) so QA/Production can review & activate it.
 */
export const techTransferMachine = defineMachine<TransferStatus, TechTransferRow>({
  entityType: "rd_tech_transfer",
  table: "rd.tech_transfer_package",
  states: ["DRAFT", "SUBMITTED", "ACCEPTED", "COMPLETED"],
  terminal: ["COMPLETED"],
  scopeOf: async (row, tx) => {
    if (row.status === "DRAFT") return projectOwner(tx!, row.project_id);
    return row.target_org_unit_id;
  },
  transitions: [
    {
      action: "submit",
      from: "DRAFT",
      to: "SUBMITTED",
      permission: "rd.transfer.manage",
      guards: [
        {
          code: "EMPTY_PACKAGE",
          message: "Gói chuyển giao phải có cấu trúc BOM / thành phần hoặc quy trình công đoạn (Routing/SOP) trước khi gửi.",
          check: ({ row }) => Array.isArray(row.bom_specification) && row.bom_specification.length > 0,
        },
      ],
      patch: ({ actor }) => ({ submitted_by: actor.userId, submitted_at: new Date() }),
    },
    {
      action: "return_draft",
      from: "SUBMITTED",
      to: "DRAFT",
      permission: "rd.transfer.accept",
      reasonRequired: true,
    },
    {
      action: "accept",
      from: "SUBMITTED",
      to: "ACCEPTED",
      permission: "rd.transfer.accept",
      signature: "APPROVED",
      guards: [
        {
          code: "SELF_ACCEPT",
          message: "Người ký nhận chuyển giao công nghệ phải khác người lập / gửi gói chuyển giao.",
          check: ({ actor, row }) => row.submitted_by !== actor.userId,
        },
      ],
      patch: ({ actor }) => ({ accepted_by: actor.userId, accepted_at: new Date() }),
      effects: async ({ tx, actor, updated }) => {
        // Automatically generate a DRAFT QC Specification in QMS if product_item_id is set and no draft exists yet
        if (updated.product_item_id && !updated.created_qc_spec_id) {
          const existingDraft = await tx.query(
            "SELECT id FROM qms.qc_spec WHERE item_id = $1 AND applies_to = 'PRODUCT' AND status = 'DRAFT' LIMIT 1",
            [updated.product_item_id]
          );
          if (!existingDraft.rowCount) {
            const tppRows = (
              await tx.query("SELECT * FROM rd.spec_evaluation WHERE project_id = $1 ORDER BY category, parameter", [updated.project_id])
            ).rows;
            const specCode = await nextNumber(tx, "QC_SPEC");
            const spec = (
              await tx.query(
                `INSERT INTO qms.qc_spec (code, spec_version, name, applies_to, item_id, notes, created_by, updated_by)
                 VALUES ($1, 1, $2, 'PRODUCT', $3, $4, $5, $5) RETURNING id`,
                [
                  specCode,
                  `Tiêu chuẩn QC chuyển giao: ${updated.title}`,
                  updated.product_item_id,
                  `Tự động khởi tạo từ gói chuyển giao công nghệ ${updated.code}`,
                  actor.userId,
                ]
              )
            ).rows[0];
            const paramsSource = tppRows.length
              ? tppRows.map((r, idx) => ({
                  seq: idx + 1,
                  name: r.parameter,
                  method: r.method_ref || r.category,
                  unit: r.unit || null,
                  target: r.target_value,
                }))
              : [{ seq: 1, name: " Ngoại quan & Hiệu năng theo hồ sơ chuyển giao", method: "SOP R&D", unit: null, target: "Đạt" }];
            for (const p of paramsSource) {
              await tx.query(
                `INSERT INTO qms.qc_spec_parameter (spec_id, seq, name, method, unit, value_type, target, is_critical)
                 VALUES ($1, $2, $3, $4, $5, 'PASS_FAIL', $6, true)`,
                [spec.id, p.seq, p.name, p.method, p.unit, p.target]
              );
            }
            await tx.query("UPDATE rd.tech_transfer_package SET created_qc_spec_id = $2 WHERE id = $1", [updated.id, spec.id]);
          }
        }
        // Automatically generate a DRAFT Kit BOM & Routing if target_domain === 'KIT' and product_item_id is set
        if (updated.target_domain === "KIT" && updated.product_item_id) {
          const prod = (await tx.query("SELECT base_uom, shelf_life_days FROM master.item WHERE id = $1", [updated.product_item_id])).rows[0];
          const existingBom = await tx.query(
            "SELECT 1 FROM kit.bom WHERE product_item_id = $1 AND status = 'DRAFT' LIMIT 1",
            [updated.product_item_id]
          );
          if (prod && !existingBom.rowCount) {
            const bomVer = Number(
              (await tx.query("SELECT coalesce(max(bom_version), 0) + 1 AS v FROM kit.bom WHERE product_item_id = $1", [updated.product_item_id])).rows[0].v
            );
            const bomCode = await nextNumber(tx, "KIT_BOM");
            const bomRow = (
              await tx.query(
                `INSERT INTO kit.bom
                   (code, org_unit_id, product_item_id, bom_version, name, base_qty, base_uom, shelf_life_days, notes, created_by, updated_by)
                 VALUES ($1, $2, $3, $4, $5, 1, $6, $7, $8, $9, $9) RETURNING id`,
                [
                  bomCode,
                  updated.target_org_unit_id,
                  updated.product_item_id,
                  bomVer,
                  `BOM chuyển giao R&D: ${updated.title}`,
                  prod.base_uom,
                  prod.shelf_life_days || 365,
                  `Khởi tạo tự động từ gói chuyển giao công nghệ ${updated.code}`,
                  actor.userId,
                ]
              )
            ).rows[0];

            // Populate kit.bom_line from bom_specification where component_code matches master.item
            const bomSpecLines = Array.isArray(updated.bom_specification) ? (updated.bom_specification as Record<string, unknown>[]) : [];
            let lineNo = 0;
            for (const bl of bomSpecLines) {
              const compCode = String(bl.component_code ?? "").trim().toUpperCase();
              const compId = bl.component_item_id ? String(bl.component_item_id) : null;
              const matchedItem = compId
                ? (await tx.query("SELECT id, base_uom FROM master.item WHERE id = $1", [compId])).rows[0]
                : compCode
                  ? (await tx.query("SELECT id, base_uom FROM master.item WHERE upper(code) = $1", [compCode])).rows[0]
                  : null;
              if (matchedItem && matchedItem.id !== updated.product_item_id) {
                lineNo++;
                await tx.query(
                  `INSERT INTO kit.bom_line
                     (bom_id, line_no, component_item_id, qty_per_base, uom, scrap_pct, box_no, component_role, is_critical, notes, created_by, updated_by)
                   VALUES ($1, $2, $3, $4, $5, 0, $6, 'REAGENT', true, $7, $8, $8)`,
                  [
                    bomRow.id,
                    lineNo,
                    matchedItem.id,
                    Number(bl.qty_per_kit ?? 1),
                    String(bl.uom || matchedItem.base_uom),
                    Number(bl.box_no ?? 1),
                    bl.role ? String(bl.role) : null,
                    actor.userId,
                  ]
                );
              }
            }
          }
          const existingRt = await tx.query(
            "SELECT 1 FROM kit.routing WHERE product_item_id = $1 AND status = 'DRAFT' LIMIT 1",
            [updated.product_item_id]
          );
          if (!existingRt.rowCount) {
            const rtVer = Number(
              (await tx.query("SELECT coalesce(max(routing_version), 0) + 1 AS v FROM kit.routing WHERE product_item_id = $1", [updated.product_item_id])).rows[0].v
            );
            const rtCode = await nextNumber(tx, "KIT_ROUTING");
            const rtRow = (
              await tx.query(
                `INSERT INTO kit.routing
                   (code, org_unit_id, product_item_id, routing_version, name, notes, created_by, updated_by)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $7) RETURNING id`,
                [
                  rtCode,
                  updated.target_org_unit_id,
                  updated.product_item_id,
                  rtVer,
                  `Quy trình công đoạn chuyển giao: ${updated.title}`,
                  `Khởi tạo tự động từ gói chuyển giao công nghệ ${updated.code}`,
                  actor.userId,
                ]
              )
            ).rows[0];

            // Populate kit.routing_step from routing_steps
            const rtSteps = Array.isArray(updated.routing_steps) ? (updated.routing_steps as Record<string, unknown>[]) : [];
            for (const [idx, st] of rtSteps.entries()) {
              const stepSeq = Number(st.seq ?? idx + 1);
              await tx.query(
                `INSERT INTO kit.routing_step
                   (routing_id, seq, step_code, step_name, category, instructions, param_schema, is_qc, requires_check_signature, allow_skip, std_duration_min)
                 VALUES ($1, $2, $3, $4, 'FORMULATION', $5, $6, $7, true, false, 30)
                 ON CONFLICT (routing_id, seq) DO NOTHING`,
                [
                  rtRow.id,
                  stepSeq,
                  `STEP-${stepSeq}`,
                  String(st.step_name ?? `Bước ${stepSeq}`),
                  String(st.params || st.step_name || "Thực hiện theo hồ sơ chuyển giao công nghệ R&D"),
                  JSON.stringify(st.qc_check ? [{ key: "qc_check", label: String(st.qc_check), type: "text", required: true }] : []),
                  Boolean(st.qc_check),
                ]
              );
            }
          }
        }
        // Automatically generate a DRAFT Device Model Revision & BOM if target_domain === 'DEVICE'
        if (updated.target_domain === "DEVICE") {
          const model = (
            await tx.query(
              `SELECT id FROM device.device_model
                WHERE ($1::uuid IS NOT NULL AND item_id = $1) OR rd_project_id = $2
                ORDER BY created_at DESC LIMIT 1`,
              [updated.product_item_id, updated.project_id]
            )
          ).rows[0];
          if (model) {
            const revCount = Number(
              (await tx.query("SELECT count(*)::int AS c FROM device.model_revision WHERE model_id = $1", [model.id])).rows[0].c
            );
            const revTag = `TT-${revCount + 1}`;
            const revRow = (
              await tx.query(
                `INSERT INTO device.model_revision
                   (model_id, revision, dmr_summary, effectivity_type, status, created_by, updated_by)
                 VALUES ($1, $2, $3, 'IMMEDIATE', 'DRAFT', $4, $4) RETURNING id`,
                [model.id, revTag, `Hồ sơ DMR chuyển giao từ gói ${updated.code}: ${updated.title}`, actor.userId]
              )
            ).rows[0];
            const bomSpecLines = Array.isArray(updated.bom_specification) ? (updated.bom_specification as Record<string, unknown>[]) : [];
            let lineNo = 0;
            for (const bl of bomSpecLines) {
              const compCode = String(bl.component_code ?? "").trim().toUpperCase();
              const matchedItem = compCode
                ? (await tx.query("SELECT id, base_uom FROM master.item WHERE upper(code) = $1", [compCode])).rows[0]
                : null;
              if (matchedItem) {
                lineNo++;
                await tx.query(
                  `INSERT INTO device.model_bom_line
                     (revision_id, line_no, station_code, component_item_id, qty_per_unit, uom, source_type, is_critical, notes, created_by, updated_by)
                   VALUES ($1, $2, 'STATION_1_MECH', $3, $4, $5, 'BUY', true, $6, $7, $7)`,
                  [
                    revRow.id,
                    lineNo,
                    matchedItem.id,
                    Number(bl.qty_per_kit ?? 1),
                    String(bl.uom || matchedItem.base_uom),
                    bl.role ? String(bl.role) : null,
                    actor.userId,
                  ]
                );
              }
            }
          }
        }
        await enqueueEvent(tx, "TechTransferAccepted", {
          package_id: updated.id,
          code: updated.code,
          project_id: updated.project_id,
          target_domain: updated.target_domain,
          target_org_unit_id: updated.target_org_unit_id,
          product_item_id: updated.product_item_id,
        });
      },
    },
    {
      action: "complete",
      from: "ACCEPTED",
      to: "COMPLETED",
      permission: "rd.transfer.accept",
      guards: [
        {
          code: "PILOT_LOT_REQUIRED",
          message: "Nhập mã lô Pilot / máy Pilot đầu tiên đạt QC (pilot_lot_ref) trước khi hoàn tất chuyển giao.",
          check: ({ row, payload }) => Boolean((payload.pilot_lot_ref as string)?.trim() || row.pilot_lot_ref?.trim()),
        },
      ],
      patch: ({ actor, row, payload }) => ({
        pilot_lot_ref: ((payload.pilot_lot_ref as string)?.trim() || row.pilot_lot_ref) ?? null,
        completed_by: actor.userId,
        completed_at: new Date(),
      }),
    },
  ],
});

/**
 * Software Release state machine (docs/nha-may/00-kien-truc.md D6 & 02 §5.4):
 * DRAFT → RELEASED ✍ (signed release) → WITHDRAWN 📝 (mandatory reason).
 */
export const swReleaseMachine = defineMachine<SwReleaseStatus, SwReleaseRow>({
  entityType: "rd_software_release",
  table: "rd.software_release",
  states: ["DRAFT", "RELEASED", "WITHDRAWN"],
  terminal: ["WITHDRAWN"],
  scopeOf: (row, tx) => projectOwner(tx!, row.project_id),
  transitions: [
    {
      action: "release",
      from: "DRAFT",
      to: "RELEASED",
      permission: "rd.transfer.manage",
      signature: "RELEASED",
      guards: [
        {
          code: "VALIDATION_REQUIRED",
          message: "Phải có tóm tắt kết quả kiểm thử / thẩm định (validation_summary) trước khi phát hành phần mềm.",
          check: ({ row }) => Boolean(row.validation_summary?.trim()),
        },
        {
          code: "IEC62304_SRS_FAILED",
          message: "Theo chuẩn IEC 62304, phần mềm Hạng B/C không được có ca kiểm thử yêu cầu (SRS Traceability) nào ở trạng thái FAIL.",
          check: ({ row }) => {
            const traces = Array.isArray(row.srs_traceability) ? row.srs_traceability : [];
            if (row.safety_class === "CLASS_C" && traces.length === 0) return false;
            return traces.every((t) => t.result !== "FAIL");
          },
        },
        {
          code: "IEC62304_CRITICAL_ANOMALY_OPEN",
          message: "Theo chuẩn IEC 62304, không được phát hành phần mềm khi còn lỗi (Known Anomaly) mức CRITICAL hoặc HIGH đang mở (OPEN).",
          check: ({ row }) => {
            const bugs = Array.isArray(row.known_anomalies) ? row.known_anomalies : [];
            return !bugs.some((b) => b.status === "OPEN" && (b.severity === "CRITICAL" || (row.safety_class === "CLASS_C" && b.severity === "HIGH")));
          },
        },
      ],
      patch: ({ actor }) => ({ released_by: actor.userId, released_at: new Date() }),
    },
    {
      action: "withdraw",
      from: "RELEASED",
      to: "WITHDRAWN",
      permission: "rd.transfer.manage",
      reasonRequired: true,
      patch: ({ reason }) => ({ withdraw_reason: reason }),
    },
  ],
});

const bomItemSchema = z.object({
  component_item_id: z.string().uuid().optional().nullable(),
  component_code: z.string().trim().min(1),
  component_name: z.string().trim().min(1),
  box_no: z.coerce.number().int().positive().optional().default(1),
  box_name: z.string().trim().max(150).optional().nullable(),
  qty_per_kit: z.coerce.number().positive(),
  uom: z.string().trim().min(1),
  role: z.string().trim().max(200).optional().nullable(),
});

const routingStepSchema = z.object({
  seq: z.coerce.number().int().positive(),
  step_name: z.string().trim().min(2),
  params: z.string().trim().max(500).optional().nullable(),
  qc_check: z.string().trim().max(300).optional().nullable(),
});

const createTransferSchema = z.object({
  project_id: z.string().uuid("chọn dự án R&D"),
  target_domain: z.enum(["KIT", "OLIGO", "DEVICE", "SOFTWARE"]),
  target_org_unit_id: z.string().uuid("chọn phòng nhận chuyển giao"),
  title: z.string().trim().min(3, "nhập tiêu đề gói chuyển giao").max(300),
  product_item_id: z.string().uuid().optional().nullable(),
  bom_specification: z.array(bomItemSchema).min(1, "nhập ít nhất 1 thành phần trong cấu trúc BOM").max(2000),
  routing_steps: z.array(routingStepSchema).max(200).default([]),
  stability_summary: z.string().trim().min(5, "nhập tóm tắt dữ liệu độ ổn định").max(4000),
  validation_summary: z.string().trim().min(5, "nhập tóm tắt kết quả thẩm định hiệu năng").max(4000),
  notes: z.string().trim().max(2000).optional().nullable(),
  submit_now: z.boolean().default(false),
});

export async function createTechTransferPackage(tx: Tx, actor: AuthzActor, input: unknown) {
  const d = parseInput(createTransferSchema, input);
  const owner = await projectOwner(tx, d.project_id);
  await authorize(tx, actor, "rd.transfer.manage", owner);
  const code = await nextNumber(tx, "RD_TECH_TRANSFER");
  const pkg = await insertRecord<TechTransferRow>(tx, actor, "rd.tech_transfer_package", "rd_tech_transfer", {
    code,
    project_id: d.project_id,
    target_domain: d.target_domain,
    target_org_unit_id: d.target_org_unit_id,
    title: d.title,
    product_item_id: d.product_item_id ?? null,
    bom_specification: JSON.stringify(d.bom_specification),
    routing_steps: JSON.stringify(d.routing_steps),
    stability_summary: d.stability_summary,
    validation_summary: d.validation_summary,
    notes: d.notes ?? null,
  });
  if (d.submit_now) {
    return runTransition(tx, techTransferMachine, actor, { id: pkg.id, action: "submit", expectedVersion: pkg.version });
  }
  return pkg;
}

export async function listTechTransfers(tx: Tx, actor: AuthzActor, projectId?: string) {
  await authorizeAnywhere(tx, actor, "rd.view");
  const rows = (
    await tx.query(
      `SELECT tt.*, p.code AS project_code, p.name AS project_name, p.owner_org_unit_id,
              tu.name AS target_org_unit_name, it.code AS product_item_code, it.name AS product_item_name,
              cs.code AS created_qc_spec_code, sb.display_name AS submitted_by_name, ab.display_name AS accepted_by_name
         FROM rd.tech_transfer_package tt
         JOIN rd.project p ON p.id = tt.project_id
         JOIN core.org_unit tu ON tu.id = tt.target_org_unit_id
         LEFT JOIN master.item it ON it.id = tt.product_item_id
         LEFT JOIN qms.qc_spec cs ON cs.id = tt.created_qc_spec_id
         LEFT JOIN core.user_profile sb ON sb.user_id = tt.submitted_by
         LEFT JOIN core.user_profile ab ON ab.user_id = tt.accepted_by
        WHERE ($1::uuid IS NULL OR tt.project_id = $1)
        ORDER BY tt.created_at DESC LIMIT 200`,
      [projectId ?? null]
    )
  ).rows;
  const visible = [];
  for (const r of rows) {
    const canSeeSource = await hasFactoryPermission(tx, actor, "rd.view", r.owner_org_unit_id);
    const canSeeTarget = await hasFactoryPermission(tx, actor, "rd.transfer.accept", r.target_org_unit_id);
    if (canSeeSource || canSeeTarget) {
      r.actions = await listAllowedActions(tx, techTransferMachine, actor, r);
      visible.push(r);
    }
  }
  return visible;
}

const createSwReleaseSchema = z.object({
  project_id: z.string().uuid("chọn dự án phần mềm / thiết bị"),
  version_tag: z.string().trim().regex(/^v?\d+\.\d+(\.\d+)?(-[A-Za-z0-9._-]+)?$/, "nhập phiên bản hợp lệ (ví dụ v1.2.0)"),
  target_kind: z.enum(["FIRMWARE", "ASSAY_CALLER", "LIMS_PLUGIN", "STANDALONE"]).default("STANDALONE"),
  safety_class: z.enum(["CLASS_A", "CLASS_B", "CLASS_C"]).default("CLASS_B"),
  srs_traceability: z
    .array(
      z.object({
        req_id: z.string().trim().min(1),
        title: z.string().trim().min(1),
        test_case_id: z.string().trim().min(1),
        result: z.enum(["PASS", "FAIL"]).default("PASS"),
      })
    )
    .default([]),
  soup_list: z
    .array(
      z.object({
        name: z.string().trim().min(1),
        version: z.string().trim().min(1),
        vendor: z.string().trim().optional(),
        cybersecurity_note: z.string().trim().optional(),
      })
    )
    .default([]),
  known_anomalies: z
    .array(
      z.object({
        bug_id: z.string().trim().min(1),
        severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).default("LOW"),
        description: z.string().trim().min(1),
        status: z.enum(["OPEN", "RESOLVED"]).default("OPEN"),
      })
    )
    .default([]),
  release_notes: z.string().trim().min(5, "nhập nội dung cập nhật (release notes)").max(4000),
  checksum_sha256: z.string().trim().regex(/^[0-9a-fA-F]{64}$/, "SHA-256 gồm 64 ký tự hex").optional().nullable(),
  validation_summary: z.string().trim().min(5, "nhập tóm tắt kết quả kiểm thử / thẩm định").max(4000),
});

export async function createSoftwareRelease(tx: Tx, actor: AuthzActor, input: unknown) {
  const d = parseInput(createSwReleaseSchema, input);
  const owner = await projectOwner(tx, d.project_id);
  await authorize(tx, actor, "rd.transfer.manage", owner);
  const code = await nextNumber(tx, "RD_SW_RELEASE");
  return insertRecord<SwReleaseRow>(tx, actor, "rd.software_release", "rd_software_release", {
    code,
    project_id: d.project_id,
    version_tag: d.version_tag,
    target_kind: d.target_kind,
    safety_class: d.safety_class,
    srs_traceability: JSON.stringify(d.srs_traceability),
    soup_list: JSON.stringify(d.soup_list),
    known_anomalies: JSON.stringify(d.known_anomalies),
    release_notes: d.release_notes,
    checksum_sha256: d.checksum_sha256 ? d.checksum_sha256.toLowerCase() : null,
    validation_summary: d.validation_summary,
  });
}

export async function listSoftwareReleases(tx: Tx, actor: AuthzActor, projectId?: string) {
  await authorizeAnywhere(tx, actor, "rd.view");
  const rows = (
    await tx.query(
      `SELECT sr.*, p.code AS project_code, p.name AS project_name, p.owner_org_unit_id,
              rb.display_name AS released_by_name
         FROM rd.software_release sr
         JOIN rd.project p ON p.id = sr.project_id
         LEFT JOIN core.user_profile rb ON rb.user_id = sr.released_by
        WHERE ($1::uuid IS NULL OR sr.project_id = $1)
        ORDER BY sr.created_at DESC LIMIT 200`,
      [projectId ?? null]
    )
  ).rows;
  const visible = [];
  for (const r of rows) {
    if (await hasFactoryPermission(tx, actor, "rd.view", r.owner_org_unit_id)) {
      r.actions = await listAllowedActions(tx, swReleaseMachine, actor, r);
      visible.push(r);
    }
  }
  return visible;
}
