import { z } from "zod";
import { withTransaction, type Tx } from "../core/db";
import { writeAudit } from "../core/audit";
import { SYSTEM_ACTOR } from "../core/authz";
import { addDays, vnToday } from "../core/dates";
import { notifyUsers, usersWithPermission } from "../core/notifications";
import { nextNumber } from "../core/numbering";
import { enqueueEvent } from "../core/outbox";
import { runTransition } from "../core/stateMachine";
import type { BridgeEvent } from "./gateway";
import { notifyNewOrder, orderMachine } from "./orders";
import { syncOrderStatus } from "./shipments";
import { ensureDeviceModelForPoLine } from "./orderDispatchOps";
import { addSequences, createOligoOrder } from "../oligo/orders";
import { kitSpecOf, kitSpecToFactorySupplyAndTube } from "@/frontend/utils/packagingForm";

let internalOrderLineColumnsEnsured = false;
export async function ensureInternalOrderLineKitSpecColumns(tx: Tx) {
  if (internalOrderLineColumnsEnsured) return;
  await tx.query(`
    ALTER TABLE intake.internal_order_line
      ADD COLUMN IF NOT EXISTS supply_form text,
      ADD COLUMN IF NOT EXISTS tube_code text,
      ADD COLUMN IF NOT EXISTS specification text,
      ADD COLUMN IF NOT EXISTS line_notes text
  `);
  internalOrderLineColumnsEnsured = true;
}

const FACTORY_UNITS = ["KIT", "OLIGO", "DEVICE"] as const;

const DEPARTMENT_DEFAULTS: Record<(typeof FACTORY_UNITS)[number], { code: string; name: string }> = {
  OLIGO: { code: "P-OLIGO", name: "Phòng Tổng hợp Oligo" },
  KIT: { code: "P-KIT", name: "Phòng Sản xuất Kit" },
  DEVICE: { code: "P-DEVICE", name: "Phòng Kỹ thuật - Thiết bị" },
};

const poIssued = z.object({
  kd_po_id: z.number().int(),
  kd_po_code: z.string().min(1),
  factory_unit: z.enum(FACTORY_UNITS),
  ship_mode: z.enum(["TO_KD", "DROP_SHIP"]),
  ship_to: z.record(z.unknown()).nullable().optional(),
  kd_so_code: z.string().nullable().optional(),
  requested_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  notes: z.string().nullable().optional(),
  lines: z
    .array(
      z.object({
        line_index: z.number().int().min(0),
        product_code: z.string().min(1),
        product_name: z.string().nullable().optional(),
        unit: z.string().nullable().optional(),
        quantity: z.number().positive(),
        unit_price: z.number().min(0),
        supply_form: z.string().nullable().optional(),
        tube_code: z.string().nullable().optional(),
        specification: z.string().nullable().optional(),
        notes: z.string().nullable().optional(),
      })
    )
    .min(1),
});

async function ensureFactoryDepartmentUnit(tx: Tx, factoryUnit: (typeof FACTORY_UNITS)[number]) {
  let unit = (
    await tx.query(
      "SELECT id, code, name, module_key FROM core.org_unit WHERE module_key = $1 AND unit_type = 'DEPARTMENT' AND status = 'ACTIVE' ORDER BY created_at LIMIT 1",
      [factoryUnit]
    )
  ).rows[0];
  if (unit) return unit;

  let company = (
    await tx.query("SELECT id FROM core.org_unit WHERE unit_type = 'COMPANY' ORDER BY created_at LIMIT 1")
  ).rows[0];
  if (!company) {
    company = (
      await tx.query(
        `INSERT INTO core.org_unit (code, name, unit_type, status)
         VALUES ('ABT-CORP', 'Công ty Y Sinh ABT', 'COMPANY', 'ACTIVE')
         ON CONFLICT (code) DO UPDATE SET status = 'ACTIVE'
         RETURNING id`
      )
    ).rows[0];
  }

  const def = DEPARTMENT_DEFAULTS[factoryUnit];
  unit = (
    await tx.query(
      `INSERT INTO core.org_unit (code, name, unit_type, parent_id, module_key, status)
       VALUES ($1, $2, 'DEPARTMENT', $3, $4, 'ACTIVE')
       ON CONFLICT (code) DO UPDATE SET module_key = EXCLUDED.module_key, status = 'ACTIVE', name = EXCLUDED.name
       RETURNING id, code, name, module_key`,
      [def.code, def.name, company.id, factoryUnit]
    )
  ).rows[0];
  return unit;
}

async function resolveOrCreateMasterItemForPoLine(
  tx: Tx,
  factoryUnit: (typeof FACTORY_UNITS)[number],
  line: { product_code: string; product_name?: string | null; unit?: string | null }
) {
  const code = String(line.product_code || "").trim();
  const existing = (
    await tx.query(
      `SELECT id, code, name, base_uom, kd_item_code
         FROM master.item
        WHERE status = 'ACTIVE'
          AND (upper(kd_item_code) = upper($1) OR upper(code) = upper($1))
        ORDER BY (upper(kd_item_code) = upper($1)) DESC, created_at ASC
        LIMIT 1`,
      [code]
    )
  ).rows[0];

  if (existing) {
    if (!existing.kd_item_code) {
      await tx.query("UPDATE master.item SET kd_item_code = $2 WHERE id = $1", [existing.id, code]);
    }
    return existing;
  }

  const rawUom = String(line.unit || (factoryUnit === "OLIGO" ? "tube" : factoryUnit === "DEVICE" ? "Cái" : "Hộp")).trim() || "Hộp";
  const uomCode = rawUom.slice(0, 20);
  await tx.query(
    `INSERT INTO master.uom (code, name, dimension)
     VALUES ($1, $2, 'COUNT')
     ON CONFLICT (code) DO NOTHING`,
    [uomCode, rawUom]
  );

  const itemType =
    factoryUnit === "OLIGO" ? "OLIGO_SERVICE" : factoryUnit === "DEVICE" ? "DEVICE" : "FINISHED_KIT";
  const lotControlled = factoryUnit !== "OLIGO";
  const serialControlled = factoryUnit === "DEVICE";
  const itemName = String(line.product_name || code).trim() || code;

  const created = (
    await tx.query(
      `INSERT INTO master.item
         (code, name, item_type, base_uom, lot_controlled, serial_controlled, fefo_enabled, default_storage_cond, kd_item_code, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'ACTIVE')
       ON CONFLICT (code) DO UPDATE
         SET kd_item_code = COALESCE(master.item.kd_item_code, EXCLUDED.kd_item_code),
             status = 'ACTIVE',
             updated_at = now()
       RETURNING id, code, name, base_uom, kd_item_code`,
      [
        code.toUpperCase(),
        itemName,
        itemType,
        uomCode,
        lotControlled,
        serialControlled,
        factoryUnit === "KIT",
        factoryUnit === "DEVICE" ? "AMBIENT" : "MINUS20",
        code,
      ]
    )
  ).rows[0];
  return created;
}

async function ensureDownstreamDepartmentOrder(
  tx: Tx,
  factoryUnit: (typeof FACTORY_UNITS)[number],
  unit: { id: string; code: string; name: string },
  order: any
) {
  if (factoryUnit === "OLIGO") {
    const existingOligo = (
      await tx.query("SELECT id FROM oligo.oligo_order WHERE internal_order_id = $1 LIMIT 1", [order.id])
    ).rows[0];
    if (!existingOligo) {
      const firstLine = (
        await tx.query("SELECT * FROM intake.internal_order_line WHERE order_id = $1 ORDER BY line_no LIMIT 1", [order.id])
      ).rows[0];
      const reqDate = order.requested_date ? String(order.requested_date).slice(0, 10) : addDays(vnToday(), 7);
      const dueDate = reqDate >= vnToday() ? reqDate : addDays(vnToday(), 7);
      const oligoOrder = await createOligoOrder(tx, SYSTEM_ACTOR, {
        org_unit_id: unit.id,
        internal_order_id: order.id,
        customer_label: `${order.kd_po_code} — ${firstLine?.kd_item_name || "Đơn tổng hợp Oligo"}`,
        due_date: dueDate,
        notes: order.notes || `Đơn Tổng hợp Oligo tự động chuyển từ PO Kinh doanh ${order.kd_po_code} (Đơn nội bộ ${order.code})`,
      });
      const prefix = firstLine?.kd_item_code || "OLI-SET";
      const defaultSeqs = [
        `${prefix}-F; GAGTGTGGATTCGCACTCCT; 200NMOL; OPC; LYOPHILIZED`,
        `${prefix}-R; GAGGAGTTGGGGGAGGAGATT; 200NMOL; OPC; LYOPHILIZED`,
        `${prefix}-PRB; [FAM]CCAYTCRTCCBGCRGGBTR[BHQ1]; 200NMOL; HPLC; LYOPHILIZED`,
      ].join("\n");
      try {
        await addSequences(tx, SYSTEM_ACTOR, oligoOrder.id, {
          text: defaultSeqs,
          defaults: {
            scale_code: "200NMOL",
            purification: "OPC",
            format: "LYOPHILIZED",
            target_pathogen: firstLine?.kd_item_name || prefix,
          },
        });
      } catch {
        // Ignore sequence seed error if scale/purification constraints differ
      }
    }
  } else if (factoryUnit === "DEVICE") {
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
}

async function receivePo(tx: Tx, payload: unknown): Promise<void> {
  await ensureInternalOrderLineKitSpecColumns(tx);
  const p = poIssued.parse(payload);
  const unit = await ensureFactoryDepartmentUnit(tx, p.factory_unit);

  const existing = (
    await tx.query("SELECT * FROM intake.internal_order WHERE kd_po_code = $1 FOR UPDATE", [p.kd_po_code])
  ).rows[0];

  if (existing) {
    const updatedOrder = (
      await tx.query(
        `UPDATE intake.internal_order
            SET org_unit_id = $2,
                ship_mode = $3,
                ship_to = COALESCE($4::jsonb, ship_to),
                kd_so_code = COALESCE($5, kd_so_code),
                requested_date = COALESCE($6::date, requested_date),
                notes = COALESCE($7, notes),
                updated_at = now()
          WHERE id = $1
          RETURNING *`,
        [
          existing.id,
          unit.id,
          p.ship_mode,
          p.ship_to ? JSON.stringify(p.ship_to) : null,
          p.kd_so_code ?? null,
          p.requested_date ?? null,
          p.notes ?? null,
        ]
      )
    ).rows[0];

    const hasProdOrder = (
      await tx.query("SELECT 1 FROM kit.production_order WHERE internal_order_id = $1 LIMIT 1", [existing.id])
    ).rowCount;
    if (["RECEIVED", "ACCEPTED"].includes(String(existing.status)) && !hasProdOrder) {
      await tx.query("DELETE FROM intake.internal_order_line WHERE order_id = $1", [existing.id]);
      let n = 0;
      for (const l of p.lines) {
        const item = await resolveOrCreateMasterItemForPoLine(tx, p.factory_unit, l);
        const ks = kitSpecOf({
          supply_form: l.supply_form,
          tube_code: l.tube_code,
          specification: `${l.specification ?? ""} ${l.product_name ?? ""}`,
          notes: l.notes,
        });
        const mapped = kitSpecToFactorySupplyAndTube(ks);
        await tx.query(
          `INSERT INTO intake.internal_order_line (order_id, line_no, kd_line_index, kd_item_code, kd_item_name, kd_unit, item_id, qty, transfer_price, supply_form, tube_code, specification, line_notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [
            existing.id,
            ++n,
            l.line_index,
            l.product_code,
            l.product_name ?? item.name ?? null,
            l.unit ?? item.base_uom ?? null,
            item?.id ?? null,
            l.quantity,
            l.unit_price,
            mapped.supply_form ?? l.supply_form ?? null,
            mapped.tube_code ?? l.tube_code ?? null,
            l.specification ?? null,
            l.notes ?? null,
          ]
        );
      }
    }

    await ensureDownstreamDepartmentOrder(tx, p.factory_unit, unit, updatedOrder);
    await enqueueEvent(tx, "FactoryOrderProgress", {
      kd_po_code: p.kd_po_code,
      order_code: updatedOrder.code,
      status: updatedOrder.status,
      committed_date: updatedOrder.committed_date ? String(updatedOrder.committed_date).slice(0, 10) : null,
    });
    return;
  }

  const code = await nextNumber(tx, "INTERNAL_ORDER");
  const reqDate = p.requested_date ?? addDays(vnToday(), 7);
  const order = (
    await tx.query(
      `INSERT INTO intake.internal_order (code, kd_po_id, kd_po_code, org_unit_id, ship_mode, ship_to, kd_so_code, requested_date, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [code, p.kd_po_id, p.kd_po_code, unit.id, p.ship_mode, p.ship_to ? JSON.stringify(p.ship_to) : null, p.kd_so_code ?? null, reqDate, p.notes ?? null]
    )
  ).rows[0];
  let n = 0;
  for (const l of p.lines) {
    const item = await resolveOrCreateMasterItemForPoLine(tx, p.factory_unit, l);
    const ks = kitSpecOf({
      supply_form: l.supply_form,
      tube_code: l.tube_code,
      specification: `${l.specification ?? ""} ${l.product_name ?? ""}`,
      notes: l.notes,
    });
    const mapped = kitSpecToFactorySupplyAndTube(ks);
    await tx.query(
      `INSERT INTO intake.internal_order_line (order_id, line_no, kd_line_index, kd_item_code, kd_item_name, kd_unit, item_id, qty, transfer_price, supply_form, tube_code, specification, line_notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        order.id,
        ++n,
        l.line_index,
        l.product_code,
        l.product_name ?? item.name ?? null,
        l.unit ?? item.base_uom ?? null,
        item?.id ?? null,
        l.quantity,
        l.unit_price,
        mapped.supply_form ?? l.supply_form ?? null,
        mapped.tube_code ?? l.tube_code ?? null,
        l.specification ?? null,
        l.notes ?? null,
      ]
    );
  }
  await ensureDownstreamDepartmentOrder(tx, p.factory_unit, unit, order);
  await enqueueEvent(tx, "FactoryOrderProgress", {
    kd_po_code: p.kd_po_code,
    order_code: order.code,
    status: order.status,
    committed_date: order.committed_date ? String(order.committed_date).slice(0, 10) : null,
  });
  await writeAudit(tx, SYSTEM_ACTOR, { entityType: "internal_order", entityId: order.id, action: "receive", changes: { kd_po_code: [null, p.kd_po_code], department: [null, unit.name], lines: [null, p.lines.length] } });
  await notifyNewOrder(tx, order);
}

export async function getFactoryInternalOrderSummary(kdPoCode: string): Promise<{
  code: string;
  status: string;
  committed_date: string | null;
  module_key: string | null;
  department_name: string | null;
} | null> {
  return withTransaction(async (tx) => {
    const row = (
      await tx.query(
        `SELECT o.code, o.status, o.committed_date, u.module_key, u.name AS department_name
           FROM intake.internal_order o
           LEFT JOIN core.org_unit u ON u.id = o.org_unit_id
          WHERE o.kd_po_code = $1
          LIMIT 1`,
        [kdPoCode]
      )
    ).rows[0];
    if (!row) return null;
    return {
      code: row.code,
      status: row.status,
      committed_date: row.committed_date ? String(row.committed_date).slice(0, 10) : null,
      module_key: row.module_key ?? null,
      department_name: row.department_name ?? null,
    };
  });
}

async function cancelPo(tx: Tx, payload: any): Promise<void> {
  const o = (await tx.query("SELECT id, status, version, org_unit_id, code FROM intake.internal_order WHERE kd_po_code = $1 FOR UPDATE", [payload.kd_po_code])).rows[0];
  if (!o || ["CANCELLED", "REJECTED", "CLOSED"].includes(o.status)) return;
  try {
    await runTransition(tx, orderMachine, SYSTEM_ACTOR, { id: o.id, action: "cancel", expectedVersion: o.version, reason: `Kinh doanh hủy PO: ${payload.reason ?? ""}` });
  } catch {
    // already shipped or in delivery: the department must settle it with Kinh doanh
    await notifyUsers(tx, await usersWithPermission(tx, "intake.order.accept", o.org_unit_id), {
      type: "INTERNAL_ORDER_CANCEL_CONFLICT",
      title: `Kinh doanh hủy PO ${payload.kd_po_code} nhưng đơn ${o.code} đã giao hàng`,
      entityType: "internal_order",
      entityId: o.id,
      sourceKey: `cancel:${o.id}`,
    });
  }
}

async function acknowledgeShipment(tx: Tx, payload: any): Promise<void> {
  const s = (await tx.query("SELECT id, order_id, status FROM intake.shipment WHERE id = $1 FOR UPDATE", [payload.shipment_id])).rows[0];
  if (!s || s.status === "ACKNOWLEDGED") return;
  await tx.query(
    "UPDATE intake.shipment SET status = 'ACKNOWLEDGED', kd_acknowledged_at = now(), kd_inbound_code = $2, version = version + 1, updated_at = now() WHERE id = $1",
    [s.id, payload.inbound_code ?? null]
  );
  await writeAudit(tx, SYSTEM_ACTOR, { entityType: "shipment", entityId: s.id, action: "kd_acknowledge", changes: { status: [s.status, "ACKNOWLEDGED"], inbound: [null, payload.inbound_code ?? null] } });
  await syncOrderStatus(tx, SYSTEM_ACTOR, s.order_id);
}

/**
 * Entry point for messages from Kinh doanh. Runs in its own transaction; the event id is recorded in
 * core.inbox_event in that same transaction, so a redelivered message has no second effect.
 */
export async function handleKdEvent(event: BridgeEvent): Promise<"processed" | "duplicate"> {
  return withTransaction(async (tx) => {
    const fresh = await tx.query("INSERT INTO core.inbox_event (event_id, source, event_type) VALUES ($1, 'KD', $2) ON CONFLICT DO NOTHING RETURNING event_id", [
      event.event_id,
      event.event_type,
    ]);
    if (!fresh.rowCount) return "duplicate";
    if (event.event_type === "KdPoIssued") await receivePo(tx, event.payload);
    else if (event.event_type === "KdPoCancelled") await cancelPo(tx, event.payload);
    else if (event.event_type === "KdShipmentAcknowledged") await acknowledgeShipment(tx, event.payload);
    else throw new Error(`Loại sự kiện không hỗ trợ: ${event.event_type}`);
    return "processed";
  });
}

