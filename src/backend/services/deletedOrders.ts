/**
 * Đơn hàng đã xóa không được "sống lại" trên bản màn hình (app_storage sales_factory_orders).
 *
 * Xóa đơn trước đây chỉ xóa dòng trong bảng sales_orders; bản màn hình trông vào trình duyệt người xóa gửi lệnh xóa.
 * Một tab khác mở từ trước vẫn giữ đơn trong bộ nhớ: lần lưu sau đó thêm đơn trở lại (SO26-NG-1103 trên TBRs: xóa
 * 18/11 nhưng vẫn hiện "Đang mua hàng"). Nay xóa đơn còn ghi mã vào danh sách "deleted_sales_orders" và mọi lần lưu
 * bản màn hình đều bỏ đơn có mã trong danh sách đó.
 */
type Db = { query: (sql: string, params?: any[]) => Promise<{ rows: any[] }> };

export const DELETED_ORDERS_KEY = "deleted_sales_orders";

function orderCodesOf(item: any): string[] {
  return [item?.order_code, item?.id, item?.linkedSalesOrderId]
    .map(v => String(v ?? "").trim().toUpperCase())
    .filter(Boolean);
}

export async function deletedOrderCodes(db: Db): Promise<Set<string>> {
  const row = (await db.query("SELECT data FROM app_storage WHERE key = $1", [DELETED_ORDERS_KEY])).rows[0];
  const list = Array.isArray(row?.data) ? row.data : [];
  return new Set(list.map((x: any) => String(x || "").trim().toUpperCase()).filter(Boolean));
}

/** Bỏ các đơn đã xóa khỏi danh sách sắp lưu; trả về danh sách còn lại và các mã đã bỏ. */
export async function withoutDeletedOrders(db: Db, items: any[]): Promise<{ items: any[]; dropped: string[] }> {
  if (!Array.isArray(items) || items.length === 0) return { items, dropped: [] };
  const deleted = await deletedOrderCodes(db);
  if (deleted.size === 0) return { items, dropped: [] };
  const dropped: string[] = [];
  const kept = items.filter(it => {
    const hit = orderCodesOf(it).find(c => deleted.has(c));
    if (hit) dropped.push(hit);
    return !hit;
  });
  return { items: kept, dropped };
}

/** Trong giao dịch xóa đơn: bỏ đơn khỏi bản màn hình và ghi mã vào danh sách đã xóa. */
export async function forgetDeletedOrder(db: Db, code: string): Promise<number> {
  const upper = code.trim().toUpperCase();
  const cur = (await db.query("SELECT data FROM app_storage WHERE key = 'sales_factory_orders' FOR UPDATE")).rows[0];
  let removed = 0;
  if (Array.isArray(cur?.data)) {
    const next = cur.data.filter((it: any) => {
      const hit = orderCodesOf(it).includes(upper);
      if (hit) removed++;
      return !hit;
    });
    if (removed > 0) {
      await db.query(
        "UPDATE app_storage SET data = $1::jsonb, version = COALESCE(version, 1) + 1, updated_at = now() WHERE key = 'sales_factory_orders'",
        [JSON.stringify(next)]
      );
    }
  }
  await db.query(
    `INSERT INTO app_storage (key, data, version, updated_at) VALUES ($1, $2::jsonb, 1, now())
     ON CONFLICT (key) DO UPDATE
       SET data = (SELECT COALESCE(jsonb_agg(DISTINCT v), '[]'::jsonb) FROM jsonb_array_elements_text(
                     CASE WHEN jsonb_typeof(app_storage.data) = 'array' THEN app_storage.data ELSE '[]'::jsonb END || EXCLUDED.data) v),
           version = COALESCE(app_storage.version, 1) + 1, updated_at = now()`,
    [DELETED_ORDERS_KEY, JSON.stringify([upper])]
  );
  return removed;
}
