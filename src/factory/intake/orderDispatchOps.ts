import { z } from "zod/v3";
import type { Tx } from "../core/db";
import { authorizeAnywhere, SYSTEM_ACTOR, type AuthzActor } from "../core/authz";
import { addDays, vnToday } from "../core/dates";
import { invalid, notFound } from "../core/errors";
import { writeAudit } from "../core/audit";
import { nextNumber } from "../core/numbering";
import { parseInput } from "../core/records";
import { runTransition } from "../core/stateMachine";
import { orderMachine } from "./orders";
import { ensureInternalOrderLineKitSpecColumns } from "./kdEvents";
import { createProductionOrder } from "../kit/ordersEbr";
import { addSequences, createOligoOrder } from "../oligo/orders";
import { convertPoToWorkOrder } from "../device/workflow";
import { createRequest } from "../purchase/requests";
import { DEFAULT_ABT_KIT_BOM_COMPONENTS } from "@/shared/defaultKitBomComponents";
import { findAccessorySet, isExtractionAccessoryProduct } from "@/frontend/utils/extractionAccessories";
import { kitSpecOf, kitSpecToFactorySupplyAndTube, kitSpecLabel, hasKitSpec, hasPackagingSpec } from "@/frontend/utils/packagingForm";
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
                WHEN i.item_type = 'DEVICE'
                  OR i.code LIKE 'THE-%' OR i.code LIKE 'MPS-%' OR i.code LIKE 'MBC-%' OR i.code LIKE 'EQ-%' OR i.code LIKE 'DEV-%'
                  OR EXISTS (SELECT 1 FROM device.device_model dm WHERE dm.item_id = i.id OR upper(dm.code) = upper(i.code)) THEN 'DEVICE'
                WHEN i.item_type = 'OLIGO_SERVICE'
                  OR i.code LIKE 'OLG-%' OR i.code LIKE 'OLI-%' OR i.code LIKE 'PRI-%' OR i.code LIKE 'PRB-%'
                  OR i.code LIKE 'PRIMER-%' OR i.code LIKE 'PROBE-%' THEN 'OLIGO'
                ELSE 'KIT'
              END AS domain_key
         FROM master.item i
        WHERE i.status = 'ACTIVE'
          AND (
            i.item_type IN ('FINISHED_KIT', 'DEVICE', 'OLIGO_SERVICE', 'SEMI_FINISHED')
            OR i.code LIKE 'KIT-%' OR i.code LIKE 'LBC-%' OR i.code LIKE 'DD-%'
            OR i.code LIKE 'SQH-%' OR i.code LIKE 'SDS-%' OR i.code LIKE 'SDV-%'
            OR i.code LIKE 'HI-%' OR i.code LIKE 'EXS-%' OR i.code LIKE 'EXM-%'
            OR i.code LIKE 'AMP-%' OR i.code LIKE 'PIP-%' OR i.code LIKE 'POP-%'
            OR i.code LIKE 'OLG-%' OR i.code LIKE 'OLI-%'
            OR i.code LIKE 'THE-%' OR i.code LIKE 'MPS-%' OR i.code LIKE 'MBC-%' OR i.code LIKE 'EQ-%'
            OR EXISTS (SELECT 1 FROM device.device_model dm WHERE dm.item_id = i.id OR upper(dm.code) = upper(i.code))
          )
        ORDER BY i.code ASC
        LIMIT 1500`
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
      customer_label: d.customer_name?.trim() || unit.name,
      due_date: dueDate,
      notes: d.notes || `Đơn Tổng hợp Oligo nội bộ (${unit.name})`,
    });
    const prefix = firstLine?.kd_item_code || "OLI-SET";
    const userSeqs = d.oligo_sequences_text?.trim();
    if (userSeqs) {
      await addSequences(tx, dispatchActor, oligoOrder.id, {
        text: userSeqs,
        defaults: {
          scale_code: "200NMOL",
          purification: "OPC",
          format: "LYOPHILIZED",
          target_pathogen: firstLine?.kd_item_name || prefix,
        },
      });
    }
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
export async function ensureDeviceModelForPoLine(
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
  await ensureInternalOrderLineKitSpecColumns(tx);
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

    // Giải mã quy cách Kit PCR (Chia sẵn/Không chia sẵn, Sẵn IC/Không sẵn IC, Loại Tube PCR) từ dòng Đơn nội bộ / PO
    const ks = kitSpecOf({
      supply_form: line.supply_form,
      tube_code: line.tube_code,
      accessory_set: line.accessory_set,
      specification: `${line.specification ?? ""} ${line.kd_item_name ?? ""}`,
      notes: `${line.line_notes ?? ""} ${order.notes ?? ""}`,
    });
    const mappedSpec = kitSpecToFactorySupplyAndTube(ks);
    const resolvedSupplyForm = mappedSpec.supply_form ?? line.supply_form ?? "NO_SPLIT_NO_IC";
    const resolvedTubeCode = mappedSpec.tube_code ?? line.tube_code ?? null;
    const resolvedVariantCode = mappedSpec.variant_code ?? "BASE";
    const isAliquoted = resolvedSupplyForm === "SPLIT_NO_IC" || resolvedSupplyForm === "SPLIT_WITH_IC";

    // Check if product has an EFFECTIVE BOM (prefer matching variant_code or supply_form, fallback to BASE) & Routing
    let effBom = (
      await tx.query(
        `SELECT id FROM kit.bom
          WHERE product_item_id = $1 AND status = 'EFFECTIVE'
          ORDER BY
            CASE
              WHEN coalesce(variant_code, 'BASE') = $2 THEN 0
              WHEN supply_form = $3 THEN 1
              WHEN coalesce(variant_code, 'BASE') = 'BASE' THEN 2
              ELSE 3
            END,
            bom_version DESC
          LIMIT 1`,
        [line.item_id, resolvedVariantCode, resolvedSupplyForm]
      )
    ).rows[0];
    let effRt = (
      await tx.query("SELECT id FROM kit.routing WHERE product_item_id = $1 AND status = 'EFFECTIVE' LIMIT 1", [line.item_id])
    ).rows[0];

    if (!effBom || !effRt) {
      throw invalid(
        `Sản phẩm ${line.item_code || line.kd_item_code} chưa có ${!effBom ? "Định mức BOM" : ""}${!effBom && !effRt ? " và " : ""}${!effRt ? "Quy trình Routing" : ""} ở trạng thái HIỆU LỰC (EFFECTIVE). Không tự nhân bản từ sản phẩm khác — vui lòng thiết lập và phê duyệt hiệu lực trước khi phát hành lệnh.`,
        undefined,
        !effBom ? "MISSING_EFFECTIVE_BOM" : "MISSING_EFFECTIVE_ROUTING"
      );
    }

    const accessorySet = ks.accessorySet ? findAccessorySet(ks.accessorySet) : null;
    const accessoryNote = accessorySet
      ? ` [Mã phụ ${accessorySet.variant}: ${accessorySet.items.map((i) => i.code).join(" + ")}]`
      : isExtractionAccessoryProduct(line.item_code || line.kd_item_code)
        ? " [Chưa chọn mã phụ trên SO — không cấp kèm vật tư phụ]"
        : "";
    const specSummaryNote = (hasPackagingSpec(ks) ? ` [Dạng: ${kitSpecLabel(ks)}]` : "") + accessoryNote;
    const kitOrder = await createProductionOrder(tx, dispatchActor, {
      org_unit_id: order.org_unit_id,
      product_item_id: line.item_id,
      bom_id: effBom?.id ?? null,
      routing_id: effRt?.id ?? null,
      warehouse_id: kitWh.id,
      planned_qty: qtyToProduce,
      supply_form: resolvedSupplyForm,
      tube_code: resolvedTubeCode,
      accessory_set: accessorySet?.key ?? null,
      order_mode: isAliquoted ? "ALIQUOTED" : "STANDARD",
      is_aliquoted: isAliquoted,
      priority: "HIGH",
      internal_order_line_id: line.id,
      notes: `Sản xuất theo Đơn nội bộ ${order.code} (PO ${order.kd_po_code})${specSummaryNote}`,
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

    const userSeqText = d.oligo_sequences_text?.trim() || "";

    if (existingOligo) {
      const seqCount = Number(
        (await tx.query("SELECT count(*)::int AS c FROM oligo.oligo_sequence WHERE order_id = $1 AND status != 'CANCELLED'", [existingOligo.id])).rows[0]?.c || 0
      );
      if (seqCount === 0 && userSeqText) {
        await addSequences(tx, dispatchActor, existingOligo.id, {
          text: userSeqText,
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
    const shipToLabel = order.ship_to?.name ? String(order.ship_to.name).trim() : "";
    const oligoOrder = await createOligoOrder(tx, dispatchActor, {
      org_unit_id: order.org_unit_id,
      internal_order_id: order.id,
      customer_label: shipToLabel || order.unit_name || "Phòng Tổng hợp Oligo",
      due_date: dueDate >= vnToday() ? dueDate : addDays(vnToday(), 5),
      notes: order.notes || `Tổng hợp Oligo theo Đơn nội bộ ${order.code} (${qtyToProduce} ${line.kd_unit || "Ống"})`,
    });

    if (userSeqText) {
      await addSequences(tx, dispatchActor, oligoOrder.id, {
        text: userSeqText,
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
      order_code: oligoOrder.code,
      order_id: oligoOrder.id,
      target_tab: "factory-oligo",
      message: userSeqText
        ? `Đã phát hành Đơn Tổng Hợp Oligo ${oligoOrder.code} (kèm bộ chuỗi Primer/Probe từ đơn) cho Phòng Tổng hợp Oligo.`
        : `Đã phát hành Đơn Tổng Hợp Oligo ${oligoOrder.code} (chờ nhập/import trình tự Primer/Probe) cho Phòng Tổng hợp Oligo.`,
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
  scale_code: z.enum(["25NMOL", "50NMOL", "100NMOL", "200NMOL", "250NMOL", "500NMOL", "1000NMOL"]).default("200NMOL"),
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
    const shipToLabel = order.ship_to?.name ? String(order.ship_to.name).trim() : "";
    oligoOrder = await createOligoOrder(tx, dispatchActor, {
      org_unit_id: order.org_unit_id,
      internal_order_id: order.id,
      customer_label: shipToLabel || "Phòng Tổng hợp Oligo",
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

export function classifyKdItemDomain(code: string, name: string, category: string, spec: string): "KIT" | "OLIGO" | "DEVICE" {
  const c = code.trim().toUpperCase();
  const text = `${code} ${name} ${category} ${spec}`.toUpperCase();
  if (
    c.startsWith("OLG-") ||
    c.startsWith("OLI-") ||
    c.startsWith("PRI-") ||
    c.startsWith("PRB-") ||
    c.startsWith("PRIMER") ||
    c.startsWith("PROBE") ||
    text.includes("OLIGO") ||
    text.includes("PRIMER") ||
    text.includes("PROBE") ||
    text.includes("TAQMAN") ||
    text.includes("MỒI") ||
    text.includes("ĐẦU DÒ")
  ) {
    return "OLIGO";
  }
  if (
    c.startsWith("DEV-") ||
    c.startsWith("THE-") ||
    c.startsWith("MPS-") ||
    c.startsWith("MBC-") ||
    c.startsWith("EQ-") ||
    c.startsWith("ABT-EXTR") ||
    c.startsWith("ABT-PCR") ||
    c.startsWith("MÁY") ||
    c.startsWith("MAY-") ||
    text.includes("MÁY TÁCH CHIẾT") ||
    text.includes("THIẾT BỊ") ||
    text.includes("THERMAL CYCLER") ||
    text.includes("EXTRACTOR") ||
    text.includes("CENTRIFUGE") ||
    text.includes("LINH KIỆN KỸ THUẬT") ||
    text.includes("NỘI THẤT PTN")
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

        const seqText = extractedSeqs;

        const oligoOrder = await createOligoOrder(tx, SYSTEM_ACTOR, {
          org_unit_id: unit.id,
          internal_order_id: order.id,
          customer_label: input.customer_name || `${kdPoCodeForDomain} — ${firstEntry?.raw?.product_name || prefix}`,
          due_date: reqDate >= vnToday() ? reqDate : addDays(vnToday(), 7),
          notes: input.notes || `Đơn Tổng hợp Oligo đồng bộ tự động từ ${basePoCode}`,
        });
        if (seqText) {
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

    createdOrders.push({
      ...order,
      module_key: domain,
      org_unit_code: unit.code,
      org_unit_name: unit.name,
      routed_items: grouped[domain].map((g) => ({
        product_code: g.item.kd_item_code || g.item.code,
        product_name: g.raw.product_name || g.item.name,
        unit: g.raw.unit || g.item.base_uom,
        quantity: g.qty,
      })),
    });
  }

  return createdOrders;
}

const createForecastSchema = z.object({
  forecast_period: z.string().trim().min(2).default("Quý IV.2026"),
  forecast_code: z.string().trim().optional().nullable(),
  requested_date: z.string().optional().nullable(),
  notes: z.string().trim().optional().nullable(),
  items: z
    .array(
      z.object({
        product_code: z.string().trim().min(1),
        product_name: z.string().trim().optional().nullable(),
        unit: z.string().trim().optional().nullable(),
        quantity: z.coerce.number().positive(),
        category: z.string().trim().optional().nullable(),
        specification: z.string().trim().optional().nullable(),
      })
    )
    .min(1, "Cần ít nhất 1 mã hàng trong bảng Forecast Quý"),
});

/**
 * Tiếp nhận Bảng Forecast Quý từ Phòng Kinh doanh (có thể chứa hỗn hợp sản phẩm của cả 3 phòng),
 * tự động tra cứu danh mục và tách thành các Đơn Dự Trù Forecast Nội Bộ chuyển về đúng:
 * - `P-KIT` (Phòng Sản xuất Kit): Kit PCR, Kit tách chiết, Tế bào học (`LBC-*`), Dung dịch/Hóa chất (`DD-*`), Giải pháp tự pha (`AMP-*`, `PIP-*`, `POP-*`)...
 * - `P-DEVICE` (Phòng Kỹ thuật – Thiết bị / KTCN): Thiết bị SHPT, Thiết bị cơ bản ABT (`THE-*`, `MPS-*`, `MBC-*`, `EQ-*`, `DEV-*`)...
 * - `P-OLIGO` (Phòng Tổng hợp Oligo): Oligo, Primer, Probe (`OLG-*`, `OLI-*`, `PRI-*`, `PRB-*`)...
 */
export async function createQuarterlyForecastAndSplitToDepartments(tx: Tx, actor: AuthzActor, input: unknown) {
  await authorizeAnywhere(tx, actor, "intake.order.view");
  const d = parseInput(createForecastSchema, input);

  const periodClean = d.forecast_period.trim();
  const baseCode =
    (d.forecast_code || "").trim().toUpperCase() ||
    `FC-${periodClean
      .toUpperCase()
      .replace(/QUÝ\s*/i, "Q")
      .replace(/[^A-Z0-9]+/g, "-")
      .replace(/^-|-$/g, "")}-${String(Date.now()).slice(-4)}`;

  const reqDate =
    d.requested_date && /^\d{4}-\d{2}-\d{2}$/.test(d.requested_date)
      ? d.requested_date
      : addDays(vnToday(), 30);

  const created = await syncKdOrderOrPoToInternalOrder(tx, {
    kd_po_code: baseCode,
    kd_so_code: `FORECAST-${periodClean}`,
    customer_name: `Phòng Kinh Doanh — Dự trù Forecast ${periodClean}`,
    requested_date: reqDate,
    ship_mode: "TO_KD",
    notes: `[FORECAST QUÝ — ${periodClean}] ${d.notes || "Dự trù nguyên vật liệu & kế hoạch sản xuất quý từ Phòng Kinh doanh"}`,
    items: d.items.map((it) => ({
      product_code: it.product_code.trim().toUpperCase(),
      product_name: it.product_name?.trim() || it.product_code.trim().toUpperCase(),
      unit: it.unit?.trim() || (it.product_code.toUpperCase().startsWith("DD-") ? "Chai" : "Hộp"),
      quantity: it.quantity,
      category: it.category || undefined,
      specification: it.specification || undefined,
    })),
  });

  await writeAudit(tx, actor, {
    entityType: "quarterly_forecast",
    entityId: created[0]?.id ?? baseCode,
    action: "create_quarterly_forecast",
    changes: {
      forecast_code: [null, baseCode],
      period: [null, periodClean],
      departments_routed: [null, created.map((c: any) => `${c.org_unit_name} (${c.routed_items?.length ?? 0} mã)`).join("; ")],
    },
  });

  return {
    forecast_code: baseCode,
    forecast_period: periodClean,
    created_orders: created,
  };
}

export interface ForecastMrpComponentLine {
  component_item_id: string | null;
  component_code: string;
  component_name: string;
  uom: string;
  source_type: "BUY" | "SUBCONTRACT" | "REAGENT" | "PACKAGING";
  used_by_products: string[];
  gross_required_qty: number;
  dept_available_qty: number;
  hub_available_qty: number;
  total_available_qty: number;
  open_pr_po_qty: number;
  net_shortage_qty: number;
  est_unit_price: number;
}

/**
 * Nổ Định Mức BOM (BOM Explosion) & Đối chiếu Tồn kho (MRP Netting) cho một Đơn Nội Bộ / Forecast Quý
 * theo đặc thù của từng Phòng Sản Xuất (`KIT`, `DEVICE`, `OLIGO`).
 */
export async function getInternalOrderForecastMrp(tx: Tx, actor: AuthzActor, orderId: string) {
  await authorizeAnywhere(tx, actor, "intake.order.view");

  const order = (
    await tx.query(
      `SELECT o.*, u.code AS org_unit_code, u.name AS org_unit_name, u.module_key
         FROM intake.internal_order o
         JOIN core.org_unit u ON u.id = o.org_unit_id
        WHERE o.id = $1`,
      [orderId]
    )
  ).rows[0];
  if (!order) throw notFound("Đơn nội bộ / Forecast");

  const deptWh = (
    await tx.query(
      "SELECT id, code, name FROM master.warehouse WHERE owner_org_unit_id = $1 AND status = 'ACTIVE' ORDER BY code LIMIT 1",
      [order.org_unit_id]
    )
  ).rows[0];

  const orderLines = (
    await tx.query(
      `SELECT l.*, i.code AS item_code, i.name AS item_name, i.base_uom, i.item_type
         FROM intake.internal_order_line l
         LEFT JOIN master.item i ON i.id = l.item_id
        WHERE l.order_id = $1
        ORDER BY l.line_no ASC`,
      [orderId]
    )
  ).rows;

  const aggMap = new Map<
    string,
    {
      component_item_id: string | null;
      component_code: string;
      component_name: string;
      uom: string;
      source_type: "BUY" | "SUBCONTRACT" | "REAGENT" | "PACKAGING";
      used_by_products: Set<string>;
      gross_required_qty: number;
      est_unit_price: number;
    }
  >();

  const addRequirement = (entry: {
    component_item_id: string | null;
    component_code: string;
    component_name: string;
    uom: string;
    source_type: "BUY" | "SUBCONTRACT" | "REAGENT" | "PACKAGING";
    product_label: string;
    required_qty: number;
    est_unit_price?: number;
  }) => {
    const key = (entry.component_item_id || entry.component_code).toUpperCase();
    const existing = aggMap.get(key);
    if (existing) {
      existing.gross_required_qty = Number((existing.gross_required_qty + entry.required_qty).toFixed(4));
      existing.used_by_products.add(entry.product_label);
    } else {
      aggMap.set(key, {
        component_item_id: entry.component_item_id,
        component_code: entry.component_code,
        component_name: entry.component_name,
        uom: entry.uom,
        source_type: entry.source_type,
        used_by_products: new Set([entry.product_label]),
        gross_required_qty: Number(entry.required_qty.toFixed(4)),
        est_unit_price: entry.est_unit_price ?? 180000,
      });
    }
  };

  const moduleKey = String(order.module_key || "KIT");

  if (moduleKey === "DEVICE") {
    for (const ln of orderLines) {
      const model = await ensureDeviceModelForPoLine(tx, SYSTEM_ACTOR, order, ln);
      const lineQty = Math.max(1, Number(ln.qty) - Number(ln.qty_delivered || 0));
      const prodLabel = `${ln.kd_item_code} (×${lineQty})`;
      if (model?.current_revision_id) {
        const bomRows = (
          await tx.query(
            `SELECT bl.*, ci.code AS comp_code, ci.name AS comp_name, ci.base_uom AS comp_uom
               FROM device.model_bom_line bl
               JOIN master.item ci ON ci.id = bl.component_item_id
              WHERE bl.revision_id = $1
              ORDER BY bl.line_no ASC`,
            [model.current_revision_id]
          )
        ).rows;
        for (const b of bomRows) {
          addRequirement({
            component_item_id: b.component_item_id,
            component_code: b.comp_code,
            component_name: b.comp_name,
            uom: b.uom || b.comp_uom || "pcs",
            source_type: b.source_type === "SUBCONTRACT" ? "SUBCONTRACT" : "BUY",
            product_label: prodLabel,
            required_qty: lineQty * Number(b.qty_per_unit || 1),
            est_unit_price: b.source_type === "SUBCONTRACT" ? 850000 : 650000,
          });
        }
      }
    }
  } else if (moduleKey === "OLIGO") {
    const totalUnits = orderLines.reduce((s, l) => s + Math.max(1, Number(l.qty) - Number(l.qty_delivered || 0)), 0);
    const prodLabel = orderLines.map((l) => `${l.kd_item_code} (×${Number(l.qty)})`).join(", ") || "Forecast Oligo";
    const rules = (
      await tx.query(
        `SELECT r.role, r.name, r.basis, r.qty::float AS qty, r.uom, r.item_id,
                i.code AS item_code, i.name AS item_name, i.base_uom
           FROM oligo.reagent_rule r
           LEFT JOIN master.item i ON i.id = r.item_id
          WHERE r.status = 'ACTIVE'
          ORDER BY r.role ASC`
      )
    ).rows;

    // Giả định trung bình 1 đơn vị/bộ Oligo Forecast gồm ~3 chuỗi × 22 chu kỳ (cycles) = 66 coupling cycles
    const estCyclesPerUnit = 22;
    for (const r of rules) {
      const compCode = r.item_code || `CHEM-OLG-${r.role}`;
      const compName = r.item_name || r.name;
      const factor = r.basis === "PER_CYCLE" ? estCyclesPerUnit : r.basis === "PER_COUPLING" ? 6 : 1;
      addRequirement({
        component_item_id: r.item_id ?? null,
        component_code: compCode,
        component_name: compName,
        uom: r.uom || r.base_uom || "mL",
        source_type: "REAGENT",
        product_label: prodLabel,
        required_qty: totalUnits * factor * Number(r.qty || 0.1),
        est_unit_price: 450000,
      });
    }
  } else {
    // MODULE = KIT (Phòng Sản xuất Kit: Kit PCR, Kit tách chiết, LBC-*, DD-*, Giải pháp tự pha...)
    for (const ln of orderLines) {
      const lineQty = Math.max(1, Number(ln.qty) - Number(ln.qty_delivered || 0));
      const sku = String(ln.item_code || ln.kd_item_code || "").trim().toUpperCase();
      const prodLabel = `${sku} (×${lineQty})`;

      // 1. Kiểm tra định mức BOM trong DB (`kit.bom` + `kit.bom_line`)
      let dbBomLines: any[] = [];
      if (ln.item_id) {
        const bom = (
          await tx.query(
            `SELECT id, base_qty FROM kit.bom
              WHERE product_item_id = $1 AND status IN ('EFFECTIVE', 'IN_REVIEW', 'DRAFT')
              ORDER BY CASE status WHEN 'EFFECTIVE' THEN 0 WHEN 'IN_REVIEW' THEN 1 ELSE 2 END, bom_version DESC
              LIMIT 1`,
            [ln.item_id]
          )
        ).rows[0];
        if (bom) {
          const baseQty = Math.max(1, Number(bom.base_qty || 1));
          dbBomLines = (
            await tx.query(
              `SELECT bl.component_item_id, bl.qty_per_base::float AS qty_per_base, bl.uom,
                      bl.scrap_factor::float AS scrap_factor, bl.stage_type,
                      ci.code AS comp_code, ci.name AS comp_name, ci.base_uom AS comp_uom, ci.item_type AS comp_type
                 FROM kit.bom_line bl
                 JOIN master.item ci ON ci.id = bl.component_item_id
                WHERE bl.bom_id = $1
                ORDER BY bl.line_no ASC`,
              [bom.id]
            )
          ).rows.map((r) => ({ ...r, base_qty: baseQty }));
        }
      }

      if (dbBomLines.length > 0) {
        for (const b of dbBomLines) {
          const reqQty =
            (lineQty / Number(b.base_qty || 1)) *
            Number(b.qty_per_base || 1) *
            (1 + Number(b.scrap_factor || 0));
          addRequirement({
            component_item_id: b.component_item_id,
            component_code: b.comp_code,
            component_name: b.comp_name,
            uom: b.uom || b.comp_uom || "ĐV",
            source_type: b.comp_type === "PACKAGING" ? "PACKAGING" : "REAGENT",
            product_label: prodLabel,
            required_qty: reqQty,
            est_unit_price: b.comp_type === "PACKAGING" ? 15000 : 240000,
          });
        }
        continue;
      }

      // 2. Kiểm tra danh mục BOM mẫu chuẩn (`DEFAULT_ABT_KIT_BOM_COMPONENTS`)
      const seedMatches = DEFAULT_ABT_KIT_BOM_COMPONENTS.filter(
        (s) => s.parent_product_code.toUpperCase() === sku
      );
      if (seedMatches.length > 0) {
        for (const s of seedMatches) {
          const matchedComp = (
            await tx.query(
              "SELECT id, code, name, base_uom, item_type FROM master.item WHERE upper(code) = upper($1) OR upper(COALESCE(kd_item_code, '')) = upper($1) LIMIT 1",
              [s.component_code]
            )
          ).rows[0];
          addRequirement({
            component_item_id: matchedComp?.id ?? null,
            component_code: matchedComp?.code ?? s.component_code,
            component_name: matchedComp?.name ?? s.component_name,
            uom: matchedComp?.base_uom ?? s.unit ?? "Hộp",
            source_type: matchedComp?.item_type === "PACKAGING" ? "PACKAGING" : "REAGENT",
            product_label: prodLabel,
            required_qty: lineQty * Number(s.quantity_per_kit || 1),
            est_unit_price: 165000,
          });
        }
        continue;
      }

      // 3. Định mức chuẩn cho nhóm Hóa chất / Dung dịch (`DD-*`), Tế bào học (`LBC-*`) hoặc Kit mới chưa cấu hình chi tiết dòng BOM:
      // Tự động ánh xạ sang Hóa chất cơ sở + Chai/Hộp bao bì chuẩn trong `master.item` để phục vụ dự trù NVL Quý
      const fallbackRawItems = (
        await tx.query(
          `SELECT id, code, name, base_uom, item_type
             FROM master.item
            WHERE status = 'ACTIVE'
              AND item_type IN ('RAW_CHEMICAL', 'PACKAGING')
            ORDER BY CASE item_type WHEN 'RAW_CHEMICAL' THEN 0 ELSE 1 END, code ASC
            LIMIT 4`
        )
      ).rows;

      if (sku.startsWith("DD-") || sku.startsWith("LBC-")) {
        // Mỗi chai/bộ dung dịch (`DD-*` / `LBC-*`) cần Hóa chất gốc pha đệm + Chai HDPE/PP + Tem nhãn & Hộp ngoài
        const rawChem = fallbackRawItems.find((x) => x.item_type === "RAW_CHEMICAL");
        const pkgItem = fallbackRawItems.find((x) => x.item_type === "PACKAGING");
        if (rawChem) {
          addRequirement({
            component_item_id: rawChem.id,
            component_code: rawChem.code,
            component_name: `${rawChem.name} (Hóa chất gốc pha chế ${sku})`,
            uom: rawChem.base_uom || "mL",
            source_type: "REAGENT",
            product_label: prodLabel,
            required_qty: lineQty * (sku.startsWith("LBC-") ? 250 : 100),
            est_unit_price: 185000,
          });
        }
        if (pkgItem) {
          addRequirement({
            component_item_id: pkgItem.id,
            component_code: pkgItem.code,
            component_name: `${pkgItem.name} (Bao bì đóng gói ${sku})`,
            uom: pkgItem.base_uom || "Cái",
            source_type: "PACKAGING",
            product_label: prodLabel,
            required_qty: lineQty * (sku.startsWith("LBC-") ? 4 : 1),
            est_unit_price: 12000,
          });
        }
      } else {
        for (const fb of fallbackRawItems.slice(0, 2)) {
          addRequirement({
            component_item_id: fb.id,
            component_code: fb.code,
            component_name: fb.name,
            uom: fb.base_uom || "ĐV",
            source_type: fb.item_type === "PACKAGING" ? "PACKAGING" : "REAGENT",
            product_label: prodLabel,
            required_qty: lineQty * (fb.item_type === "PACKAGING" ? 1 : 5),
            est_unit_price: fb.item_type === "PACKAGING" ? 18000 : 210000,
          });
        }
      }
    }
  }

  // Đối chiếu Tồn kho khả dụng (Kho Phòng + Kho Tổng) & PR/PO đang mở cho toàn bộ danh sách NVL sau nổ BOM
  const components: ForecastMrpComponentLine[] = [];
  for (const entry of aggMap.values()) {
    let itemId = entry.component_item_id;
    if (!itemId) {
      const found = (
        await tx.query(
          "SELECT id FROM master.item WHERE upper(code) = upper($1) OR upper(COALESCE(kd_item_code, '')) = upper($1) LIMIT 1",
          [entry.component_code]
        )
      ).rows[0];
      itemId = found?.id ?? null;
    }

    let deptAvail = 0;
    let hubAvail = 0;
    let openPrPo = 0;

    if (itemId) {
      const stockRow = (
        await tx.query(
          `SELECT
             COALESCE(sum(b.qty_on_hand - b.qty_reserved) FILTER (
               WHERE ($2::uuid IS NOT NULL AND loc.warehouse_id = $2)
                 AND loc.is_quarantine = false
                 AND COALESCE(lot.status, 'RELEASED') = 'RELEASED'
                 AND (b.qty_on_hand - b.qty_reserved) > 0
             ), 0)::float AS dept_avail,
             COALESCE(sum(b.qty_on_hand - b.qty_reserved) FILTER (
               WHERE wh.code = 'KHO-TONG'
                 AND loc.is_quarantine = false
                 AND COALESCE(lot.status, 'RELEASED') = 'RELEASED'
                 AND (b.qty_on_hand - b.qty_reserved) > 0
             ), 0)::float AS hub_avail
           FROM inv.stock_balance b
           JOIN master.location loc ON loc.id = b.location_id
           JOIN master.warehouse wh ON wh.id = loc.warehouse_id
           LEFT JOIN inv.lot lot ON lot.id = b.lot_id
          WHERE b.item_id = $1 AND b.qty_on_hand > 0`,
          [itemId, deptWh?.id ?? null]
        )
      ).rows[0];

      deptAvail = Number(stockRow?.dept_avail ?? 0);
      hubAvail = Number(stockRow?.hub_avail ?? 0);

      const prRow = (
        await tx.query(
          `SELECT COALESCE(sum(prl.qty - prl.qty_ordered), 0)::float AS open_pr
             FROM purchase.purchase_request_line prl
             JOIN purchase.purchase_request pr ON pr.id = prl.pr_id
            WHERE prl.item_id = $1
              AND pr.status IN ('DRAFT', 'SUBMITTED', 'PENDING_BOD', 'APPROVED')
              AND prl.qty > prl.qty_ordered`,
          [itemId]
        )
      ).rows[0];

      const poRow = (
        await tx.query(
          `SELECT COALESCE(sum(pol.qty_ordered - pol.qty_received), 0)::float AS open_po
             FROM purchase.purchase_order_line pol
             JOIN purchase.purchase_order po ON po.id = pol.po_id
            WHERE pol.item_id = $1
              AND po.status IN ('DRAFT', 'ISSUED', 'PARTIALLY_RECEIVED')
              AND pol.qty_ordered > pol.qty_received`,
          [itemId]
        )
      ).rows[0];

      openPrPo = Number(prRow?.open_pr ?? 0) + Number(poRow?.open_po ?? 0);
    }

    const totalAvail = Number((deptAvail + hubAvail).toFixed(4));
    const netShortage = Math.max(0, Number((entry.gross_required_qty - totalAvail - openPrPo).toFixed(4)));

    components.push({
      component_item_id: itemId,
      component_code: entry.component_code,
      component_name: entry.component_name,
      uom: entry.uom,
      source_type: entry.source_type,
      used_by_products: Array.from(entry.used_by_products),
      gross_required_qty: entry.gross_required_qty,
      dept_available_qty: deptAvail,
      hub_available_qty: hubAvail,
      total_available_qty: totalAvail,
      open_pr_po_qty: Number(openPrPo.toFixed(4)),
      net_shortage_qty: netShortage,
      est_unit_price: entry.est_unit_price,
    });
  }

  // Sắp xếp: Ưu tiên hiển thị các vật tư đang THIẾU (`net_shortage_qty > 0`) lên đầu
  components.sort((a, b) => b.net_shortage_qty - a.net_shortage_qty || a.component_code.localeCompare(b.component_code));

  const linkedPrs = (
    await tx.query(
      `SELECT id, code, status, priority, needed_by::text AS needed_by, reason, created_at
         FROM purchase.purchase_request
        WHERE (purpose_entity_type = 'INTERNAL_ORDER' AND purpose_entity_id = $1)
           OR reason ILIKE '%' || $2 || '%'
        ORDER BY created_at DESC`,
      [order.id, order.kd_po_code]
    )
  ).rows;

  return {
    order_id: order.id,
    order_code: order.code,
    kd_po_code: order.kd_po_code,
    org_unit_code: order.org_unit_code,
    org_unit_name: order.org_unit_name,
    module_key: moduleKey,
    department_warehouse_code: deptWh?.code ?? "KHO-TONG",
    components,
    shortage_count: components.filter((c) => c.net_shortage_qty > 0).length,
    linked_prs: linkedPrs,
  };
}

const createPrFromOrderMrpSchema = z.object({
  order_id: z.string().uuid(),
  mode: z.enum(["SHORTAGE_ONLY", "FULL_GROSS"]).default("SHORTAGE_ONLY"),
  safety_buffer_pct: z.coerce.number().min(0).max(100).default(0),
});

/**
 * 1-Click Phát hành Phiếu Đề nghị Mua hàng (`purchase.purchase_request` / `PR...`)
 * từ Bảng Nổ BOM & Dự trù Nguyên liệu (MRP) của Đơn Nội Bộ / Forecast Quý chuyển thẳng sang `Cung Ứng NVL`.
 */
export async function createPrFromOrderMrp(tx: Tx, actor: AuthzActor, input: unknown) {
  await authorizeAnywhere(tx, actor, "intake.order.view");
  const d = parseInput(createPrFromOrderMrpSchema, input);

  const mrp = await getInternalOrderForecastMrp(tx, actor, d.order_id);
  const order = (await tx.query("SELECT * FROM intake.internal_order WHERE id = $1", [d.order_id])).rows[0];
  if (!order) throw notFound("Đơn nội bộ / Forecast");

  const targetWh =
    (
      await tx.query(
        "SELECT id, code FROM master.warehouse WHERE owner_org_unit_id = $1 AND status = 'ACTIVE' ORDER BY code LIMIT 1",
        [order.org_unit_id]
      )
    ).rows[0] ??
    (await tx.query("SELECT id, code FROM master.warehouse WHERE code = 'KHO-TONG' AND status = 'ACTIVE' LIMIT 1")).rows[0];
  if (!targetWh) throw invalid("Không tìm thấy kho nhận để lập PR dự trù nguyên liệu.");

  const bufferMultiplier = 1 + d.safety_buffer_pct / 100;
  const targetLines = mrp.components
    .map((c) => {
      const baseQty = d.mode === "SHORTAGE_ONLY" ? c.net_shortage_qty : c.gross_required_qty;
      return {
        ...c,
        request_qty: Number((baseQty * bufferMultiplier).toFixed(4)),
      };
    })
    .filter((c) => c.request_qty > 0);

  // Nếu chọn SHORTAGE_ONLY nhưng tất cả vật tư đều đủ tồn kho, fallback lấy toàn bộ nhu cầu Gross để dự trù bù tồn kho Quý
  const finalLines =
    targetLines.length > 0
      ? targetLines
      : mrp.components.map((c) => ({
          ...c,
          request_qty: Number((c.gross_required_qty * bufferMultiplier).toFixed(4)),
        })).filter((c) => c.request_qty > 0);

  if (finalLines.length === 0) {
    throw invalid("Chưa có dòng nguyên vật liệu nào sau khi nổ BOM để tạo PR dự trù mua hàng.");
  }

  const resolvedPrLines: Array<{ item_id: string; qty: number; uom: string; est_price: number; notes: string }> = [];

  for (const ln of finalLines) {
    let itemId = ln.component_item_id;
    if (!itemId) {
      const itemType = ln.source_type === "PACKAGING" ? "PACKAGING" : "RAW_CHEMICAL";
      const createdItem = (
        await tx.query(
          `INSERT INTO master.item (code, name, item_type, base_uom, is_purchasable, status)
           VALUES ($1, $2, $3, $4, true, 'ACTIVE')
           ON CONFLICT (code) DO UPDATE SET is_purchasable = true, status = 'ACTIVE'
           RETURNING id`,
          [ln.component_code, ln.component_name, itemType, ln.uom || "Hộp"]
        )
      ).rows[0];
      itemId = createdItem.id;
    } else {
      await tx.query("UPDATE master.item SET is_purchasable = true WHERE id = $1", [itemId]);
    }

    resolvedPrLines.push({
      item_id: itemId!,
      qty: ln.request_qty,
      uom: ln.uom || "Hộp",
      est_price: ln.est_unit_price || 180000,
      notes: `Dự trù NVL theo ${order.kd_po_code} (Phục vụ: ${ln.used_by_products.join(", ")})`,
    });
  }

  const pr = await createRequest(tx, actor, {
    org_unit_id: order.org_unit_id,
    target_warehouse_id: targetWh.id,
    needed_by: order.committed_date || order.requested_date || addDays(vnToday(), 14),
    reason: `[Dự trù NVL Forecast / Đơn ${order.kd_po_code}] Nổ BOM tại ${mrp.org_unit_name} (${resolvedPrLines.length} mã vật tư)`,
    purpose_entity_type: "INTERNAL_ORDER",
    purpose_entity_id: order.id,
    lines: resolvedPrLines,
  });

  await tx.query("UPDATE purchase.purchase_request SET status = 'SUBMITTED', priority = 'HIGH', version = version + 1 WHERE id = $1", [
    pr.id,
  ]);

  return {
    pr_id: pr.id,
    pr_code: pr.code,
    line_count: resolvedPrLines.length,
    warehouse_code: targetWh.code,
    message: `Đã phát hành Phiếu Đề nghị Mua hàng ${pr.code} (${resolvedPrLines.length} dòng vật tư) từ ${mrp.org_unit_name} sang Phòng Cung ứng NVL.`,
  };
}
