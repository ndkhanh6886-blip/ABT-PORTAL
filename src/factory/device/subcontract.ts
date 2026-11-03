import { z } from "zod";
import type { Tx } from "../core/db";
import { writeAudit } from "../core/audit";
import { authorize, authorizeAnywhere, hasFactoryPermission, SYSTEM_ACTOR, type AuthzActor } from "../core/authz";
import { invalid, notFound } from "../core/errors";
import { nextNumber } from "../core/numbering";
import { insertRecord, parseInput } from "../core/records";
import { defineMachine, listAllowedActions, runTransition } from "../core/stateMachine";
import { createStockDocument, stockDocumentMachine } from "../inv/documents";
import { createLot, lotMachine } from "../inv/lots";
import { readAttachment, saveAttachment } from "../core/files";
import { getItem } from "../master/service";
import "./permissions";

export type SubcontractOrderStatus = "DRAFT" | "ISSUED" | "PARTIALLY_RECEIVED" | "RECEIVED" | "CLOSED" | "CANCELLED";

export interface SubcontractOrderRow {
  id: string;
  code: string;
  org_unit_id: string;
  vendor_id: string;
  warehouse_id: string;
  device_order_id: string | null;
  due_date: string | null;
  notes: string | null;
  status: SubcontractOrderStatus;
  version: number;
}

export const subcontractOrderMachine = defineMachine<SubcontractOrderStatus, SubcontractOrderRow>({
  entityType: "device_subcontract_order",
  table: "device.subcontract_order",
  states: ["DRAFT", "ISSUED", "PARTIALLY_RECEIVED", "RECEIVED", "CLOSED", "CANCELLED"],
  terminal: ["CLOSED", "CANCELLED"],
  scopeOf: (row) => row.org_unit_id,
  transitions: [
    {
      action: "issue",
      from: "DRAFT",
      to: "ISSUED",
      permission: "device.subcontract.manage",
      guards: [
        {
          code: "NO_LINES",
          message: "Đơn đặt gia công phải có ít nhất một chi tiết gia công trước khi phát hành.",
          check: async ({ tx, row }) => {
            const c = await tx.query("SELECT 1 FROM device.subcontract_line WHERE order_id = $1 LIMIT 1", [row.id]);
            return (c.rowCount ?? 0) > 0;
          },
        },
      ],
    },
    {
      action: "mark_partial",
      from: ["ISSUED", "PARTIALLY_RECEIVED"],
      to: "PARTIALLY_RECEIVED",
      permission: "device.subcontract.manage",
    },
    {
      action: "mark_received",
      from: ["ISSUED", "PARTIALLY_RECEIVED"],
      to: "RECEIVED",
      permission: "device.subcontract.manage",
    },
    {
      action: "close",
      from: "RECEIVED",
      to: "CLOSED",
      permission: "device.subcontract.manage",
    },
    {
      action: "cancel",
      from: ["DRAFT", "ISSUED"],
      to: "CANCELLED",
      permission: "device.subcontract.manage",
      reasonRequired: true,
    },
  ],
});

const createPartSchema = z.object({
  org_unit_id: z.string().uuid("chọn phòng KT-CN"),
  name: z.string().trim().min(2, "nhập tên chi tiết gia công").max(250),
  item_id: z.string().uuid("chọn mã vật tư linh kiện trong danh mục"),
  vendor_id: z.string().uuid("chọn nhà cung cấp gia công"),
  material: z.string().trim().min(2, "nhập vật liệu (ví dụ Nhôm 6061-T6, Inox 304, FR4 4 lớp)").max(200),
  process_type: z.enum(["CNC", "SHEET_METAL", "ANODIZE", "PCB_SMT", "MOLDING", "LASER_CUT", "OTHER"]).default("CNC"),
  tolerance_standard: z.string().trim().min(2, "nhập tiêu chuẩn dung sai (ví dụ ISO 2768-mK, ±0.02mm)").max(200),
  drawing_ref: z.string().trim().max(200).optional().nullable(),
});

export async function createSubcontractPart(tx: Tx, actor: AuthzActor, input: unknown) {
  const d = parseInput(createPartSchema, input);
  await authorize(tx, actor, "device.subcontract.manage", d.org_unit_id);
  const code = await nextNumber(tx, "SUBCONTRACT_PART");
  return insertRecord(tx, actor, "device.subcontract_part", "device_subcontract_part", {
    code,
    name: d.name,
    org_unit_id: d.org_unit_id,
    item_id: d.item_id,
    vendor_id: d.vendor_id,
    material: d.material,
    process_type: d.process_type,
    tolerance_standard: d.tolerance_standard,
    drawing_ref: d.drawing_ref ?? null,
  });
}

export async function listSubcontractParts(tx: Tx, actor: AuthzActor) {
  await authorizeAnywhere(tx, actor, "device.view");
  return (
    await tx.query(
      `SELECT sp.*, it.code AS item_code, it.name AS item_name, it.base_uom,
              p.code AS vendor_code, p.name AS vendor_name
         FROM device.subcontract_part sp
         JOIN master.item it ON it.id = sp.item_id
         JOIN master.partner p ON p.id = sp.vendor_id
        ORDER BY sp.code DESC`
    )
  ).rows;
}

const createSubOrderSchema = z.object({
  org_unit_id: z.string().uuid("chọn phòng KT-CN"),
  vendor_id: z.string().uuid("chọn nhà cung cấp gia công"),
  warehouse_id: z.string().uuid("chọn kho nhận hàng gia công"),
  device_order_id: z.string().uuid().optional().nullable(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
  issue_now: z.boolean().default(false),
  lines: z
    .array(
      z.object({
        part_id: z.string().uuid("chọn chi tiết gia công"),
        qty_ordered: z.coerce.number().positive("số lượng đặt > 0"),
        unit_price: z.coerce.number().min(0).default(0),
      })
    )
    .min(1, "nhập ít nhất 1 dòng chi tiết gia công"),
});

export async function createSubcontractOrder(tx: Tx, actor: AuthzActor, input: unknown) {
  const d = parseInput(createSubOrderSchema, input);
  await authorize(tx, actor, "device.subcontract.manage", d.org_unit_id);
  const code = await nextNumber(tx, "SUBCONTRACT_ORDER");
  const order = await insertRecord<SubcontractOrderRow>(tx, actor, "device.subcontract_order", "device_subcontract_order", {
    code,
    org_unit_id: d.org_unit_id,
    vendor_id: d.vendor_id,
    warehouse_id: d.warehouse_id,
    device_order_id: d.device_order_id ?? null,
    due_date: d.due_date ?? null,
    notes: d.notes ?? null,
  });

  for (const [idx, line] of d.lines.entries()) {
    await tx.query(
      `INSERT INTO device.subcontract_line (order_id, line_no, part_id, qty_ordered, unit_price)
       VALUES ($1, $2, $3, $4, $5)`,
      [order.id, idx + 1, line.part_id, line.qty_ordered, line.unit_price]
    );
  }

  if (d.issue_now) {
    return runTransition(tx, subcontractOrderMachine, actor, { id: order.id, action: "issue", expectedVersion: order.version });
  }
  return order;
}

const receiveLineSchema = z.object({
  line_id: z.string().uuid("chọn dòng đơn gia công"),
  qty_accepted: z.coerce.number().min(0, "số lượng đạt IQC ≥ 0").default(0),
  qty_rework: z.coerce.number().min(0, "số lượng trả làm lại ≥ 0").default(0),
  qty_rejected: z.coerce.number().min(0, "số lượng loại bỏ ≥ 0").default(0),
  measuring_instrument: z.string().trim().max(120).optional().nullable(),
  nominal_spec: z.string().trim().max(200).optional().nullable(),
  measured_value: z.string().trim().max(200).optional().nullable(),
  sample_qty: z.coerce.number().int().min(1).optional().nullable(),
  iqc_dimension_note: z.string().trim().min(3, "nhập kết quả đo dung sai bản vẽ (IQC)").max(1000),
  to_location_id: z.string().uuid().optional().nullable(),
});

/**
 * Receives subcontracted mechanical/PCB parts with dimensional IQC (docs/nha-may/02 §10.4):
 * - Only `qty_accepted > 0` creates a RELEASED lot and posts a `RECEIPT` stock document into the warehouse.
 * - `qty_accepted === 0` (pure REWORK or REJECT) NEVER posts stock into the warehouse.
 * - `qty_rejected > 0` automatically opens an NCR in `qms.ncr`.
 * - Advances the order to `PARTIALLY_RECEIVED` or `RECEIVED`.
 */
export async function receiveSubcontractLine(tx: Tx, actor: AuthzActor, orderId: string, input: unknown) {
  const d = parseInput(receiveLineSchema, input);
  const totalNow = d.qty_accepted + d.qty_rework + d.qty_rejected;
  if (!(totalNow > 0)) {
    throw invalid("Tổng số lượng kiểm nhận (Đạt + Làm lại + Loại bỏ) phải lớn hơn 0.");
  }

  const order = (await tx.query("SELECT * FROM device.subcontract_order WHERE id = $1 FOR UPDATE", [orderId])).rows[0] as
    | SubcontractOrderRow
    | undefined;
  if (!order) throw notFound("đơn gia công ngoài");
  await authorize(tx, actor, "device.subcontract.manage", order.org_unit_id);
  if (!["ISSUED", "PARTIALLY_RECEIVED"].includes(order.status)) {
    throw invalid(`Không thể nhận hàng khi đơn gia công đang ở trạng thái ${order.status}.`);
  }

  const line = (
    await tx.query(
      `SELECT sl.*, sp.item_id, sp.code AS part_code, sp.name AS part_name
         FROM device.subcontract_line sl
         JOIN device.subcontract_part sp ON sp.id = sl.part_id
        WHERE sl.id = $1 AND sl.order_id = $2 FOR UPDATE`,
      [d.line_id, orderId]
    )
  ).rows[0];
  if (!line) throw notFound("dòng chi tiết gia công");
  // QT 21: the drawing with the measured values written on it is the IQC record of accepted parts
  if (d.qty_accepted > 0 && !(await lineFiles(tx, line.id)).length) {
    throw invalid("Đính kèm bản vẽ đã ghi kết quả QC của chi tiết này trước khi nghiệm thu Đạt.", undefined, "IQC_DRAWING_REQUIRED");
  }

  const remaining = Number(line.qty_ordered) - Number(line.qty_accepted) - Number(line.qty_rejected);
  if (d.qty_accepted + d.qty_rejected > remaining + 1e-9) {
    throw invalid(`Số lượng nghiệm thu (${d.qty_accepted + d.qty_rejected}) vượt quá số lượng còn phải giao (${remaining}).`);
  }

  let lotId: string | null = line.lot_id;
  let stockDocId: string | null = line.stock_document_id;

  // Strict rule: ONLY post into warehouse when qty_accepted > 0, and receive into QUARANTINE pending formal QC release
  if (d.qty_accepted > 0) {
    const item = await getItem(tx, line.item_id);
    // Find or create an active quarantine location in the target warehouse so QUARANTINE lot receipt is valid
    let locId: string | undefined;
    if (d.to_location_id) {
      const passedLoc = (
        await tx.query("SELECT id, is_quarantine FROM master.location WHERE id = $1 AND warehouse_id = $2 AND status = 'ACTIVE'", [
          d.to_location_id,
          order.warehouse_id,
        ])
      ).rows[0];
      if (passedLoc?.is_quarantine) {
        locId = passedLoc.id;
      }
    }
    if (!locId) {
      locId = (
        await tx.query(
          "SELECT id FROM master.location WHERE warehouse_id = $1 AND is_quarantine = true AND status = 'ACTIVE' ORDER BY code LIMIT 1",
          [order.warehouse_id]
        )
      ).rows[0]?.id;
    }
    if (!locId) {
      locId = (
        await tx.query(
          `INSERT INTO master.location (warehouse_id, code, name, temperature_condition, is_quarantine, status)
           VALUES ($1, 'BIET-TRU-GC', 'Khu Biệt Trữ Chờ IQC Gia Công', 'RT', true, 'ACTIVE')
           ON CONFLICT (warehouse_id, code) DO UPDATE SET is_quarantine = true, status = 'ACTIVE'
           RETURNING id`,
          [order.warehouse_id]
        )
      ).rows[0]?.id;
    }
    if (!locId) throw invalid("Kho nhận hàng gia công chưa có vị trí biệt trữ hoạt động.");

    const lot = await createLot(tx, actor, {
      item_id: item.id,
      origin: "PRODUCTION",
      mfr_lot_no: order.code,
      supplier_id: order.vendor_id,
      origin_entity_type: "SUBCONTRACT_ORDER",
      origin_entity_id: order.id,
    });
    await tx.query("UPDATE inv.lot SET status = 'QUARANTINE' WHERE id = $1", [lot.id]);

    const doc = await createStockDocument(
      tx,
      actor,
      {
        doc_type: "RECEIPT",
        reason_code: "PURCHASE",
        warehouse_id: order.warehouse_id,
        source_entity_type: "SUBCONTRACT_ORDER",
        source_entity_id: order.id,
        notes: `Nhập biệt trữ chi tiết gia công chờ QC giải phóng (${order.code} - ${line.part_code})`,
        lines: [
          {
            item_id: item.id,
            lot_id: lot.id,
            to_location_id: locId,
            qty: d.qty_accepted,
            uom: item.base_uom,
          },
        ],
      },
      { trusted: true }
    );
    await runTransition(tx, stockDocumentMachine, actor, { id: doc.id, action: "post", expectedVersion: doc.version }, { trusted: true });
    lotId = lot.id;
    stockDocId = doc.id;
  }

  let ncrId: string | null = line.ncr_id;
  if (d.qty_rejected > 0) {
    const devCode = await nextNumber(tx, "DEVIATION");
    const dev = (
      await tx.query(
        `INSERT INTO qms.deviation (code, source_module, entity_type, entity_id, title, severity, description, detected_by, created_by, updated_by)
         VALUES ($1, 'DEVICE', 'SUBCONTRACT_LINE', $2, $3, 'MEDIUM', $4, $5, $5, $5) RETURNING id`,
        [
          devCode,
          line.id,
          `IQC không đạt dung sai chi tiết gia công ${line.part_code}`,
          d.iqc_dimension_note,
          actor.userId,
        ]
      )
    ).rows[0];
    const ncrCode = await nextNumber(tx, "NCR");
    const ncr = (
      await tx.query(
        `INSERT INTO qms.ncr (code, deviation_id, entity_type, entity_id, item_id, qty_affected, description, disposition, status, created_by, updated_by)
         VALUES ($1, $2, 'SUBCONTRACT_LINE', $3, $4, $5, $6, 'RETURN_TO_SUPPLIER', 'OPEN', $7, $7) RETURNING id`,
        [
          ncrCode,
          dev.id,
          line.id,
          line.item_id,
          d.qty_rejected,
          `Loại bỏ ${d.qty_rejected} chi tiết ${line.part_code} (${order.code}): ${d.iqc_dimension_note}`,
          actor.userId,
        ]
      )
    ).rows[0];
    ncrId = ncr.id;
  }

  const iqcResult = d.qty_accepted > 0 ? "PASS" : d.qty_rework > 0 ? "REWORK" : "REJECT";
  await tx.query(
    `UPDATE device.subcontract_line
        SET qty_received = qty_received + $2,
            qty_accepted = qty_accepted + $3,
            qty_rework   = qty_rework + $4,
            qty_rejected = qty_rejected + $5,
            iqc_result = $6,
            iqc_dimension_note = $7,
            lot_id = COALESCE($8, lot_id),
            stock_document_id = COALESCE($9, stock_document_id),
            ncr_id = COALESCE($10, ncr_id),
            measuring_instrument = COALESCE($11, measuring_instrument),
            nominal_spec = COALESCE($12, nominal_spec),
            measured_value = COALESCE($13, measured_value),
            sample_qty = COALESCE($14, sample_qty)
      WHERE id = $1`,
    [
      line.id,
      totalNow,
      d.qty_accepted,
      d.qty_rework,
      d.qty_rejected,
      iqcResult,
      d.iqc_dimension_note,
      lotId,
      stockDocId,
      ncrId,
      d.measuring_instrument ?? null,
      d.nominal_spec ?? null,
      d.measured_value ?? null,
      d.sample_qty ?? null,
    ]
  );

  // Check if all lines of the order have been fully resolved (qty_accepted + qty_rejected >= qty_ordered)
  const unfulfilled = await tx.query(
    "SELECT 1 FROM device.subcontract_line WHERE order_id = $1 AND (qty_accepted + qty_rejected) < qty_ordered LIMIT 1",
    [orderId]
  );
  const nextAction = !unfulfilled.rowCount ? "mark_received" : "mark_partial";
  if ((nextAction === "mark_received" && order.status !== "RECEIVED") || (nextAction === "mark_partial" && order.status === "ISSUED")) {
    await runTransition(
      tx,
      subcontractOrderMachine,
      actor,
      { id: order.id, action: nextAction, expectedVersion: order.version },
      { trusted: true }
    );
  }

  await writeAudit(tx, actor, {
    entityType: "device_subcontract_order",
    entityId: order.id,
    action: "receive_iqc",
    changes: {
      line: [
        null,
        `${line.part_code}: accepted=${d.qty_accepted}, rework=${d.qty_rework}, rejected=${d.qty_rejected} (${iqcResult})`,
      ],
    },
    reason: d.iqc_dimension_note,
  });

  return getSubcontractOrderDetail(tx, actor, orderId);
}

const vendorEvalSchema = z.object({
  org_unit_id: z.string().uuid("chọn phòng KT-CN"),
  vendor_id: z.string().uuid("chọn nhà cung cấp"),
  eval_type: z.enum(["PERIODIC", "POST_ORDER", "AUDIT"]).default("POST_ORDER"),
  linked_order_id: z.string().uuid().optional().nullable(),
  quality_score: z.coerce.number().min(1).max(5),
  delivery_score: z.coerce.number().min(1).max(5),
  cost_score: z.coerce.number().min(1).max(5),
  service_score: z.coerce.number().min(1).max(5),
  conclusion: z.string().trim().max(2000).optional().nullable(),
});

/**
 * Evaluates a mechanical/PCB vendor on 4 criteria (1–5 scale) with configurable weights
 * (default 40% Quality, 25% Delivery, 20% Cost, 15% Service) and classifies into Tier A/B/C/D (docs/nha-may/01 §12):
 * - Tier A: ≥ 4.5
 * - Tier B: ≥ 3.5 and < 4.5
 * - Tier C: ≥ 2.5 and < 3.5
 * - Tier D: < 2.5
 */
export async function createVendorEvaluation(tx: Tx, actor: AuthzActor, input: unknown) {
  const d = parseInput(vendorEvalSchema, input);
  await authorize(tx, actor, "device.subcontract.manage", d.org_unit_id);

  const setting = (await tx.query("SELECT value FROM core.setting WHERE key = 'device.vendor_eval_weights'")).rows[0];
  let weights = { quality: 40, delivery: 25, cost: 20, service: 15 };
  if (setting?.value) {
    try {
      const parsed = typeof setting.value === "string" ? JSON.parse(setting.value) : setting.value;
      if (parsed && typeof parsed.quality === "number") weights = parsed;
    } catch {
      // keep default weights
    }
  }
  const totalW = weights.quality + weights.delivery + weights.cost + weights.service;
  const weighted =
    Math.round(
      ((d.quality_score * weights.quality +
        d.delivery_score * weights.delivery +
        d.cost_score * weights.cost +
        d.service_score * weights.service) /
        totalW) *
        100
    ) / 100;

  const tier: "A" | "B" | "C" | "D" = weighted >= 4.5 ? "A" : weighted >= 3.5 ? "B" : weighted >= 2.5 ? "C" : "D";
  const code = await nextNumber(tx, "VENDOR_EVAL");
  return insertRecord<{
    id: string;
    code: string;
    weighted_score: string;
    tier: "A" | "B" | "C" | "D";
  }>(tx, actor, "device.vendor_evaluation", "device_vendor_eval", {
    code,
    org_unit_id: d.org_unit_id,
    vendor_id: d.vendor_id,
    eval_type: d.eval_type,
    linked_order_id: d.linked_order_id ?? null,
    quality_score: d.quality_score,
    delivery_score: d.delivery_score,
    cost_score: d.cost_score,
    service_score: d.service_score,
    weighted_score: weighted,
    tier,
    conclusion: d.conclusion ?? null,
    evaluator_id: actor.userId,
  });
}

export async function listSubcontractOrders(tx: Tx, actor: AuthzActor) {
  await authorizeAnywhere(tx, actor, "device.view");
  const rows = (
    await tx.query(
      `SELECT so.*, so.due_date::text AS due_date, u.name AS org_unit_name,
              p.code AS vendor_code, p.name AS vendor_name, w.code AS warehouse_code,
              (SELECT count(*)::int FROM device.subcontract_line sl WHERE sl.order_id = so.id) AS line_count
         FROM device.subcontract_order so
         JOIN core.org_unit u ON u.id = so.org_unit_id
         JOIN master.partner p ON p.id = so.vendor_id
         JOIN master.warehouse w ON w.id = so.warehouse_id
        ORDER BY so.created_at DESC LIMIT 200`
    )
  ).rows;
  const visible = [];
  for (const r of rows) {
    if (await hasFactoryPermission(tx, actor, "device.view", r.org_unit_id)) visible.push(r);
  }
  return visible;
}

export async function getSubcontractOrderDetail(tx: Tx, actor: AuthzActor, id: string) {
  const order = (
    await tx.query(
      `SELECT so.*, so.due_date::text AS due_date, u.name AS org_unit_name,
              p.code AS vendor_code, p.name AS vendor_name, w.code AS warehouse_code
         FROM device.subcontract_order so
         JOIN core.org_unit u ON u.id = so.org_unit_id
         JOIN master.partner p ON p.id = so.vendor_id
         JOIN master.warehouse w ON w.id = so.warehouse_id
        WHERE so.id = $1`,
      [id]
    )
  ).rows[0];
  if (!order) throw notFound("đơn gia công ngoài");
  await authorize(tx, actor, "device.view", order.org_unit_id);

  const lines = (
    await tx.query(
      `SELECT sl.*, sl.qty_ordered::float AS qty_ordered, sl.qty_received::float AS qty_received,
              sl.qty_accepted::float AS qty_accepted, sl.qty_rework::float AS qty_rework, sl.qty_rejected::float AS qty_rejected,
              sl.unit_price::float AS unit_price,
              sp.code AS part_code, sp.name AS part_name, sp.material, sp.process_type, sp.tolerance_standard,
              it.code AS item_code, it.base_uom, l.code AS lot_code, sd.code AS document_code, n.code AS ncr_code
         FROM device.subcontract_line sl
         JOIN device.subcontract_part sp ON sp.id = sl.part_id
         JOIN master.item it ON it.id = sp.item_id
         LEFT JOIN inv.lot l ON l.id = sl.lot_id
         LEFT JOIN inv.stock_document sd ON sd.id = sl.stock_document_id
         LEFT JOIN qms.ncr n ON n.id = sl.ncr_id
        WHERE sl.order_id = $1 ORDER BY sl.line_no ASC`,
      [id]
    )
  ).rows;

  const actions = await listAllowedActions(tx, subcontractOrderMachine, actor, order);
  return { ...order, lines, actions };
}

export async function listVendorEvaluations(tx: Tx, actor: AuthzActor) {
  await authorizeAnywhere(tx, actor, "device.view");
  return (
    await tx.query(
      `SELECT ve.*, ve.quality_score::float AS quality_score, ve.delivery_score::float AS delivery_score,
              ve.cost_score::float AS cost_score, ve.service_score::float AS service_score,
              ve.weighted_score::float AS weighted_score,
              p.code AS vendor_code, p.name AS vendor_name,
              so.code AS order_code, up.display_name AS evaluator_name
         FROM device.vendor_evaluation ve
         JOIN master.partner p ON p.id = ve.vendor_id
         LEFT JOIN device.subcontract_order so ON so.id = ve.linked_order_id
         LEFT JOIN core.user_profile up ON up.user_id = ve.evaluator_id
        ORDER BY ve.created_at DESC LIMIT 200`
    )
  ).rows;
}

// ---------------------------------------------------------------------------
// IQC drawings: the technical drawing with the measured values, attached to each subcontract line
// ---------------------------------------------------------------------------

const LINE_FILES = "device_subcontract_line";

async function lineFiles(tx: Tx, lineId: string) {
  return (
    await tx.query(
      `SELECT f.id, f.file_name, f.mime_type, f.size_bytes, f.uploaded_at, p.display_name AS uploaded_by_name
         FROM core.attachment f LEFT JOIN core.user_profile p ON p.user_id = f.uploaded_by
        WHERE f.entity_type = $1 AND f.entity_id = $2 AND f.voided_at IS NULL ORDER BY f.uploaded_at`,
      [LINE_FILES, lineId]
    )
  ).rows;
}

async function lineScope(tx: Tx, lineId: string): Promise<string> {
  const r = (await tx.query("SELECT o.org_unit_id FROM device.subcontract_line l JOIN device.subcontract_order o ON o.id = l.order_id WHERE l.id = $1", [lineId])).rows[0];
  if (!r) throw notFound("dòng chi tiết gia công");
  return r.org_unit_id;
}

/** Attaches the QC'd drawing (PDF or image / scan) to a subcontract line. */
export async function attachLineDrawing(tx: Tx, actor: AuthzActor, lineId: string, file: { fileName: string; mimeType: string; data: Buffer }) {
  await authorize(tx, actor, "device.subcontract.manage", await lineScope(tx, lineId));
  return saveAttachment(tx, actor, { entityType: LINE_FILES, entityId: lineId, category: file.mimeType.startsWith("image/") ? "IMAGE" : "DOCUMENT", ...file });
}

export async function listLineDrawings(tx: Tx, actor: AuthzActor, lineId: string) {
  await authorize(tx, actor, "device.view", await lineScope(tx, lineId));
  return lineFiles(tx, lineId);
}

export async function readLineDrawing(tx: Tx, actor: AuthzActor, lineId: string, fileId: string) {
  await authorize(tx, actor, "device.view", await lineScope(tx, lineId));
  if (!(await tx.query("SELECT 1 FROM core.attachment WHERE id = $1 AND entity_type = $2 AND entity_id = $3", [fileId, LINE_FILES, lineId])).rowCount) {
    throw notFound("bản vẽ đính kèm");
  }
  return readAttachment(tx, fileId);
}
