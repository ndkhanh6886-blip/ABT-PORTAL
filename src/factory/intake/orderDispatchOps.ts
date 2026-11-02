import { z } from "zod";
import type { Tx } from "../core/db";
import { authorizeAnywhere, SYSTEM_ACTOR, type AuthzActor } from "../core/authz";
import { addDays, vnToday } from "../core/dates";
import { invalid, notFound } from "../core/errors";
import { writeAudit } from "../core/audit";
import { nextNumber } from "../core/numbering";
import { parseInput } from "../core/records";
import { runTransition } from "../core/stateMachine";
import { orderMachine } from "./orders";
import { createProductionOrder } from "../kit/ordersEbr";
import { addSequences, createOligoOrder } from "../oligo/orders";
import { convertPoToWorkOrder } from "../device/workflow";
import "./permissions";
import "../kit/permissions";
import "../oligo/orders";
import "../device/permissions";

export async function getInternalOrderCatalogOptions(tx: Tx, actor: AuthzActor) {
  await authorizeAnywhere(tx, actor, "intake.order.view");
  const departments = (
    await tx.query(
      `SELECT id, code, name, module_key
         FROM core.org_unit
        WHERE module_key IN ('KIT', 'OLIGO', 'DEVICE') AND status = 'ACTIVE'
        ORDER BY CASE module_key WHEN 'KIT' THEN 1 WHEN 'OLIGO' THEN 2 WHEN 'DEVICE' THEN 3 ELSE 9 END`
    )
  ).rows;

  const items = (
    await tx.query(
      `SELECT i.id, i.code, i.name, i.item_type, i.base_uom, i.kd_item_code,
              CASE
                WHEN i.item_type = 'DEVICE' OR EXISTS (SELECT 1 FROM device.device_model dm WHERE dm.item_id = i.id OR upper(dm.code) = upper(i.code)) THEN 'DEVICE'
                WHEN i.item_type = 'OLIGO_SERVICE' OR i.code LIKE 'OLI-%' OR i.code LIKE 'PRIMER-%' OR i.code LIKE 'PROBE-%' THEN 'OLIGO'
                ELSE 'KIT'
              END AS domain_key
         FROM master.item i
        WHERE i.status = 'ACTIVE'
          AND (
            i.item_type IN ('FINISHED_KIT', 'DEVICE', 'OLIGO_SERVICE', 'SEMI_FINISHED')
            OR i.code LIKE 'KIT-%'
            OR i.code LIKE 'OLI-%'
            OR EXISTS (SELECT 1 FROM device.device_model dm WHERE dm.item_id = i.id OR upper(dm.code) = upper(i.code))
          )
        ORDER BY i.code ASC
        LIMIT 100`
    )
  ).rows;

  let sales_orders: any[] = [];
  try {
    sales_orders = (
      await tx.query(
        `SELECT id, order_code, customer_name, order_date, delivery_address, order_notes, status, items
           FROM sales_orders
          WHERE COALESCE(status, '') NOT IN ('CANCELLED', 'Cancelled')
          ORDER BY id DESC
          LIMIT 40`
      )
    ).rows;
  } catch {
    sales_orders = [];
  }

  return { departments, items, sales_orders };
}

const createManualOrderSchema = z.object({
  target_module: z.enum(["KIT", "OLIGO", "DEVICE"]),
  kd_po_code: z.string().trim().optional().nullable(),
  kd_so_code: z.string().trim().optional().nullable(),
  ship_mode: z.enum(["TO_KD", "DROP_SHIP"]).default("TO_KD"),
  customer_name: z.string().trim().optional().nullable(),
  customer_address: z.string().trim().optional().nullable(),
  requested_date: z.string().optional().nullable(),
  notes: z.string().trim().optional().nullable(),
  oligo_sequences_text: z.string().trim().optional().nullable(),
  auto_accept: z.boolean().default(true),
  lines: z
    .array(
      z.object({
        item_id: z.string().uuid(),
        qty: z.coerce.number().positive(),
        transfer_price: z.coerce.number().min(0).default(1500000),
      })
    )
    .min(1, "Cần ít nhất 1 dòng sản phẩm"),
});

export async function createInternalOrderManual(tx: Tx, actor: AuthzActor, input: unknown) {
  await authorizeAnywhere(tx, actor, "intake.order.view");
  const d = parseInput(createManualOrderSchema, input);

  const unit = (
    await tx.query("SELECT id, code, name, module_key FROM core.org_unit WHERE module_key = $1 AND status = 'ACTIVE' ORDER BY created_at LIMIT 1", [
      d.target_module,
    ])
  ).rows[0];
  if (!unit) throw notFound(`Phòng sản xuất thuộc phân hệ ${d.target_module}`);

  const code = await nextNumber(tx, "INTERNAL_ORDER");
  const kdPoCode = d.kd_po_code?.trim() || `PO-KD-${d.target_module}-${code}`;
  const existingPo = (await tx.query("SELECT * FROM intake.internal_order WHERE kd_po_code = $1 LIMIT 1", [kdPoCode])).rows[0];
  if (existingPo) {
    await tx.query("UPDATE intake.internal_order SET org_unit_id = $2 WHERE id = $1", [existingPo.id, unit.id]);
    return existingPo;
  }
  const reqDate = d.requested_date && /^\d{4}-\d{2}-\d{2}$/.test(d.requested_date) ? d.requested_date : addDays(vnToday(), 10);
  const shipTo =
    d.ship_mode === "DROP_SHIP" || d.customer_name
      ? {
          name: d.customer_name || "Bệnh viện Đa khoa Trung ương / CDC",
          address: d.customer_address || "Hà Nội / TP.HCM",
        }
      : null;

  const kdSoCode = d.kd_so_code?.trim() || `SO-KD-${await nextNumber(tx, "INTERNAL_ORDER")}`;

  const order = (
    await tx.query(
      `INSERT INTO intake.internal_order
         (code, kd_po_id, kd_po_code, org_unit_id, ship_mode, ship_to, kd_so_code, requested_date, committed_date, initial_committed_date, status, notes, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, $10, $11, $12, $12)
       RETURNING *`,
      [
        code,
        Math.floor(Date.now() / 1000) % 1000000,
        kdPoCode,
        unit.id,
        d.ship_mode,
        shipTo ? JSON.stringify(shipTo) : null,
        kdSoCode,
        reqDate,
        d.auto_accept ? reqDate : null,
        d.auto_accept ? "ACCEPTED" : "RECEIVED",
        d.notes || `Đơn đặt hàng nội bộ phân luồng về ${unit.name}`,
        actor.userId,
      ]
    )
  ).rows[0];

  let lineNo = 0;
  for (const l of d.lines) {
    const item = (await tx.query("SELECT id, code, name, base_uom, kd_item_code FROM master.item WHERE id = $1", [l.item_id])).rows[0];
    if (!item) throw notFound("Sản phẩm");
    const kdCode = item.kd_item_code || item.code;
    if (!item.kd_item_code) {
      await tx.query("UPDATE master.item SET kd_item_code = $2 WHERE id = $1", [item.id, kdCode]);
    }
    await tx.query(
      `INSERT INTO intake.internal_order_line
         (order_id, line_no, kd_line_index, kd_item_code, kd_item_name, kd_unit, item_id, qty, transfer_price)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [order.id, ++lineNo, lineNo - 1, kdCode, item.name, item.base_uom, item.id, l.qty, l.transfer_price]
    );
  }

  // Nếu tạo Đơn nội bộ cho Phòng Tổng hợp Oligo, tự động khởi tạo và liên kết Đơn Oligo tương ứng
  if (d.target_module === "OLIGO") {
    const dispatchActor: AuthzActor = actor;
    const firstLine = (
      await tx.query("SELECT * FROM intake.internal_order_line WHERE order_id = $1 ORDER BY line_no LIMIT 1", [order.id])
    ).rows[0];
    const dueDate = reqDate >= vnToday() ? reqDate : addDays(vnToday(), 7);
    const oligoOrder = await createOligoOrder(tx, dispatchActor, {
      org_unit_id: unit.id,
      internal_order_id: order.id,
      customer_label: d.customer_name || `${kdPoCode} — ${firstLine?.kd_item_name || "Bộ Primer/Probe & Amplicon"}`,
      due_date: dueDate,
      notes: d.notes || `Đơn Tổng hợp Oligo liên kết từ Đơn nội bộ ${order.code} (PO ${kdPoCode})`,
    });
    const prefix = firstLine?.kd_item_code || "OLI-SET";
    const defaultSeqs =
      d.oligo_sequences_text?.trim() ||
      [
        `${prefix}-F; GAGTGTGGATTCGCACTCCT; 200NMOL; OPC; LYOPHILIZED`,
        `${prefix}-R; GAGGAGTTGGGGGAGGAGATT; 200NMOL; OPC; LYOPHILIZED`,
        `${prefix}-PRB; [FAM]CCAYTCRTCCBGCRGGBTR[BHQ1]; 200NMOL; HPLC; LYOPHILIZED`,
        `${prefix}-Amplicon-PC; GAGTGTGGATTCGCACTCCTCCTGCCTCCACCAATCGCCAGTCAGGAAGGCAGCCTACCCCGCTGTCTCCACCTTTGAGAAACACTCATCCTCAGGCCATGCAGTGGAATTCCACAACCTTCCACCAAACTCTGCAAGATCCCAGAGTGAGAGGCCTGTATTTCCCTGCTGGTGGCTCCAGTTCAGGAACAGTAAACCCTGTTCTGACTACTGCCTCTCCCTTATCGTCAATCTTCTCGAGGATTGGGGACCCTGCGCTGAACATGGAGAACATCACATCAGGATTCCTAGGACCCCTTCTCGTGTTACAGGCGGGGTTTTTCTTGTTGACAAGAATCCTCACAATACCGCAGAGTCTAGACTCGTGGTGGACTTCTCTCAATTTTCTAGGGGG; 200NMOL; PAGE; LYOPHILIZED`,
      ].join("\n");
    await addSequences(tx, dispatchActor, oligoOrder.id, {
      text: defaultSeqs,
      defaults: {
        scale_code: "200NMOL",
        purification: "OPC",
        format: "LYOPHILIZED",
        target_pathogen: firstLine?.kd_item_name || prefix,
      },
    });
  }

  // Nếu tạo Đơn nội bộ cho Phòng Kỹ thuật – Thiết bị (DEVICE), đảm bảo liên kết Model & BOM cho PO Sản xuất (Tab 3: po_mrp)
  if (d.target_module === "DEVICE") {
    const linesRows = (
      await tx.query(
        `SELECT l.*, i.code AS item_code, i.name AS item_name
           FROM intake.internal_order_line l
           LEFT JOIN master.item i ON i.id = l.item_id
          WHERE l.order_id = $1 ORDER BY l.line_no`,
        [order.id]
      )
    ).rows;
    for (const ln of linesRows) {
      await ensureDeviceModelForPoLine(tx, actor, order, ln);
    }
  }

  await writeAudit(tx, actor, {
    entityType: "internal_order",
    entityId: order.id,
    action: "create_manual_internal_order",
    changes: { code: [null, order.code], department: [null, unit.name], lines: [null, d.lines.length] },
  });

  return order;
}

/**
 * Đảm bảo dòng sản phẩm trong Đơn nội bộ của Phòng Kỹ thuật – Công nghệ (`DEVICE`)
 * được liên kết với `device.device_model` và có phiên bản BOM/DMR (`current_revision_id`)
 * để đồng bộ sang **Đơn PO Sản Xuất & Nổ BOM MRP (Tab 3: po_mrp)**.
 */
async function ensureDeviceModelForPoLine(
  tx: Tx,
  actor: AuthzActor,
  order: { id: string; org_unit_id: string },
  line: { id: string; item_id: string | null; item_code?: string | null; item_name?: string | null; kd_item_code: string; kd_item_name?: string | null }
) {
  let model = (
    await tx.query(
      `SELECT dm.*, mr.revision
         FROM device.device_model dm
         LEFT JOIN device.model_revision mr ON mr.id = dm.current_revision_id
        WHERE ($1::uuid IS NOT NULL AND dm.item_id = $1)
           OR upper(dm.code) = upper($2)
           OR ($3::text IS NOT NULL AND upper(dm.code) = upper($3))
        ORDER BY (dm.current_revision_id IS NOT NULL) DESC, dm.created_at ASC
        LIMIT 1`,
      [line.item_id, line.kd_item_code, line.item_code ?? null]
    )
  ).rows[0];

  if (!model) {
    // Tìm model thương mại có sẵn BOM để làm mẫu định mức chuẩn nếu mã máy mới chưa có model
    const templateModel = (
      await tx.query(
        `SELECT dm.*, mr.revision, mr.firmware_version
           FROM device.device_model dm
           JOIN device.model_revision mr ON mr.id = dm.current_revision_id
          WHERE dm.current_revision_id IS NOT NULL
          ORDER BY dm.created_at ASC LIMIT 1`
      )
    ).rows[0];

    const modelCode = (line.item_code || line.kd_item_code || "ABT-DEV-NEW").trim().toUpperCase();
    const modelName = line.item_name || line.kd_item_name || `Thiết bị ${modelCode}`;
    const createdModel = (
      await tx.query(
        `INSERT INTO device.device_model
           (code, name, org_unit_id, item_id, category, warranty_months, required_burn_in_hours, status, description, created_by, updated_by)
         VALUES ($1, $2, $3, $4, 'EXTRACTOR', 24, 48, 'COMMERCIAL', $5, $6, $6)
         ON CONFLICT (code) DO UPDATE SET item_id = COALESCE(device.device_model.item_id, EXCLUDED.item_id)
         RETURNING *`,
        [modelCode, modelName, order.org_unit_id, line.item_id, `Model thiết bị đồng bộ từ PO ${modelCode}`, actor.userId]
      )
    ).rows[0];

    let revId = createdModel.current_revision_id;
    let revCode = "A";
    if (!revId) {
      const createdRev = (
        await tx.query(
          `INSERT INTO device.model_revision
             (model_id, revision, firmware_version, dmr_summary, effectivity_type, status, released_by, released_at, created_by, updated_by)
           VALUES ($1, 'A', 'v1.0.0', $2, 'IMMEDIATE', 'RELEASED', $3, now(), $3, $3)
           RETURNING id, revision`,
          [createdModel.id, `DMR chuẩn cho ${modelName}`, actor.userId]
        )
      ).rows[0];
      revId = createdRev.id;
      revCode = createdRev.revision;

      if (templateModel?.current_revision_id) {
        await tx.query(
          `INSERT INTO device.model_bom_line
             (revision_id, line_no, station_code, component_item_id, qty_per_unit, uom, source_type, is_critical, requires_serial, tracking_type, drawing_code, notes, created_by, updated_by)
           SELECT $1, line_no, station_code, component_item_id, qty_per_unit, uom, source_type, is_critical, requires_serial, tracking_type, drawing_code, notes, $2, $2
             FROM device.model_bom_line WHERE revision_id = $3 ORDER BY line_no`,
          [revId, actor.userId, templateModel.current_revision_id]
        );
      }
      await tx.query("UPDATE device.device_model SET current_revision_id = $2 WHERE id = $1", [createdModel.id, revId]);
    }
    model = { ...createdModel, current_revision_id: revId, revision: revCode };
  } else if (line.item_id && !model.item_id) {
    await tx.query("UPDATE device.device_model SET item_id = $2 WHERE id = $1", [model.id, line.item_id]);
  } else if (!line.item_id && model.item_id) {
    await tx.query("UPDATE intake.internal_order_line SET item_id = $2 WHERE id = $1", [line.id, model.item_id]);
  }

  return model;
}

const dispatchLineSchema = z.object({
  order_id: z.string().uuid(),
  line_id: z.string().uuid(),
  qty: z.coerce.number().positive().optional(),
  oligo_sequences_text: z.string().optional().nullable(),
  force_new: z.boolean().optional(),
});

/**
 * 1-Click Dispatch from an Internal Order Line to the Producing Department's Execution Engine:
 * - `KIT`: Creates (or activates existing) `kit.production_order` linked via `internal_order_line_id`.
 * - `OLIGO`: Creates (or activates existing) `oligo.oligo_order` + standard Primer/Probe sequences linked via `internal_order_id`.
 * - `DEVICE`: Creates (or activates existing) `device.device_order` (WO) + Serial Units linked via `internal_order_line_id`.
 */
export async function dispatchInternalOrderLineToProduction(tx: Tx, actor: AuthzActor, input: unknown) {
  await authorizeAnywhere(tx, actor, "intake.order.view");
  const d = parseInput(dispatchLineSchema, input);
  const dispatchActor: AuthzActor = actor;

  let order = (
    await tx.query(
      `SELECT o.*, u.code AS org_unit_code, u.name AS org_unit_name, u.module_key
         FROM intake.internal_order o
         JOIN core.org_unit u ON u.id = o.org_unit_id
        WHERE o.id = $1 FOR UPDATE OF o`,
      [d.order_id]
    )
  ).rows[0];
  if (!order) throw notFound("Đơn nội bộ");

  const line = (
    await tx.query(
      `SELECT l.*, i.code AS item_code, i.name AS item_name, i.base_uom
         FROM intake.internal_order_line l
         LEFT JOIN master.item i ON i.id = l.item_id
        WHERE l.id = $1 AND l.order_id = $2`,
      [d.line_id, order.id]
    )
  ).rows[0];
  if (!line) throw notFound("Dòng sản phẩm trong đơn nội bộ");

  // Auto-accept if still RECEIVED
  if (order.status === "RECEIVED") {
    const commitDate = order.requested_date && String(order.requested_date).slice(0, 10) >= vnToday()
      ? String(order.requested_date).slice(0, 10)
      : addDays(vnToday(), 7);
    await tx.query(
      "UPDATE intake.internal_order SET status = 'ACCEPTED', committed_date = $2, initial_committed_date = $2, version = version + 1 WHERE id = $1",
      [order.id, commitDate]
    );
    order.status = "ACCEPTED";
    order.committed_date = commitDate;
    order.version += 1;
  }

  const qtyToProduce = d.qty ?? Math.max(1, Number(line.qty) - Number(line.qty_delivered));
  const moduleKey = String(order.module_key);

  if (moduleKey === "KIT") {
    const existingKit = !d.force_new
      ? (
          await tx.query(
            "SELECT id, code, status FROM kit.production_order WHERE internal_order_line_id = $1 AND status != 'CANCELLED' ORDER BY created_at DESC LIMIT 1",
            [line.id]
          )
        ).rows[0]
      : null;

    if (existingKit) {
      if (order.status === "ACCEPTED") {
        await runTransition(tx, orderMachine, SYSTEM_ACTOR, { id: order.id, action: "start_production", expectedVersion: order.version }, { trusted: true });
      }
      return {
        domain: "KIT",
        order_code: existingKit.code,
        order_id: existingKit.id,
        target_tab: "factory-kit",
        already_existed: true,
        message: `Đã kích hoạt & chuyển tiếp sang Lệnh Sản Xuất Kit ${existingKit.code} (${qtyToProduce} ${line.base_uom}).`,
      };
    }

    if (!line.item_id) throw invalid("Dòng đơn nội bộ chưa gắn với Mã vật tư nhà máy.");
    const kitWh = (
      await tx.query("SELECT id FROM master.warehouse WHERE owner_org_unit_id = $1 AND status = 'ACTIVE' ORDER BY code LIMIT 1", [
        order.org_unit_id,
      ])
    ).rows[0];
    if (!kitWh) throw invalid("Phòng Sản xuất Kit chưa có kho nhánh KHO-KIT.");

    // Check if product has an EFFECTIVE BOM & Routing; if not, clone from existing EFFECTIVE BOM/Routing
    let effBom = (
      await tx.query("SELECT id FROM kit.bom WHERE product_item_id = $1 AND status = 'EFFECTIVE' LIMIT 1", [line.item_id])
    ).rows[0];
    let effRt = (
      await tx.query("SELECT id FROM kit.routing WHERE product_item_id = $1 AND status = 'EFFECTIVE' LIMIT 1", [line.item_id])
    ).rows[0];

    if (!effBom || !effRt) {
      const templateBom = (await tx.query("SELECT * FROM kit.bom WHERE status = 'EFFECTIVE' ORDER BY created_at LIMIT 1")).rows[0];
      const templateRt = (await tx.query("SELECT * FROM kit.routing WHERE status = 'EFFECTIVE' ORDER BY created_at LIMIT 1")).rows[0];
      if (!effBom && templateBom) {
        const insBom = (
          await tx.query(
            `INSERT INTO kit.bom (code, org_unit_id, product_item_id, version_tag, status, batch_size, uom, tests_per_kit, shelf_life_days, created_by, updated_by)
             VALUES ($1, $2, $3, 'v1.0', 'EFFECTIVE', $4, $5, 50, 365, $6, $6) RETURNING id`,
            [`BOM-${line.item_code}-V1`, order.org_unit_id, line.item_id, qtyToProduce, line.base_uom || "Hộp", actor.userId]
          )
        ).rows[0];
        await tx.query(
          `INSERT INTO kit.bom_line (bom_id, line_no, component_item_id, component_role, qty_per_batch, uom, scrap_pct, is_critical)
           SELECT $1, line_no, component_item_id, component_role, qty_per_batch, uom, scrap_pct, is_critical
             FROM kit.bom_line WHERE bom_id = $2`,
          [insBom.id, templateBom.id]
        );
        effBom = insBom;
      }
      if (!effRt && templateRt) {
        const insRt = (
          await tx.query(
            `INSERT INTO kit.routing (code, org_unit_id, product_item_id, version_tag, status, created_by, updated_by)
             VALUES ($1, $2, $3, 'v1.0', 'EFFECTIVE', $4, $4) RETURNING id`,
            [`RT-${line.item_code}-V1`, order.org_unit_id, line.item_id, actor.userId]
          )
        ).rows[0];
        await tx.query(
          `INSERT INTO kit.routing_step (routing_id, seq, step_code, step_name, workcenter, sop_doc_code, is_qc, requires_check_signature, allow_skip, param_schema)
           SELECT $1, seq, step_code, step_name, workcenter, sop_doc_code, is_qc, requires_check_signature, allow_skip, param_schema
             FROM kit.routing_step WHERE routing_id = $2`,
          [insRt.id, templateRt.id]
        );
        effRt = insRt;
      }
    }

    const kitOrder = await createProductionOrder(tx, dispatchActor, {
      org_unit_id: order.org_unit_id,
      product_item_id: line.item_id,
      bom_id: effBom?.id ?? null,
      routing_id: effRt?.id ?? null,
      warehouse_id: kitWh.id,
      planned_qty: qtyToProduce,
      priority: "HIGH",
      internal_order_line_id: line.id,
      notes: `Sản xuất theo Đơn nội bộ ${order.code} (PO ${order.kd_po_code})`,
    });

    if (order.status === "ACCEPTED") {
      await runTransition(tx, orderMachine, SYSTEM_ACTOR, { id: order.id, action: "start_production", expectedVersion: order.version }, { trusted: true });
    }

    return {
      domain: "KIT",
      order_code: kitOrder.code,
      order_id: kitOrder.id,
      target_tab: "factory-kit",
      message: `Đã phát hành Lệnh Sản Xuất Kit ${kitOrder.code} cho Phòng Sản xuất Kit (${qtyToProduce} ${line.base_uom}).`,
    };
  }

  if (moduleKey === "OLIGO") {
    const existingOligo = !d.force_new
      ? (
          await tx.query(
            "SELECT id, code, status FROM oligo.oligo_order WHERE internal_order_id = $1 AND status != 'CANCELLED' ORDER BY created_at DESC LIMIT 1",
            [order.id]
          )
        ).rows[0]
      : null;

    const defaultSeqText =
      d.oligo_sequences_text?.trim() ||
      [
        `${line.kd_item_code}-F; GAGTGTGGATTCGCACTCCT; 200NMOL; OPC; LYOPHILIZED`,
        `${line.kd_item_code}-R; GAGGAGTTGGGGGAGGAGATT; 200NMOL; OPC; LYOPHILIZED`,
        `${line.kd_item_code}-PRB; [FAM]CCAYTCRTCCBGCRGGBTR[BHQ1]; 200NMOL; HPLC; LYOPHILIZED`,
        `${line.kd_item_code}-Amplicon-PC; GAGTGTGGATTCGCACTCCTCCTGCCTCCACCAATCGCCAGTCAGGAAGGCAGCCTACCCCGCTGTCTCCACCTTTGAGAAACACTCATCCTCAGGCCATGCAGTGGAATTCCACAACCTTCCACCAAACTCTGCAAGATCCCAGAGTGAGAGGCCTGTATTTCCCTGCTGGTGGCTCCAGTTCAGGAACAGTAAACCCTGTTCTGACTACTGCCTCTCCCTTATCGTCAATCTTCTCGAGGATTGGGGACCCTGCGCTGAACATGGAGAACATCACATCAGGATTCCTAGGACCCCTTCTCGTGTTACAGGCGGGGTTTTTCTTGTTGACAAGAATCCTCACAATACCGCAGAGTCTAGACTCGTGGTGGACTTCTCTCAATTTTCTAGGGGG; 200NMOL; PAGE; LYOPHILIZED`,
      ].join("\n");

    if (existingOligo) {
      const seqCount = Number(
        (await tx.query("SELECT count(*)::int AS c FROM oligo.oligo_sequence WHERE order_id = $1 AND status != 'CANCELLED'", [existingOligo.id])).rows[0]?.c || 0
      );
      if (seqCount === 0) {
        await addSequences(tx, dispatchActor, existingOligo.id, {
          text: defaultSeqText,
          defaults: {
            scale_code: "200NMOL",
            purification: "OPC",
            format: "LYOPHILIZED",
            target_pathogen: line.kd_item_name || line.kd_item_code,
          },
        });
      }
      if (order.status === "ACCEPTED") {
        await runTransition(tx, orderMachine, SYSTEM_ACTOR, { id: order.id, action: "start_production", expectedVersion: order.version }, { trusted: true });
      }
      return {
        domain: "OLIGO",
        order_code: existingOligo.code,
        order_id: existingOligo.id,
        target_tab: "factory-oligo",
        already_existed: true,
        message: `Đã kích hoạt & chuyển tiếp sang Đơn Tổng Hợp Oligo ${existingOligo.code} tại Phòng Tổng hợp Oligo.`,
      };
    }

    const dueDate = order.committed_date ? String(order.committed_date).slice(0, 10) : addDays(vnToday(), 7);
    const oligoOrder = await createOligoOrder(tx, dispatchActor, {
      org_unit_id: order.org_unit_id,
      internal_order_id: order.id,
      customer_label: `${order.kd_po_code} — ${line.kd_item_name || line.kd_item_code}`,
      due_date: dueDate >= vnToday() ? dueDate : addDays(vnToday(), 5),
      notes: order.notes || `Tổng hợp Oligo theo Đơn nội bộ ${order.code} (${qtyToProduce} ${line.kd_unit || "Ống"})`,
    });

    await addSequences(tx, dispatchActor, oligoOrder.id, {
      text: defaultSeqText,
      defaults: {
        scale_code: "200NMOL",
        purification: "OPC",
        format: "LYOPHILIZED",
        target_pathogen: line.kd_item_name || line.kd_item_code,
      },
    });

    if (order.status === "ACCEPTED") {
      await runTransition(tx, orderMachine, SYSTEM_ACTOR, { id: order.id, action: "start_production", expectedVersion: order.version }, { trusted: true });
    }

    return {
      domain: "OLIGO",
      order_code: oligoOrder.code,
      order_id: oligoOrder.id,
      target_tab: "factory-oligo",
      message: `Đã phát hành Đơn Tổng Hợp Oligo ${oligoOrder.code} (kèm bộ chuỗi Primer/Probe) cho Phòng Tổng hợp Oligo.`,
    };
  }

  if (moduleKey === "DEVICE") {
    const model = await ensureDeviceModelForPoLine(tx, dispatchActor, order, line);

    const bomCountRow = model?.current_revision_id
      ? (
          await tx.query(
            "SELECT count(*)::int AS cnt FROM device.model_bom_line WHERE revision_id = $1",
            [model.current_revision_id]
          )
        ).rows[0]
      : { cnt: 0 };

    return {
      domain: "DEVICE",
      order_code: order.kd_po_code || order.code,
      order_id: order.id,
      target_tab: "factory-device",
      target_subtab: "po_mrp",
      already_existed: !d.force_new,
      message: `Đã đồng bộ Đơn nội bộ ${order.code} với Đơn PO Sản Xuất Thiết Bị ${order.kd_po_code} tại Phòng Kỹ thuật – Công nghệ (Tab 3: Đơn PO & Tách PR/Gia công — Model ${model.code} Rev ${model.revision || "A"} · ${bomCountRow?.cnt ?? 0} dòng BOM). Tại đây kỹ sư thực hiện nổ BOM (MRP), tách PR mua hàng / đơn gia công ngoài trước khi phát Lệnh lắp ráp WO.`,
    };
  }

  throw invalid(`Phân hệ ${moduleKey} chưa hỗ trợ phát lệnh sản xuất tự động.`);
}

const addOligoSequencesSchema = z.object({
  order_id: z.string().uuid(),
  sequences_text: z.string().trim().min(3, "Vui lòng nhập ít nhất 1 trình tự Primer/Probe (5'→3')"),
  scale_code: z.enum(["25NMOL", "50NMOL", "100NMOL", "200NMOL", "1000NMOL"]).default("200NMOL"),
  purification: z.enum(["DESALT", "OPC", "HPLC", "PAGE"]).default("OPC"),
  format: z.enum(["LYOPHILIZED", "LIQUID_100UM", "LIQUID_10UM"]).default("LYOPHILIZED"),
});

/**
 * Thêm trực tiếp danh sách trình tự Primer / Probe / Amplicon (5'→3') vào Đơn Tổng Hợp Oligo
 * đang liên kết với Đơn hàng nội bộ (`intake.internal_order`).
 */
export async function addOligoSequencesToInternalOrder(tx: Tx, actor: AuthzActor, input: unknown) {
  await authorizeAnywhere(tx, actor, "intake.order.view");
  const d = parseInput(addOligoSequencesSchema, input);
  const dispatchActor: AuthzActor = actor;

  const order = (
    await tx.query(
      `SELECT o.*, u.module_key
         FROM intake.internal_order o
         JOIN core.org_unit u ON u.id = o.org_unit_id
        WHERE o.id = $1`,
      [d.order_id]
    )
  ).rows[0];
  if (!order) throw notFound("Đơn nội bộ");

  let oligoOrder = (
    await tx.query(
      "SELECT * FROM oligo.oligo_order WHERE internal_order_id = $1 AND status != 'CANCELLED' ORDER BY created_at DESC LIMIT 1",
      [order.id]
    )
  ).rows[0];

  const firstLine = (
    await tx.query("SELECT * FROM intake.internal_order_line WHERE order_id = $1 ORDER BY line_no LIMIT 1", [order.id])
  ).rows[0];

  if (!oligoOrder) {
    const dueDate = order.committed_date ? String(order.committed_date).slice(0, 10) : addDays(vnToday(), 7);
    oligoOrder = await createOligoOrder(tx, dispatchActor, {
      org_unit_id: order.org_unit_id,
      internal_order_id: order.id,
      customer_label: `${order.kd_po_code} — ${firstLine?.kd_item_name || firstLine?.kd_item_code || "Bộ Primer/Probe"}`,
      due_date: dueDate >= vnToday() ? dueDate : addDays(vnToday(), 5),
      notes: order.notes || `Đơn Tổng hợp Oligo liên kết từ Đơn nội bộ ${order.code}`,
    });
  }

  const inserted = await addSequences(tx, dispatchActor, oligoOrder.id, {
    text: d.sequences_text,
    defaults: {
      scale_code: d.scale_code,
      purification: d.purification,
      format: d.format,
      target_pathogen: firstLine?.kd_item_name || firstLine?.kd_item_code || order.kd_po_code,
    },
  });

  return {
    oligo_order_id: oligoOrder.id,
    oligo_order_code: oligoOrder.code,
    added_count: inserted.added,
    message: `Đã thêm ${inserted.added} trình tự Primer/Probe vào đơn ${oligoOrder.code}.`,
  };
}

export interface KdSyncItemInput {
  product_code?: string;
  product_name?: string;
  unit?: string;
  quantity?: number | string;
  unit_price?: number | string;
  specification?: string;
  category?: string;
  notes?: string;
  oligo_sequences_text?: string;
}

export interface SyncKdOrderToInternalInput {
  kd_po_code: string;
  kd_so_code?: string | null;
  customer_name?: string | null;
  customer_address?: string | null;
  requested_date?: string | null;
  notes?: string | null;
  ship_mode?: "TO_KD" | "DROP_SHIP";
  items: KdSyncItemInput[];
  oligo_sequences_text?: string | null;
}

function classifyKdItemDomain(code: string, name: string, category: string, spec: string): "KIT" | "OLIGO" | "DEVICE" {
  const c = code.toUpperCase();
  const text = `${code} ${name} ${category} ${spec}`.toUpperCase();
  if (
    c.startsWith("OLI-") ||
    c.startsWith("PRIMER") ||
    c.startsWith("PROBE") ||
    text.includes("OLIGO") ||
    text.includes("PRIMER") ||
    text.includes("PROBE") ||
    text.includes("TAQMAN") ||
    text.includes("MỒI") ||
    text.includes("ĐẦU DÒ") ||
    text.includes("AMPLICON")
  ) {
    return "OLIGO";
  }
  if (
    c.startsWith("DEV-") ||
    c.startsWith("ABT-EXTR") ||
    c.startsWith("ABT-PCR") ||
    c.startsWith("MÁY") ||
    c.startsWith("MAY-") ||
    text.includes("MÁY TÁCH CHIẾT") ||
    text.includes("THIẾT BỊ") ||
    text.includes("THERMAL CYCLER") ||
    text.includes("EXTRACTOR") ||
    text.includes("CENTRIFUGE")
  ) {
    return "DEVICE";
  }
  return "KIT";
}

function extractOligoSequencesFromItemText(text: string): string {
  if (!text) return "";
  const lines = text
    .split(/\r?\n|\|/)
    .map((s) => s.trim())
    .filter(Boolean);
  const validSeqLines: string[] = [];
  for (const ln of lines) {
    // Check if line looks like "Name; ATCG..." or "Name: ATCG..." or contains >= 12 nt of ACGTU
    const parts = ln.split(/[;,\t:]/).map((s) => s.trim()).filter(Boolean);
    if (parts.length >= 2) {
      const seqCandidate = parts[1].replace(/\[[^\]]+\]/g, "").replace(/[^ACGTRYMKSWHBVDNUacgtrymkswhbvdnu]/g, "");
      if (seqCandidate.length >= 10) {
        validSeqLines.push(`${parts[0]}; ${parts[1]}; ${parts[2] || "200NMOL"}; ${parts[3] || "OPC"}; ${parts[4] || "LYOPHILIZED"}`);
      }
    }
  }
  return validSeqLines.join("\n");
}

/**
 * Tự động đồng bộ Đơn đặt hàng (PO / PR Đặt Hãng / SO) từ Tab Kinh doanh / Cung ứng
 * sang **Đơn Hàng Nội Bộ (`intake.internal_order`)** phân luồng về đúng Phòng Sản Xuất (`KIT`, `OLIGO`, `DEVICE`).
 */
export async function syncKdOrderOrPoToInternalOrder(tx: Tx, input: SyncKdOrderToInternalInput) {
  const rawItems = Array.isArray(input.items) ? input.items : [];
  const validItems = rawItems.filter((it) => {
    const code = String(it?.product_code || "").trim();
    const qty = Number(it?.quantity) || 0;
    return code.length > 0 && qty > 0;
  });
  if (validItems.length === 0) return [];

  const basePoCode = String(input.kd_po_code || "").trim();
  if (!basePoCode) return [];

  const grouped: Record<"KIT" | "OLIGO" | "DEVICE", Array<{ item: any; raw: KdSyncItemInput; qty: number; price: number }>> = {
    KIT: [],
    OLIGO: [],
    DEVICE: [],
  };

  for (const raw of validItems) {
    const code = String(raw.product_code || "").trim();
    const name = String(raw.product_name || code).trim();
    const uom = String(raw.unit || "Hộp").trim();
    const qty = Math.max(1, Number(raw.quantity) || 1);
    const price = Math.max(0, Number(raw.unit_price) || 1500000);
    const spec = String(raw.specification || "").trim();
    const cat = String(raw.category || "").trim();

    let masterItem = (
      await tx.query(
        `SELECT i.*,
                CASE
                  WHEN i.item_type = 'DEVICE' OR EXISTS (SELECT 1 FROM device.device_model dm WHERE dm.item_id = i.id OR upper(dm.code) = upper(i.code)) THEN 'DEVICE'
                  WHEN i.item_type = 'OLIGO_SERVICE' OR i.code LIKE 'OLI-%' OR i.code LIKE 'PRIMER-%' OR i.code LIKE 'PROBE-%' THEN 'OLIGO'
                  ELSE 'KIT'
                END AS domain_key
           FROM master.item i
          WHERE upper(i.code) = upper($1) OR upper(COALESCE(i.kd_item_code, '')) = upper($1)
          LIMIT 1`,
        [code]
      )
    ).rows[0];

    const domain = (masterItem?.domain_key as "KIT" | "OLIGO" | "DEVICE") || classifyKdItemDomain(code, name, cat, spec);

    if (!masterItem) {
      const itemType = domain === "DEVICE" ? "DEVICE" : domain === "OLIGO" ? "OLIGO_SERVICE" : "FINISHED_KIT";
      masterItem = (
        await tx.query(
          `INSERT INTO master.item (code, name, item_type, base_uom, kd_item_code, status, spec_summary)
           VALUES ($1, $2, $3, $4, $1, 'ACTIVE', $5)
           ON CONFLICT (code) DO UPDATE SET kd_item_code = COALESCE(master.item.kd_item_code, EXCLUDED.kd_item_code)
           RETURNING *`,
          [code, name, itemType, domain === "OLIGO" ? "tube" : domain === "DEVICE" ? "Máy" : uom, spec || null]
        )
      ).rows[0];
    }

    grouped[domain].push({ item: masterItem, raw, qty, price });
  }

  const activeDomains = (["KIT", "OLIGO", "DEVICE"] as const).filter((k) => grouped[k].length > 0);
  const createdOrders: any[] = [];

  for (const domain of activeDomains) {
    const unit = (
      await tx.query("SELECT id, code, name, module_key FROM core.org_unit WHERE module_key = $1 AND status = 'ACTIVE' ORDER BY created_at LIMIT 1", [
        domain,
      ])
    ).rows[0];
    if (!unit) continue;

    const kdPoCodeForDomain = activeDomains.length === 1 ? basePoCode : `${basePoCode}-${domain}`;
    const reqDate =
      input.requested_date && /^\d{4}-\d{2}-\d{2}$/.test(String(input.requested_date).slice(0, 10))
        ? String(input.requested_date).slice(0, 10)
        : addDays(vnToday(), 7);

    const shipTo = input.customer_name
      ? {
          name: input.customer_name,
          address: input.customer_address || "Giao theo đơn Kinh doanh",
        }
      : null;

    let order = (
      await tx.query("SELECT * FROM intake.internal_order WHERE kd_po_code = $1 LIMIT 1", [kdPoCodeForDomain])
    ).rows[0];

    if (!order) {
      const internalCode = await nextNumber(tx, "INTERNAL_ORDER");
      order = (
        await tx.query(
          `INSERT INTO intake.internal_order
             (code, kd_po_id, kd_po_code, org_unit_id, ship_mode, ship_to, kd_so_code, requested_date, committed_date, initial_committed_date, status, notes, created_by, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $8, 'ACCEPTED', $9, $10, $10)
           RETURNING *`,
          [
            internalCode,
            Math.floor(Date.now() / 1000) % 1000000,
            kdPoCodeForDomain,
            unit.id,
            input.ship_mode || (input.customer_name ? "DROP_SHIP" : "TO_KD"),
            shipTo ? JSON.stringify(shipTo) : null,
            input.kd_so_code || basePoCode,
            reqDate,
            input.notes || `Đồng bộ tự động từ Đơn đặt hàng Kinh doanh ${basePoCode}`,
            SYSTEM_ACTOR.userId,
          ]
        )
      ).rows[0];

      let lineNo = 0;
      for (const entry of grouped[domain]) {
        const kdCode = entry.item.kd_item_code || entry.item.code;
        await tx.query(
          `INSERT INTO intake.internal_order_line
             (order_id, line_no, kd_line_index, kd_item_code, kd_item_name, kd_unit, item_id, qty, transfer_price)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            order.id,
            ++lineNo,
            lineNo - 1,
            kdCode,
            entry.raw.product_name || entry.item.name,
            entry.raw.unit || entry.item.base_uom,
            entry.item.id,
            entry.qty,
            entry.price,
          ]
        );
      }
    }

    if (domain === "OLIGO") {
      const existingOligo = (
        await tx.query("SELECT id FROM oligo.oligo_order WHERE internal_order_id = $1 AND status != 'CANCELLED' LIMIT 1", [order.id])
      ).rows[0];
      if (!existingOligo) {
        const firstEntry = grouped.OLIGO[0];
        const prefix = firstEntry?.item?.code || "OLI-SET";
        const extractedSeqs = [
          input.oligo_sequences_text || "",
          ...grouped.OLIGO.map((g) =>
            extractOligoSequencesFromItemText(
              [g.raw.oligo_sequences_text, g.raw.specification, g.raw.notes, input.notes].filter(Boolean).join("\n")
            )
          ),
        ]
          .filter(Boolean)
          .join("\n")
          .trim();

        const seqText =
          extractedSeqs ||
          [
            `${prefix}-F; GAGTGTGGATTCGCACTCCT; 200NMOL; OPC; LYOPHILIZED`,
            `${prefix}-R; GAGGAGTTGGGGGAGGAGATT; 200NMOL; OPC; LYOPHILIZED`,
            `${prefix}-PRB; [FAM]CCAYTCRTCCBGCRGGBTR[BHQ1]; 200NMOL; HPLC; LYOPHILIZED`,
            `${prefix}-Amplicon-PC; GAGTGTGGATTCGCACTCCTCCTGCCTCCACCAATCGCCAGTCAGGAAGGCAGCCTACCCCGCTGTCTCCACCTTTGAGAAACACTCATCCTCAGGCCATGCAGTGGAATTCCACAACCTTCCACCAAACTCTGCAAGATCCCAGAGTGAGAGGCCTGTATTTCCCTGCTGGTGGCTCCAGTTCAGGAACAGTAAACCCTGTTCTGACTACTGCCTCTCCCTTATCGTCAATCTTCTCGAGGATTGGGGACCCTGCGCTGAACATGGAGAACATCACATCAGGATTCCTAGGACCCCTTCTCGTGTTACAGGCGGGGTTTTTCTTGTTGACAAGAATCCTCACAATACCGCAGAGTCTAGACTCGTGGTGGACTTCTCTCAATTTTCTAGGGGG; 200NMOL; PAGE; LYOPHILIZED`,
          ].join("\n");

        const oligoOrder = await createOligoOrder(tx, SYSTEM_ACTOR, {
          org_unit_id: unit.id,
          internal_order_id: order.id,
          customer_label: input.customer_name || `${kdPoCodeForDomain} — ${firstEntry?.raw?.product_name || prefix}`,
          due_date: reqDate >= vnToday() ? reqDate : addDays(vnToday(), 7),
          notes: input.notes || `Đơn Tổng hợp Oligo đồng bộ tự động từ ${basePoCode}`,
        });
        await addSequences(tx, SYSTEM_ACTOR, oligoOrder.id, {
          text: seqText,
          defaults: {
            scale_code: "200NMOL",
            purification: "OPC",
            format: "LYOPHILIZED",
            target_pathogen: firstEntry?.raw?.product_name || prefix,
          },
        });
      }
    }

    if (domain === "DEVICE") {
      const linesRows = (
        await tx.query(
          `SELECT l.*, i.code AS item_code, i.name AS item_name
             FROM intake.internal_order_line l
             LEFT JOIN master.item i ON i.id = l.item_id
            WHERE l.order_id = $1 ORDER BY l.line_no`,
          [order.id]
        )
      ).rows;
      for (const ln of linesRows) {
        await ensureDeviceModelForPoLine(tx, SYSTEM_ACTOR, order, ln);
      }
    }

    createdOrders.push(order);
  }

  return createdOrders;
}
