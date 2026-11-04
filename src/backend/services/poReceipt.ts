/**
 * Ghi nhận hàng đã nhận vào PO khi nhập kho KHÔNG đi qua màn hình "Nhập kho PO" (ví dụ nhập kho bằng file Excel
 * có cột Mã PO): cộng số lượng vào đúng dòng PO cùng mã hàng (dòng còn thiếu trước), cập nhật trạng thái
 * PARTIALLY_RECEIVED / COMPLETED. Chạy trong transaction của phiếu nhập.
 */
export async function applyPOReceipt(
  c: { query: (sql: string, params?: any[]) => Promise<{ rows: any[] }> },
  poCode: string,
  lines: { product_code: string; quantity: number }[],
  inboundCode: string
): Promise<{ applied: boolean; status?: string; unmatched: string[] }> {
  const r = await c.query(
    "SELECT id, po_code, status, items, received_qty FROM procurement_orders WHERE po_code = $1 FOR UPDATE",
    [String(poCode || "").trim()]
  );
  const po = r.rows[0];
  if (!po) return { applied: false, unmatched: lines.map(l => l.product_code) };
  const st = String(po.status || "").toUpperCase();
  if (["CANCELLED", "COMPLETED"].includes(st)) return { applied: false, status: po.status, unmatched: [] };

  let items: any = po.items;
  if (typeof items === "string") {
    try { items = JSON.parse(items); } catch { items = []; }
  }
  if (!Array.isArray(items)) items = [];
  const received: Record<string, number> = { ...(po.received_qty || {}) };
  const unmatched: string[] = [];

  for (const ln of lines) {
    let rem = Number(ln.quantity) || 0;
    if (rem <= 0) continue;
    const code = String(ln.product_code || "").trim().toUpperCase();
    const idxs = items
      .map((_: any, i: number) => i)
      .filter((i: number) => String(items[i]?.product_code || "").trim().toUpperCase() === code);
    if (idxs.length === 0) {
      unmatched.push(ln.product_code);
      continue;
    }
    for (const i of idxs) {
      if (rem <= 0) break;
      const room = Math.max(0, (Number(items[i]?.quantity) || 0) - (Number(received[i]) || 0));
      const take = Math.min(room, rem);
      if (take > 0) {
        received[i] = (Number(received[i]) || 0) + take;
        rem -= take;
      }
    }
    // Giao dư: ghi vào dòng cuối cùng của mã đó để không mất số liệu
    if (rem > 0) {
      const last = idxs[idxs.length - 1];
      received[last] = (Number(received[last]) || 0) + rem;
    }
  }

  const allDone = items.every((it: any, i: number) => (Number(it?.quantity) || 0) <= 0 || (Number(received[i]) || 0) >= (Number(it.quantity) || 0));
  const anyReceived = Object.values(received).some(v => Number(v) > 0);
  const newStatus = allDone ? "COMPLETED" : anyReceived ? "PARTIALLY_RECEIVED" : po.status;
  await c.query(
    `UPDATE procurement_orders
        SET status = $1, received_qty = $2::jsonb,
            inbound_transaction_code = COALESCE(inbound_transaction_code, $3),
            version = COALESCE(version, 0) + 1
      WHERE id = $4`,
    [newStatus, JSON.stringify(received), inboundCode, po.id]
  );
  return { applied: true, status: newStatus, unmatched };
}
