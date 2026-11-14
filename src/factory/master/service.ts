import type { Tx } from "../core/db";
import { writeAudit } from "../core/audit";
import { authorize, type AuthzActor } from "../core/authz";
import { conflict, invalid, notFound } from "../core/errors";
import { nextNumber } from "../core/numbering";
import { insertRecord, parseInput, updateRecord } from "../core/records";
import {
  conversionSchema,
  createCategorySchema,
  createItemSchema,
  createLocationSchema,
  createPartnerSchema,
  createWarehouseSchema,
  listQuerySchema,
  updateItemSchema,
} from "./schemas";
import "./permissions";

export interface Item {
  id: string;
  code: string;
  name: string;
  item_type: string;
  base_uom: string;
  tracking: "NONE" | "LOT" | "SERIAL";
  shelf_life_days: number | null;
  open_shelf_life_days: number | null;
  receipt_qc_required: boolean;
  status: string;
  version: number;
}

const BUILTIN_METRIC_UOMS = new Set(["kg", "g", "mg", "\u00b5g", "L", "mL", "\u00b5L", "mol", "\u00b5mol", "nmol"]);

const UOM_ALIAS_MAP: Record<string, string> = {
  ul: "\u00b5L",
  "\u00b5l": "\u00b5L",
  "\u03bcl": "\u00b5L", // Greek mu + l
  mcl: "\u00b5L",
  microlit: "\u00b5L",
  microliter: "\u00b5L",
  ml: "mL",
  mililit: "mL",
  l: "L",
  lit: "L",
  "l\u00edt": "L",
  ug: "\u00b5g",
  "\u00b5g": "\u00b5g",
  "\u03bcg": "\u00b5g", // Greek mu + g
  mcg: "\u00b5g",
  mg: "mg",
  g: "g",
  gam: "g",
  gram: "g",
  kg: "kg",
  umol: "\u00b5mol",
  "\u00b5mol": "\u00b5mol",
  "\u03bcmol": "\u00b5mol",
  nmol: "nmol",
  mol: "mol",
  od: "OD",
  od260: "OD",
  "\u1ed1ng": "tube",
  ong: "tube",
  "l\u1ecd": "vial",
  lo: "vial",
  chai: "bottle",
  "c\u00e1i": "pcs",
  cai: "pcs",
  "h\u1ed9p": "box",
  hop: "box",
  "b\u1ed9": "set",
  bo: "set",
  "\u0111\u0129a": "plate",
  dia: "plate",
};

/** Returns true when a raw unit string is empty or a placeholder dash/N/A imported from Excel. */
export function isPlaceholderUom(raw: string | null | undefined): boolean {
  const s = String(raw ?? "").trim();
  if (!s) return true;
  return /^([-\u2013\u2014]+|n\/?a|none|null|\?)$/i.test(s);
}

/** Normalizes ASCII/Greek-mu/Vietnamese unit aliases (e.g. uL, μL -> µL) to canonical codes. */
export function normalizeUomAlias(raw: string): string {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return "";
  return UOM_ALIAS_MAP[trimmed.toLowerCase()] ?? trimmed;
}

async function assertUom(tx: Tx, code: string): Promise<string> {
  if (isPlaceholderUom(code)) {
    throw invalid('Đơn vị tính không hợp lệ (đang để trống hoặc dấu "-"). Hãy chọn đơn vị chuẩn như mL, µL, g, tube, pcs...');
  }
  const normalized = normalizeUomAlias(code);
  const r = await tx.query(
    `SELECT code FROM master.uom
      WHERE (lower(code) = lower($1) OR lower(code) = lower($2)) AND status = 'ACTIVE'
      ORDER BY (code = $1) DESC, (code = $2) DESC
      LIMIT 1`,
    [normalized, code.trim()]
  );
  if (!r.rowCount) throw invalid(`Đơn vị tính "${code}" không có trong danh mục.`);
  return r.rows[0].code as string;
}

export async function createItem(tx: Tx, actor: AuthzActor, input: unknown): Promise<Item> {
  await authorize(tx, actor, "master.item.manage");
  const data = parseInput(createItemSchema, input);
  const canonicalUom = await assertUom(tx, data.base_uom);
  if (data.tracking === "SERIAL" && canonicalUom.toLowerCase() !== "pcs")
    throw invalid("Vật tư quản lý theo serial phải có đơn vị gốc là 'pcs' (cái).");
  const code = data.code ?? (await nextNumber(tx, "ITEM"));
  const dup = await tx.query("SELECT 1 FROM master.item WHERE code = $1", [code]);
  if (dup.rowCount) throw conflict(`Mã vật tư ${code} đã tồn tại.`, "DUPLICATE_CODE");
  return insertRecord<Item>(tx, actor, "master.item", "item", { ...data, base_uom: canonicalUom, code });
}

async function rescaleItemStockForNewBaseUom(
  tx: Tx,
  actor: AuthzActor,
  item: { id: string; code: string; base_uom: string },
  newBaseUom: string,
  factor: number,
  reason: string
): Promise<void> {
  const activeRes = await tx.query("SELECT 1 FROM inv.reservation WHERE item_id = $1 AND status = 'ACTIVE' LIMIT 1", [item.id]);
  if (activeRes.rowCount) {
    throw invalid(
      `Vật tư ${item.code} đang có giữ chỗ (reservation) cho lệnh sản xuất/pha chế. Hãy giải phóng giữ chỗ trước hoặc giữ nguyên ĐVT gốc và khai báo quy đổi ĐVT.`
    );
  }
  const balances = (
    await tx.query(
      `SELECT b.id, b.lot_id, b.container_id, b.location_id, b.qty_on_hand::float AS qty_on_hand, loc.warehouse_id
         FROM inv.stock_balance b
         JOIN master.location loc ON loc.id = b.location_id
        WHERE b.item_id = $1 AND b.qty_on_hand > 0
        ORDER BY loc.warehouse_id, b.location_id, b.lot_id NULLS FIRST
        FOR UPDATE OF b`,
      [item.id]
    )
  ).rows as Array<{
    id: string;
    lot_id: string | null;
    container_id: string | null;
    location_id: string;
    qty_on_hand: number;
    warehouse_id: string;
  }>;

  const byWarehouse = new Map<string, Array<(typeof balances)[number] & { delta: number }>>();
  for (const b of balances) {
    const targetQty = Math.round(Number(b.qty_on_hand) * factor * 1e6) / 1e6;
    const delta = Math.round((targetQty - Number(b.qty_on_hand)) * 1e6) / 1e6;
    if (Math.abs(delta) <= 1e-9) continue;
    const arr = byWarehouse.get(b.warehouse_id) ?? [];
    arr.push({ ...b, delta });
    byWarehouse.set(b.warehouse_id, arr);
  }

  for (const [warehouseId, rows] of byWarehouse.entries()) {
    const docCode = await nextNumber(tx, "STOCK_ADJUST");
    const docId = (
      await tx.query(
        `INSERT INTO inv.stock_document
           (code, doc_type, reason_code, warehouse_id, source_entity_type, source_entity_id,
            status, posted_at, posted_by, notes, created_by, updated_by)
         VALUES ($1, 'ADJUSTMENT', 'UOM_REBASE', $2, 'ITEM', $3, 'POSTED', now(), $4, $5, $4, $4)
         RETURNING id`,
        [docCode, warehouseId, item.id, actor.userId, `Quy đổi ĐVT gốc ${item.code}: ${item.base_uom} → ${newBaseUom} (×${factor}). ${reason}`]
      )
    ).rows[0].id as string;

    let lineNo = 0;
    for (const r of rows) {
      const absDelta = Math.abs(r.delta);
      const lineId = (
        await tx.query(
          `INSERT INTO inv.stock_document_line
             (document_id, line_no, item_id, lot_id, container_id, from_location_id, to_location_id, qty, uom, qty_base)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $8)
           RETURNING id`,
          [
            docId,
            ++lineNo,
            item.id,
            r.lot_id,
            r.container_id,
            r.delta < 0 ? r.location_id : null,
            r.delta > 0 ? r.location_id : null,
            absDelta,
            newBaseUom,
          ]
        )
      ).rows[0].id as string;

      await tx.query("UPDATE inv.stock_balance SET qty_on_hand = qty_on_hand + $2::numeric, updated_at = now() WHERE id = $1", [r.id, r.delta]);
      await tx.query(
        `INSERT INTO inv.stock_ledger (document_line_id, item_id, lot_id, container_id, location_id, qty_delta_base)
         VALUES ($1, $2, $3, $4, $5, $6::numeric)`,
        [lineId, item.id, r.lot_id, r.container_id, r.location_id, r.delta]
      );
    }
  }

  await tx.query(
    `UPDATE inv.container
        SET initial_qty_base = GREATEST(0.000001, round(initial_qty_base * $2::numeric, 6)), updated_at = now(), updated_by = $3
      WHERE lot_id IN (SELECT id FROM inv.lot WHERE item_id = $1)`,
    [item.id, factor, actor.userId]
  );
}

export async function updateItem(tx: Tx, actor: AuthzActor, id: string, input: unknown): Promise<Item> {
  await authorize(tx, actor, "master.item.manage");
  const { version, reason, uom_change_mode, ...patch } = parseInput(updateItemSchema, input);
  const current = (await tx.query("SELECT id, code, base_uom, tracking FROM master.item WHERE id = $1", [id])).rows[0] as
    | { id: string; code: string; base_uom: string; tracking: string }
    | undefined;
  if (!current) throw notFound("vật tư");

  if (patch.base_uom !== undefined) {
    patch.base_uom = await assertUom(tx, patch.base_uom);
  }
  const effectiveTracking = patch.tracking ?? current.tracking;
  const effectiveBaseUom = patch.base_uom ?? current.base_uom;
  if (effectiveTracking === "SERIAL" && effectiveBaseUom.toLowerCase() !== "pcs") {
    throw invalid("Vật tư quản lý theo serial phải có đơn vị gốc là 'pcs' (cái).");
  }

  const baseUomChanged = Boolean(patch.base_uom && patch.base_uom !== current.base_uom);
  const trackingChanged = Boolean(patch.tracking && patch.tracking !== current.tracking);
  const used = baseUomChanged || trackingChanged ? await tx.query("SELECT 1 FROM inv.stock_ledger WHERE item_id = $1 LIMIT 1", [id]) : { rowCount: 0 };

  if ((used.rowCount ?? 0) > 0) {
    if (trackingChanged) {
      throw invalid("Vật tư đã phát sinh tồn kho: không được đổi đơn vị gốc hoặc cách quản lý lô/serial. Hãy tạo mã vật tư mới.");
    }
    if (baseUomChanged && patch.base_uom) {
      const requestedMode = uom_change_mode ?? "STRICT";
      const effectiveMode = requestedMode === "STRICT" && isPlaceholderUom(current.base_uom) ? "RELABEL_1_TO_1" : requestedMode;

      if (effectiveMode === "STRICT") {
        throw invalid("Vật tư đã phát sinh tồn kho: không được đổi đơn vị gốc hoặc cách quản lý lô/serial. Hãy tạo mã vật tư mới.");
      }

      if (effectiveMode === "RELABEL_1_TO_1") {
        if (!isPlaceholderUom(current.base_uom) && !reason?.trim()) {
          throw invalid("Vui lòng nhập lý do cập nhật nhãn ĐVT gốc để lưu nhật ký kiểm toán (Audit Trail).");
        }
        const auditReason = reason?.trim() || `Chuẩn hóa ĐVT gốc từ "${current.base_uom}" sang "${patch.base_uom}"`;
        const updated = await updateRecord<Item>(tx, actor, "master.item", "item", id, version, patch, auditReason);
        await tx.query(
          isPlaceholderUom(current.base_uom)
            ? "UPDATE inv.stock_document_line SET uom = $2 WHERE item_id = $1 AND uom = $3"
            : "UPDATE inv.stock_document_line SET uom = $2 WHERE item_id = $1 AND uom = $3 AND qty = qty_base",
          [id, patch.base_uom, current.base_uom]
        );
        return updated;
      }

      if (effectiveMode === "RESCALE_STOCK") {
        if (!reason?.trim()) {
          throw invalid("Vui lòng nhập lý do quy đổi ĐVT gốc & tồn kho để lưu nhật ký kiểm toán (Audit Trail).");
        }
        if (isPlaceholderUom(current.base_uom)) {
          throw invalid('ĐVT gốc hiện tại đang là "-" nên không có hệ số quy đổi. Hãy chọn chế độ "Cập nhật nhãn ĐVT gốc (giữ nguyên số lượng)".');
        }
        const factor = await toBaseQty(tx, { id: current.id, code: current.code, base_uom: patch.base_uom }, 1, current.base_uom);
        const updated = await updateRecord<Item>(tx, actor, "master.item", "item", id, version, patch, reason.trim());
        await rescaleItemStockForNewBaseUom(tx, actor, current, patch.base_uom, factor, reason.trim());
        return updated;
      }
    }
  }

  return updateRecord<Item>(tx, actor, "master.item", "item", id, version, patch, reason);
}

export async function listItems(tx: Tx, actor: AuthzActor, query: unknown) {
  await authorize(tx, actor, "master.data.view");
  const q = parseInput(listQuerySchema, query);
  const params: unknown[] = [];
  const where: string[] = [];
  if (q.status !== "ALL") {
    params.push(q.status);
    where.push(`i.status = $${params.length}`);
  }
  if (q.q) {
    params.push(`%${q.q}%`);
    where.push(`(i.code ILIKE $${params.length} OR i.name ILIKE $${params.length})`);
  }
  if (q.missing_uom === "1" || q.missing_uom === "true") {
    where.push(`(trim(i.base_uom) ~ '^[-\u2013\u2014]+$' OR upper(trim(i.base_uom)) IN ('N/A', 'NA', 'NONE', 'NULL', '?'))`);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = Number((await tx.query(`SELECT count(*) FROM master.item i ${whereSql}`, params)).rows[0].count);
  const missingUomCount = Number(
    (
      await tx.query(
        `SELECT count(*)::int AS cnt FROM master.item
          WHERE status = 'ACTIVE'
            AND (trim(base_uom) ~ '^[-\u2013\u2014]+$' OR upper(trim(base_uom)) IN ('N/A', 'NA', 'NONE', 'NULL', '?'))`
      )
    ).rows[0]?.cnt ?? 0
  );
  params.push(q.page_size, (q.page - 1) * q.page_size);
  const rows = (
    await tx.query(
      `SELECT i.*, c.name AS category_name,
              EXISTS (SELECT 1 FROM inv.stock_ledger sl WHERE sl.item_id = i.id) AS has_stock
         FROM master.item i
         LEFT JOIN master.item_category c ON c.id = i.category_id
        ${whereSql} ORDER BY i.code LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    )
  ).rows;
  return { rows, total, page: q.page, page_size: q.page_size, missing_uom_count: missingUomCount };
}

export async function getItem(tx: Tx, id: string): Promise<Item> {
  const row = (await tx.query("SELECT * FROM master.item WHERE id = $1", [id])).rows[0];
  if (!row) throw notFound("vật tư");
  return row;
}

export async function createCategory(tx: Tx, actor: AuthzActor, input: unknown) {
  await authorize(tx, actor, "master.item.manage");
  const data = parseInput(createCategorySchema, input);
  return insertRecord(tx, actor, "master.item_category", "item_category", data);
}

export async function setConversion(tx: Tx, actor: AuthzActor, input: unknown) {
  await authorize(tx, actor, "master.item.manage");
  const data = parseInput(conversionSchema, input);
  const fromUom = await assertUom(tx, data.from_uom);
  const toUom = await assertUom(tx, data.to_uom);
  if (fromUom.toLowerCase() === toUom.toLowerCase()) {
    throw invalid("Hai đơn vị quy đổi phải khác nhau.");
  }
  const itemId = data.item_id ?? null;
  if (itemId) await getItem(tx, itemId);

  const isBuiltinPair = !itemId && BUILTIN_METRIC_UOMS.has(fromUom) && BUILTIN_METRIC_UOMS.has(toUom);
  if (!isBuiltinPair) {
    await tx.query(
      `DELETE FROM master.uom_conversion
        WHERE lower(from_uom) = lower($2) AND lower(to_uom) = lower($1) AND item_id IS NOT DISTINCT FROM $3`,
      [fromUom, toUom, itemId]
    );
  }
  const saved = (
    await tx.query(
      `INSERT INTO master.uom_conversion (from_uom, to_uom, factor, item_id) VALUES ($1, $2, $3, $4)
       ON CONFLICT (from_uom, to_uom, item_id) DO UPDATE SET factor = EXCLUDED.factor
       RETURNING id, from_uom, to_uom, factor::float AS factor, item_id`,
      [fromUom, toUom, data.factor, itemId]
    )
  ).rows[0];
  await writeAudit(tx, actor, {
    entityType: "uom_conversion",
    entityId: saved.id as string,
    action: "upsert",
    changes: {
      from_uom: [null, fromUom],
      to_uom: [null, toUom],
      factor: [null, data.factor],
      item_id: [null, itemId],
    },
  });
  return saved;
}

export async function listConversions(tx: Tx, actor: AuthzActor, query?: { item_id?: string; q?: string }) {
  await authorize(tx, actor, "master.data.view");
  const params: unknown[] = [];
  const where: string[] = [];
  if (query?.item_id) {
    params.push(query.item_id);
    where.push(`(uc.item_id = $${params.length} OR uc.item_id IS NULL)`);
  }
  if (query?.q?.trim()) {
    params.push(`%${query.q.trim()}%`);
    where.push(`(i.code ILIKE $${params.length} OR i.name ILIKE $${params.length} OR uc.from_uom ILIKE $${params.length} OR uc.to_uom ILIKE $${params.length})`);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const rows = (
    await tx.query(
      `SELECT uc.id, uc.from_uom, uc.to_uom, uc.factor::float AS factor, uc.item_id,
              i.code AS item_code, i.name AS item_name, i.base_uom AS item_base_uom
         FROM master.uom_conversion uc
         LEFT JOIN master.item i ON i.id = uc.item_id
         ${whereSql}
        ORDER BY (uc.item_id IS NULL) ASC, i.code NULLS LAST, uc.from_uom, uc.to_uom`,
      params
    )
  ).rows;
  return rows.map((r) => ({
    ...r,
    is_builtin_metric: !r.item_id && BUILTIN_METRIC_UOMS.has(r.from_uom) && BUILTIN_METRIC_UOMS.has(r.to_uom),
  }));
}

export async function deleteConversion(tx: Tx, actor: AuthzActor, id: string) {
  await authorize(tx, actor, "master.item.manage");
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) throw invalid("Thiếu ID quy tắc quy đổi.");
  const row = (await tx.query("SELECT id, from_uom, to_uom, factor, item_id FROM master.uom_conversion WHERE id = $1", [id])).rows[0];
  if (!row) throw notFound("quy tắc quy đổi");
  if (!row.item_id && BUILTIN_METRIC_UOMS.has(row.from_uom) && BUILTIN_METRIC_UOMS.has(row.to_uom)) {
    throw invalid("Không được xóa quy tắc quy đổi hệ mét chuẩn của hệ thống.");
  }
  await tx.query("DELETE FROM master.uom_conversion WHERE id = $1", [id]);
  await writeAudit(tx, actor, {
    entityType: "uom_conversion",
    entityId: id,
    action: "delete",
    changes: { from_uom: [row.from_uom, null], to_uom: [row.to_uom, null], factor: [Number(row.factor), null] },
  });
}

/**
 * Quantity in the item's base unit. Item-specific conversions win over general ones; the reverse
 * direction of a declared conversion is used too, plus a safe 2-hop metric bridge (e.g. mL -> µL -> tube).
 * Unknown pairs are refused, never guessed.
 */
export async function toBaseQty(tx: Tx, item: Pick<Item, "id" | "base_uom" | "code">, qty: number, uom: string): Promise<number> {
  if (isPlaceholderUom(item.base_uom)) {
    throw invalid(
      `Chưa khai báo quy đổi từ ${uom} sang ${item.base_uom} cho vật tư ${item.code} (vật tư đang thiếu ĐVT gốc trong Kho — vào Kho Nhà Máy → 4. Danh mục vật tư để chọn ĐVT gốc như mL, µL, tube...).`,
      undefined,
      "NO_UOM_CONVERSION"
    );
  }
  const uNorm = normalizeUomAlias(uom);
  const bNorm = normalizeUomAlias(item.base_uom);
  if (uNorm.toLowerCase() === bNorm.toLowerCase() || uom.trim().toLowerCase() === item.base_uom.trim().toLowerCase()) {
    return qty;
  }

  const res = await tx.query(
    `SELECT from_uom, to_uom, factor::float AS factor FROM master.uom_conversion
      WHERE (
        ((lower(from_uom) = lower($1) OR lower(from_uom) = lower($4)) AND (lower(to_uom) = lower($2) OR lower(to_uom) = lower($5)))
        OR
        ((lower(from_uom) = lower($2) OR lower(from_uom) = lower($5)) AND (lower(to_uom) = lower($1) OR lower(to_uom) = lower($4)))
      )
        AND (item_id = $3 OR item_id IS NULL)
      ORDER BY (item_id IS NULL), (lower(from_uom) = lower($1) OR lower(from_uom) = lower($4)) DESC LIMIT 1`,
    [uNorm, bNorm, item.id, uom.trim(), item.base_uom.trim()]
  );
  const conv = res.rows[0];
  if (conv) {
    const factor = Number(conv.factor);
    const matchesFrom = conv.from_uom.toLowerCase() === uNorm.toLowerCase() || conv.from_uom.toLowerCase() === uom.trim().toLowerCase();
    return matchesFrom ? qty * factor : qty / factor;
  }

  // 2-hop transitive lookup (e.g., mL -> µL -> tube when 1 tube = 500 µL)
  const allRows = (
    await tx.query(
      `SELECT from_uom, to_uom, factor::float AS factor, (item_id IS NULL) AS is_global
         FROM master.uom_conversion
        WHERE item_id = $1 OR item_id IS NULL
        ORDER BY (item_id IS NULL) ASC`,
      [item.id]
    )
  ).rows as Array<{ from_uom: string; to_uom: string; factor: number; is_global: boolean }>;

  const edges = new Map<string, Array<{ next: string; factor: number }>>();
  const seenPair = new Set<string>();
  const addEdge = (a: string, b: string, f: number) => {
    const keyA = normalizeUomAlias(a).toLowerCase();
    const keyB = normalizeUomAlias(b).toLowerCase();
    const pairKey = `${keyA}->${keyB}`;
    if (seenPair.has(pairKey)) return;
    seenPair.add(pairKey);
    const list = edges.get(keyA) ?? [];
    list.push({ next: keyB, factor: f });
    edges.set(keyA, list);
  };
  for (const r of allRows) {
    const f = Number(r.factor);
    if (!(f > 0)) continue;
    addEdge(r.from_uom, r.to_uom, f);
    addEdge(r.to_uom, r.from_uom, 1 / f);
  }
  const startKey = uNorm.toLowerCase();
  const targetKey = bNorm.toLowerCase();
  for (const hop1 of edges.get(startKey) ?? []) {
    if (hop1.next === targetKey) return qty * hop1.factor;
    for (const hop2 of edges.get(hop1.next) ?? []) {
      if (hop2.next === targetKey) {
        return qty * hop1.factor * hop2.factor;
      }
    }
  }

  throw invalid(
    `Chưa khai báo quy đổi từ ${uom} sang ${item.base_uom} cho vật tư ${item.code} (vào Kho Nhà Máy → 4. Danh mục vật tư → Bảng Quy đổi ĐVT để khai báo).`,
    undefined,
    "NO_UOM_CONVERSION"
  );
}

export async function createPartner(tx: Tx, actor: AuthzActor, input: unknown) {
  await authorize(tx, actor, "master.partner.manage");
  const data = parseInput(createPartnerSchema, input);
  if (data.tax_code) {
    const dup = await tx.query("SELECT code FROM master.partner WHERE tax_code = $1", [data.tax_code]);
    if (dup.rowCount) throw conflict(`Mã số thuế ${data.tax_code} đã thuộc đối tác ${dup.rows[0].code}.`, "DUPLICATE_TAX_CODE");
  }
  const code = data.code ?? (await nextNumber(tx, "PARTNER"));
  return insertRecord(tx, actor, "master.partner", "partner", { ...data, code });
}

export async function createWarehouse(tx: Tx, actor: AuthzActor, input: unknown) {
  await authorize(tx, actor, "master.warehouse.manage");
  const data = parseInput(createWarehouseSchema, input);
  const ou = await tx.query("SELECT 1 FROM core.org_unit WHERE id = $1 AND status = 'ACTIVE'", [data.owner_org_unit_id]);
  if (!ou.rowCount) throw invalid("Phòng sở hữu kho không tồn tại hoặc đã ngừng hoạt động.");
  return insertRecord(tx, actor, "master.warehouse", "warehouse", data);
}

export async function createLocation(tx: Tx, actor: AuthzActor, input: unknown) {
  await authorize(tx, actor, "master.warehouse.manage");
  const data = parseInput(createLocationSchema, input);
  if (data.parent_id) {
    const parent = (await tx.query("SELECT warehouse_id FROM master.location WHERE id = $1", [data.parent_id])).rows[0];
    if (!parent || parent.warehouse_id !== data.warehouse_id) throw invalid("Vị trí cha phải thuộc cùng kho.");
  }
  return insertRecord(tx, actor, "master.location", "location", data);
}

export async function listPartners(tx: Tx, actor: AuthzActor, query: { q?: string; role?: string }) {
  await authorize(tx, actor, "master.data.view").catch(async () => authorize(tx, actor, "master.partner.manage"));
  const role = ["supplier", "customer", "subcontractor"].includes(query.role ?? "") ? `is_${query.role}` : null;
  return (
    await tx.query(
      `SELECT id, code, name, tax_code, is_supplier, is_customer, is_subcontractor, is_internal, address, payment_terms, status
         FROM master.partner
        WHERE status = 'ACTIVE' ${role ? `AND ${role}` : ""} AND ($1 = '' OR code ILIKE '%' || $1 || '%' OR name ILIKE '%' || $1 || '%' OR tax_code ILIKE '%' || $1 || '%')
        ORDER BY name LIMIT 300`,
      [(query.q ?? "").trim().slice(0, 100)]
    )
  ).rows;
}
