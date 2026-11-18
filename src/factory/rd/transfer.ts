import path from "path";
import { z } from "zod/v3";
import type { Tx } from "../core/db";
import { writeAudit } from "../core/audit";
import { authorize, authorizeAnywhere, authorizeAnywhereOneOf, hasFactoryPermission, type AuthzActor } from "../core/authz";
import { conflict, invalid, notFound } from "../core/errors";
import { readAttachment, saveAttachment, sniffMime, type FileCategory } from "../core/files";
import { nextNumber } from "../core/numbering";
import { enqueueEvent } from "../core/outbox";
import { insertRecord, parseInput } from "../core/records";
import { defineMachine, listAllowedActions, runTransition } from "../core/stateMachine";
import { buildTraceability, openProblems } from "./software";
import "./permissions";

export type TransferStatus = "DRAFT" | "SUBMITTED" | "ACCEPTED" | "COMPLETED";
export type TransferItemStatus = "MISSING" | "SUBMITTED" | "VERIFIED" | "WAIVED";
export type SwReleaseStatus = "DRAFT" | "RELEASED" | "WITHDRAWN";

export interface NormalizedBomLine {
  line_no: number;
  component_item_id: string | null;
  component_code: string;
  component_name: string;
  box_no: number;
  box_name: string | null;
  qty_per_kit: number;
  qty_aliquoted: number | null;
  scrap_pct: number;
  uom: string;
  role: string | null;
  notes: string | null;
}

export interface NormalizedRoutingStep {
  seq: number;
  step_code: string;
  step_name: string;
  params: string | null;
  qc_check: string | null;
}

export interface QcReleaseCriterion {
  seq: number;
  stage: "IQC" | "IPQC" | "FQC" | "STABILITY";
  parameter: string;
  method: string | null;
  unit: string | null;
  target: string;
}

export interface TransferMetadata {
  pack_size?: string | null;
  storage_temp?: string | null;
  shelf_life_months?: number | null;
  shipping_condition?: string | null;
  compatible_instruments?: string | null;
  cleanroom_class?: string | null;
  pilot_batch_plan?: string | null;
}

export interface TechTransferRow {
  id: string;
  code: string;
  project_id: string;
  template_id: string | null;
  target_domain: "KIT" | "OLIGO" | "DEVICE" | "SOFTWARE";
  target_org_unit_id: string;
  title: string;
  product_item_id: string | null;
  bom_specification: NormalizedBomLine[];
  routing_steps: NormalizedRoutingStep[];
  qc_release_criteria: QcReleaseCriterion[];
  transfer_metadata: TransferMetadata;
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

const VALID_KIT_ROLES = new Set([
  "MASTER_MIX",
  "PRIMER_PROBE",
  "ENZYME",
  "POSITIVE_CONTROL",
  "NEGATIVE_CONTROL",
  "EXTRACTION_BUFFER",
  "PACKAGING",
  "SEMI_FINISHED",
  "REAGENT",
]);

function mapKitComponentRole(raw?: string | null): string {
  const upper = String(raw || "").trim().toUpperCase().replace(/\s+/g, "_");
  if (VALID_KIT_ROLES.has(upper)) return upper;
  return "REAGENT";
}

function sanitizeUom(raw?: string | null, fallback = "EA"): string {
  const clean = String(raw || "").trim().slice(0, 12);
  if (/^[A-Za-zµ0-9%/_-]{1,12}$/.test(clean)) return clean;
  return fallback;
}

export function normalizeBomLine(raw: any, index = 0): NormalizedBomLine {
  const qtyRaw = Number(raw?.qty_per_kit ?? raw?.qty_per_base ?? 1);
  const aliqRaw = raw?.qty_aliquoted != null && raw?.qty_aliquoted !== "" ? Number(raw.qty_aliquoted) : null;
  return {
    line_no: Number(raw?.line_no ?? index + 1),
    component_item_id: raw?.component_item_id ? String(raw.component_item_id) : raw?.item_id ? String(raw.item_id) : null,
    component_code: String(raw?.component_code ?? raw?.item_code ?? `COMP-${index + 1}`).trim(),
    component_name: String(raw?.component_name ?? raw?.item_name ?? raw?.component_code ?? raw?.item_code ?? `Thành phần ${index + 1}`).trim(),
    box_no: Math.max(1, Number(raw?.box_no ?? 1) || 1),
    box_name: raw?.box_name ? String(raw.box_name).trim() : null,
    qty_per_kit: Number.isFinite(qtyRaw) && qtyRaw > 0 ? qtyRaw : 1,
    qty_aliquoted: aliqRaw !== null && Number.isFinite(aliqRaw) && aliqRaw > 0 ? aliqRaw : null,
    scrap_pct: Number.isFinite(Number(raw?.scrap_pct)) ? Math.max(0, Math.min(100, Number(raw.scrap_pct))) : 0,
    uom: String(raw?.uom || "µL").trim() || "µL",
    role: raw?.role ? String(raw.role).trim() : null,
    notes: raw?.notes ? String(raw.notes).trim() : null,
  };
}

export function normalizeBomList(raw: unknown): NormalizedBomLine[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item, idx) => normalizeBomLine(item, idx));
}

export function normalizeRoutingList(raw: unknown): NormalizedRoutingStep[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((s: any, idx: number) => ({
    seq: Number(s?.seq ?? idx + 1),
    step_code: String(s?.step_code || `STEP-${idx + 1}`).trim(),
    step_name: String(s?.step_name || `Công đoạn ${idx + 1}`).trim(),
    params: s?.params ? String(s.params).trim() : s?.instructions ? String(s.instructions).trim() : null,
    qc_check: s?.qc_check ? String(s.qc_check).trim() : null,
  }));
}

export function normalizeQcCriteria(raw: unknown): QcReleaseCriterion[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((c: any, idx: number) => {
    const stUpper = String(c?.stage || "FQC").toUpperCase();
    const stage: QcReleaseCriterion["stage"] =
      stUpper === "IQC" || stUpper === "IPQC" || stUpper === "STABILITY" ? stUpper : "FQC";
    return {
      seq: Number(c?.seq ?? idx + 1),
      stage,
      parameter: String(c?.parameter || "").trim(),
      method: c?.method ? String(c.method).trim() : null,
      unit: c?.unit ? String(c.unit).trim() : null,
      target: String(c?.target || "Đạt").trim(),
    };
  }).filter((c) => c.parameter.length > 0);
}

/**
 * Traceability of a release: generated from the project's requirements, test cases and the runs on this version
 * when the project keeps them (KTCN software lifecycle), else the matrix typed on the release.
 */
async function releaseTraceability(tx: Tx, row: SwReleaseRow): Promise<{ req_id: string; title: string; test_case_id: string; result: string }[]> {
  return (await buildTraceability(tx, row.project_id, row.version_tag)) ?? (Array.isArray(row.srs_traceability) ? row.srs_traceability : []);
}

/** Known anomalies of a release: those typed on it plus the project's problem reports not yet verified fixed. */
async function releaseAnomalies(tx: Tx, row: SwReleaseRow): Promise<{ bug_id: string; severity: string; description: string; status: string }[]> {
  const typed = Array.isArray(row.known_anomalies) ? row.known_anomalies : [];
  const reported = await openProblems(tx, row.project_id);
  return [...typed.filter((t) => !reported.some((r) => r.bug_id === t.bug_id)), ...reported];
}

async function projectOwner(tx: Tx, projectId: string): Promise<string> {
  const p = (await tx.query("SELECT owner_org_unit_id FROM rd.project WHERE id = $1", [projectId])).rows[0];
  if (!p) throw notFound("dự án R&D");
  return p.owner_org_unit_id;
}

async function loadPackageWithScope(tx: Tx, packageId: string) {
  const pkg = (
    await tx.query(
      `SELECT tt.*, p.owner_org_unit_id, p.code AS project_code, p.name AS project_name
         FROM rd.tech_transfer_package tt
         JOIN rd.project p ON p.id = tt.project_id
        WHERE tt.id = $1`,
      [packageId]
    )
  ).rows[0];
  if (!pkg) throw notFound("gói chuyển giao công nghệ");
  return pkg as TechTransferRow & { owner_org_unit_id: string; project_code: string; project_name: string };
}

/**
 * Technology Transfer state machine (docs/nha-may/02 §7.6):
 * DRAFT → SUBMITTED (by R&D) → ACCEPTED ✍ (signed by receiving production department head) → COMPLETED.
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
          check: ({ row }) =>
            (Array.isArray(row.bom_specification) && row.bom_specification.length > 0) ||
            (Array.isArray(row.routing_steps) && row.routing_steps.length > 0),
        },
        {
          code: "MISSING_REQUIRED_DOSSIER",
          message:
            "Hồ sơ chuyển giao còn hạng mục bắt buộc ở trạng thái Chưa nộp (MISSING). Vui lòng đính kèm file minh chứng, nhập mã tài liệu tham chiếu hoặc chọn Miễn trừ (WAIVED) kèm lý do trước khi gửi sang Sản xuất.",
          check: async ({ tx, row }) => {
            const stats = (
              await tx.query(
                `SELECT count(*)::int AS total_req,
                        count(*) FILTER (WHERE status = 'MISSING')::int AS missing_req
                   FROM rd.tech_transfer_item
                  WHERE package_id = $1 AND is_required = true`,
                [row.id]
              )
            ).rows[0];
            if (!stats || stats.total_req === 0) return true;
            return stats.missing_req === 0;
          },
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
        const bomSpecLines = normalizeBomList(updated.bom_specification);
        const rtSteps = normalizeRoutingList(updated.routing_steps);

        // Ensure product_item_id exists in master.item if not linked yet
        let productItemId = updated.product_item_id;
        if (!productItemId && (updated.target_domain === "KIT" || updated.target_domain === "DEVICE")) {
          const proj = (await tx.query("SELECT code, name FROM rd.project WHERE id = $1", [updated.project_id])).rows[0];
          const prodCode = `PRD-${String(proj?.code || updated.code).toUpperCase().replace(/[^A-Z0-9-]/g, "")}`;
          const existingProd = (await tx.query("SELECT id FROM master.item WHERE upper(code) = $1 LIMIT 1", [prodCode])).rows[0];
          if (existingProd) {
            productItemId = existingProd.id;
          } else {
            const targetUom = updated.target_domain === "KIT" ? "KIT" : "EA";
            const uomName = updated.target_domain === "KIT" ? "Bộ Kit" : "Cái";
            await tx.query(
              `INSERT INTO master.uom (code, name, dimension) VALUES ($1, $2, 'COUNT') ON CONFLICT (code) DO NOTHING`,
              [targetUom, uomName]
            );
            const itemType = updated.target_domain === "KIT" ? "FINISHED_KIT" : "DEVICE";
            const newProd = (
              await tx.query(
                `INSERT INTO master.item (code, name, item_type, base_uom, tracking, shelf_life_days, status, created_by, updated_by)
                 VALUES ($1, $2, $3, $4, 'LOT', 365, 'ACTIVE', $5, $5) RETURNING id`,
                [prodCode, updated.title, itemType, targetUom, actor.userId]
              )
            ).rows[0];
            productItemId = newProd.id;
          }
          await tx.query("UPDATE rd.tech_transfer_package SET product_item_id = $2 WHERE id = $1", [updated.id, productItemId]);
          updated.product_item_id = productItemId;
        }

        const resolveOrCreateComponentItem = async (bl: NormalizedBomLine) => {
          const compCode = bl.component_code.trim().toUpperCase();
          let matched = bl.component_item_id
            ? (await tx.query("SELECT id, base_uom FROM master.item WHERE id = $1", [bl.component_item_id])).rows[0]
            : compCode
              ? (await tx.query("SELECT id, base_uom FROM master.item WHERE upper(code) = $1", [compCode])).rows[0]
              : null;
          if (!matched && compCode) {
            const safeUom = sanitizeUom(bl.uom, "EA");
            await tx.query(
              `INSERT INTO master.uom (code, name, dimension) VALUES ($1, $1, 'COUNT') ON CONFLICT (code) DO NOTHING`,
              [safeUom]
            );
            matched = (
              await tx.query(
                `INSERT INTO master.item (code, name, item_type, base_uom, tracking, shelf_life_days, status, created_by, updated_by)
                 VALUES ($1, $2, 'RAW_MATERIAL', $3, 'LOT', 365, 'ACTIVE', $4, $4)
                 ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
                 RETURNING id, base_uom`,
                [compCode, bl.component_name || compCode, safeUom, actor.userId]
              )
            ).rows[0];
          }
          return matched as { id: string; base_uom: string } | null;
        };

        // Automatically generate a DRAFT QC Specification in QMS
        if (updated.product_item_id && !updated.created_qc_spec_id) {
          const existingDraft = await tx.query(
            "SELECT id FROM qms.qc_spec WHERE item_id = $1 AND applies_to = 'PRODUCT' AND status = 'DRAFT' LIMIT 1",
            [updated.product_item_id]
          );
          if (!existingDraft.rowCount) {
            const tppRows = (
              await tx.query("SELECT * FROM rd.spec_evaluation WHERE project_id = $1 ORDER BY category, parameter", [updated.project_id])
            ).rows;
            const customCriteria = normalizeQcCriteria(updated.qc_release_criteria);
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

            const mergedParams: { seq: number; name: string; method: string | null; unit: string | null; target: string }[] = [];
            const seenNames = new Set<string>();
            for (const c of customCriteria) {
              seenNames.add(c.parameter.toLowerCase());
              mergedParams.push({
                seq: mergedParams.length + 1,
                name: c.parameter,
                method: c.method || c.stage,
                unit: c.unit,
                target: c.target,
              });
            }
            for (const r of tppRows) {
              const pName = String(r.parameter || "").trim();
              if (!pName || seenNames.has(pName.toLowerCase())) continue;
              seenNames.add(pName.toLowerCase());
              mergedParams.push({
                seq: mergedParams.length + 1,
                name: pName,
                method: r.method_ref || r.category,
                unit: r.unit || null,
                target: r.target_value,
              });
            }
            if (mergedParams.length === 0) {
              mergedParams.push({
                seq: 1,
                name: "Ngoại quan & Hiệu năng theo hồ sơ chuyển giao",
                method: "SOP R&D",
                unit: null,
                target: "Đạt",
              });
            }
            for (const p of mergedParams) {
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

            let lineNo = 0;
            for (const bl of bomSpecLines) {
              const matchedItem = await resolveOrCreateComponentItem(bl);
              if (matchedItem && matchedItem.id !== updated.product_item_id) {
                lineNo++;
                await tx.query(
                  `INSERT INTO kit.bom_line
                     (bom_id, line_no, component_item_id, qty_per_base, qty_per_base_aliquoted, uom, scrap_pct, box_no, component_role, is_critical, notes, created_by, updated_by)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, $10, $11, $11)`,
                  [
                    bomRow.id,
                    lineNo,
                    matchedItem.id,
                    bl.qty_per_kit,
                    bl.qty_aliquoted,
                    bl.uom || matchedItem.base_uom,
                    bl.scrap_pct,
                    bl.box_no,
                    mapKitComponentRole(bl.role),
                    bl.notes || bl.role || null,
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

            for (const [idx, st] of rtSteps.entries()) {
              const stepSeq = st.seq || idx + 1;
              await tx.query(
                `INSERT INTO kit.routing_step
                   (routing_id, seq, step_code, step_name, category, instructions, param_schema, is_qc, requires_check_signature, allow_skip, std_duration_min)
                 VALUES ($1, $2, $3, $4, 'FORMULATION', $5, $6, $7, true, false, 30)
                 ON CONFLICT (routing_id, seq) DO NOTHING`,
                [
                  rtRow.id,
                  stepSeq,
                  st.step_code || `STEP-${stepSeq}`,
                  st.step_name || `Bước ${stepSeq}`,
                  st.params || st.step_name || "Thực hiện theo hồ sơ chuyển giao công nghệ R&D",
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
            let lineNo = 0;
            for (const bl of bomSpecLines) {
              const matchedItem = await resolveOrCreateComponentItem(bl);
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
                    bl.qty_per_kit,
                    bl.uom || matchedItem.base_uom,
                    bl.notes || bl.role || null,
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
      permission: "rd.software.release",
      signature: "RELEASED",
      guards: [
        {
          code: "SELF_RELEASE",
          message: "Người ký phát hành phải khác người lập bản phát hành (Trưởng phòng chủ trì hoặc Ban Giám Đốc ký).",
          check: ({ actor, row }) => row.created_by !== actor.userId,
        },
        {
          code: "VALIDATION_REQUIRED",
          message: "Phải có tóm tắt kết quả kiểm thử / thẩm định (validation_summary) trước khi phát hành phần mềm.",
          check: ({ row }) => Boolean(row.validation_summary?.trim()),
        },
        {
          code: "IEC62304_SRS_FAILED",
          message:
            "Theo chuẩn IEC 62304, phần mềm Hạng B/C bắt buộc phải có ma trận truy xuất yêu cầu (SRS Traceability) và 100% yêu cầu có ca kiểm thử đạt (PASS) trên đúng phiên bản phát hành.",
          check: async ({ tx, row }) => {
            const traces = await releaseTraceability(tx, row);
            if ((row.safety_class === "CLASS_C" || row.safety_class === "CLASS_B") && traces.length === 0) return false;
            return traces.every((t) => t.result === "PASS");
          },
        },
        {
          code: "IEC62304_CRITICAL_ANOMALY_OPEN",
          message: "Theo chuẩn IEC 62304, không được phát hành phần mềm khi còn lỗi (Known Anomaly) mức CRITICAL hoặc HIGH đang mở (OPEN).",
          check: async ({ tx, row }) => {
            const bugs = await releaseAnomalies(tx, row);
            return !bugs.some((b) => b.status === "OPEN" && (b.severity === "CRITICAL" || (row.safety_class === "CLASS_C" && b.severity === "HIGH")));
          },
        },
      ],
      patch: async ({ tx, actor, row }) => ({
        released_by: actor.userId,
        released_at: new Date(),
        srs_traceability: JSON.stringify(await releaseTraceability(tx, row)),
        known_anomalies: JSON.stringify(await releaseAnomalies(tx, row)),
      }),
    },
    {
      action: "withdraw",
      from: "RELEASED",
      to: "WITHDRAWN",
      permission: "rd.software.release",
      reasonRequired: true,
      patch: ({ reason }) => ({ withdraw_reason: reason }),
      effects: async ({ tx, actor, updated, reason }) => {
        const linkedUnits = (
          await tx.query("SELECT id, serial_no FROM device.device_unit WHERE firmware_release_id = $1", [updated.id])
        ).rows;
        const linkedRevs = (
          await tx.query(
            `SELECT r.id, r.revision, m.code AS model_code
               FROM device.model_revision r
               JOIN device.device_model m ON m.id = r.model_id
              WHERE r.firmware_release_id = $1`,
            [updated.id]
          )
        ).rows;
        const devCode = await nextNumber(tx, "DEVIATION");
        const affectedSummary = [
          linkedRevs.length > 0
            ? `Phiên bản DMR ảnh hưởng: ${linkedRevs.map((r) => `${r.model_code} Rev ${r.revision}`).join(", ")}`
            : null,
          linkedUnits.length > 0
            ? `Thiết bị xuất xưởng ảnh hưởng (${linkedUnits.length} máy): ${linkedUnits.map((u) => u.serial_no).join(", ")}`
            : null,
        ]
          .filter(Boolean)
          .join("; ");
        await tx.query(
          `INSERT INTO qms.deviation
             (code, source_module, category, entity_type, entity_id, title, severity, description, detected_by, status, created_by, updated_by)
           VALUES ($1, 'RD', 'SOFTWARE_RECALL', 'SOFTWARE_RELEASE', $2, $3, 'CRITICAL', $4, $5, 'OPEN', $5, $5)`,
          [
            devCode,
            updated.id,
            `Thu hồi phiên bản phần mềm/Firmware ${updated.code} (${updated.version_tag})`,
            `Thu hồi phần mềm ${updated.code} (${updated.version_tag}) — Lý do: ${reason ?? updated.withdraw_reason ?? "Thu hồi khẩn cấp"}. ${affectedSummary}`.trim(),
            actor.userId,
          ]
        );
      },
    },
  ],
});

// ============================================================================
// SCHEMAS FOR TECH TRANSFER TEMPLATES & PACKAGES
// ============================================================================

const templateItemSchema = z.object({
  seq: z.coerce.number().int().positive(),
  section_code: z.string().trim().min(1).max(60).default("GENERAL"),
  section_name: z.string().trim().min(1).max(200),
  doc_code: z.string().trim().min(1).max(60),
  item_name: z.string().trim().min(2).max(300),
  guidance: z.string().trim().max(1000).optional().nullable(),
  is_required: z.boolean().default(true),
});

const saveTemplateSchema = z.object({
  id: z.string().uuid().optional().nullable(),
  code: z.string().trim().max(60).optional().nullable(),
  name: z.string().trim().min(3, "nhập tên mẫu hồ sơ chuyển giao").max(250),
  domain: z.enum(["KIT", "OLIGO", "DEVICE", "SOFTWARE", "OTHER"]).default("KIT"),
  description: z.string().trim().max(1000).optional().nullable(),
  is_default: z.boolean().default(false),
  items: z.array(templateItemSchema).min(1, "cần ít nhất 1 hạng mục hồ sơ trong mẫu").max(100),
});

const bomItemSchema = z
  .object({
    component_item_id: z.string().uuid().optional().nullable(),
    item_id: z.string().uuid().optional().nullable(),
    component_code: z.string().trim().optional().nullable(),
    item_code: z.string().trim().optional().nullable(),
    component_name: z.string().trim().optional().nullable(),
    item_name: z.string().trim().optional().nullable(),
    box_no: z.coerce.number().int().positive().optional().default(1),
    box_name: z.string().trim().max(150).optional().nullable(),
    qty_per_kit: z.coerce.number().positive().optional(),
    qty_per_base: z.coerce.number().positive().optional(),
    qty_aliquoted: z.coerce.number().positive().optional().nullable(),
    scrap_pct: z.coerce.number().min(0).max(100).optional().default(0),
    uom: z.string().trim().min(1),
    role: z.string().trim().max(200).optional().nullable(),
    notes: z.string().trim().max(500).optional().nullable(),
  })
  .refine(
    (v) => Boolean((v.component_code || v.item_code || "").trim()) && Boolean((v.component_name || v.item_name || "").trim()),
    { message: "nhập mã và tên thành phần BOM" }
  )
  .transform((v, ctx) => {
    const qty = v.qty_per_kit ?? v.qty_per_base;
    if (!qty || qty <= 0) {
      ctx.addIssue({ code: "custom", message: "định mức / kit phải lớn hơn 0" });
      return z.NEVER;
    }
    return {
      component_item_id: v.component_item_id ?? v.item_id ?? null,
      component_code: (v.component_code || v.item_code || "").trim(),
      component_name: (v.component_name || v.item_name || "").trim(),
      box_no: v.box_no ?? 1,
      box_name: v.box_name ?? null,
      qty_per_kit: qty,
      qty_aliquoted: v.qty_aliquoted ?? null,
      scrap_pct: v.scrap_pct ?? 0,
      uom: v.uom,
      role: v.role ?? null,
      notes: v.notes ?? null,
    };
  });

const routingStepSchema = z.object({
  seq: z.coerce.number().int().positive(),
  step_code: z.string().trim().max(60).optional().nullable(),
  step_name: z.string().trim().min(2),
  params: z.string().trim().max(1000).optional().nullable(),
  instructions: z.string().trim().max(1000).optional().nullable(),
  qc_check: z.string().trim().max(500).optional().nullable(),
});

const qcCriterionSchema = z.object({
  seq: z.coerce.number().int().positive().optional(),
  stage: z.enum(["IQC", "IPQC", "FQC", "STABILITY"]).default("FQC"),
  parameter: z.string().trim().min(1).max(200),
  method: z.string().trim().max(200).optional().nullable(),
  unit: z.string().trim().max(60).optional().nullable(),
  target: z.string().trim().min(1).max(200),
});

const transferMetadataSchema = z
  .object({
    pack_size: z.string().trim().max(200).optional().nullable(),
    storage_temp: z.string().trim().max(120).optional().nullable(),
    shelf_life_months: z.coerce.number().int().positive().max(120).optional().nullable(),
    shipping_condition: z.string().trim().max(200).optional().nullable(),
    compatible_instruments: z.string().trim().max(300).optional().nullable(),
    cleanroom_class: z.string().trim().max(120).optional().nullable(),
    pilot_batch_plan: z.string().trim().max(400).optional().nullable(),
  })
  .optional()
  .default({});

const dossierItemInputSchema = z.object({
  template_item_id: z.string().uuid().optional().nullable(),
  seq: z.coerce.number().int().positive().optional(),
  section_code: z.string().trim().min(1).max(60).default("CUSTOM"),
  section_name: z.string().trim().min(1).max(200).default("9. Hồ sơ Bổ sung Tùy chỉnh"),
  doc_code: z.string().trim().min(1).max(60).default("DOC-CUSTOM"),
  item_name: z.string().trim().min(2).max(300),
  guidance: z.string().trim().max(1000).optional().nullable(),
  is_required: z.boolean().default(true),
  doc_ref_code: z.string().trim().max(200).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  status: z.enum(["MISSING", "SUBMITTED", "VERIFIED", "WAIVED"]).default("MISSING"),
});

const createTransferSchema = z.object({
  project_id: z.string().uuid("chọn dự án R&D"),
  template_id: z.string().uuid().optional().nullable(),
  target_domain: z.enum(["KIT", "OLIGO", "DEVICE", "SOFTWARE"]),
  target_org_unit_id: z.string().uuid("chọn phòng nhận chuyển giao"),
  title: z.string().trim().min(3, "nhập tiêu đề gói chuyển giao").max(300),
  product_item_id: z.string().uuid().optional().nullable(),
  bom_specification: z.array(bomItemSchema).min(1, "nhập ít nhất 1 thành phần trong cấu trúc BOM").max(2000),
  routing_steps: z.array(routingStepSchema).max(200).default([]),
  qc_release_criteria: z.array(qcCriterionSchema).max(200).default([]),
  transfer_metadata: transferMetadataSchema,
  dossier_items: z.array(dossierItemInputSchema).max(150).optional(),
  stability_summary: z.string().trim().min(5, "nhập tóm tắt dữ liệu độ ổn định").max(4000),
  validation_summary: z.string().trim().min(5, "nhập tóm tắt kết quả thẩm định hiệu năng").max(4000),
  pilot_lot_ref: z.string().trim().max(250).optional().nullable(),
  notes: z.string().trim().max(4000).optional().nullable(),
  submit_now: z.boolean().default(false),
});

const updateTransferSchema = z.object({
  target_domain: z.enum(["KIT", "OLIGO", "DEVICE", "SOFTWARE"]).optional(),
  target_org_unit_id: z.string().uuid().optional(),
  title: z.string().trim().min(3).max(300).optional(),
  product_item_id: z.string().uuid().optional().nullable(),
  bom_specification: z.array(bomItemSchema).min(1).max(2000).optional(),
  routing_steps: z.array(routingStepSchema).max(200).optional(),
  qc_release_criteria: z.array(qcCriterionSchema).max(200).optional(),
  transfer_metadata: transferMetadataSchema.optional(),
  stability_summary: z.string().trim().min(5).max(4000).optional(),
  validation_summary: z.string().trim().min(5).max(4000).optional(),
  pilot_lot_ref: z.string().trim().max(250).optional().nullable(),
  notes: z.string().trim().max(4000).optional().nullable(),
});

// ============================================================================
// TEMPLATE MANAGEMENT FUNCTIONS
// ============================================================================

export async function listTransferTemplates(tx: Tx, actor: AuthzActor, domain?: string) {
  await authorizeAnywhereOneOf(tx, actor, ["rd.view", "it.view"]);
  const templates = (
    await tx.query(
      `SELECT tt.*,
              (SELECT count(*)::int FROM rd.tech_transfer_package p WHERE p.template_id = tt.id) AS package_count
         FROM rd.transfer_template tt
        WHERE tt.status = 'ACTIVE'
          AND ($1::text IS NULL OR tt.domain = $1)
        ORDER BY tt.is_default DESC, tt.domain ASC, tt.created_at ASC`,
      [domain || null]
    )
  ).rows;
  if (!templates.length) return [];
  const items = (
    await tx.query(
      `SELECT * FROM rd.transfer_template_item
        WHERE template_id = ANY($1::uuid[])
        ORDER BY seq ASC`,
      [templates.map((t) => t.id)]
    )
  ).rows;
  const byTpl = new Map<string, any[]>();
  for (const it of items) {
    const arr = byTpl.get(it.template_id) ?? [];
    arr.push(it);
    byTpl.set(it.template_id, arr);
  }
  return templates.map((t) => ({ ...t, items: byTpl.get(t.id) ?? [] }));
}

export async function saveTransferTemplate(tx: Tx, actor: AuthzActor, input: unknown) {
  await authorizeAnywhere(tx, actor, "rd.transfer.manage");
  const d = parseInput(saveTemplateSchema, input);

  if (d.is_default) {
    await tx.query(
      "UPDATE rd.transfer_template SET is_default = false, updated_at = now(), updated_by = $2 WHERE domain = $1 AND is_default = true",
      [d.domain, actor.userId]
    );
  }

  let tplRow: any;
  if (d.id) {
    const existing = (await tx.query("SELECT * FROM rd.transfer_template WHERE id = $1 FOR UPDATE", [d.id])).rows[0];
    if (!existing) throw notFound("mẫu hồ sơ chuyển giao");
    tplRow = (
      await tx.query(
        `UPDATE rd.transfer_template
            SET name = $2, domain = $3, description = $4, is_default = $5,
                version = version + 1, updated_at = now(), updated_by = $6
          WHERE id = $1 RETURNING *`,
        [d.id, d.name, d.domain, d.description ?? null, d.is_default, actor.userId]
      )
    ).rows[0];
    await tx.query("DELETE FROM rd.transfer_template_item WHERE template_id = $1", [d.id]);
  } else {
    const code = d.code?.trim() || (await nextNumber(tx, "RD_TRANSFER_TEMPLATE"));
    tplRow = await insertRecord<any>(tx, actor, "rd.transfer_template", "rd_transfer_template", {
      code,
      name: d.name,
      domain: d.domain,
      description: d.description ?? null,
      is_default: d.is_default,
      status: "ACTIVE",
    });
  }

  const insertedItems = [];
  for (const [idx, item] of d.items.entries()) {
    const res = (
      await tx.query(
        `INSERT INTO rd.transfer_template_item
           (template_id, seq, section_code, section_name, doc_code, item_name, guidance, is_required)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [tplRow.id, idx + 1, item.section_code, item.section_name, item.doc_code, item.item_name, item.guidance ?? null, item.is_required]
      )
    ).rows[0];
    insertedItems.push(res);
  }

  await writeAudit(tx, actor, {
    entityType: "rd_transfer_template",
    entityId: tplRow.id,
    action: d.id ? "update" : "create",
    changes: { name: [null, tplRow.name], items_count: [null, insertedItems.length] },
  });

  return { ...tplRow, items: insertedItems };
}

export async function deleteTransferTemplate(tx: Tx, actor: AuthzActor, id: string) {
  await authorizeAnywhere(tx, actor, "rd.transfer.manage");
  const cur = (await tx.query("SELECT * FROM rd.transfer_template WHERE id = $1 FOR UPDATE", [id])).rows[0];
  if (!cur) throw notFound("mẫu hồ sơ chuyển giao");

  const activeInDomain = Number(
    (await tx.query("SELECT count(*)::int AS c FROM rd.transfer_template WHERE domain = $1 AND status = 'ACTIVE'", [cur.domain])).rows[0].c
  );
  if (activeInDomain <= 1) {
    throw invalid(`Không thể xóa mẫu cuối cùng của mảng ${cur.domain}. Hãy tạo mẫu thay thế trước.`);
  }

  const usedCount = Number(
    (await tx.query("SELECT count(*)::int AS c FROM rd.tech_transfer_package WHERE template_id = $1", [id])).rows[0].c
  );
  if (usedCount > 0) {
    await tx.query(
      "UPDATE rd.transfer_template SET status = 'INACTIVE', is_default = false, updated_at = now(), updated_by = $2 WHERE id = $1",
      [id, actor.userId]
    );
  } else {
    await tx.query("DELETE FROM rd.transfer_template WHERE id = $1", [id]);
  }
  await writeAudit(tx, actor, {
    entityType: "rd_transfer_template",
    entityId: id,
    action: "delete",
    changes: { code: [cur.code, null] },
  });
  return { deleted: true };
}

// ============================================================================
// PREFILL FROM R&D PROJECT (BOM + TPP + STAGE-GATES)
// ============================================================================

export async function getProjectTransferPrefill(tx: Tx, actor: AuthzActor, projectId: string) {
  const proj = (await tx.query("SELECT * FROM rd.project WHERE id = $1", [projectId])).rows[0];
  if (!proj) throw notFound("dự án R&D");
  await authorize(tx, actor, "rd.view", proj.owner_org_unit_id);

  const targetDomain = ["KIT", "OLIGO", "DEVICE", "SOFTWARE"].includes(proj.target_domain) ? proj.target_domain : "KIT";
  const targetModule = targetDomain === "SOFTWARE" ? "IT" : targetDomain;
  const targetUnit = (
    await tx.query("SELECT id FROM core.org_unit WHERE module_key = $1 AND status = 'ACTIVE' LIMIT 1", [targetModule])
  ).rows[0];

  const bomLines = (
    await tx.query(
      `SELECT pb.*, i.code AS item_code, i.name AS item_name
         FROM rd.project_prototype_bom pb
         JOIN master.item i ON i.id = pb.component_item_id
        WHERE pb.project_id = $1
        ORDER BY pb.line_no ASC`,
      [projectId]
    )
  ).rows;

  const specs = (
    await tx.query("SELECT * FROM rd.spec_evaluation WHERE project_id = $1 ORDER BY category, parameter", [projectId])
  ).rows;

  const deliverables = (
    await tx.query(
      `SELECT gd.id, gd.doc_type, gd.item_name, gd.notes, gd.status, pg.gate_no, pg.gate_name
         FROM rd.gate_deliverable gd
         JOIN rd.project_gate pg ON pg.id = gd.project_gate_id
        WHERE pg.project_id = $1
        ORDER BY pg.gate_no ASC, gd.seq ASC`,
      [projectId]
    )
  ).rows;

  return {
    project: {
      id: proj.id,
      code: proj.code,
      name: proj.name,
      target_domain: targetDomain,
      target_product_item_id: proj.target_product_item_id ?? null,
      target_org_unit_id: targetUnit?.id ?? null,
    },
    bom_specification: bomLines.map((l, i) =>
      normalizeBomLine(
        {
          line_no: l.line_no ?? i + 1,
          component_item_id: l.component_item_id,
          component_code: l.item_code,
          component_name: l.item_name,
          qty_per_kit: Number(l.qty_per_base),
          uom: l.uom,
          scrap_pct: Number(l.scrap_pct ?? 0),
          role: l.component_role,
          notes: l.notes,
        },
        i
      )
    ),
    qc_release_criteria: specs.map((s, idx) => ({
      seq: idx + 1,
      stage: "FQC" as const,
      parameter: s.parameter,
      method: s.method_ref || s.category || "TCCS",
      unit: s.unit || null,
      target: s.actual_value || s.target_value || "Đạt",
    })),
    validation_summary: specs.length
      ? `Tổng hợp ${specs.length} chỉ tiêu thiết kế TPP (${specs.filter((s) => s.result === "PASS").length} PASS): ` +
        specs.map((s) => `${s.parameter}: ${s.actual_value || s.target_value}${s.unit ? ` ${s.unit}` : ""}`).join("; ")
      : "",
    gate_deliverables: deliverables,
  };
}

// ============================================================================
// TECH TRANSFER PACKAGE CRUD & DOSSIER ITEMS / ATTACHMENTS
// ============================================================================

export async function createTechTransferPackage(tx: Tx, actor: AuthzActor, input: unknown) {
  const d = parseInput(createTransferSchema, input);
  const owner = await projectOwner(tx, d.project_id);
  await authorize(tx, actor, "rd.transfer.manage", owner);
  const code = await nextNumber(tx, "RD_TECH_TRANSFER");

  let templateId = d.template_id ?? null;
  let itemsToSeed: Array<{
    template_item_id?: string | null;
    seq: number;
    section_code: string;
    section_name: string;
    doc_code: string;
    item_name: string;
    guidance?: string | null;
    is_required: boolean;
    doc_ref_code?: string | null;
    notes?: string | null;
    status: TransferItemStatus;
  }> = [];

  if (d.dossier_items && d.dossier_items.length > 0) {
    itemsToSeed = d.dossier_items.map((it, idx) => ({
      template_item_id: it.template_item_id ?? null,
      seq: it.seq ?? idx + 1,
      section_code: it.section_code,
      section_name: it.section_name,
      doc_code: it.doc_code,
      item_name: it.item_name,
      guidance: it.guidance ?? null,
      is_required: it.is_required,
      doc_ref_code: it.doc_ref_code ?? null,
      notes: it.notes ?? null,
      status: it.status,
    }));
  } else if (templateId) {
    const tplItems = (
      await tx.query("SELECT * FROM rd.transfer_template_item WHERE template_id = $1 ORDER BY seq ASC", [templateId])
    ).rows;
    itemsToSeed = tplItems.map((ti, idx) => ({
      template_item_id: ti.id,
      seq: ti.seq ?? idx + 1,
      section_code: ti.section_code,
      section_name: ti.section_name,
      doc_code: ti.doc_code,
      item_name: ti.item_name,
      guidance: ti.guidance ?? null,
      is_required: Boolean(ti.is_required),
      doc_ref_code: null,
      notes: null,
      status: "MISSING",
    }));
  }

  const pkg = await insertRecord<TechTransferRow>(tx, actor, "rd.tech_transfer_package", "rd_tech_transfer", {
    code,
    project_id: d.project_id,
    template_id: templateId,
    target_domain: d.target_domain,
    target_org_unit_id: d.target_org_unit_id,
    title: d.title,
    product_item_id: d.product_item_id ?? null,
    bom_specification: JSON.stringify(d.bom_specification),
    routing_steps: JSON.stringify(normalizeRoutingList(d.routing_steps)),
    qc_release_criteria: JSON.stringify(normalizeQcCriteria(d.qc_release_criteria)),
    transfer_metadata: JSON.stringify(d.transfer_metadata ?? {}),
    stability_summary: d.stability_summary,
    validation_summary: d.validation_summary,
    pilot_lot_ref: d.pilot_lot_ref ?? null,
    notes: d.notes ?? null,
  });

  for (const it of itemsToSeed) {
    await tx.query(
      `INSERT INTO rd.tech_transfer_item
         (package_id, template_item_id, seq, section_code, section_name, doc_code, item_name, guidance, is_required, doc_ref_code, notes, status, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        pkg.id,
        it.template_item_id ?? null,
        it.seq,
        it.section_code,
        it.section_name,
        it.doc_code,
        it.item_name,
        it.guidance ?? null,
        it.is_required,
        it.doc_ref_code ?? null,
        it.notes ?? null,
        it.status,
        actor.userId,
      ]
    );
  }

  if (d.submit_now) {
    return runTransition(tx, techTransferMachine, actor, { id: pkg.id, action: "submit", expectedVersion: pkg.version });
  }
  return pkg;
}

export async function listTechTransfers(tx: Tx, actor: AuthzActor, projectId?: string) {
  await authorizeAnywhereOneOf(tx, actor, ["rd.view", "it.view"]);
  const rows = (
    await tx.query(
      `SELECT tt.*, p.code AS project_code, p.name AS project_name, p.owner_org_unit_id,
              tu.name AS target_org_unit_name, it.code AS product_item_code, it.name AS product_item_name,
              cs.code AS created_qc_spec_code, sb.display_name AS submitted_by_name, ab.display_name AS accepted_by_name,
              tpl.code AS template_code, tpl.name AS template_name,
              (SELECT count(*)::int FROM rd.tech_transfer_item di WHERE di.package_id = tt.id) AS dossier_total,
              (SELECT count(*)::int FROM rd.tech_transfer_item di WHERE di.package_id = tt.id AND di.status IN ('SUBMITTED', 'VERIFIED', 'WAIVED')) AS dossier_done,
              (SELECT count(*)::int FROM rd.tech_transfer_item di WHERE di.package_id = tt.id AND di.is_required = true) AS required_total,
              (SELECT count(*)::int FROM rd.tech_transfer_item di WHERE di.package_id = tt.id AND di.is_required = true AND di.status IN ('SUBMITTED', 'VERIFIED', 'WAIVED')) AS required_done,
              (SELECT count(*)::int FROM rd.tech_transfer_file tf JOIN core.attachment a ON a.id = tf.attachment_id WHERE tf.package_id = tt.id AND a.voided_at IS NULL) AS file_count
         FROM rd.tech_transfer_package tt
         JOIN rd.project p ON p.id = tt.project_id
         JOIN core.org_unit tu ON tu.id = tt.target_org_unit_id
         LEFT JOIN rd.transfer_template tpl ON tpl.id = tt.template_id
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
      r.bom_specification = normalizeBomList(r.bom_specification);
      r.routing_steps = normalizeRoutingList(r.routing_steps);
      r.qc_release_criteria = normalizeQcCriteria(r.qc_release_criteria);
      r.actions = await listAllowedActions(tx, techTransferMachine, actor, r);
      visible.push(r);
    }
  }
  return visible;
}

export async function getTechTransferDetail(tx: Tx, actor: AuthzActor, id: string) {
  const row = (
    await tx.query(
      `SELECT tt.*, p.code AS project_code, p.name AS project_name, p.owner_org_unit_id,
              tu.name AS target_org_unit_name, it.code AS product_item_code, it.name AS product_item_name,
              cs.code AS created_qc_spec_code, sb.display_name AS submitted_by_name, ab.display_name AS accepted_by_name,
              cb.display_name AS completed_by_name, tpl.code AS template_code, tpl.name AS template_name
         FROM rd.tech_transfer_package tt
         JOIN rd.project p ON p.id = tt.project_id
         JOIN core.org_unit tu ON tu.id = tt.target_org_unit_id
         LEFT JOIN rd.transfer_template tpl ON tpl.id = tt.template_id
         LEFT JOIN master.item it ON it.id = tt.product_item_id
         LEFT JOIN qms.qc_spec cs ON cs.id = tt.created_qc_spec_id
         LEFT JOIN core.user_profile sb ON sb.user_id = tt.submitted_by
         LEFT JOIN core.user_profile ab ON ab.user_id = tt.accepted_by
         LEFT JOIN core.user_profile cb ON cb.user_id = tt.completed_by
        WHERE tt.id = $1`,
      [id]
    )
  ).rows[0];
  if (!row) throw notFound("gói chuyển giao công nghệ");

  const canSeeSource = await hasFactoryPermission(tx, actor, "rd.view", row.owner_org_unit_id);
  const canSeeTarget = await hasFactoryPermission(tx, actor, "rd.transfer.accept", row.target_org_unit_id);
  if (!canSeeSource && !canSeeTarget) {
    await authorize(tx, actor, "rd.view", row.owner_org_unit_id);
  }

  const items = (
    await tx.query(
      `SELECT di.*, vu.display_name AS verified_by_name, uu.display_name AS updated_by_name
         FROM rd.tech_transfer_item di
         LEFT JOIN core.user_profile vu ON vu.user_id = di.verified_by
         LEFT JOIN core.user_profile uu ON uu.user_id = di.updated_by
        WHERE di.package_id = $1
        ORDER BY di.seq ASC`,
      [id]
    )
  ).rows;

  const files = (
    await tx.query(
      `SELECT tf.id, tf.package_id, tf.item_id, tf.attachment_id, tf.doc_label, tf.uploaded_at,
              a.file_name, a.mime_type, a.size_bytes, a.sha256, a.category,
              up.display_name AS uploaded_by_name
         FROM rd.tech_transfer_file tf
         JOIN core.attachment a ON a.id = tf.attachment_id
         LEFT JOIN core.user_profile up ON up.user_id = tf.uploaded_by
        WHERE tf.package_id = $1 AND a.voided_at IS NULL
        ORDER BY tf.uploaded_at DESC`,
      [id]
    )
  ).rows;

  const filesByItem = new Map<string, any[]>();
  const generalFiles: any[] = [];
  for (const f of files) {
    if (f.item_id) {
      const arr = filesByItem.get(f.item_id) ?? [];
      arr.push(f);
      filesByItem.set(f.item_id, arr);
    } else {
      generalFiles.push(f);
    }
  }

  return {
    ...row,
    bom_specification: normalizeBomList(row.bom_specification),
    routing_steps: normalizeRoutingList(row.routing_steps),
    qc_release_criteria: normalizeQcCriteria(row.qc_release_criteria),
    transfer_metadata: row.transfer_metadata ?? {},
    items: items.map((it) => ({ ...it, files: filesByItem.get(it.id) ?? [] })),
    general_files: generalFiles,
    actions: await listAllowedActions(tx, techTransferMachine, actor, row),
  };
}

export async function updateTechTransferPackage(tx: Tx, actor: AuthzActor, id: string, input: unknown) {
  const pkg = await loadPackageWithScope(tx, id);
  await authorize(tx, actor, "rd.transfer.manage", pkg.owner_org_unit_id);
  if (pkg.status !== "DRAFT") {
    throw conflict(`Chỉ được chỉnh sửa nội dung gói chuyển giao khi đang ở trạng thái Nháp (hiện tại: ${pkg.status}).`);
  }
  const d = parseInput(updateTransferSchema, input);

  const upd = (
    await tx.query(
      `UPDATE rd.tech_transfer_package
          SET target_domain = $2,
              target_org_unit_id = $3,
              title = $4,
              product_item_id = $5,
              bom_specification = $6::jsonb,
              routing_steps = $7::jsonb,
              qc_release_criteria = $8::jsonb,
              transfer_metadata = $9::jsonb,
              stability_summary = $10,
              validation_summary = $11,
              pilot_lot_ref = $12,
              notes = $13,
              version = version + 1,
              updated_at = now(),
              updated_by = $14
        WHERE id = $1
        RETURNING *`,
      [
        id,
        d.target_domain ?? pkg.target_domain,
        d.target_org_unit_id ?? pkg.target_org_unit_id,
        d.title ?? pkg.title,
        d.product_item_id !== undefined ? d.product_item_id : pkg.product_item_id,
        JSON.stringify(d.bom_specification ?? normalizeBomList(pkg.bom_specification)),
        JSON.stringify(d.routing_steps ? normalizeRoutingList(d.routing_steps) : normalizeRoutingList(pkg.routing_steps)),
        JSON.stringify(d.qc_release_criteria ? normalizeQcCriteria(d.qc_release_criteria) : normalizeQcCriteria(pkg.qc_release_criteria)),
        JSON.stringify(d.transfer_metadata ?? pkg.transfer_metadata ?? {}),
        d.stability_summary ?? pkg.stability_summary,
        d.validation_summary ?? pkg.validation_summary,
        d.pilot_lot_ref !== undefined ? d.pilot_lot_ref : pkg.pilot_lot_ref,
        d.notes !== undefined ? d.notes : pkg.notes,
        actor.userId,
      ]
    )
  ).rows[0];

  await writeAudit(tx, actor, {
    entityType: "rd_tech_transfer",
    entityId: id,
    action: "update",
    changes: { title: [pkg.title, upd.title] },
  });
  return upd;
}

export async function deleteTechTransferPackage(tx: Tx, actor: AuthzActor, id: string) {
  const pkg = await loadPackageWithScope(tx, id);
  await authorize(tx, actor, "rd.transfer.manage", pkg.owner_org_unit_id);
  if (pkg.status !== "DRAFT") {
    throw conflict("Không thể xóa gói chuyển giao đã gửi hoặc đã tiếp nhận. Chỉ gói ở trạng thái Nháp mới được xóa.");
  }
  await tx.query("DELETE FROM rd.tech_transfer_package WHERE id = $1", [id]);
  await writeAudit(tx, actor, {
    entityType: "rd_tech_transfer",
    entityId: id,
    action: "delete",
    changes: { code: [pkg.code, null], title: [pkg.title, null] },
  });
  return { deleted: true };
}

const checklistActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("apply_template"),
    template_id: z.string().uuid(),
    mode: z.enum(["MERGE", "REPLACE"]).default("MERGE"),
  }),
  z.object({
    action: z.literal("upsert"),
    id: z.string().uuid().optional().nullable(),
    seq: z.coerce.number().int().positive().optional(),
    section_code: z.string().trim().min(1).max(60).optional(),
    section_name: z.string().trim().min(1).max(200).optional(),
    doc_code: z.string().trim().min(1).max(60).optional(),
    item_name: z.string().trim().min(2).max(300).optional(),
    guidance: z.string().trim().max(1000).optional().nullable(),
    is_required: z.boolean().optional(),
    doc_ref_code: z.string().trim().max(200).optional().nullable(),
    notes: z.string().trim().max(2000).optional().nullable(),
    status: z.enum(["MISSING", "SUBMITTED", "VERIFIED", "WAIVED"]).optional(),
  }),
]);

export async function saveTechTransferChecklistItem(tx: Tx, actor: AuthzActor, packageId: string, rawInput: unknown) {
  const pkg = await loadPackageWithScope(tx, packageId);
  if (pkg.status === "COMPLETED") {
    throw conflict("Gói chuyển giao đã hoàn tất chuyển giao nên không thể chỉnh sửa hồ sơ.");
  }

  // Allow omitting `action` for convenience -> default to "upsert"
  const normalized =
    rawInput && typeof rawInput === "object" && !("action" in (rawInput as Record<string, unknown>))
      ? { action: "upsert", ...(rawInput as Record<string, unknown>) }
      : rawInput;
  const input = parseInput(checklistActionSchema, normalized);

  if (input.action === "apply_template") {
    await authorize(tx, actor, "rd.transfer.manage", pkg.owner_org_unit_id);
    if (pkg.status !== "DRAFT") {
      throw conflict("Chỉ áp dụng lại mẫu hồ sơ khi gói chuyển giao đang ở trạng thái Nháp.");
    }
    const tplItems = (
      await tx.query("SELECT * FROM rd.transfer_template_item WHERE template_id = $1 ORDER BY seq ASC", [input.template_id])
    ).rows;
    if (!tplItems.length) throw notFound("mẫu hồ sơ chuyển giao");

    if (input.mode === "REPLACE") {
      // Preserve previously uploaded files by converting them to general attachments before replacing items
      await tx.query("UPDATE rd.tech_transfer_file SET item_id = NULL WHERE package_id = $1", [packageId]);
      await tx.query("DELETE FROM rd.tech_transfer_item WHERE package_id = $1", [packageId]);
    }

    const existingCodes = new Set(
      (await tx.query("SELECT doc_code FROM rd.tech_transfer_item WHERE package_id = $1", [packageId])).rows.map((r) =>
        String(r.doc_code).toUpperCase()
      )
    );
    let maxSeq = Number(
      (await tx.query("SELECT coalesce(max(seq), 0) AS s FROM rd.tech_transfer_item WHERE package_id = $1", [packageId])).rows[0].s
    );
    for (const ti of tplItems) {
      if (input.mode === "MERGE" && existingCodes.has(String(ti.doc_code).toUpperCase())) continue;
      maxSeq++;
      await tx.query(
        `INSERT INTO rd.tech_transfer_item
           (package_id, template_item_id, seq, section_code, section_name, doc_code, item_name, guidance, is_required, status, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'MISSING', $10)`,
        [packageId, ti.id, maxSeq, ti.section_code, ti.section_name, ti.doc_code, ti.item_name, ti.guidance ?? null, ti.is_required, actor.userId]
      );
    }
    await tx.query("UPDATE rd.tech_transfer_package SET template_id = $2, updated_at = now(), updated_by = $3 WHERE id = $1", [
      packageId,
      input.template_id,
      actor.userId,
    ]);
    await writeAudit(tx, actor, {
      entityType: "rd_tech_transfer",
      entityId: packageId,
      action: "apply_template",
      changes: { template_id: [pkg.template_id, input.template_id] },
    });
    return { applied: true };
  }

  // Upsert / update checklist item
  if (input.status === "VERIFIED") {
    if (pkg.status !== "SUBMITTED" && pkg.status !== "ACCEPTED") {
      throw conflict("Chỉ xác nhận (VERIFIED) hạng mục khi gói chuyển giao đã gửi hoặc đã ký nhận.");
    }
    await authorize(tx, actor, "rd.transfer.accept", pkg.target_org_unit_id);
  } else if (pkg.status === "DRAFT") {
    await authorize(tx, actor, "rd.transfer.manage", pkg.owner_org_unit_id);
  } else {
    // Allow receiving reviewer to add review notes or revert VERIFIED -> SUBMITTED during SUBMITTED/ACCEPTED
    await authorize(tx, actor, "rd.transfer.accept", pkg.target_org_unit_id);
  }

  if (input.status === "WAIVED" && !String(input.notes || "").trim()) {
    throw invalid("Vui lòng nhập lý do miễn trừ (Ghi chú) khi đánh dấu Miễn trừ cho hạng mục này.");
  }

  if (input.id) {
    const cur = (
      await tx.query("SELECT * FROM rd.tech_transfer_item WHERE id = $1 AND package_id = $2 FOR UPDATE", [input.id, packageId])
    ).rows[0];
    if (!cur) throw notFound("hạng mục hồ sơ chuyển giao");

    const nextStatus = input.status ?? cur.status;
    const isVerifyChange = nextStatus === "VERIFIED" && cur.status !== "VERIFIED";
    const clearVerify = nextStatus !== "VERIFIED" && cur.status === "VERIFIED";

    const upd = (
      await tx.query(
        `UPDATE rd.tech_transfer_item
            SET seq = $3,
                section_code = $4,
                section_name = $5,
                doc_code = $6,
                item_name = $7,
                guidance = $8,
                is_required = $9,
                doc_ref_code = $10,
                notes = $11,
                status = $12,
                verified_by = CASE WHEN $13 THEN $15 WHEN $14 THEN NULL ELSE verified_by END,
                verified_at = CASE WHEN $13 THEN now() WHEN $14 THEN NULL ELSE verified_at END,
                updated_at = now(),
                updated_by = $15
          WHERE id = $1 AND package_id = $2
          RETURNING *`,
        [
          input.id,
          packageId,
          input.seq ?? cur.seq,
          input.section_code ?? cur.section_code,
          input.section_name ?? cur.section_name,
          input.doc_code ?? cur.doc_code,
          input.item_name ?? cur.item_name,
          input.guidance !== undefined ? input.guidance : cur.guidance,
          input.is_required ?? cur.is_required,
          input.doc_ref_code !== undefined ? input.doc_ref_code : cur.doc_ref_code,
          input.notes !== undefined ? input.notes : cur.notes,
          nextStatus,
          isVerifyChange,
          clearVerify,
          actor.userId,
        ]
      )
    ).rows[0];
    await writeAudit(tx, actor, {
      entityType: "rd_tech_transfer_item",
      entityId: upd.id,
      action: "update",
      changes: { status: [cur.status, upd.status], doc_ref_code: [cur.doc_ref_code, upd.doc_ref_code] },
    });
    return upd;
  }

  if (pkg.status !== "DRAFT") {
    throw conflict("Chỉ được thêm hạng mục hồ sơ mới khi gói đang ở trạng thái Nháp.");
  }
  if (!input.item_name) throw invalid("Nhập tên hạng mục hồ sơ cần thêm.");
  const maxSeq = Number(
    (await tx.query("SELECT coalesce(max(seq), 0) AS s FROM rd.tech_transfer_item WHERE package_id = $1", [packageId])).rows[0].s
  );
  const inserted = (
    await tx.query(
      `INSERT INTO rd.tech_transfer_item
         (package_id, seq, section_code, section_name, doc_code, item_name, guidance, is_required, doc_ref_code, notes, status, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        packageId,
        input.seq ?? maxSeq + 1,
        input.section_code ?? "9_CUSTOM",
        input.section_name ?? "9. Hồ sơ Bổ sung Tùy chỉnh",
        input.doc_code ?? `DOC-${maxSeq + 1}`,
        input.item_name,
        input.guidance ?? null,
        input.is_required ?? true,
        input.doc_ref_code ?? null,
        input.notes ?? null,
        input.status ?? "MISSING",
        actor.userId,
      ]
    )
  ).rows[0];
  await writeAudit(tx, actor, {
    entityType: "rd_tech_transfer_item",
    entityId: inserted.id,
    action: "create",
    changes: { item_name: [null, inserted.item_name] },
  });
  return inserted;
}

export async function deleteTechTransferChecklistItem(tx: Tx, actor: AuthzActor, packageId: string, itemId: string) {
  const pkg = await loadPackageWithScope(tx, packageId);
  await authorize(tx, actor, "rd.transfer.manage", pkg.owner_org_unit_id);
  if (pkg.status !== "DRAFT") {
    throw conflict("Chỉ được xóa hạng mục hồ sơ khi gói chuyển giao ở trạng thái Nháp.");
  }
  const cur = (
    await tx.query("SELECT * FROM rd.tech_transfer_item WHERE id = $1 AND package_id = $2 FOR UPDATE", [itemId, packageId])
  ).rows[0];
  if (!cur) throw notFound("hạng mục hồ sơ chuyển giao");

  await tx.query("UPDATE rd.tech_transfer_file SET item_id = NULL WHERE item_id = $1", [itemId]);
  await tx.query("DELETE FROM rd.tech_transfer_item WHERE id = $1", [itemId]);
  await tx.query(
    `WITH ordered AS (
       SELECT id, row_number() OVER (ORDER BY seq ASC) AS rn
         FROM rd.tech_transfer_item WHERE package_id = $1
     )
     UPDATE rd.tech_transfer_item t SET seq = o.rn FROM ordered o WHERE t.id = o.id`,
    [packageId]
  );
  await writeAudit(tx, actor, {
    entityType: "rd_tech_transfer_item",
    entityId: itemId,
    action: "delete",
    changes: { item_name: [cur.item_name, null] },
  });
  return { deleted: true };
}

function normalizeTransferUploadMime(fileName: string, declaredMime: string, data: Buffer): { mimeType: string; category: FileCategory } {
  const ext = path.extname(fileName || "").toLowerCase();
  const sniffed = sniffMime(data);
  if (ext === ".pdf" || sniffed === "application/pdf") {
    return { mimeType: "application/pdf", category: "DOCUMENT" };
  }
  if (ext === ".docx") {
    return { mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", category: "DOCUMENT" };
  }
  if (ext === ".xlsx") {
    return { mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", category: "DOCUMENT" };
  }
  if (ext === ".png" || sniffed === "image/png") {
    return { mimeType: "image/png", category: "IMAGE" };
  }
  if (ext === ".jpg" || ext === ".jpeg" || sniffed === "image/jpeg") {
    return { mimeType: "image/jpeg", category: "IMAGE" };
  }
  if (ext === ".webp" || sniffed === "image/webp") {
    return { mimeType: "image/webp", category: "IMAGE" };
  }
  if (ext === ".csv") {
    return { mimeType: "text/csv", category: "RAW_DATA" };
  }
  if (ext === ".txt") {
    return { mimeType: "text/plain", category: "RAW_DATA" };
  }
  if (ext === ".zip" || sniffed === "application/zip") {
    return { mimeType: "application/zip", category: "RAW_DATA" };
  }
  return { mimeType: declaredMime || "application/octet-stream", category: "DOCUMENT" };
}

export async function attachTechTransferFile(
  tx: Tx,
  actor: AuthzActor,
  packageId: string,
  input: { itemId?: string | null; docLabel?: string | null; fileName: string; mimeType: string; data: Buffer }
) {
  const pkg = await loadPackageWithScope(tx, packageId);
  if (pkg.status === "COMPLETED") {
    throw conflict("Gói chuyển giao đã hoàn tất (COMPLETED), không thể đính kèm thêm file.");
  }
  const canSrc = await hasFactoryPermission(tx, actor, "rd.transfer.manage", pkg.owner_org_unit_id);
  const canDst = await hasFactoryPermission(tx, actor, "rd.transfer.accept", pkg.target_org_unit_id);
  if (!canSrc && !canDst) {
    await authorize(tx, actor, "rd.transfer.manage", pkg.owner_org_unit_id);
  }

  let validItemId: string | null = null;
  if (input.itemId) {
    const it = (
      await tx.query("SELECT id, status FROM rd.tech_transfer_item WHERE id = $1 AND package_id = $2", [input.itemId, packageId])
    ).rows[0];
    if (!it) throw notFound("hạng mục hồ sơ chuyển giao");
    validItemId = it.id;
  }

  const { mimeType, category } = normalizeTransferUploadMime(input.fileName, input.mimeType, input.data);
  const att = await saveAttachment(tx, actor, {
    entityType: "rd_tech_transfer",
    entityId: packageId,
    category,
    fileName: input.fileName,
    mimeType,
    data: input.data,
  });

  const tf = (
    await tx.query(
      `INSERT INTO rd.tech_transfer_file (package_id, item_id, attachment_id, doc_label, uploaded_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [packageId, validItemId, att.id, input.docLabel ?? null, actor.userId]
    )
  ).rows[0];

  if (validItemId) {
    await tx.query(
      `UPDATE rd.tech_transfer_item
          SET status = CASE WHEN status = 'MISSING' THEN 'SUBMITTED' ELSE status END,
              updated_at = now(),
              updated_by = $2
        WHERE id = $1`,
      [validItemId, actor.userId]
    );
  }

  return {
    ...tf,
    file_name: path.basename(input.fileName),
    mime_type: mimeType,
    size_bytes: input.data.length,
    sha256: att.sha256,
  };
}

export async function readTechTransferFile(tx: Tx, actor: AuthzActor, packageId: string, transferFileId: string) {
  const pkg = await loadPackageWithScope(tx, packageId);
  const canSrc = await hasFactoryPermission(tx, actor, "rd.view", pkg.owner_org_unit_id);
  const canDst = await hasFactoryPermission(tx, actor, "rd.transfer.accept", pkg.target_org_unit_id);
  if (!canSrc && !canDst) {
    await authorize(tx, actor, "rd.view", pkg.owner_org_unit_id);
  }
  const row = (
    await tx.query("SELECT attachment_id FROM rd.tech_transfer_file WHERE id = $1 AND package_id = $2", [transferFileId, packageId])
  ).rows[0];
  if (!row) throw notFound("tệp hồ sơ chuyển giao");
  return readAttachment(tx, row.attachment_id);
}

export async function deleteTechTransferFile(tx: Tx, actor: AuthzActor, packageId: string, transferFileId: string) {
  const pkg = await loadPackageWithScope(tx, packageId);
  await authorize(tx, actor, "rd.transfer.manage", pkg.owner_org_unit_id);
  if (pkg.status !== "DRAFT") {
    throw conflict("Chỉ được gỡ tệp đính kèm khi gói chuyển giao ở trạng thái Nháp.");
  }
  const row = (
    await tx.query("SELECT * FROM rd.tech_transfer_file WHERE id = $1 AND package_id = $2 FOR UPDATE", [transferFileId, packageId])
  ).rows[0];
  if (!row) throw notFound("tệp hồ sơ chuyển giao");

  await tx.query("DELETE FROM rd.tech_transfer_file WHERE id = $1", [transferFileId]);
  await tx.query("UPDATE core.attachment SET voided_at = now(), voided_by = $2 WHERE id = $1 AND voided_at IS NULL", [
    row.attachment_id,
    actor.userId,
  ]);
  await writeAudit(tx, actor, {
    entityType: "rd_tech_transfer",
    entityId: packageId,
    action: "remove_file",
    changes: { file_id: [transferFileId, null] },
  });
  return { deleted: true };
}

// ============================================================================
// SOFTWARE RELEASES (IEC 62304 — D6)
// ============================================================================

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
  source_ref: z.string().trim().max(200).optional().nullable(),
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
    source_ref: d.source_ref ?? null,
    validation_summary: d.validation_summary,
  });
}

const updateSwReleaseSchema = createSwReleaseSchema.omit({ project_id: true });

export async function updateSoftwareRelease(tx: Tx, actor: AuthzActor, id: string, input: unknown) {
  const cur = (await tx.query("SELECT * FROM rd.software_release WHERE id = $1 FOR UPDATE", [id])).rows[0] as
    | (SwReleaseRow & Record<string, unknown>)
    | undefined;
  if (!cur) throw notFound("bản phát hành phần mềm");
  const owner = await projectOwner(tx, cur.project_id);
  await authorize(tx, actor, "rd.transfer.manage", owner);
  if (cur.status !== "DRAFT") {
    throw invalid(
      "Bản phát hành phần mềm đã phê duyệt / thu hồi không được phép chỉnh sửa trực tiếp.",
      undefined,
      "IMMUTABLE_RELEASED_SW"
    );
  }
  const d = parseInput(updateSwReleaseSchema, input);
  const upd = (
    await tx.query(
      `UPDATE rd.software_release
          SET version_tag = $2, target_kind = $3, safety_class = $4,
              srs_traceability = $5::jsonb, soup_list = $6::jsonb, known_anomalies = $7::jsonb,
              release_notes = $8, checksum_sha256 = $9, source_ref = $10, validation_summary = $11,
              version = version + 1, updated_at = now(), updated_by = $12
        WHERE id = $1 RETURNING *`,
      [
        id,
        d.version_tag,
        d.target_kind,
        d.safety_class,
        JSON.stringify(d.srs_traceability),
        JSON.stringify(d.soup_list),
        JSON.stringify(d.known_anomalies),
        d.release_notes,
        d.checksum_sha256 ? d.checksum_sha256.toLowerCase() : null,
        d.source_ref ?? null,
        d.validation_summary,
        actor.userId,
      ]
    )
  ).rows[0];
  await writeAudit(tx, actor, {
    entityType: "rd_software_release",
    entityId: id,
    action: "update",
    changes: {
      version_tag: [cur.version_tag, d.version_tag],
      safety_class: [cur.safety_class, d.safety_class],
    },
  });
  return upd;
}

export async function listSoftwareReleases(tx: Tx, actor: AuthzActor, projectId?: string) {
  await authorizeAnywhereOneOf(tx, actor, ["rd.view", "it.view"]);
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
