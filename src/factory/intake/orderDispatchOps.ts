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

  return { departments, items };
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
  const kdPoCode = d.kd_po_code?.trim() || `PO-KD-${d.target_module}-${Math.floor(1000 + Math.random() * 9000)}`;
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
        d.kd_so_code || `SO-KD-${Math.floor(100 + Math.random() * 900)}`,
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

  await writeAudit(tx, actor, {
    entityType: "internal_order",
    entityId: order.id,
    action: "create_manual_internal_order",
    changes: { code: [null, order.code], department: [null, unit.name], lines: [null, d.lines.length] },
  });

  return order;
}

const dispatchLineSchema = z.object({
  order_id: z.string().uuid(),
  line_id: z.string().uuid(),
  qty: z.coerce.number().positive().optional(),
  oligo_sequences_text: z.string().optional().nullable(),
});

/**
 * 1-Click Dispatch from an Internal Order Line to the Producing Department's Execution Engine:
 * - `KIT`: Creates a `kit.production_order` linked via `internal_order_line_id`.
 * - `OLIGO`: Creates an `oligo.oligo_order` + standard Primer/Probe sequences linked via `internal_order_id`.
 * - `DEVICE`: Creates a `device.device_order` (WO) + Serial Units linked via `internal_order_line_id`.
 */
export async function dispatchInternalOrderLineToProduction(tx: Tx, actor: AuthzActor, input: unknown) {
  const d = parseInput(dispatchLineSchema, input);

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

    const kitOrder = await createProductionOrder(tx, SYSTEM_ACTOR, {
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
    const dueDate = order.committed_date ? String(order.committed_date).slice(0, 10) : addDays(vnToday(), 7);
    const oligoOrder = await createOligoOrder(tx, SYSTEM_ACTOR, {
      org_unit_id: order.org_unit_id,
      internal_order_id: order.id,
      customer_label: `${order.kd_po_code} — ${line.kd_item_name || line.kd_item_code}`,
      due_date: dueDate >= vnToday() ? dueDate : addDays(vnToday(), 5),
      notes: `Tổng hợp Oligo theo Đơn nội bộ ${order.code} (${qtyToProduce} ${line.kd_unit || "Ống"})`,
    });

    const seqText =
      d.oligo_sequences_text?.trim() ||
      [
        `${line.kd_item_code}-F; GAGTGTGGATTCGCACTCCT; 200NMOL; OPC; LYOPHILIZED`,
        `${line.kd_item_code}-R; GAGGAGTTGGGGGAGGAGATT; 200NMOL; OPC; LYOPHILIZED`,
        `${line.kd_item_code}-PRB; [FAM]CCAYTCRTCCBGCRGGBTR[BHQ1]; 200NMOL; HPLC; LYOPHILIZED`,
      ].join("\n");

    await addSequences(tx, SYSTEM_ACTOR, oligoOrder.id, {
      text: seqText,
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
      message: `Đã tạo Đơn Tổng Hợp Oligo ${oligoOrder.code} (kèm bộ chuỗi Primer/Probe) cho Phòng Tổng hợp Oligo.`,
    };
  }

  if (moduleKey === "DEVICE") {
    const woRes = await convertPoToWorkOrder(tx, SYSTEM_ACTOR, {
      internal_order_id: order.id,
      internal_order_line_id: line.id,
      qty: qtyToProduce,
      priority: "HIGH",
    });

    return {
      domain: "DEVICE",
      order_code: woRes.work_order.code,
      order_id: woRes.work_order.id,
      serials: woRes.serial_numbers,
      target_tab: "factory-device",
      message: `Đã phát hành Lệnh Lắp Ráp Thiết Bị ${woRes.work_order.code} (Serial: ${woRes.serial_numbers.join(", ")}) cho Phòng Kỹ thuật – Thiết bị.`,
    };
  }

  throw invalid(`Phân hệ ${moduleKey} chưa hỗ trợ phát lệnh sản xuất tự động.`);
}
