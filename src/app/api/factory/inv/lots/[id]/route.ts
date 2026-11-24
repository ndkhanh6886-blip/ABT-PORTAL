import { z } from "zod/v3";
import { allowedActionsFor, factoryRoute } from "@/factory/http";
import { hasFactoryPermission } from "@/factory/core/authz";
import { diffChanges, writeAudit } from "@/factory/core/audit";
import { conflict, forbidden, invalid, notFound } from "@/factory/core/errors";
import { parseInput } from "@/factory/core/records";
import { runTransition } from "@/factory/core/stateMachine";
import { createStockDocument, stockDocumentMachine } from "@/factory/inv/documents";
import { lotMachine } from "@/factory/inv/lots";
import { viewableWarehouses } from "@/factory/inv/queries";

import { todayVN } from "@/backend/services/dates";
/** A lot with the quality actions the user may run now and its QC history. */
export const GET = factoryRoute(async (tx, { actor, params }) => {
  const lot = (
    await tx.query(
      `SELECT l.*,
              l.expiry_date::text AS expiry_date,
              l.mfg_date::text AS mfg_date,
              l.received_date::text AS received_date,
              i.code AS item_code,
              i.name AS item_name,
              i.item_type,
              i.base_uom,
              i.version AS item_version
         FROM inv.lot l
         JOIN master.item i ON i.id = l.item_id
        WHERE l.id = $1`,
      [params.id]
    )
  ).rows[0];
  if (!lot) throw notFound("lô");
  // QA/QC (company-wide) see every lot; others only lots held in a warehouse they may view
  if (!(await hasFactoryPermission(tx, actor, "qms.qc.view"))) {
    const allowed = (await viewableWarehouses(tx, actor)).map((w) => w.id);
    const visible = await tx.query(
      `SELECT 1 FROM inv.stock_balance b JOIN master.location loc ON loc.id = b.location_id
        WHERE b.lot_id = $1 AND loc.warehouse_id = ANY($2::uuid[]) LIMIT 1`,
      [params.id, allowed]
    );
    if (!visible.rowCount) throw forbidden("Bạn không có quyền xem lô này.");
  }
  const tests = (
    await tx.query(
      "SELECT id, code, test_kind, status, overall_result, created_at, reviewed_at FROM qms.qc_test WHERE entity_type = 'LOT' AND entity_id = $1 ORDER BY created_at DESC",
      [params.id]
    )
  ).rows;
  const balances = (
    await tx.query(
      `SELECT b.location_id, loc.code AS location_code, loc.is_quarantine, w.id AS warehouse_id, w.code AS warehouse_code,
              b.qty_on_hand::text AS qty_on_hand, b.qty_reserved::text AS qty_reserved
         FROM inv.stock_balance b JOIN master.location loc ON loc.id = b.location_id JOIN master.warehouse w ON w.id = loc.warehouse_id
        WHERE b.lot_id = $1 AND b.qty_on_hand >= 0
        ORDER BY (b.qty_on_hand > 0) DESC, w.code, loc.code`,
      [params.id]
    )
  ).rows;
  const movements = (
    await tx.query(
      `SELECT l.id AS line_id,
              d.id AS document_id, d.code AS document_code, d.doc_type, d.reason_code, d.notes,
              COALESCE(d.posted_at, d.created_at) AS occurred_at,
              up.display_name AS performed_by_name,
              fw.code AS from_wh_code, fl.code AS from_loc_code,
              tw.code AS to_wh_code, tl.code AS to_loc_code,
              l.qty::float AS qty, l.uom
         FROM inv.stock_document_line l
         JOIN inv.stock_document d ON d.id = l.document_id AND d.status = 'POSTED'
         LEFT JOIN master.location fl ON fl.id = l.from_location_id
         LEFT JOIN master.warehouse fw ON fw.id = fl.warehouse_id
         LEFT JOIN master.location tl ON tl.id = l.to_location_id
         LEFT JOIN master.warehouse tw ON tw.id = tl.warehouse_id
         LEFT JOIN core.user_profile up ON up.user_id = COALESCE(d.posted_by, d.created_by)
        WHERE l.lot_id = $1
        ORDER BY COALESCE(d.posted_at, d.created_at) DESC, d.code DESC`,
      [params.id]
    )
  ).rows;
  return { ...lot, qc_tests: tests, balances, movements, actions: await allowedActionsFor(tx, lotMachine, actor, lot) };
});

const patchLotBasicSchema = z.object({
  code: z.string().trim().min(1, "Mã lô không được để trống").max(80).optional(),
  mfr_lot_no: z.string().trim().max(120).optional().nullable(),
  mfg_date: z.string().trim().optional().nullable(),
  expiry_date: z.string().trim().optional().nullable(),
  received_date: z.string().trim().optional().nullable(),
  item_name: z.string().trim().min(1, "Tên vật tư không được để trống").max(250).optional(),
  item_type: z
    .enum(["RAW_MATERIAL", "REAGENT", "CONSUMABLE", "COMPONENT", "SPARE_PART", "SEMI_FINISHED", "FINISHED_KIT"])
    .optional(),
  base_uom: z.string().trim().min(1).max(32).optional(),
});

/**
 * Updates basic lot information (lot code, manufacturer lot, manufacturing/expiry/received dates)
 * and basic material metadata (item name, item classification, base UOM) directly from the warehouse row.
 */
export const PATCH = factoryRoute(async (tx, { actor, params, body }) => {
  const canEdit =
    (await hasFactoryPermission(tx, actor, "master.item.manage")) ||
    (await hasFactoryPermission(tx, actor, "inv.document.create")) ||
    (await hasFactoryPermission(tx, actor, "inv.document.post"));
  if (!canEdit) throw forbidden("Bạn không có quyền chỉnh sửa thông tin lô vật tư.");

  const lotBefore = (
    await tx.query(
      `SELECT l.*, i.code AS item_code, i.name AS item_name, i.item_type, i.base_uom
         FROM inv.lot l
         JOIN master.item i ON i.id = l.item_id
        WHERE l.id = $1
        FOR UPDATE`,
      [params.id]
    )
  ).rows[0];
  if (!lotBefore) throw notFound("lô");

  const data = parseInput(patchLotBasicSchema, body);
  const normDate = (d: string | null | undefined) => {
    if (d === undefined) return undefined;
    if (d === null || d.trim() === "") return null;
    const s = d.trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw invalid(`Định dạng ngày không hợp lệ (${d}), cần YYYY-MM-DD.`);
    return s;
  };

  const nextCode = data.code !== undefined ? data.code.trim() : lotBefore.code;
  const nextMfrLot =
    data.mfr_lot_no !== undefined ? (data.mfr_lot_no && data.mfr_lot_no.trim() ? data.mfr_lot_no.trim() : null) : lotBefore.mfr_lot_no;
  const nextMfgDate = data.mfg_date !== undefined ? normDate(data.mfg_date) : lotBefore.mfg_date;
  const nextExpDate = data.expiry_date !== undefined ? normDate(data.expiry_date) : lotBefore.expiry_date;
  const nextRecDate =
    data.received_date !== undefined
      ? normDate(data.received_date) || todayVN()
      : lotBefore.received_date;

  if (nextMfgDate && nextExpDate && nextExpDate < nextMfgDate) {
    throw invalid("Hạn dùng không được nhỏ hơn Ngày sản xuất.");
  }

  if (nextCode.toLowerCase() !== String(lotBefore.code).toLowerCase()) {
    const dup = await tx.query(
      "SELECT 1 FROM inv.lot WHERE item_id = $1 AND lower(code) = lower($2) AND id <> $3 LIMIT 1",
      [lotBefore.item_id, nextCode, lotBefore.id]
    );
    if (dup.rowCount) {
      throw conflict(`Vật tư ${lotBefore.item_code} đã có lô mang mã "${nextCode}".`);
    }
  }

  await tx.query(
    `UPDATE inv.lot
        SET code = $2,
            mfr_lot_no = $3,
            mfg_date = $4,
            expiry_date = $5,
            received_date = $6,
            version = version + 1,
            updated_at = now()
      WHERE id = $1`,
    [lotBefore.id, nextCode, nextMfrLot, nextMfgDate, nextExpDate, nextRecDate]
  );

  // Update master.item basic info if provided
  const nextItemName = data.item_name !== undefined ? data.item_name.trim() : lotBefore.item_name;
  const nextItemType = data.item_type !== undefined ? data.item_type : lotBefore.item_type;
  const nextBaseUom = data.base_uom !== undefined ? data.base_uom.trim() : lotBefore.base_uom;

  if (
    nextItemName !== lotBefore.item_name ||
    nextItemType !== lotBefore.item_type ||
    nextBaseUom !== lotBefore.base_uom
  ) {
    if (nextBaseUom !== lotBefore.base_uom) {
      await tx.query(
        `INSERT INTO master.uom (code, name) VALUES ($1, $1) ON CONFLICT (code) DO NOTHING`,
        [nextBaseUom]
      );
      await tx.query(
        `UPDATE inv.stock_document_line SET uom = $2 WHERE item_id = $1 AND uom = $3`,
        [lotBefore.item_id, nextBaseUom, lotBefore.base_uom]
      );
    }
    await tx.query(
      `UPDATE master.item
          SET name = $2,
              item_type = $3,
              base_uom = $4,
              version = version + 1,
              updated_by = $5,
              updated_at = now()
        WHERE id = $1`,
      [lotBefore.item_id, nextItemName, nextItemType, nextBaseUom, actor.userId]
    );
  }

  await writeAudit(tx, actor, {
    action: "UPDATE",
    entityType: "lot",
    entityId: lotBefore.id,
    reason: "Cập nhật thông tin cơ bản lô & vật tư tại kho",
    changes: diffChanges(
      {
        code: lotBefore.code,
        mfr_lot_no: lotBefore.mfr_lot_no,
        mfg_date: lotBefore.mfg_date,
        expiry_date: lotBefore.expiry_date,
        received_date: lotBefore.received_date,
        item_name: lotBefore.item_name,
        item_type: lotBefore.item_type,
        base_uom: lotBefore.base_uom,
      },
      {
        code: nextCode,
        mfr_lot_no: nextMfrLot,
        mfg_date: nextMfgDate,
        expiry_date: nextExpDate,
        received_date: nextRecDate,
        item_name: nextItemName,
        item_type: nextItemType,
        base_uom: nextBaseUom,
      },
      ["code", "mfr_lot_no", "mfg_date", "expiry_date", "received_date", "item_name", "item_type", "base_uom"]
    ),
  });

  return { ok: true, id: lotBefore.id, code: nextCode };
});

const lotStockOpSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("quick_issue"),
    location_id: z.string().uuid("Chọn vị trí xuất kho"),
    qty: z.coerce.number().positive("Số lượng xuất phải lớn hơn 0"),
    reason_code: z
      .enum(["PRODUCTION", "RND", "QC_SAMPLE", "SCRAP", "RETURN_TO_SUPPLIER", "OTHER"])
      .default("PRODUCTION"),
    notes: z.string().trim().max(1000).optional().nullable(),
  }),
  z.object({
    op: z.literal("quick_adjust"),
    location_id: z.string().uuid("Chọn vị trí cân đối tồn kho"),
    new_qty_on_hand: z.coerce.number().min(0, "Tồn thực tế mới không được âm"),
    reason_code: z.enum(["COUNT_DIFF", "DAMAGE", "OTHER"]).default("COUNT_DIFF"),
    notes: z.string().trim().max(1000).optional().nullable(),
  }),
]);

/**
 * Direct warehouse actions on a lot:
 * - `quick_issue`: Posts an ISSUE stock document from the selected location of this lot.
 * - `quick_adjust`: Reconciles physical stock balance of this lot at the selected location to `new_qty_on_hand`
 *   by posting an ADJUSTMENT stock document for the exact difference (+/-).
 */
export const POST = factoryRoute(async (tx, { actor, params, body }) => {
  const lot = (
    await tx.query(
      `SELECT l.*, i.code AS item_code, i.name AS item_name, i.base_uom
         FROM inv.lot l
         JOIN master.item i ON i.id = l.item_id
        WHERE l.id = $1
        FOR UPDATE`,
      [params.id]
    )
  ).rows[0];
  if (!lot) throw notFound("lô");

  const input = parseInput(lotStockOpSchema, body);
  const loc = (
    await tx.query(
      `SELECT loc.id, loc.code, loc.warehouse_id, loc.is_quarantine, w.code AS warehouse_code
         FROM master.location loc
         JOIN master.warehouse w ON w.id = loc.warehouse_id
        WHERE loc.id = $1`,
      [input.location_id]
    )
  ).rows[0];
  if (!loc) throw notFound("vị trí kho");

  const balRow = (
    await tx.query(
      `SELECT qty_on_hand::float AS qty_on_hand, qty_reserved::float AS qty_reserved
         FROM inv.stock_balance
        WHERE item_id = $1 AND lot_id = $2 AND location_id = $3 AND container_id IS NULL`,
      [lot.item_id, lot.id, loc.id]
    )
  ).rows[0];
  const currentOnHand = Number(balRow?.qty_on_hand ?? 0);
  const currentReserved = Number(balRow?.qty_reserved ?? 0);

  if (input.op === "quick_issue") {
    const qty = Math.round(input.qty * 1_000_000) / 1_000_000;
    const avail = Math.round((currentOnHand - currentReserved) * 1_000_000) / 1_000_000;
    if (qty > avail + 1e-9) {
      throw invalid(
        `Số lượng xuất (${qty} ${lot.base_uom}) vượt quá tồn khả dụng tại ${loc.warehouse_code}·${loc.code} (${avail} ${lot.base_uom}).`
      );
    }
    const defaultNote = `Xuất kho trực tiếp lô ${lot.code} (${lot.item_code}) tại ${loc.warehouse_code}·${loc.code}`;
    const doc = await createStockDocument(
      tx,
      actor,
      {
        doc_type: "ISSUE",
        reason_code: input.reason_code,
        warehouse_id: loc.warehouse_id,
        notes: input.notes?.trim() || defaultNote,
        lines: [
          {
            item_id: lot.item_id,
            lot_id: lot.id,
            from_location_id: loc.id,
            to_location_id: null,
            qty,
            uom: lot.base_uom,
          },
        ],
      },
      { trusted: true }
    );
    const posted = await runTransition(
      tx,
      stockDocumentMachine,
      actor,
      { id: doc.id, action: "post", expectedVersion: doc.version },
      { trusted: true }
    );
    return {
      ok: true,
      op: "quick_issue",
      document_id: posted.id,
      document_code: posted.code,
      issued_qty: qty,
      remaining_qty: Math.max(0, Math.round((currentOnHand - qty) * 1_000_000) / 1_000_000),
      uom: lot.base_uom,
    };
  }

  // input.op === "quick_adjust"
  const targetOnHand = Math.round(input.new_qty_on_hand * 1_000_000) / 1_000_000;
  if (targetOnHand + 1e-9 < currentReserved) {
    throw invalid(
      `Tồn thực tế mới (${targetOnHand} ${lot.base_uom}) không được nhỏ hơn lượng đang giữ chỗ (${currentReserved} ${lot.base_uom}).`
    );
  }
  const delta = Math.round((targetOnHand - currentOnHand) * 1_000_000) / 1_000_000;
  if (Math.abs(delta) < 1e-7) {
    throw invalid(`Tồn thực tế mới (${targetOnHand} ${lot.base_uom}) bằng tồn hiện tại (${currentOnHand} ${lot.base_uom}), không có chênh lệch để điều chỉnh.`);
  }
  const signLabel = delta > 0 ? `+${delta}` : `${delta}`;
  const defaultAdjustNote = `Cân đối tồn kho lô ${lot.code} (${lot.item_code}) tại ${loc.warehouse_code}·${loc.code}: ${currentOnHand} → ${targetOnHand} ${lot.base_uom} (${signLabel} ${lot.base_uom})`;
  const doc = await createStockDocument(
    tx,
    actor,
    {
      doc_type: "ADJUSTMENT",
      reason_code: input.reason_code,
      warehouse_id: loc.warehouse_id,
      notes: input.notes?.trim() ? `${input.notes.trim()} [${currentOnHand} → ${targetOnHand} ${lot.base_uom}]` : defaultAdjustNote,
      lines: [
        {
          item_id: lot.item_id,
          lot_id: lot.id,
          from_location_id: delta < 0 ? loc.id : null,
          to_location_id: delta > 0 ? loc.id : null,
          qty: Math.abs(delta),
          uom: lot.base_uom,
        },
      ],
    },
    { trusted: true }
  );
  const posted = await runTransition(
    tx,
    stockDocumentMachine,
    actor,
    { id: doc.id, action: "post", expectedVersion: doc.version },
    { trusted: true }
  );
  return {
    ok: true,
    op: "quick_adjust",
    document_id: posted.id,
    document_code: posted.code,
    previous_qty: currentOnHand,
    new_qty: targetOnHand,
    delta,
    uom: lot.base_uom,
  };
});
