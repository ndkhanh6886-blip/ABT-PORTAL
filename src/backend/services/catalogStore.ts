import type { PoolClient } from "pg";
import { query } from "@/backend/db/db";
import type { StoragePatch } from "@/backend/services/storagePatch";

/**
 * Danh mục hàng thương mại (khóa `sales_commercial_products` cũ) lưu mỗi mặt hàng một dòng trong bảng
 * `catalog_items`, thay cho một khối JSON chứa cả danh mục. Sửa một giá chỉ ghi một dòng (trước đây ghi lại
 * cả khối ~1 MB cho 3.000 mã), không còn xung đột phiên bản giữa người dùng.
 *
 * Phía trình duyệt vẫn đọc / ghi qua /api/storage với khóa cũ; API chuyển sang bảng này.
 */
export const CATALOG_KEY = "sales_commercial_products";

type Queryable = Pick<PoolClient, "query">;
const COST_FIELDS = ["cost_price", "costPrice", "unit_cost", "unitCost", "purchase_price", "purchasePrice"];

const cleanCode = (v: any) => String(v ?? "").trim();

/** Toàn bộ danh mục theo thứ tự hiển thị (mới thêm ở trên). */
export async function readCatalog(c?: Queryable): Promise<any[]> {
  const q = c ? c.query.bind(c) : query;
  const res = await q("SELECT data FROM catalog_items ORDER BY sort_order ASC, code ASC");
  return res.rows.map((r: any) => r.data);
}

/** Số phiên bản để trình duyệt nhận biết thay đổi (đổi mỗi khi có dòng được ghi). */
export async function catalogVersion(c?: Queryable): Promise<number> {
  const q = c ? c.query.bind(c) : query;
  const r = await q("SELECT COALESCE(EXTRACT(EPOCH FROM MAX(updated_at))::bigint, 0) AS v, COUNT(*)::int AS n FROM catalog_items");
  return Number(r.rows[0]?.v || 0) + Number(r.rows[0]?.n || 0);
}

/** Mã của mục theo định danh của bản vá ("code:X" hoặc "id:Y"). */
async function codesForIdentity(c: Queryable, ident: string): Promise<string[]> {
  const i = ident.indexOf(":");
  const field = ident.slice(0, i);
  const value = ident.slice(i + 1);
  if (field === "code") return [value];
  const r = await c.query("SELECT code FROM catalog_items WHERE data->>$1 = $2", [field, value]);
  return r.rows.map((x: any) => x.code);
}

/**
 * Ghi một bản vá danh mục: thêm / sửa từng mặt hàng, xóa các mặt hàng bị bỏ.
 * `keepCosts`: người không được xem giá vốn gửi lên mặt hàng không có giá vốn -> giữ giá vốn đang lưu.
 */
export async function applyCatalogPatch(c: Queryable, patch: StoragePatch, keepCosts: boolean): Promise<string[]> {
  if (patch.kind !== "array") throw new Error("Danh mục sản phẩm phải là danh sách");
  const byCode = new Map<string, any>();
  for (const item of patch.upserts || []) {
    const code = cleanCode(item?.code);
    if (code) byCode.set(code, { ...item, code });
  }
  const upserts = Array.from(byCode.values());
  if (upserts.length > 0) {
    // một câu lệnh cho cả lô; mục mới lên đầu danh sách (như trên trình duyệt), mục đã có giữ vị trí
    await c.query(
      `INSERT INTO catalog_items (code, data, sort_order, updated_at)
       SELECT e->>'code', e, $2::bigint + t.ord, now() FROM jsonb_array_elements($1::jsonb) WITH ORDINALITY AS t(e, ord)
       ON CONFLICT (code) DO UPDATE SET
         data = CASE WHEN $3::boolean
                     THEN (SELECT COALESCE(jsonb_object_agg(je.k, je.v), '{}'::jsonb) FROM jsonb_each(catalog_items.data) AS je(k, v) WHERE je.k = ANY($4::text[])) || EXCLUDED.data
                     ELSE EXCLUDED.data END,
         updated_at = now()`,
      [JSON.stringify(upserts), -Date.now(), keepCosts, COST_FIELDS]
    );
  }
  const delCodes: string[] = [];
  for (const ident of patch.deletes || []) delCodes.push(...(await codesForIdentity(c, ident)));
  if (delCodes.length > 0) await c.query("DELETE FROM catalog_items WHERE code = ANY($1::text[])", [delCodes]);
  return [...byCode.keys(), ...delCodes];
}

/**
 * Ghi đè cả danh sách (trình duyệt cũ / trường hợp không lập được bản vá). Không bao giờ xóa hàng loạt khi
 * người gửi không được xem giá vốn: chỉ thêm / sửa. Người được xem giá vốn: xóa các mã không còn trong danh sách.
 */
export async function replaceCatalog(c: Queryable, items: any[], canDelete: boolean, keepCosts: boolean): Promise<void> {
  const byCode = new Map<string, any>();
  for (const it of items) { const code = cleanCode(it?.code); if (code) byCode.set(code, { ...it, code }); }
  const upserts = Array.from(byCode.values());
  let deletes: string[] = [];
  if (canDelete) {
    const existing = (await c.query("SELECT code FROM catalog_items")).rows.map((r: any) => r.code);
    deletes = existing.filter((code: string) => !byCode.has(code)).map((code: string) => `code:${code}`);
  }
  await applyCatalogPatch(c, { kind: "array", upserts, deletes, order: [] } as any, keepCosts);
}

/**
 * Thêm mặt hàng mới về từ kho / PO; nếu mặt hàng đã tồn tại trong danh mục mà phiếu nhập kho / lô mới
 * có Đơn giá nhập (costPrice > 0) hoặc Giá bán mới (price > 0) thì tự động cập nhật Giá vốn hiện hành
 * (kèm lưu previousCostPrice nếu giá nhập thay đổi) và Giá bán (nếu có điền).
 */
export async function appendCatalogEntry(c: Queryable, entry: Record<string, any>): Promise<void> {
  const code = cleanCode(entry?.code);
  if (!code) return;
  const ins = await c.query(
    `INSERT INTO catalog_items (code, data, sort_order, updated_at) VALUES ($1, $2::jsonb, $3, now())
     ON CONFLICT (code) DO NOTHING
     RETURNING code`,
    [code, JSON.stringify({ ...entry, code }), -Date.now()]
  );
  if ((ins.rowCount || 0) > 0) return;

  const newCost = Number(entry?.costPrice ?? entry?.cost_price) || 0;
  const newPrice = Number(entry?.price ?? entry?.standard_price) || 0;
  const newStorage = String(entry?.storageCondition ?? entry?.storage_condition ?? "").trim();
  if (newCost <= 0 && newPrice <= 0 && !newStorage) return;

  const existingRes = await c.query("SELECT data FROM catalog_items WHERE code = $1", [code]);
  if (existingRes.rows.length === 0) return;
  const curData = existingRes.rows[0]?.data || {};
  const patch: Record<string, any> = {};

  if (newCost > 0) {
    const oldCost = Number(curData.costPrice ?? curData.cost_price) || 0;
    if (oldCost > 0 && oldCost !== newCost) {
      patch.previousCostPrice = oldCost;
      patch.costChangedAt = new Date().toISOString();
    }
    patch.costPrice = newCost;
  }
  if (newPrice > 0) {
    const oldPrice = Number(curData.price) || 0;
    if (oldPrice > 0 && oldPrice !== newPrice) {
      patch.previousPrice = oldPrice;
    }
    patch.price = newPrice;
    patch.priceDealer1 = Number(entry?.priceDealer1) || Math.round(newPrice * 0.85);
    patch.priceDealer2 = Number(entry?.priceDealer2) || Math.round(newPrice * 0.8);
  }
  if (newStorage && !curData.storageCondition) {
    patch.storageCondition = newStorage;
  }

  if (Object.keys(patch).length > 0) {
    await c.query(
      "UPDATE catalog_items SET data = data || $2::jsonb, updated_at = now() WHERE code = $1",
      [code, JSON.stringify(patch)]
    );
  }
}

/** Cập nhật vài trường của một mặt hàng (vd. giá sửa từ trang Kho / Kinh doanh). */
export async function mergeCatalogFields(c: Queryable | null, code: string, fields: Record<string, any>): Promise<boolean> {
  const clean: Record<string, any> = {};
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) clean[k] = v;
  const q = c ? c.query.bind(c) : query;
  const r = await q("UPDATE catalog_items SET data = data || $2::jsonb, updated_at = now() WHERE code = $1", [cleanCode(code), JSON.stringify(clean)]);
  return (r.rowCount || 0) > 0;
}
