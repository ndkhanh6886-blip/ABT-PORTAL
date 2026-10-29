import type { Tx } from "../core/db";
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

async function assertUom(tx: Tx, code: string) {
  const r = await tx.query("SELECT 1 FROM master.uom WHERE code = $1 AND status = 'ACTIVE'", [code]);
  if (!r.rowCount) throw invalid(`Đơn vị tính "${code}" không có trong danh mục.`);
}

export async function createItem(tx: Tx, actor: AuthzActor, input: unknown): Promise<Item> {
  await authorize(tx, actor, "master.item.manage");
  const data = parseInput(createItemSchema, input);
  await assertUom(tx, data.base_uom);
  if (data.tracking === "SERIAL" && data.base_uom !== "pcs") throw invalid("Vật tư quản lý theo serial phải có đơn vị gốc là 'pcs' (cái).");
  const code = data.code ?? (await nextNumber(tx, "ITEM"));
  const dup = await tx.query("SELECT 1 FROM master.item WHERE code = $1", [code]);
  if (dup.rowCount) throw conflict(`Mã vật tư ${code} đã tồn tại.`, "DUPLICATE_CODE");
  return insertRecord<Item>(tx, actor, "master.item", "item", { ...data, code });
}

export async function updateItem(tx: Tx, actor: AuthzActor, id: string, input: unknown): Promise<Item> {
  await authorize(tx, actor, "master.item.manage");
  const { version, reason, ...patch } = parseInput(updateItemSchema, input);
  const current = (await tx.query("SELECT base_uom, tracking FROM master.item WHERE id = $1", [id])).rows[0];
  if (!current) throw notFound("vật tư");
  const changesStockKey = (patch.base_uom && patch.base_uom !== current.base_uom) || (patch.tracking && patch.tracking !== current.tracking);
  if (changesStockKey) {
    const used = await tx.query("SELECT 1 FROM inv.stock_ledger WHERE item_id = $1 LIMIT 1", [id]);
    if (used.rowCount) throw invalid("Vật tư đã phát sinh tồn kho: không được đổi đơn vị gốc hoặc cách quản lý lô/serial. Hãy tạo mã vật tư mới.");
    if (patch.base_uom) await assertUom(tx, patch.base_uom);
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
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = Number((await tx.query(`SELECT count(*) FROM master.item i ${whereSql}`, params)).rows[0].count);
  params.push(q.page_size, (q.page - 1) * q.page_size);
  const rows = (
    await tx.query(
      `SELECT i.*, c.name AS category_name FROM master.item i LEFT JOIN master.item_category c ON c.id = i.category_id
       ${whereSql} ORDER BY i.code LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    )
  ).rows;
  return { rows, total, page: q.page, page_size: q.page_size };
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
  await assertUom(tx, data.from_uom);
  await assertUom(tx, data.to_uom);
  await tx.query(
    `INSERT INTO master.uom_conversion (from_uom, to_uom, factor, item_id) VALUES ($1, $2, $3, $4)
     ON CONFLICT (from_uom, to_uom, item_id) DO UPDATE SET factor = EXCLUDED.factor`,
    [data.from_uom, data.to_uom, data.factor, data.item_id ?? null]
  );
}

/**
 * Quantity in the item's base unit. Item-specific conversions win over general ones; the reverse
 * direction of a declared conversion is used too. Unknown pairs are refused, never guessed.
 */
export async function toBaseQty(tx: Tx, item: Pick<Item, "id" | "base_uom" | "code">, qty: number, uom: string): Promise<number> {
  if (uom === item.base_uom) return qty;
  const res = await tx.query(
    `SELECT from_uom, factor FROM master.uom_conversion
      WHERE ((from_uom = $1 AND to_uom = $2) OR (from_uom = $2 AND to_uom = $1)) AND (item_id = $3 OR item_id IS NULL)
      ORDER BY (item_id IS NULL), (from_uom = $1) DESC LIMIT 1`,
    [uom, item.base_uom, item.id]
  );
  const conv = res.rows[0];
  if (!conv) throw invalid(`Chưa khai báo quy đổi từ ${uom} sang ${item.base_uom} cho vật tư ${item.code}.`, undefined, "NO_UOM_CONVERSION");
  const factor = Number(conv.factor);
  return conv.from_uom === uom ? qty * factor : qty / factor;
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
