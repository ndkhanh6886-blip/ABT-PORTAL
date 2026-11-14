import { z } from "zod";
import type { Tx } from "../core/db";
import { writeAudit } from "../core/audit";
import { authorize, authorizeAnywhere, hasFactoryPermission, registerPermissions, SYSTEM_ACTOR, type AuthzActor } from "../core/authz";
import { vnToday } from "../core/dates";
import { FactoryError, invalid, notFound } from "../core/errors";
import { nextNumber } from "../core/numbering";
import { insertRecord, parseInput } from "../core/records";
import { runTransition } from "../core/stateMachine";
import { allocate, findCandidates } from "../inv/allocation";
import { createStockDocument, stockDocumentMachine } from "../inv/documents";
import { createItem, getItem, toBaseQty } from "../master/service";
import { createRequest } from "../purchase/requests";
import {
  allocateOrderSerials,
  resolveLotNo,
  deviceUnitMachine,
  getDeviceOrderDetail,
  syncOrderStatusFromUnits,
  type DeviceOrderRow,
  type DeviceUnitRow,
} from "./assembly";
import { createSubcontractOrder, createSubcontractPart } from "./subcontract";
import "./permissions";

/**
 * Standard 5-Gate Device R&D DHF Template (aligned with ABT Biolab Portal TechDepartmentPage):
 * G1: Đề xuất & Khảo sát khả thi (CONCEPT)
 * G2: Thiết kế 3D CAD, PCB & eBOM (DESIGN_BOM)
 * G3: Chế tạo Mẫu thử Prototype & Đo kiểm DVP (PROTOTYPE)
 * G4: Sản xuất Pilot & Kiểm định an toàn điện IEC 61010-1 (PILOT_TRIAL)
 * G5: Nghiệm thu & Chuyển giao Sản xuất - Mở mã thương mại (TRANSFERRED)
 */
export const DEVICE_RD_STAGE_DEFS = [
  {
    gate_no: 1,
    stage_code: "G1_CONCEPT",
    gate_name: "Cổng 1 (G1): Đề xuất & Khảo sát khả thi (PRD & FTO)",
    stage_after: "G2_DESIGN_BOM",
    deliverables: [
      { seq: 1, item_name: "Tài liệu Yêu cầu Sản phẩm Thiết bị (PRD) & Cấu hình mục tiêu", doc_type: "PRD_FTO", default_note: "Đã phê duyệt PRD: xác định dải nhiệt độ, công suất mẫu, chuẩn kết nối và giá thành mục tiêu." },
      { seq: 2, item_name: "Báo cáo khảo sát bản quyền kiểu dáng công nghiệp (FTO) & Nghiên cứu thị trường", doc_type: "PRD_FTO", default_note: "Đã rà soát FTO kiểu dáng công nghiệp & cơ cấu truyền động, không vi phạm sáng chế." },
    ],
  },
  {
    gate_no: 2,
    stage_code: "G2_DESIGN_BOM",
    gate_name: "Cổng 2 (G2): Thiết kế 3D CAD, Layout PCB & Cây eBOM",
    stage_after: "G3_PROTOTYPE",
    deliverables: [
      { seq: 1, item_name: "Bản vẽ lắp 3D SolidWorks (.SLDASM) & Bản vẽ chi tiết gia công CNC/Kim loại tấm", doc_type: "CAD_DFMEA", default_note: "Đã hoàn thiện bộ bản vẽ 3D CAD & xuất bản vẽ 2D dung sai ISO 2768-mK." },
      { seq: 2, item_name: "Sơ đồ nguyên lý (Schematic), Layout PCB 4 lớp (Altium) & Cấu trúc eBOM 4 trạm", doc_type: "CAD_DFMEA", default_note: "Đã chốt sơ đồ mạch điều khiển MCU, mạch công suất Peltier/Motor và cây định mức eBOM." },
      { seq: 3, item_name: "Bảng phân tích rủi ro thiết kế dFMEA (ISO 14971: Quá nhiệt, Rò điện, Kẹt cơ khí)", doc_type: "RISK_ISO14971", default_note: "Đã lập bảng dFMEA ISO 14971, bổ sung cầu chì nhiệt độc lập và cảm biến hành trình quang." },
    ],
  },
  {
    gate_no: 3,
    stage_code: "G3_PROTOTYPE",
    gate_name: "Cổng 3 (G3): Chế tạo Mẫu thử Prototype & Đo kiểm DVP",
    stage_after: "G4_PILOT",
    deliverables: [
      { seq: 1, item_name: "Biên bản lắp ráp mẫu thử Prototype v1/v2 & Tinh chỉnh dung sai lắp ghép", doc_type: "DVP_IEC61010", default_note: "Đã lắp hoàn chỉnh 02 máy Prototype, hiệu chỉnh khe hở dẫn hướng tuyến tính ±0.02mm." },
      { seq: 2, item_name: "Báo cáo kiểm증 thiết kế (DVP): Độ chính xác nhiệt độ, tốc độ gia nhiệt & độ lặp lại", doc_type: "DVP_IEC61010", default_note: "Đo kiểm bằng đầu dò chuẩn Fluke: độ đồng đều nhiệt ±0.15°C, đạt 100% chỉ tiêu DVP." },
    ],
  },
  {
    gate_no: 4,
    stage_code: "G4_PILOT",
    gate_name: "Cổng 4 (G4): Sản xuất Pilot, Test An toàn điện IEC 61010-1 & Lão hóa 48h",
    stage_after: "G5_TRANSFER",
    deliverables: [
      { seq: 1, item_name: "Biên bản kiểm định An toàn điện & Tương thích điện từ (IEC 61010-1 / EMC)", doc_type: "DVP_IEC61010", default_note: "Đạt kiểm định dòng rò < 0.5mA, điện trở cách điện > 50 MΩ theo IEC 61010-1." },
      { seq: 2, item_name: "Báo cáo chạy thử nghiệm lô Pilot (03–05 máy) & Lão hóa Burn-in liên tục 48h", doc_type: "DVP_IEC61010", default_note: "Lô Pilot 03 máy vượt qua 48h Burn-in liên tục và thử nghiệm thực tế với bộ Kit ABT." },
    ],
  },
  {
    gate_no: 5,
    stage_code: "G5_TRANSFER",
    gate_name: "Cổng 5 (G5): Nghiệm thu Chuyển giao Sản xuất (DMR/SOP/FQC) & Mở mã Thương mại",
    stage_after: "TRANSFERRED",
    deliverables: [
      { seq: 1, item_name: "Bộ hồ sơ gốc thiết bị (Device Master Record - DMR), SOP Lắp ráp 4 trạm & Checklist FQC", doc_type: "DMR", default_note: "Đã đóng gói trọn bộ DMR, bản vẽ CNC, file Gerber/Firmware, SOP lắp ráp 4 trạm & FQC." },
      { seq: 2, item_name: "Biên bản nghiệm thu chuyển giao R&D ➔ Sản xuất & Kích hoạt mã hàng Thương mại", doc_type: "DMR", default_note: "Hội đồng R&D – Sản xuất – QA ký duyệt nghiệm thu, ban hành BOM hiệu lực và mở mã kinh doanh." },
    ],
  },
] as const;

export async function ensureDevice5GateTemplate(tx: Tx): Promise<string> {
  let tpl = (await tx.query("SELECT id FROM rd.gate_template WHERE code = 'SG_DEVICE_5G'")).rows[0];
  if (!tpl) {
    tpl = (
      await tx.query(
        `INSERT INTO rd.gate_template (code, name, domain, status)
         VALUES ('SG_DEVICE_5G', 'Quy trình R&D Thiết bị 5 Cổng (Đề xuất ➔ Thiết kế 3D/eBOM ➔ Mẫu thử ➔ Pilot IEC 61010 ➔ Chuyển giao SX)', 'DEVICE', 'ACTIVE')
         RETURNING id`
      )
    ).rows[0];
  }
  const existingItems = Number(
    (await tx.query("SELECT count(*)::int AS c FROM rd.gate_template_item WHERE template_id = $1", [tpl.id])).rows[0]?.c ?? 0
  );
  if (existingItems === 0) {
    for (const g of DEVICE_RD_STAGE_DEFS) {
      for (const d of g.deliverables) {
        await tx.query(
          `INSERT INTO rd.gate_template_item (template_id, gate_no, gate_name, stage_after, seq, item_name, doc_type, is_required)
           VALUES ($1, $2, $3, $4, $5, $6, $7, true)
           ON CONFLICT (template_id, gate_no, seq) DO NOTHING`,
          [tpl.id, g.gate_no, g.gate_name, g.stage_after, d.seq, d.item_name, d.doc_type]
        );
      }
    }
  }
  return tpl.id;
}

/**
 * Lists all Device R&D projects (`target_domain = 'DEVICE'`) with their 5 Stage-Gates,
 * deliverables, TPP/Design Input vs Actual specs, linked Device Model & draft/released BOM lines.
 */
export async function listDeviceRdProjects(tx: Tx, actor: AuthzActor) {
  await authorizeAnywhere(tx, actor, "device.view");
  await ensureDevice5GateTemplate(tx);

  const projects = (
    await tx.query(
      `SELECT p.*, p.planned_start::text AS planned_start, p.planned_end::text AS planned_end,
              p.actual_transfer_date::text AS actual_transfer_date,
              u.name AS org_unit_name, l.display_name AS leader_name,
              m.id AS model_id, m.code AS model_code, m.name AS model_name, m.category AS model_category,
              m.status AS model_status, m.warranty_months, m.required_burn_in_hours::float AS required_burn_in_hours,
              m.specs_json, m.accessories_standard
         FROM rd.project p
         JOIN core.org_unit u ON u.id = p.owner_org_unit_id
         LEFT JOIN core.user_profile l ON l.user_id = p.leader_id
         LEFT JOIN LATERAL (
           SELECT dm.*
             FROM device.device_model dm
            WHERE dm.rd_project_id = p.id
               OR (p.description IS NOT NULL AND position('[' || dm.code || ']' in p.description) > 0)
            ORDER BY (dm.rd_project_id = p.id) DESC, dm.created_at DESC
            LIMIT 1
         ) m ON true
        WHERE p.target_domain = 'DEVICE'
        ORDER BY p.created_at DESC`
    )
  ).rows;

  for (const p of projects) {
    p.gates = (
      await tx.query(
        `SELECT g.*, sb.display_name AS submitted_by_name, db.display_name AS decided_by_name
           FROM rd.project_gate g
           LEFT JOIN core.user_profile sb ON sb.user_id = g.submitted_by
           LEFT JOIN core.user_profile db ON db.user_id = g.decided_by
          WHERE g.project_id = $1
          ORDER BY g.gate_no ASC`,
        [p.id]
      )
    ).rows;

    for (const g of p.gates) {
      g.deliverables = (
        await tx.query(
          `SELECT gd.*, rb.display_name AS reviewed_by_name
             FROM rd.gate_deliverable gd
             LEFT JOIN core.user_profile rb ON rb.user_id = gd.reviewed_by
            WHERE gd.project_gate_id = $1
            ORDER BY gd.seq ASC`,
          [g.id]
        )
      ).rows;
    }

    p.specs = (
      await tx.query(
        `SELECT se.*
           FROM rd.spec_evaluation se
          WHERE se.project_id = $1
          ORDER BY se.category ASC, se.parameter ASC`,
        [p.id]
      )
    ).rows;

    if (p.model_id) {
      const targetRev = (
        await tx.query(
          `SELECT r.*
             FROM device.model_revision r
            WHERE r.model_id = $1
            ORDER BY (r.status = 'DRAFT') DESC, r.created_at DESC
            LIMIT 1`,
          [p.model_id]
        )
      ).rows[0];
      p.target_revision = targetRev ?? null;
      if (targetRev) {
        p.bom_lines = (
          await tx.query(
            `SELECT bl.*, bl.qty_per_unit::float AS qty_per_unit, it.code AS item_code, it.name AS item_name
               FROM device.model_bom_line bl
               JOIN master.item it ON it.id = bl.component_item_id
              WHERE bl.revision_id = $1
              ORDER BY bl.line_no ASC`,
            [targetRev.id]
          )
        ).rows;
      } else {
        p.bom_lines = [];
      }
    } else {
      p.target_revision = null;
      p.bom_lines = [];
    }
  }

  return projects;
}

const createDeviceRdSchema = z.object({
  org_unit_id: z.string().uuid().optional().nullable(),
  project_type: z.enum(["NEW_PRODUCT", "IMPROVEMENT"]).default("NEW_PRODUCT"),
  base_model_id: z.string().uuid().optional().nullable(),
  model_code: z.string().trim().min(2).max(30).optional().nullable(),
  model_name: z.string().trim().min(3, "nhập tên thiết bị / đề tài R&D").max(250),
  category: z
    .enum(["THERMAL_CYCLER", "EXTRACTOR", "CENTRIFUGE", "SPIN_COLUMN_SYSTEM", "INCUBATOR", "SPECTROPHOTOMETER", "OTHER"])
    .default("EXTRACTOR"),
  target_revision: z.string().trim().min(1).max(16).default("A"),
  firmware_version: z.string().trim().max(60).default("v1.0.0"),
  warranty_months: z.coerce.number().int().min(0).max(120).default(24),
  required_burn_in_hours: z.coerce.number().min(0).max(500).default(48),
  planned_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  description: z.string().trim().max(4000).optional().nullable(),
  specs: z
    .array(
      z.object({
        parameter: z.string().trim().min(1),
        unit: z.string().trim().optional().nullable(),
        baseline_value: z.string().trim().optional().nullable(),
        target_value: z.string().trim().min(1),
        actual_value: z.string().trim().optional().nullable(),
        method_ref: z.string().trim().optional().nullable(),
      })
    )
    .optional(),
  bom_lines: z
    .array(
      z.object({
        station_code: z.string().trim().default("STATION_1_MECH"),
        component_item_id: z.string().uuid(),
        qty_per_unit: z.coerce.number().positive().default(1),
        uom: z.string().trim().default("pcs"),
        source_type: z.enum(["BUY", "SUBCONTRACT", "MAKE"]).default("BUY"),
        tracking_type: z.string().trim().default("LOT"),
        drawing_code: z.string().trim().optional().nullable(),
        is_critical: z.boolean().default(true),
        requires_serial: z.boolean().default(false),
      })
    )
    .optional(),
});

/**
 * Creates a 5-stage Device R&D Project (either NEW_PRODUCT or IMPROVEMENT of an existing Device Model).
 * - Automatically initializes the 5 Device DHF gates (G1..G5).
 * - Creates or links the `device.device_model` and a `DRAFT` `device.model_revision` (cloning BOM lines if IMPROVEMENT).
 * - Populates `rd.spec_evaluation` (`[Thông số cũ] ➔ [Mục tiêu] ➔ [Thực tế]`).
 */
export async function createDeviceRdProject(tx: Tx, actor: AuthzActor, input: unknown) {
  const d = parseInput(createDeviceRdSchema, input);
  const devDept = d.org_unit_id
    ? (await tx.query("SELECT id FROM core.org_unit WHERE id = $1", [d.org_unit_id])).rows[0]
    : (
        await tx.query("SELECT id FROM core.org_unit WHERE module_key = 'DEVICE' AND status = 'ACTIVE' ORDER BY created_at LIMIT 1")
      ).rows[0];
  if (!devDept) throw notFound("Phòng Kỹ thuật – Thiết bị");
  await authorize(tx, actor, "device.model.manage", devDept.id);

  const tplId = await ensureDevice5GateTemplate(tx);
  const tplItems = (
    await tx.query("SELECT * FROM rd.gate_template_item WHERE template_id = $1 ORDER BY gate_no, seq", [tplId])
  ).rows;

  let baseModel: any = null;
  if (d.project_type === "IMPROVEMENT" && d.base_model_id) {
    baseModel = (await tx.query("SELECT * FROM device.device_model WHERE id = $1", [d.base_model_id])).rows[0];
    if (!baseModel) throw notFound("Model thiết bị nền cần cải tiến");
  }

  const prjCode = await nextNumber(tx, "RD_PROJECT");
  const modelCode = baseModel
    ? (baseModel.code as string)
    : (d.model_code?.trim().toUpperCase() || (await nextNumber(tx, "DEVICE_MODEL")));
  const prjName =
    d.project_type === "IMPROVEMENT" && baseModel
      ? `Cải tiến ${baseModel.code} lên Rev ${d.target_revision.toUpperCase()}: ${d.model_name}`
      : `R&D Thiết bị mới [${modelCode}]: ${d.model_name}`;

  const project = await insertRecord<any>(tx, actor, "rd.project", "rd_project", {
    code: prjCode,
    name: prjName,
    owner_org_unit_id: devDept.id,
    project_type: d.project_type,
    target_domain: "DEVICE",
    ivd_class: "CLASS_A",
    leader_id: actor.userId,
    gate_template_id: tplId,
    current_stage: "G1_CONCEPT",
    planned_start: vnToday(),
    planned_end: d.planned_end ?? null,
    description: `[${modelCode}] ${d.description ?? prjName}`,
  });

  await tx.query(
    "INSERT INTO rd.project_member (project_id, user_id, role_in_project, allocation_pct) VALUES ($1, $2, 'LEADER', 100) ON CONFLICT DO NOTHING",
    [project.id, actor.userId]
  );

  const gatesMap = new Map<number, { gate_name: string; stage_after: string; items: typeof tplItems }>();
  for (const item of tplItems) {
    if (!gatesMap.has(item.gate_no)) {
      gatesMap.set(item.gate_no, { gate_name: item.gate_name, stage_after: item.stage_after, items: [] });
    }
    gatesMap.get(item.gate_no)!.items.push(item);
  }
  const sortedGateNos = [...gatesMap.keys()].sort((a, b) => a - b);
  for (const [idx, gateNo] of sortedGateNos.entries()) {
    const g = gatesMap.get(gateNo)!;
    const gateRow = (
      await tx.query(
        `INSERT INTO rd.project_gate (project_id, gate_no, gate_name, stage_after, status)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [project.id, gateNo, g.gate_name, g.stage_after, idx === 0 ? "OPEN" : "LOCKED"]
      )
    ).rows[0];
    for (const it of g.items) {
      await tx.query(
        `INSERT INTO rd.gate_deliverable (project_gate_id, template_item_id, seq, item_name, doc_type, is_required, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'MISSING')`,
        [gateRow.id, it.id, it.seq, it.item_name, it.doc_type, it.is_required]
      );
    }
  }

  let modelId: string;
  if (baseModel) {
    modelId = baseModel.id;
    await tx.query("UPDATE device.device_model SET rd_project_id = $2 WHERE id = $1", [modelId, project.id]);
    const revTag = d.target_revision.toUpperCase();
    const existingRev = (
      await tx.query("SELECT id FROM device.model_revision WHERE model_id = $1 AND revision = $2", [modelId, revTag])
    ).rows[0];
    if (!existingRev) {
      const draftRev = (
        await tx.query(
          `INSERT INTO device.model_revision
             (model_id, revision, firmware_version, dmr_summary, effectivity_type, status, created_by, updated_by)
           VALUES ($1, $2, $3, $4, 'IMMEDIATE', 'DRAFT', $5, $5) RETURNING id`,
          [
            modelId,
            revTag,
            d.firmware_version,
            `Hồ sơ DMR nháp thuộc dự án cải tiến ${prjCode} (${d.model_name})`,
            actor.userId,
          ]
        )
      ).rows[0];
      if (baseModel.current_revision_id) {
        await tx.query(
          `INSERT INTO device.model_bom_line
             (revision_id, line_no, station_code, component_item_id, qty_per_unit, uom, source_type, is_critical, requires_serial, tracking_type, drawing_code, notes, created_by, updated_by)
           SELECT $1, line_no, station_code, component_item_id, qty_per_unit, uom, source_type, is_critical, requires_serial, tracking_type, drawing_code, notes, $2, $2
             FROM device.model_bom_line WHERE revision_id = $3 ORDER BY line_no`,
          [draftRev.id, actor.userId, baseModel.current_revision_id]
        );
      }
    }
  } else {
    const dup = (await tx.query("SELECT id FROM device.device_model WHERE code = $1", [modelCode])).rows[0];
    if (dup) throw invalid(`Mã model thiết bị ${modelCode} đã tồn tại.`);
    const createdModel = await insertRecord<any>(tx, actor, "device.device_model", "device_model", {
      code: modelCode,
      name: d.model_name,
      org_unit_id: devDept.id,
      category: d.category,
      warranty_months: d.warranty_months,
      required_burn_in_hours: d.required_burn_in_hours,
      rd_project_id: project.id,
      description: d.description ?? `Đề tài R&D Thiết bị mới ${prjCode}`,
      specs_json: JSON.stringify({}),
      accessories_standard: JSON.stringify([
        "01 Dây nguồn AC 220V chuẩn C13",
        "01 Sách HDSD Tiếng Việt & Biên bản hiệu chuẩn xuất xưởng",
      ]),
      accessories_optional: JSON.stringify([]),
      status: "DEVELOPMENT",
    });
    modelId = createdModel.id;
    const createdRev = (
      await tx.query(
        `INSERT INTO device.model_revision
           (model_id, revision, firmware_version, dmr_summary, effectivity_type, status, created_by, updated_by)
         VALUES ($1, $2, $3, $4, 'IMMEDIATE', 'DRAFT', $5, $5) RETURNING id`,
        [
          modelId,
          d.target_revision.toUpperCase(),
          d.firmware_version,
          `Hồ sơ thiết kế gốc DMR nháp (${prjCode} — ${d.model_name})`,
          actor.userId,
        ]
      )
    ).rows[0];
    if (d.bom_lines && d.bom_lines.length > 0) {
      for (const [idx, bl] of d.bom_lines.entries()) {
        await tx.query(
          `INSERT INTO device.model_bom_line
             (revision_id, line_no, station_code, component_item_id, qty_per_unit, uom, source_type, is_critical, requires_serial, tracking_type, drawing_code, created_by, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)`,
          [
            createdRev.id,
            idx + 1,
            bl.station_code,
            bl.component_item_id,
            bl.qty_per_unit,
            bl.uom,
            bl.source_type,
            bl.is_critical,
            bl.requires_serial,
            bl.tracking_type,
            bl.drawing_code ?? null,
            actor.userId,
          ]
        );
      }
    }
  }

  const defaultSpecs =
    d.specs && d.specs.length > 0
      ? d.specs
      : baseModel && baseModel.specs_json && typeof baseModel.specs_json === "object" && !Array.isArray(baseModel.specs_json)
      ? Object.entries(baseModel.specs_json as Record<string, unknown>).map(([k, v]) => ({
          parameter: k,
          unit: "",
          baseline_value: String(v ?? ""),
          target_value: `${String(v ?? "")} (Nâng cấp Rev ${d.target_revision.toUpperCase()})`,
          actual_value: "",
          method_ref: "Đo kiểm chuẩn DVP / IEC 61010-1",
        }))
      : [
          {
            parameter: "Độ chính xác & đồng đều nhiệt độ",
            unit: "°C",
            baseline_value: d.project_type === "IMPROVEMENT" ? "±0.3°C" : "N/A (Máy mới)",
            target_value: "±0.15°C",
            actual_value: null,
            method_ref: "Đầu dò chuẩn Fluke 96-well",
          },
          {
            parameter: "An toàn điện & Dòng rò vỏ máy",
            unit: "mA",
            baseline_value: d.project_type === "IMPROVEMENT" ? "< 0.5 mA" : "N/A (Máy mới)",
            target_value: "< 0.25 mA (Chuẩn IEC 61010-1)",
            actual_value: null,
            method_ref: "Máy đo an toàn điện Hioki",
          },
          {
            parameter: "Độ ổn định chạy lão hóa liên tục (Burn-in)",
            unit: "giờ",
            baseline_value: d.project_type === "IMPROVEMENT" ? "24 giờ" : "N/A (Máy mới)",
            target_value: `${d.required_burn_in_hours} giờ liên tục không lỗi`,
            actual_value: null,
            method_ref: "SOP-FQC-BURNIN",
          },
        ];

  for (const sp of defaultSpecs) {
    await tx.query(
      `INSERT INTO rd.spec_evaluation
         (project_id, category, design_stage, parameter, unit, baseline_value, target_value, actual_value, method_ref, result, updated_by)
       VALUES ($1, 'DEVICE_SPEC', 'VERIFICATION', $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        project.id,
        sp.parameter,
        sp.unit ?? null,
        sp.baseline_value ?? null,
        sp.target_value,
        sp.actual_value ?? null,
        sp.method_ref ?? "IEC 61010-1 / DVP",
        sp.actual_value ? "PASS" : "PENDING",
        actor.userId,
      ]
    );
  }

  return { project_id: project.id, model_id: modelId, code: prjCode };
}

/**
 * 1-click helper to populate DHF deliverables for the current open gate of a Device R&D project
 * and pass that gate (G1 -> G2 -> G3 -> G4 -> G5).
 */
export async function advanceDeviceRdGate(
  tx: Tx,
  actor: AuthzActor,
  projectId: string,
  optsOrGateNo?: number | { gate_no?: number; decision_note?: string },
  maybeNote?: string
) {
  const opts =
    typeof optsOrGateNo === "number"
      ? { gate_no: optsOrGateNo, decision_note: maybeNote }
      : optsOrGateNo;
  const proj = (await tx.query("SELECT * FROM rd.project WHERE id = $1 FOR UPDATE", [projectId])).rows[0];
  if (!proj) throw notFound("dự án R&D thiết bị");
  await authorize(tx, actor, "device.model.manage", proj.owner_org_unit_id);

  const gate = opts?.gate_no
    ? (
        await tx.query("SELECT * FROM rd.project_gate WHERE project_id = $1 AND gate_no = $2 FOR UPDATE", [
          projectId,
          opts.gate_no,
        ])
      ).rows[0]
    : (
        await tx.query(
          "SELECT * FROM rd.project_gate WHERE project_id = $1 AND status <> 'PASSED' ORDER BY gate_no ASC LIMIT 1 FOR UPDATE",
          [projectId]
        )
      ).rows[0];

  if (!gate) throw invalid("Tất cả các cổng Stage-Gate của dự án đã được phê duyệt (PASSED).");

  if (Number(gate.gate_no) >= 3) {
    const failedOrPendingSpecs = await tx.query(
      `SELECT 1 FROM rd.spec_evaluation
        WHERE project_id = $1
          AND (result IN ('FAIL', 'PENDING') OR actual_value IS NULL OR btrim(actual_value) = '')
        LIMIT 1`,
      [projectId]
    );
    if (failedOrPendingSpecs.rowCount) {
      throw invalid(
        "Tất cả chỉ tiêu đánh giá thiết kế (Spec Evaluation) phải có kết quả đo kiểm thực tế (actual_value) và đạt PASS trước khi qua cổng.",
        undefined,
        "SPEC_EVALUATION_NOT_PASSED"
      );
    }
  }

  const unmitigatedRisks = await tx.query(
    `SELECT 1 FROM rd.risk_item
      WHERE project_id = $1
        AND (
          status = 'OPEN'
          OR (
            COALESCE(residual_severity * residual_occurrence * residual_detection, rpn) >= 15
            AND status NOT IN ('MITIGATED', 'ACCEPTED')
          )
        )
      LIMIT 1`,
    [projectId]
  );
  if (unmitigatedRisks.rowCount) {
    throw invalid(
      "Còn mục rủi ro ISO 14971 đang mở (OPEN) hoặc có RPN tồn dư cao chưa được giảm thiểu / chấp nhận trước khi qua cổng.",
      undefined,
      "UNMITIGATED_RISK_ITEMS"
    );
  }

  const stageDef = DEVICE_RD_STAGE_DEFS.find((s) => s.gate_no === Number(gate.gate_no));
  const delivs = (
    await tx.query("SELECT * FROM rd.gate_deliverable WHERE project_gate_id = $1 ORDER BY seq ASC", [gate.id])
  ).rows;

  for (const d of delivs) {
    const defNote =
      stageDef?.deliverables.find((x) => x.seq === Number(d.seq))?.default_note ??
      `Đã hoàn thành và thẩm định đạt hồ sơ: ${d.item_name}`;
    await tx.query(
      `UPDATE rd.gate_deliverable
          SET notes = COALESCE(NULLIF(notes, ''), $2),
              status = 'ACCEPTED',
              reviewer_comment = 'Hội đồng Kỹ thuật & QA thẩm định Đạt (ISO 13485 DHF)',
              reviewed_by = $3,
              reviewed_at = now(),
              updated_at = now(),
              updated_by = $3
        WHERE id = $1`,
      [d.id, defNote, actor.userId]
    );
  }

  await tx.query(
    `UPDATE rd.project_gate
        SET status = 'PASSED',
            submitted_by = COALESCE(submitted_by, $2),
            submitted_at = COALESCE(submitted_at, now()),
            decision = 'GO',
            decided_by = $2,
            decided_at = now(),
            decision_note = $3,
            version = version + 1,
            updated_at = now(),
            updated_by = $2
      WHERE id = $1`,
    [gate.id, actor.userId, opts?.decision_note ?? `Phê duyệt qua cổng G${gate.gate_no}: Đạt đầy đủ hồ sơ DHF & đo kiểm thực nghiệm.`]
  );

  await tx.query(
    "UPDATE rd.project SET current_stage = $2, version = version + 1, updated_at = now(), updated_by = $3 WHERE id = $1",
    [projectId, gate.stage_after, actor.userId]
  );

  const nextGate = (
    await tx.query(
      "SELECT id FROM rd.project_gate WHERE project_id = $1 AND gate_no > $2 ORDER BY gate_no ASC LIMIT 1",
      [projectId, gate.gate_no]
    )
  ).rows[0];

  if (nextGate) {
    await tx.query("UPDATE rd.project_gate SET status = 'OPEN', version = version + 1 WHERE id = $1 AND status = 'LOCKED'", [
      nextGate.id,
    ]);
  }

  await writeAudit(tx, actor, {
    entityType: "rd_project",
    entityId: projectId,
    action: `pass_gate_g${gate.gate_no}`,
    changes: { gate: [gate.status, "PASSED"], stage: [proj.current_stage, gate.stage_after] },
  });

  return { gate_no: gate.gate_no, stage_after: gate.stage_after };
}

/**
 * Completes Gate 5 (Tech Transfer to Production) for a Device R&D project:
 * 1. Marks all gates G1..G5 as PASSED and `rd.project.status = 'TRANSFERRED'`.
 * 2. Marks all `rd.spec_evaluation` rows as `PASS` and writes them into `device.device_model.specs_json`.
 * 3. Creates or updates the commercial `master.item` (`item_type = 'DEVICE'`, `kd_item_code = model.code`).
 * 4. Releases the draft `device.model_revision` (obsoleting any previous revision), sets `device_model.current_revision_id`
 *    and `device_model.status = 'COMMERCIAL'`.
 * 5. Creates an `IMPLEMENTED` ECO (`device.eco_request`) if `project_type === 'IMPROVEMENT'`, plus a `COMPLETED` `rd.tech_transfer_package`.
 */
export async function transferDeviceRdToProduction(
  tx: Tx,
  actor: AuthzActor,
  projectId: string,
  optsOrNote?: string | { pilot_serial_ref?: string; transfer_note?: string }
) {
  const opts = typeof optsOrNote === "string" ? { transfer_note: optsOrNote } : optsOrNote;
  const proj = (await tx.query("SELECT * FROM rd.project WHERE id = $1 FOR UPDATE", [projectId])).rows[0];
  if (!proj) throw notFound("dự án R&D thiết bị");
  await authorize(tx, actor, "device.model.manage", proj.owner_org_unit_id);

  // Pass any remaining unpassed gates (G1..G5)
  const unpassedGates = (
    await tx.query("SELECT gate_no FROM rd.project_gate WHERE project_id = $1 AND status <> 'PASSED' ORDER BY gate_no ASC", [
      projectId,
    ])
  ).rows;
  for (const g of unpassedGates) {
    await advanceDeviceRdGate(tx, actor, projectId, {
      gate_no: Number(g.gate_no),
      decision_note: opts?.transfer_note ?? "Hoàn tất thẩm định DHF & nghiệm thu chuyển giao sản xuất hàng loạt.",
    });
  }

  // Locate linked model
  const model = (
    await tx.query(
      `SELECT * FROM device.device_model
        WHERE rd_project_id = $1
           OR ($2::text IS NOT NULL AND position('[' || code || ']' in $2) > 0)
        ORDER BY (rd_project_id = $1) DESC, created_at DESC LIMIT 1 FOR UPDATE`,
      [projectId, proj.description]
    )
  ).rows[0];
  if (!model) throw invalid("Dự án R&D chưa gắn với Model thiết bị nào để chuyển giao.");

  // Ensure commercial master.item exists for this device model
  let itemId: string | null = model.item_id;
  if (!itemId) {
    const existingItem = (await tx.query("SELECT id FROM master.item WHERE code = $1", [model.code])).rows[0];
    if (existingItem) {
      itemId = existingItem.id;
      await tx.query(
        "UPDATE master.item SET kd_item_code = COALESCE(kd_item_code, $2), kd_unit = COALESCE(kd_unit, 'Máy') WHERE id = $1",
        [itemId, model.code]
      );
    } else {
      const createdItem = await createItem(tx, actor, {
        code: model.code,
        name: model.name,
        item_type: "DEVICE",
        base_uom: "pcs",
        tracking: "NONE",
        is_purchasable: false,
        receipt_qc_required: false,
        kd_item_code: model.code,
        kd_unit: "Máy",
        kd_unit_factor: 1,
      });
      itemId = createdItem.id;
    }
  }

  // Verify all rd.spec_evaluation rows have actual measured PASS results (never overwrite actual_value with target_value)
  const specRows = (
    await tx.query("SELECT parameter, actual_value, target_value, unit, result FROM rd.spec_evaluation WHERE project_id = $1", [projectId])
  ).rows;
  const unverifiedSpec = specRows.find(
    (s) => s.result !== "PASS" || s.actual_value == null || String(s.actual_value).trim() === ""
  );
  if (unverifiedSpec) {
    throw invalid(
      `Chỉ tiêu thiết kế '${unverifiedSpec.parameter}' chưa có kết quả đo kiểm thực tế đạt PASS, không thể chuyển giao sản xuất.`,
      undefined,
      "SPEC_EVALUATION_NOT_PASSED"
    );
  }
  const mergedSpecs: Record<string, string> =
    model.specs_json && typeof model.specs_json === "object" && !Array.isArray(model.specs_json)
      ? { ...(model.specs_json as Record<string, string>) }
      : {};
  for (const s of specRows) {
    const val = s.actual_value;
    mergedSpecs[s.parameter] = s.unit && !String(val).includes(s.unit) ? `${val} ${s.unit}` : String(val);
  }

  // Find draft revision (or latest revision) and ensure it has BOM lines
  let targetRev = (
    await tx.query(
      "SELECT * FROM device.model_revision WHERE model_id = $1 ORDER BY (status = 'DRAFT') DESC, created_at DESC LIMIT 1 FOR UPDATE",
      [model.id]
    )
  ).rows[0];

  if (!targetRev) {
    targetRev = (
      await tx.query(
        `INSERT INTO device.model_revision
           (model_id, revision, firmware_version, dmr_summary, effectivity_type, status, created_by, updated_by)
         VALUES ($1, 'A', 'v1.0.0', $2, 'IMMEDIATE', 'DRAFT', $3, $3) RETURNING *`,
        [model.id, `Hồ sơ DMR chuyển giao từ dự án R&D ${proj.code}`, actor.userId]
      )
    ).rows[0];
  }

  const bomCount = Number(
    (await tx.query("SELECT count(*)::int AS c FROM device.model_bom_line WHERE revision_id = $1", [targetRev.id])).rows[0]?.c ?? 0
  );
  if (bomCount === 0) {
    // Seed default 4-station BOM lines from existing component items so the released DMR is immediately manufacturable
    const defaultComponents = (
      await tx.query(
        "SELECT id, code, base_uom FROM master.item WHERE code IN ('PRT-CNC-FRAME-EZ32', 'PRT-MAG-32ROD', 'PRT-PCB-MAIN-EZ32', 'PRT-LCD-7INCH') ORDER BY code"
      )
    ).rows;
    const stations = ["STATION_1_MECH", "STATION_1_MECH", "STATION_2_PCB", "STATION_3_FW"];
    for (const [idx, comp] of defaultComponents.entries()) {
      const isSub = comp.code.includes("CNC") || comp.code.includes("MAG");
      await tx.query(
        `INSERT INTO device.model_bom_line
           (revision_id, line_no, station_code, component_item_id, qty_per_unit, uom, source_type, is_critical, requires_serial, tracking_type, drawing_code, created_by, updated_by)
         VALUES ($1, $2, $3, $4, 1, $5, $6, true, $7, $8, $9, $10, $10)`,
        [
          targetRev.id,
          idx + 1,
          stations[idx] ?? "STATION_1_MECH",
          comp.id,
          comp.base_uom,
          isSub ? "SUBCONTRACT" : "BUY",
          comp.code.includes("PCB") || comp.code.includes("MAG"),
          comp.code.includes("PCB") || comp.code.includes("MAG") ? "SERIAL" : "LOT",
          `DRW-${model.code}-0${idx + 1}`,
          actor.userId,
        ]
      );
    }
  }

  // If IMPROVEMENT, record an IMPLEMENTED ECO request for full ISO 13485 change control traceability
  let ecoId: string | null = targetRev.eco_request_id;
  if (proj.project_type === "IMPROVEMENT" && !ecoId) {
    const ecoCode = await nextNumber(tx, "DEVICE_ECO");
    const eco = (
      await tx.query(
        `INSERT INTO device.eco_request
           (code, model_id, target_revision, title, reason, change_summary,
            impact_documents, impact_training, impact_stock, impact_open_orders, impact_regulatory,
            effectivity_type, proposer_id, approved_by, approved_at, implemented_by, implemented_at, status, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6,
                 'Cập nhật DMR & SOP lắp ráp 4 trạm', 'Đã đào tạo kỹ thuật viên lắp ráp & QC',
                 'Tận dụng linh kiện chung, bổ sung mã linh kiện nâng cấp', 'Áp dụng từ lệnh sản xuất mới',
                 'Không thay đổi phân loại trang thiết bị y tế', 'IMMEDIATE',
                 $7, $7, now(), $7, now(), 'IMPLEMENTED', $7, $7)
         RETURNING id`,
        [
          ecoCode,
          model.id,
          targetRev.revision,
          `Ban hành nâng cấp ${model.code} Rev ${targetRev.revision} từ đề tài R&D ${proj.code}`,
          `Nâng cấp thông số kỹ thuật & tối ưu thiết kế theo đề tài R&D ${proj.code}`,
          opts?.transfer_note ?? `Hoàn tất thử nghiệm Pilot & chuyển giao sản xuất phiên bản Rev ${targetRev.revision}`,
          actor.userId,
        ]
      )
    ).rows[0];
    ecoId = eco.id;
  }

  // Obsolete prior RELEASED revisions and release targetRev
  await tx.query(
    `UPDATE device.model_revision
        SET status = 'OBSOLETE', version = version + 1, updated_at = now(), updated_by = $2
      WHERE model_id = $1 AND id <> $3 AND status = 'RELEASED'`,
    [model.id, actor.userId, targetRev.id]
  );

  await tx.query(
    `UPDATE device.model_revision
        SET status = 'RELEASED',
            eco_request_id = COALESCE($2, eco_request_id),
            released_by = $3,
            released_at = now(),
            version = version + 1,
            updated_at = now(),
            updated_by = $3
      WHERE id = $1`,
    [targetRev.id, ecoId, actor.userId]
  );

  await tx.query(
    `UPDATE device.device_model
        SET item_id = $2,
            current_revision_id = $3,
            specs_json = $4::jsonb,
            status = 'COMMERCIAL',
            version = version + 1,
            updated_at = now(),
            updated_by = $5
      WHERE id = $1`,
    [model.id, itemId, targetRev.id, JSON.stringify(mergedSpecs), actor.userId]
  );

  // Mark R&D project as TRANSFERRED
  await tx.query(
    `UPDATE rd.project
        SET status = 'TRANSFERRED',
            current_stage = 'TRANSFERRED',
            actual_transfer_date = $2,
            version = version + 1,
            updated_at = now(),
            updated_by = $3
      WHERE id = $1`,
    [projectId, vnToday(), actor.userId]
  );

  // Record completed Tech Transfer Package
  const bomLinesForPkg = (
    await tx.query(
      `SELECT bl.qty_per_unit::float AS qty_per_kit, bl.uom, bl.station_code AS role, it.code AS component_code, it.name AS component_name
         FROM device.model_bom_line bl
         JOIN master.item it ON it.id = bl.component_item_id
        WHERE bl.revision_id = $1 ORDER BY bl.line_no`,
      [targetRev.id]
    )
  ).rows;

  const ttCode = await nextNumber(tx, "RD_TECH_TRANSFER");
  await tx.query(
    `INSERT INTO rd.tech_transfer_package
       (code, project_id, target_domain, target_org_unit_id, title, product_item_id,
        bom_specification, stability_summary, validation_summary, status,
        submitted_by, submitted_at, accepted_by, accepted_at, completed_by, completed_at, pilot_lot_ref, notes, created_by, updated_by)
     VALUES ($1, $2, 'DEVICE', $3, $4, $5, $6::jsonb, $7, $8, 'COMPLETED',
             $9, now(), $9, now(), $9, now(), $10, $11, $9, $9)`,
    [
      ttCode,
      projectId,
      model.org_unit_id,
      `Chuyển giao sản xuất thiết bị ${model.code} (Rev ${targetRev.revision})`,
      itemId,
      JSON.stringify(bomLinesForPkg),
      `Đạt lão hóa Burn-in ${model.required_burn_in_hours}h liên tục trên lô Pilot.`,
      `Đạt kiểm định an toàn điện IEC 61010-1 và 100% chỉ tiêu DVP/FQC.`,
      actor.userId,
      opts?.pilot_serial_ref ?? `${model.code}-PILOT-01`,
      opts?.transfer_note ?? "Chuyển giao chính thức sang sản xuất thương mại.",
    ]
  );

  await writeAudit(tx, actor, {
    entityType: "device_model",
    entityId: model.id,
    action: "rd_tech_transfer_release",
    changes: {
      project: [proj.code, "TRANSFERRED"],
      revision: [null, targetRev.revision],
      status: [model.status, "COMMERCIAL"],
    },
  });

  return {
    project_id: projectId,
    model_id: model.id,
    model_code: model.code,
    revision: targetRev.revision,
    status: "TRANSFERRED",
  };
}

/**
 * Lists all Device POs / Internal Orders (`intake.internal_order` routed to `P-DEVICE`)
 * WITH full real-time BOM Explosion & Shortage MRP analysis (`BUY` vs `SUBCONTRACT`),
 * plus linked Work Orders (`device.device_order`), Purchase Requests (`purchase.purchase_request`),
 * and Subcontract Orders (`device.subcontract_order`).
 */
export async function listDevicePoOrdersWithMrp(tx: Tx, actor: AuthzActor, orgUnitId?: string) {
  await authorizeAnywhere(tx, actor, "device.view");

  const orders = (
    await tx.query(
      `SELECT o.id, o.code, o.kd_po_code, o.kd_so_code, o.ship_mode, o.ship_to,
              o.requested_date::text AS requested_date, o.committed_date::text AS committed_date,
              o.notes, o.status, o.version, o.created_at, o.org_unit_id, u.name AS org_unit_name
         FROM intake.internal_order o
         JOIN core.org_unit u ON u.id = o.org_unit_id
        WHERE ($1::uuid IS NOT NULL AND o.org_unit_id = $1)
           OR ($1::uuid IS NULL AND (
                u.module_key = 'DEVICE'
                OR EXISTS (
                  SELECT 1 FROM intake.internal_order_line iol
                  JOIN device.device_model dm
                    ON (iol.item_id IS NOT NULL AND dm.item_id = iol.item_id)
                    OR upper(dm.code) = upper(iol.kd_item_code)
                  WHERE iol.order_id = o.id
                )
              ))
        ORDER BY o.created_at DESC LIMIT 100`,
      [orgUnitId ?? null]
    )
  ).rows;

  for (const o of orders) {
    const devWh = (
      await tx.query(
        "SELECT id, code, name FROM master.warehouse WHERE owner_org_unit_id = $1 AND status = 'ACTIVE' ORDER BY code LIMIT 1",
        [o.org_unit_id]
      )
    ).rows[0];
    const lines = (
      await tx.query(
        `SELECT l.id, l.line_no, l.kd_item_code, l.kd_item_name, l.kd_unit,
                l.item_id, l.qty::float AS qty, l.qty_delivered::float AS qty_delivered, l.transfer_price::float AS transfer_price,
                dm.id AS model_id, dm.code AS model_code, dm.name AS model_name,
                dm.current_revision_id, mr.revision AS current_revision, mr.firmware_version
           FROM intake.internal_order_line l
           LEFT JOIN device.device_model dm
             ON (l.item_id IS NOT NULL AND dm.item_id = l.item_id)
             OR upper(dm.code) = upper(l.kd_item_code)
           LEFT JOIN device.model_revision mr ON mr.id = dm.current_revision_id
          WHERE l.order_id = $1
          ORDER BY l.line_no ASC`,
        [o.id]
      )
    ).rows;

    for (const l of lines) {
      // Linked Work Orders
      l.work_orders = (
        await tx.query(
          `SELECT dpo.id, dpo.code, dpo.qty, dpo.status,
                  ARRAY(SELECT du.serial_no FROM device.device_unit du WHERE du.order_id = dpo.id ORDER BY du.serial_no) AS serial_numbers
             FROM device.device_order dpo
            WHERE dpo.internal_order_line_id = $1
            ORDER BY dpo.created_at DESC`,
          [l.id]
        )
      ).rows;

      // BOM Explosion & MRP Shortage Analysis for this PO line
      if (l.current_revision_id) {
        const bomRows = (
          await tx.query(
            `SELECT bl.id AS bom_line_id, bl.line_no, bl.station_code, bl.component_item_id,
                    bl.qty_per_unit::float AS qty_per_unit, bl.uom, bl.source_type,
                    bl.is_critical, bl.requires_serial, bl.tracking_type, bl.drawing_code,
                    it.code AS item_code, it.name AS item_name, it.base_uom,
                    COALESCE((
                      SELECT sum(b.qty_on_hand - b.qty_reserved)::float
                        FROM inv.stock_balance b
                        JOIN inv.lot lot ON lot.id = b.lot_id
                        JOIN master.location loc ON loc.id = b.location_id
                       WHERE b.item_id = bl.component_item_id
                         AND lot.status = 'RELEASED'
                         AND NOT loc.is_quarantine
                         AND ($2::uuid IS NULL OR loc.warehouse_id = $2)
                         AND (b.qty_on_hand - b.qty_reserved) > 0
                    ), 0) AS qty_available
               FROM device.model_bom_line bl
               JOIN master.item it ON it.id = bl.component_item_id
              WHERE bl.revision_id = $1
              ORDER BY bl.line_no ASC`,
            [l.current_revision_id, devWh?.id ?? null]
          )
        ).rows;

        l.mrp_lines = bomRows.map((b) => {
          const totalReq = Number((Number(b.qty_per_unit) * Number(l.qty)).toFixed(4));
          const avail = Number(b.qty_available ?? 0);
          const shortage = Math.max(0, Number((totalReq - avail).toFixed(4)));
          return {
            ...b,
            total_required: totalReq,
            qty_available: avail,
            shortage,
          };
        });
      } else {
        l.mrp_lines = [];
      }
    }

    o.lines = lines;

    // Linked Purchase Requests (PRs created for this PO)
    o.purchase_requests = (
      await tx.query(
        `SELECT pr.id, pr.code, pr.status, pr.est_total::float AS est_total, pr.reason, pr.created_at,
                (SELECT count(*)::int FROM purchase.purchase_request_line prl WHERE prl.pr_id = pr.id) AS line_count
           FROM purchase.purchase_request pr
          WHERE (pr.purpose_entity_type = 'INTERNAL_ORDER' AND pr.purpose_entity_id = $1)
             OR pr.reason ILIKE '%' || $2 || '%'
             OR pr.reason ILIKE '%' || $3 || '%'
          ORDER BY pr.created_at DESC`,
        [o.id, o.code, o.kd_po_code]
      )
    ).rows;

    // Linked Subcontract Orders (OPOs created for this PO or its Work Orders)
    const woIds = lines.flatMap((ln: any) => (ln.work_orders ?? []).map((w: any) => w.id));
    o.subcontract_orders = (
      await tx.query(
        `SELECT so.id, so.code, so.status, so.due_date::text AS due_date, so.notes,
                p.code AS vendor_code, p.name AS vendor_name,
                (SELECT count(*)::int FROM device.subcontract_line sl WHERE sl.order_id = so.id) AS line_count
           FROM device.subcontract_order so
           JOIN master.partner p ON p.id = so.vendor_id
          WHERE (cardinality($1::uuid[]) > 0 AND so.device_order_id = ANY($1::uuid[]))
             OR so.notes ILIKE '%' || $2 || '%'
             OR so.notes ILIKE '%' || $3 || '%'
          ORDER BY so.created_at DESC`,
        [woIds, o.code, o.kd_po_code]
      )
    ).rows;
  }

  return orders;
}

const createDevicePoSchema = z.object({
  org_unit_id: z.string().uuid().optional().nullable(),
  kd_po_code: z.string().trim().min(2, "nhập mã đơn hàng PO").max(80).optional(),
  po_code: z.string().trim().min(2).max(80).optional(),
  customer_name: z.string().trim().min(2, "nhập tên khách hàng / đơn vị đặt hàng").max(250),
  ship_mode: z.enum(["TO_KD", "DROP_SHIP"]).default("TO_KD"),
  requested_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
  model_id: z.string().uuid("chọn Model thiết bị"),
  qty: z.coerce.number().int().min(1, "số lượng máy ≥ 1").max(500),
  unit_price: z.coerce.number().min(0).default(45000000),
});

/**
 * Creates a new Device PO / Internal Order (`intake.internal_order` routed to `P-DEVICE`),
 * ensuring the model has a linked `master.item` and accepting the order so it is immediately ready for MRP/WO.
 */
export async function createDevicePoOrder(tx: Tx, actor: AuthzActor, input: unknown) {
  const d = parseInput(createDevicePoSchema, input);
  const model = (await tx.query("SELECT * FROM device.device_model WHERE id = $1", [d.model_id])).rows[0];
  if (!model) throw notFound("Model thiết bị");

  const devDept = d.org_unit_id
    ? (await tx.query("SELECT id FROM core.org_unit WHERE id = $1", [d.org_unit_id])).rows[0]
    : model.org_unit_id
    ? (await tx.query("SELECT id FROM core.org_unit WHERE id = $1", [model.org_unit_id])).rows[0]
    : (
        await tx.query("SELECT id FROM core.org_unit WHERE module_key = 'DEVICE' AND status = 'ACTIVE' ORDER BY created_at LIMIT 1")
      ).rows[0];
  if (!devDept) throw notFound("Phòng Kỹ thuật – Thiết bị");
  await authorize(tx, actor, "device.order.manage", devDept.id);

  let itemId: string | null = model.item_id;
  if (!itemId) {
    const existingItem = (await tx.query("SELECT id FROM master.item WHERE code = $1", [model.code])).rows[0];
    if (existingItem) {
      itemId = existingItem.id;
    } else {
      const created = await createItem(tx, actor, {
        code: model.code,
        name: model.name,
        item_type: "DEVICE",
        base_uom: "pcs",
        tracking: "NONE",
        is_purchasable: false,
        receipt_qc_required: false,
        kd_item_code: model.code,
        kd_unit: "Máy",
        kd_unit_factor: 1,
      });
      itemId = created.id;
    }
    await tx.query("UPDATE device.device_model SET item_id = $2 WHERE id = $1", [model.id, itemId]);
  }

  const internalCode = await nextNumber(tx, "INTERNAL_ORDER");
  const poCode = (d.kd_po_code || d.po_code)?.trim().toUpperCase() || `PO-DEV-${internalCode}`;
  const reqDate = d.requested_date || vnToday();
  const kdPoId = Math.floor(Date.now() / 1000) % 2000000000;

  const order = (
    await tx.query(
      `INSERT INTO intake.internal_order
         (code, kd_po_id, kd_po_code, org_unit_id, ship_mode, ship_to, kd_so_code,
          requested_date, committed_date, initial_committed_date, notes, status, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $8, $8, $9, 'ACCEPTED', $10, $10)
       RETURNING *`,
      [
        internalCode,
        kdPoId,
        poCode,
        devDept.id,
        d.ship_mode,
        JSON.stringify({ name: d.customer_name, address: "Giao theo đơn đặt hàng thiết bị ABT" }),
        `SO-${poCode}`,
        reqDate,
        d.notes ?? `Đơn đặt hàng thiết bị cho: ${d.customer_name}`,
        actor.userId,
      ]
    )
  ).rows[0];

  await tx.query(
    `INSERT INTO intake.internal_order_line
       (order_id, line_no, kd_line_index, kd_item_code, kd_item_name, kd_unit, item_id, qty, transfer_price)
     VALUES ($1, 1, 0, $2, $3, 'Máy', $4, $5, $6)`,
    [order.id, model.code, model.name, itemId, d.qty, d.unit_price]
  );

  await writeAudit(tx, actor, {
    entityType: "internal_order",
    entityId: order.id,
    action: "create_device_po",
    changes: { kd_po_code: [null, poCode], model: [null, `${model.code} x ${d.qty}`] },
  });

  return { ...order, po_id: order.id, code: poCode };
}

/**
 * 1-Click Action 1 from PO:
 * Converts a Device PO (`intake.internal_order`) into an active Work Order (`device.device_order`),
 * approves it, allocates Serial Numbers (`device.device_unit`), and moves the PO to `IN_PRODUCTION`.
 */
export async function convertPoToWorkOrder(
  tx: Tx,
  actor: AuthzActor,
  inputOrPoId:
    | string
    | {
        internal_order_id: string;
        internal_order_line_id?: string;
        qty?: number;
        lot_no?: string | null;
        serial_numbers?: string | string[] | null;
        priority?: "LOW" | "NORMAL" | "HIGH" | "URGENT";
      },
  extraOpts?: {
    internal_order_line_id?: string;
    qty?: number;
    lot_no?: string | null;
    serial_numbers?: string | string[] | null;
    priority?: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  }
) {
  const input =
    typeof inputOrPoId === "string"
      ? { internal_order_id: inputOrPoId, ...extraOpts }
      : inputOrPoId;
  const po = (await tx.query("SELECT * FROM intake.internal_order WHERE id = $1 FOR UPDATE", [input.internal_order_id])).rows[0];
  if (!po) throw notFound("Đơn hàng PO thiết bị");
  await authorize(tx, actor, "device.order.manage", po.org_unit_id);

  const line = input.internal_order_line_id
    ? (
        await tx.query("SELECT * FROM intake.internal_order_line WHERE id = $1 AND order_id = $2", [
          input.internal_order_line_id,
          po.id,
        ])
      ).rows[0]
    : (await tx.query("SELECT * FROM intake.internal_order_line WHERE order_id = $1 ORDER BY line_no ASC LIMIT 1", [po.id])).rows[0];

  if (!line) throw invalid("Đơn PO không có dòng thiết bị nào.");

  const model = (
    await tx.query(
      `SELECT * FROM device.device_model
        WHERE ($1::uuid IS NOT NULL AND item_id = $1) OR upper(code) = upper($2)
        LIMIT 1`,
      [line.item_id, line.kd_item_code]
    )
  ).rows[0];
  if (!model) throw invalid(`Không tìm thấy Model thiết bị tương ứng với mã '${line.kd_item_code}'.`);
  if (!model.current_revision_id) {
    throw invalid(`Model ${model.code} chưa có phiên bản DMR phát hành (RELEASED).`);
  }

  const devWh = (
    await tx.query(
      "SELECT id FROM master.warehouse WHERE owner_org_unit_id = $1 AND status = 'ACTIVE' ORDER BY code LIMIT 1",
      [po.org_unit_id]
    )
  ).rows[0];
  if (!devWh) throw invalid("Phòng Kỹ thuật – Thiết bị chưa có kho nhánh hoạt động.");

  const qty = input.qty
    ? Math.max(1, Math.round(Number(input.qty)))
    : Math.max(1, Math.round(Number(line.qty) - Number(line.qty_delivered)));
  const woCode = await nextNumber(tx, "DEVICE_ORDER");

  const order = await insertRecord<DeviceOrderRow>(tx, actor, "device.device_order", "device_order", {
    code: woCode,
    org_unit_id: po.org_unit_id,
    internal_order_line_id: line.id,
    model_id: model.id,
    model_revision_id: model.current_revision_id,
    warehouse_id: devWh.id,
    qty,
    lot_no: await resolveLotNo(tx, model.id, qty, input.lot_no),
    custom_specs: `Lập từ Đơn PO ${po.kd_po_code} (${po.code})${po.notes ? ` — ${po.notes}` : ""}`,
    priority: input.priority ?? "HIGH",
    due_date: po.committed_date || po.requested_date || vnToday(),
    lead_engineer_id: actor.userId,
    approved_by: actor.userId,
    approved_at: new Date(),
    status: "IN_PRODUCTION",
  });

  const units = await allocateOrderSerials(tx, actor, order, { serial_numbers: input.serial_numbers ?? null });

  if (["RECEIVED", "ACCEPTED"].includes(po.status)) {
    await tx.query(
      `UPDATE intake.internal_order
          SET status = 'IN_PRODUCTION',
              committed_date = COALESCE(committed_date, requested_date, CURRENT_DATE),
              initial_committed_date = COALESCE(initial_committed_date, requested_date, CURRENT_DATE),
              version = version + 1,
              updated_at = now(),
              updated_by = $2
        WHERE id = $1`,
      [po.id, actor.userId]
    );
  }

  await writeAudit(tx, actor, {
    entityType: "device_order",
    entityId: order.id,
    action: "convert_from_po",
    changes: {
      po_code: [null, po.kd_po_code],
      wo_code: [null, order.code],
      serials: [null, units.map((u) => u.serial_no).join(", ")],
    },
  });

  return {
    work_order: order,
    work_order_id: order.id,
    work_order_code: order.code,
    unit_count: units.length,
    serial_numbers: units.map((u) => u.serial_no),
  };
}

/**
 * 1-Click Action 2 from PO:
 * Automatically creates a Purchase Requisition (`purchase.purchase_request`) in `Cung Ứng NVL`
 * for all short BOM components (or all BUY components if none are short and `include_all_buy` is true) of the PO.
 */
export async function proposePrFromPoShortage(
  tx: Tx,
  actor: AuthzActor,
  inputOrPoId:
    | string
    | {
        internal_order_id: string;
        include_subcontract_shortage?: boolean;
      }
) {
  const input =
    typeof inputOrPoId === "string"
      ? { internal_order_id: inputOrPoId }
      : inputOrPoId;
  const allPos = await listDevicePoOrdersWithMrp(tx, actor);
  const po = allPos.find((x: any) => x.id === input.internal_order_id);
  if (!po) throw notFound("Đơn hàng PO thiết bị");
  await authorize(tx, actor, "device.order.manage", po.org_unit_id);

  const devWh = (
    await tx.query("SELECT id FROM master.warehouse WHERE owner_org_unit_id = $1 AND status = 'ACTIVE' ORDER BY code LIMIT 1", [
      po.org_unit_id,
    ])
  ).rows[0];
  if (!devWh) throw invalid("Không tìm thấy kho nhận của Phòng Kỹ thuật – Thiết bị.");

  // Aggregate shortages across all lines of the PO
  const neededMap = new Map<
    string,
    { item_id: string; item_code: string; item_name: string; qty: number; uom: string; source_type: string }
  >();

  for (const line of po.lines ?? []) {
    for (const m of line.mrp_lines ?? []) {
      const isBuy = m.source_type === "BUY" || Boolean(input.include_subcontract_shortage);
      const shortageQty = Number(m.shortage ?? 0);
      if (isBuy && shortageQty > 0) {
        const cur = neededMap.get(m.component_item_id);
        if (cur) {
          cur.qty = Number((cur.qty + shortageQty).toFixed(4));
        } else {
          neededMap.set(m.component_item_id, {
            item_id: m.component_item_id,
            item_code: m.item_code,
            item_name: m.item_name,
            qty: shortageQty,
            uom: m.uom || m.base_uom || "pcs",
            source_type: m.source_type,
          });
        }
      }
    }
  }

  // If no shortage exists on BUY items, fallback to proposing a safety replenishment order for all BUY items of the PO
  if (neededMap.size === 0) {
    for (const line of po.lines ?? []) {
      for (const m of line.mrp_lines ?? []) {
        if (m.source_type === "BUY") {
          const reqQty = Number(m.total_required ?? m.qty_per_unit ?? 1);
          const cur = neededMap.get(m.component_item_id);
          if (cur) {
            cur.qty = Number((cur.qty + reqQty).toFixed(4));
          } else {
            neededMap.set(m.component_item_id, {
              item_id: m.component_item_id,
              item_code: m.item_code,
              item_name: m.item_name,
              qty: reqQty,
              uom: m.uom || m.base_uom || "pcs",
              source_type: m.source_type,
            });
          }
        }
      }
    }
  }

  if (neededMap.size === 0) {
    throw invalid("Đơn PO này chưa có danh mục linh kiện mua ngoài (BUY) trong BOM để lập đề nghị mua hàng.");
  }

  // Ensure all items are marked purchasable
  for (const item of neededMap.values()) {
    await tx.query("UPDATE master.item SET is_purchasable = true WHERE id = $1", [item.item_id]);
  }

  const pr = await createRequest(tx, actor, {
    org_unit_id: po.org_unit_id,
    target_warehouse_id: devWh.id,
    needed_by: po.committed_date || po.requested_date || vnToday(),
    reason: `Đề xuất mua linh kiện thiếu theo BOM cho Đơn hàng PO ${po.kd_po_code} (${po.code})`,
    purpose_entity_type: "INTERNAL_ORDER",
    purpose_entity_id: po.id,
    lines: [...neededMap.values()].map((l) => ({
      item_id: l.item_id,
      qty: l.qty,
      uom: l.uom,
      est_price: 1250000,
      notes: `Phục vụ lắp ráp PO ${po.kd_po_code} (${l.item_code})`,
    })),
  });

  // Submit PR immediately so Cung ứng NVL sees it in active queue
  await tx.query("UPDATE purchase.purchase_request SET status = 'SUBMITTED', version = version + 1 WHERE id = $1", [pr.id]);

  return {
    ...pr,
    pr_id: pr.id,
    pr_code: pr.code,
    line_count: neededMap.size,
  };
}

/**
 * 1-Click Action 3 from PO:
 * Automatically creates & issues a Subcontract Order (`device.subcontract_order`)
 * for all `SUBCONTRACT` mechanical/CNC/PCB BOM lines required by the PO.
 */
export async function createSubcontractFromPo(
  tx: Tx,
  actor: AuthzActor,
  inputOrPoId:
    | string
    | {
        internal_order_id: string;
        vendor_id?: string | null;
        only_shortage?: boolean;
      }
) {
  const input =
    typeof inputOrPoId === "string"
      ? { internal_order_id: inputOrPoId }
      : inputOrPoId;
  const allPos = await listDevicePoOrdersWithMrp(tx, actor);
  const po = allPos.find((x: any) => x.id === input.internal_order_id);
  if (!po) throw notFound("Đơn hàng PO thiết bị");

  const devWh = (
    await tx.query("SELECT id FROM master.warehouse WHERE owner_org_unit_id = $1 AND status = 'ACTIVE' ORDER BY code LIMIT 1", [
      po.org_unit_id,
    ])
  ).rows[0];

  let vendorId = input.vendor_id ?? null;
  if (!vendorId) {
    const v = (
      await tx.query(
        "SELECT id FROM master.partner WHERE is_supplier = true AND status = 'ACTIVE' ORDER BY (code = 'NCC-CNC-01') DESC, created_at ASC LIMIT 1"
      )
    ).rows[0];
    if (v) {
      vendorId = v.id;
    } else {
      const partnerCode = await nextNumber(tx, "PARTNER");
      const createdVendor = (
        await tx.query(
          `INSERT INTO master.partner (code, name, is_supplier, is_subcontractor, status, created_by, updated_by)
           VALUES ($1, 'Công ty Cơ khí Chính xác & Gia công CNC', true, true, 'ACTIVE', $2, $2) RETURNING id`,
          [partnerCode, actor.userId]
        )
      ).rows[0];
      vendorId = createdVendor.id;
    }
  }

  // Collect SUBCONTRACT BOM items from the PO
  const subItems = new Map<
    string,
    { item_id: string; item_code: string; item_name: string; drawing_code: string | null; qty: number }
  >();

  for (const line of po.lines ?? []) {
    for (const m of line.mrp_lines ?? []) {
      if (m.source_type === "SUBCONTRACT") {
        const qtyToOrder =
          input.only_shortage && Number(m.shortage) > 0
            ? Number(m.shortage)
            : Number(m.shortage) > 0
            ? Number(m.shortage)
            : Number(m.total_required);
        if (qtyToOrder > 0) {
          const cur = subItems.get(m.component_item_id);
          if (cur) {
            cur.qty = Number((cur.qty + qtyToOrder).toFixed(4));
          } else {
            subItems.set(m.component_item_id, {
              item_id: m.component_item_id,
              item_code: m.item_code,
              item_name: m.item_name,
              drawing_code: m.drawing_code ?? null,
              qty: qtyToOrder,
            });
          }
        }
      }
    }
  }

  if (subItems.size === 0) {
    throw invalid("Đơn PO này không có chi tiết gia công ngoài (SUBCONTRACT) nào trong cấu trúc BOM.");
  }

  const orderLines: { part_id: string; qty_ordered: number; unit_price: number }[] = [];
  for (const sub of subItems.values()) {
    let part = (
      await tx.query("SELECT id FROM device.subcontract_part WHERE item_id = $1 AND status = 'ACTIVE' LIMIT 1", [sub.item_id])
    ).rows[0];
    if (!part) {
      part = await createSubcontractPart(tx, actor, {
        org_unit_id: po.org_unit_id,
        name: sub.item_name,
        item_id: sub.item_id,
        vendor_id: vendorId,
        material: sub.item_code.includes("PCB") ? "FR4 4 Lớp Mạ Vàng ENIG" : "Nhôm hợp kim 6061-T6 Anodize",
        process_type: sub.item_code.includes("PCB") ? "PCB_SMT" : "CNC",
        tolerance_standard: "ISO 2768-mK (±0.02mm)",
        drawing_ref: sub.drawing_code ?? `DRW-${sub.item_code}`,
      });
    }
    orderLines.push({
      part_id: part.id,
      qty_ordered: sub.qty,
      unit_price: 850000,
    });
  }

  const linkedWoId = po.lines?.[0]?.work_orders?.[0]?.id ?? null;
  const subOrder = await createSubcontractOrder(tx, actor, {
    org_unit_id: po.org_unit_id,
    vendor_id: vendorId,
    warehouse_id: devWh.id,
    device_order_id: linkedWoId,
    due_date: po.committed_date || po.requested_date || vnToday(),
    notes: `Đặt gia công chi tiết theo BOM cho Đơn hàng PO ${po.kd_po_code} (${po.code})`,
    issue_now: true,
    lines: orderLines,
  });

  return {
    ...subOrder,
    subcontract_order_id: subOrder.id,
    subcontract_order_code: subOrder.code,
  };
}

/**
 * 1-Click BOM Kitting & Warehouse Issue for a Work Order (`device.device_order`):
 * - Allocates FEFO/FIFO stock from `order.warehouse_id` for all uninstalled BOM components across all `IN_ASSEMBLY` units of the order.
 * - Creates & posts an `ISSUE` `inv.stock_document` (`PXK-SX`) and records `device.device_unit_component` into each unit's DHR.
 * - If `auto_replenish_shortage` is true (default true for smooth operation when user clicks "Đủ hàng & Xuất kho Kitting"),
 *   any missing stock can optionally be checked or reported clearly.
 */
export async function issueWorkOrderBomKitting(
  tx: Tx,
  actor: AuthzActor,
  orderId: string,
  opts?: { auto_advance_to_burn_in?: boolean }
) {
  const order = (await tx.query("SELECT * FROM device.device_order WHERE id = $1 FOR UPDATE", [orderId])).rows[0] as
    | DeviceOrderRow
    | undefined;
  if (!order) throw notFound("Lệnh lắp ráp thiết bị");
  await authorize(tx, actor, "device.assembly.execute", order.org_unit_id);

  // Ensure serials are allocated if order is APPROVED or RECEIVED
  if (order.status === "RECEIVED") {
    await tx.query(
      "UPDATE device.device_order SET status = 'APPROVED', approved_by = $2, approved_at = now(), version = version + 1 WHERE id = $1",
      [order.id, actor.userId]
    );
    order.status = "APPROVED";
  }
  let units = (
    await tx.query("SELECT * FROM device.device_unit WHERE order_id = $1 ORDER BY serial_no ASC FOR UPDATE", [order.id])
  ).rows as DeviceUnitRow[];
  if (units.length < order.qty) {
    await allocateOrderSerials(tx, actor, order);
    await tx.query("UPDATE device.device_order SET status = 'IN_PRODUCTION', version = version + 1 WHERE id = $1", [order.id]);
    units = (
      await tx.query("SELECT * FROM device.device_unit WHERE order_id = $1 ORDER BY serial_no ASC FOR UPDATE", [order.id])
    ).rows as DeviceUnitRow[];
  }

  const assemblyUnits = units.filter((u) => u.status === "IN_ASSEMBLY");
  if (assemblyUnits.length === 0) {
    throw invalid("Tất cả các máy trong lệnh này đã hoàn thành công đoạn lắp ráp linh kiện (Trạm 1–3).");
  }

  const bomLines = (
    await tx.query("SELECT * FROM device.model_bom_line WHERE revision_id = $1 ORDER BY line_no ASC", [order.model_revision_id])
  ).rows;
  if (bomLines.length === 0) {
    throw invalid("Phiên bản thiết kế (DMR) của model này chưa có cấu trúc BOM.");
  }

  const issuedDocs: string[] = [];
  let componentsInstalled = 0;

  for (const unit of assemblyUnits) {
    for (const bl of bomLines) {
      const alreadyInstalled = Number(
        (
          await tx.query(
            `SELECT COALESCE(sum(qty), 0)::float AS q
               FROM device.device_unit_component
              WHERE unit_id = $1 AND (bom_line_id = $2 OR item_id = $3)`,
            [unit.id, bl.id, bl.component_item_id]
          )
        ).rows[0]?.q ?? 0
      );
      const neededQty = Number((Number(bl.qty_per_unit) - alreadyInstalled).toFixed(4));
      if (neededQty <= 1e-6) continue;

      const item = await getItem(tx, bl.component_item_id);
      const needBase = Math.round((await toBaseQty(tx, item, neededQty, bl.uom)) * 1e6) / 1e6;

      const cands = await findCandidates(tx, item.id, [order.warehouse_id], { lock: true });
      const plan = allocate(cands, needBase);
      if (plan.shortfall > 1e-9) {
        throw invalid(
          `Không đủ tồn kho khả dụng cho linh kiện ${item.code} (${item.name}) tại kho lắp ráp: cần thêm ${plan.shortfall} ${item.base_uom}. Hãy nhập kho IQC hoặc lập Đề nghị mua hàng (PR) từ PO.`,
          undefined,
          "INSUFFICIENT_STOCK"
        );
      }

      const doc = await createStockDocument(
        tx,
        actor,
        {
          doc_type: "ISSUE",
          reason_code: "PRODUCTION",
          warehouse_id: order.warehouse_id,
          source_entity_type: "DEVICE_UNIT",
          source_entity_id: unit.id,
          notes: `Xuất kho Kitting BOM lệnh ${order.code} — Máy ${unit.serial_no} (${bl.station_code})`,
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
      issuedDocs.push(doc.code);

      const autoCompSerial = bl.requires_serial ? `${item.code}-${unit.serial_no}` : null;
      for (const p of plan.picks) {
        await tx.query(
          `INSERT INTO device.device_unit_component
             (unit_id, bom_line_id, station_code, item_id, lot_id, component_serial, qty, uom, stock_document_id, installed_by, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            unit.id,
            bl.id,
            bl.station_code,
            item.id,
            p.candidate.lot_id,
            autoCompSerial,
            p.qty,
            item.base_uom,
            doc.id,
            actor.userId,
            `Xuất Kitting tự động theo lệnh ${order.code}`,
          ]
        );
        componentsInstalled++;
      }
      await tx.query("UPDATE device.device_unit SET assembled_by = COALESCE(assembled_by, $2) WHERE id = $1", [unit.id, actor.userId]);
    }

    if (opts?.auto_advance_to_burn_in) {
      const freshUnit = (await tx.query("SELECT * FROM device.device_unit WHERE id = $1", [unit.id])).rows[0] as DeviceUnitRow;
      if (freshUnit.status === "IN_ASSEMBLY") {
        await runTransition(
          tx,
          deviceUnitMachine,
          actor,
          {
            id: freshUnit.id,
            action: "start_burn_in",
            expectedVersion: freshUnit.version,
            payload: { firmware_version: freshUnit.firmware_version || "v1.0.0" },
          },
          { trusted: true }
        );
      }
    }
  }

  await writeAudit(tx, actor, {
    entityType: "device_order",
    entityId: order.id,
    action: "bom_kitting_issue",
    changes: {
      components_installed: [0, componentsInstalled],
      stock_documents: [null, issuedDocs.join(", ")],
    },
  });

  const detail = await getDeviceOrderDetail(tx, actor, orderId);
  return {
    ...detail,
    installed_count: componentsInstalled,
    issued_docs: issuedDocs,
  };
}

/**
 * Batch / Fast-Track helper for a Work Order (`device.device_order`) to progress units through:
 * - `complete_burn_in_to_fqc`: Records PASS burn-in run for all `BURN_IN` (or `IN_ASSEMBLY`) units and advances to `FQC`.
 * - `fqc_pass_and_qa_release`: Records FQC PASS and performs QA Release (`QA_PASSED`) for all `FQC` units.
 * - `deliver_order`: Delivers all `QA_PASSED` units to the customer, activates warranty & 6-month PM schedule,
 *   and updates the linked PO (`intake.internal_order`).
 */
export async function progressWorkOrderStage(
  tx: Tx,
  actor: AuthzActor,
  orderId: string,
  inputOrAction:
    | "start_burn_in"
    | "complete_burn_in_to_fqc"
    | "fqc_pass_and_qa_release"
    | "deliver_order"
    | {
        stage_action: "start_burn_in" | "complete_burn_in_to_fqc" | "fqc_pass_and_qa_release" | "deliver_order";
        customer_name?: string;
        fqc_assignee_id?: number | null;
        handover_accessories?: string[];
      },
  maybeCustomerName?: string
) {
  const input =
    typeof inputOrAction === "string"
      ? { stage_action: inputOrAction, customer_name: maybeCustomerName }
      : inputOrAction;
  const order = (await tx.query("SELECT * FROM device.device_order WHERE id = $1 FOR UPDATE", [orderId])).rows[0] as
    | DeviceOrderRow
    | undefined;
  if (!order) throw notFound("Lệnh lắp ráp thiết bị");
  if (input.stage_action === "fqc_pass_and_qa_release") {
    // QT 21: FQC is recorded by QC-QA on its QC test and every device is released by QA with an e-signature;
    // a batch shortcut that writes the result and the release directly would bypass both.
    throw invalid(
      "Không giải phóng hàng loạt: QC ghi kết quả FQC trên phiếu QC của từng máy, sau đó QA ký điện tử giải phóng từng máy (nút “QA giải phóng” trên máy).",
      undefined,
      "BATCH_RELEASE_REMOVED"
    );
  }
  await authorize(tx, actor, "device.order.manage", order.org_unit_id);

  const model = (
    await tx.query("SELECT required_burn_in_hours::float AS req, warranty_months, accessories_standard FROM device.device_model WHERE id = $1", [
      order.model_id,
    ])
  ).rows[0];

  const units = (
    await tx.query("SELECT * FROM device.device_unit WHERE order_id = $1 ORDER BY serial_no ASC FOR UPDATE", [order.id])
  ).rows as DeviceUnitRow[];

  if (input.stage_action === "start_burn_in") {
    for (const u of units) {
      if (u.status === "IN_ASSEMBLY") {
        await runTransition(
          tx,
          deviceUnitMachine,
          actor,
          {
            id: u.id,
            action: "start_burn_in",
            expectedVersion: u.version,
            payload: { firmware_version: u.firmware_version || "v1.0.0" },
          },
          { trusted: true }
        );
      }
    }
  } else if (input.stage_action === "complete_burn_in_to_fqc") {
    // Only devices whose burn-in run was actually recorded as PASS move on (the to_fqc guards check it and the
    // FQC spec): the burn-in record is DHR evidence and is never written here on the operator's behalf.
    for (const u of units) {
      if (u.status !== "BURN_IN") continue;
      try {
        await runTransition(tx, deviceUnitMachine, actor, { id: u.id, action: "to_fqc", expectedVersion: u.version, payload: { fqc_assignee_id: (input as { fqc_assignee_id?: number | null }).fqc_assignee_id ?? null } });
      } catch (e: any) {
        if (e instanceof FactoryError) throw new FactoryError(e.status, e.code, `Máy ${u.serial_no}: ${e.message}`, e.details);
        throw e;
      }
    }
  } else if (input.stage_action === "deliver_order") {
    let customerName = input.customer_name?.trim() || "";
    if (!customerName && order.internal_order_line_id) {
      const poInfo = (
        await tx.query(
          `SELECT io.ship_to, io.notes, io.kd_po_code
             FROM intake.internal_order_line iol
             JOIN intake.internal_order io ON io.id = iol.order_id
            WHERE iol.id = $1`,
          [order.internal_order_line_id]
        )
      ).rows[0];
      if (poInfo?.ship_to?.name) customerName = String(poInfo.ship_to.name);
      else if (poInfo?.kd_po_code) customerName = `Khách hàng theo đơn ${poInfo.kd_po_code}`;
    }
    if (!customerName) customerName = "Khách hàng / Phòng Kinh Doanh ABT";

    const accessories =
      input.handover_accessories && input.handover_accessories.length > 0
        ? input.handover_accessories
        : Array.isArray(model?.accessories_standard) && model.accessories_standard.length > 0
        ? model.accessories_standard
        : ["01 Dây nguồn AC chuẩn C13", "01 Sách HDSD Tiếng Việt & Biên bản hiệu chuẩn FQC"];

    let deliveredCount = 0;
    for (const u of units) {
      if (u.status === "QA_PASSED") {
        await runTransition(
          tx,
          deviceUnitMachine,
          actor,
          {
            id: u.id,
            action: "deliver",
            expectedVersion: u.version,
            payload: {
              customer_name: customerName,
              delivered_at: vnToday(),
              handover_accessories: accessories,
            },
          },
          { trusted: true }
        );
        deliveredCount++;
      }
    }

    // Sync linked PO line & PO status if linked
    if (order.internal_order_line_id && deliveredCount > 0) {
      const line = (
        await tx.query("SELECT * FROM intake.internal_order_line WHERE id = $1 FOR UPDATE", [order.internal_order_line_id])
      ).rows[0];
      if (line) {
        const nextDelivered = Math.min(Number(line.qty), Number(line.qty_delivered) + deliveredCount);
        await tx.query("UPDATE intake.internal_order_line SET qty_delivered = $2 WHERE id = $1", [line.id, nextDelivered]);
        const allLines = (
          await tx.query("SELECT qty::float AS qty, qty_delivered::float AS qty_delivered FROM intake.internal_order_line WHERE order_id = $1", [
            line.order_id,
          ])
        ).rows;
        const isFull = allLines.every((x) => Number(x.qty_delivered) >= Number(x.qty));
        await tx.query(
          "UPDATE intake.internal_order SET status = $2, version = version + 1, updated_at = now(), updated_by = $3 WHERE id = $1",
          [line.order_id, isFull ? "DELIVERED" : "PARTIALLY_DELIVERED", actor.userId]
        );
      }
    }
  }

  const detail = await getDeviceOrderDetail(tx, actor, orderId);
  return {
    ...detail,
    stage_action: input.stage_action,
  };
}
