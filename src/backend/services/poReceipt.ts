/**
 * Đồng bộ số lượng thực nhận từ Phiếu Nhập Kho (PNK) vào Đơn Đặt Mua Hàng (PO)
 * và cung cấp dữ liệu đối chiếu Giá Nhập Kho (PNK) <-> Giá PO cho Kế toán.
 *
 * Nguyên tắc nghiệp vụ:
 *  1. Khi tạo PO bắt buộc nhập Đơn giá PO (> 0).
 *  2. Khi hàng về nhập kho, Thủ kho / Cung ứng nhập Giá nhập kho trên Phiếu Nhập Kho (PNK),
 *     NHƯNG KHÔNG tự động ghi đè Đơn giá trên PO (giữ độc lập Giá PO và Giá Nhập Kho).
 *  3. Nhập kho chỉ đồng bộ Số lượng đã nhận (received_qty) và Trạng thái nhận hàng (PARTIALLY_RECEIVED / COMPLETED) lên PO.
 *  4. Công nợ NCC tính theo Giá PO và chỉ phát sinh trên số lượng hàng đã thực sự nhập kho.
 *  5. Hiển thị Giá Nhập Kho (PNK) bên cạnh Giá PO để Kế toán đối chiếu và chủ động điều chỉnh PO nếu có sai lệch.
 */

const r3 = (v: any): number => Math.round((Number(v) || 0) * 1000) / 1000;

export interface POReceiptLineInput {
  product_code: string;
  product_name?: string;
  specification?: string;
  unit?: string;
  quantity: number;
  unit_price?: number;
  cost_price?: number;
}

export async function applyPOReceipt(
  c: { query: (sql: string, params?: any[]) => Promise<{ rows: any[] }> },
  poCode: string,
  lines: POReceiptLineInput[],
  inboundCode: string
): Promise<{ applied: boolean; status?: string; unmatched: string[] }> {
  const cleanPoCode = String(poCode || "").trim();
  if (!cleanPoCode) return { applied: false, unmatched: lines.map((l) => l.product_code) };

  const r = await c.query(
    "SELECT id, po_code, status, items, received_qty FROM procurement_orders WHERE UPPER(TRIM(po_code)) = UPPER(TRIM($1)) FOR UPDATE",
    [cleanPoCode]
  );
  const po = r.rows[0];
  if (!po) return { applied: false, unmatched: lines.map((l) => l.product_code) };
  if (["COMPLETED", "CANCELLED"].includes(String(po.status || "").toUpperCase())) {
    return { applied: false, status: po.status, unmatched: [] };
  }

  let items: any = po.items;
  if (typeof items === "string") {
    try {
      items = JSON.parse(items);
    } catch {
      items = [];
    }
  }
  if (!Array.isArray(items)) items = [];
  const received: Record<string, number> = { ...(po.received_qty || {}) };
  const unmatched: string[] = [];

  for (const ln of lines) {
    let rem = Number(ln.quantity) || 0;
    const code = String(ln.product_code || "").trim().toUpperCase();
    if (rem <= 0 || !code) continue;

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

  const allDone =
    items.length > 0 &&
    items.every((it: any, i: number) => (Number(it?.quantity) || 0) <= 0 || (Number(received[i]) || 0) >= (Number(it.quantity) || 0));
  const anyReceived = Object.values(received).some((v) => Number(v) > 0);
  const newStatus = allDone ? "COMPLETED" : anyReceived ? "PARTIALLY_RECEIVED" : po.status;

  await c.query(
    `UPDATE procurement_orders
        SET status = $1,
            received_qty = $2::jsonb,
            inbound_transaction_code = COALESCE(inbound_transaction_code, NULLIF($3::text, '')),
            version = COALESCE(version, 0) + 1
      WHERE id = $4`,
    [newStatus, JSON.stringify(received), inboundCode || "", po.id]
  );

  return { applied: true, status: newStatus, unmatched };
}

let lastReconcileAt = 0;

/**
 * Đối soát số lượng đã nhận (received_qty) và trạng thái (PARTIALLY_RECEIVED / COMPLETED)
 * cho các PO có Phiếu Nhập Kho (INBOUND) gắn mã PO nhưng chưa được cộng vào received_qty.
 * Tuyệt đối KHÔNG ghi đè đơn giá (unit_price) hay tổng tiền (total_amount) trên PO.
 */
export async function reconcileHistoricalPOsWithInbound(
  queryFn: (sql: string, params?: any[]) => Promise<{ rows: any[] }>,
  force = false
) {
  const now = Date.now();
  if (!force && now - lastReconcileAt < 15_000) return;
  lastReconcileAt = now;

  try {
    const [posRes, txRes] = await Promise.all([
      queryFn(
        `SELECT id, po_code, status, items, received_qty, inbound_transaction_code
           FROM procurement_orders
          WHERE status != 'CANCELLED'
          ORDER BY id ASC`
      ),
      queryFn(
        `SELECT id, transaction_code, reference_code, items, notes
           FROM inventory_transactions
          WHERE transaction_type = 'INBOUND'
          ORDER BY id ASC`
      ),
    ]);

    if (posRes.rows.length === 0 || txRes.rows.length === 0) return;

    const txQtyByPoAndCode = new Map<string, number>();
    const firstTxCodeByPo = new Map<string, string>();

    for (const tx of txRes.rows) {
      const refRaw = String(tx.reference_code || "").trim();
      const notesRaw = String(tx.notes || "").trim();
      const poCode = (
        (/^PO[A-Z0-9_-]+$/i.test(refRaw) ? refRaw : "") ||
        (refRaw.match(/\b(PO\d{2}-[A-Z0-9-]+)\b/i)?.[1] ?? "") ||
        (notesRaw.match(/\b(PO\d{2}-[A-Z0-9-]+)\b/i)?.[1] ?? "")
      ).toUpperCase();
      if (!poCode) continue;

      if (tx.transaction_code && !firstTxCodeByPo.has(poCode)) {
        firstTxCodeByPo.set(poCode, tx.transaction_code);
      }

      let txItems: any = tx.items;
      if (typeof txItems === "string") {
        try {
          txItems = JSON.parse(txItems);
        } catch {
          txItems = [];
        }
      }
      if (!Array.isArray(txItems)) continue;

      for (const it of txItems) {
        const code = String(it?.product_code || it?.productCode || "").trim().toUpperCase();
        const qty = Number(it?.quantity) || 0;
        if (code && qty > 0) {
          const k = `${poCode}|${code}`;
          txQtyByPoAndCode.set(k, (txQtyByPoAndCode.get(k) || 0) + qty);
        }
      }
    }

    for (const po of posRes.rows) {
      const poCodeUpper = String(po.po_code || "").trim().toUpperCase();
      let items: any = po.items;
      if (typeof items === "string") {
        try {
          items = JSON.parse(items);
        } catch {
          items = [];
        }
      }
      if (!Array.isArray(items) || items.length === 0) continue;

      const received: Record<string, number> = { ...(po.received_qty || {}) };
      let receivedChanged = false;

      const codeIndices = new Map<string, number[]>();
      items.forEach((it: any, idx: number) => {
        const code = String(it?.product_code || "").trim().toUpperCase();
        if (!code) return;
        const list = codeIndices.get(code) || [];
        list.push(idx);
        codeIndices.set(code, list);
      });

      for (const [code, idxs] of codeIndices.entries()) {
        const txTotalQty = txQtyByPoAndCode.get(`${poCodeUpper}|${code}`) || 0;
        if (txTotalQty <= 0) continue;
        const currentRecSum = idxs.reduce((s, i) => s + (Number(received[i]) || 0), 0);
        if (txTotalQty > currentRecSum) {
          let rem = txTotalQty - currentRecSum;
          for (const i of idxs) {
            if (rem <= 0) break;
            const room = Math.max(0, (Number(items[i]?.quantity) || 0) - (Number(received[i]) || 0));
            const take = Math.min(room, rem);
            if (take > 0) {
              received[i] = (Number(received[i]) || 0) + take;
              rem -= take;
              receivedChanged = true;
            }
          }
          if (rem > 0) {
            const last = idxs[idxs.length - 1];
            received[last] = (Number(received[last]) || 0) + rem;
            receivedChanged = true;
          }
        }
      }

      if (receivedChanged) {
        const st = String(po.status || "").toUpperCase();
        const allDone = items.every(
          (it: any, i: number) => (Number(it?.quantity) || 0) <= 0 || (Number(received[i]) || 0) >= (Number(it?.quantity) || 0)
        );
        const anyReceived = Object.values(received).some((v) => Number(v) > 0);
        const newStatus = st === "COMPLETED" ? "COMPLETED" : allDone ? "COMPLETED" : anyReceived ? "PARTIALLY_RECEIVED" : po.status;
        const txCode = firstTxCodeByPo.get(poCodeUpper) || po.inbound_transaction_code || null;

        await queryFn(
          `UPDATE procurement_orders
              SET received_qty = $1::jsonb,
                  status = $2,
                  inbound_transaction_code = COALESCE(inbound_transaction_code, $3),
                  version = COALESCE(version, 0) + 1
            WHERE id = $4`,
          [JSON.stringify(received), newStatus, txCode, po.id]
        ).catch(() => {});
      }
    }
  } catch (err) {
    console.error("[PO_RECEIPT_RECONCILE] error:", err);
  }
}

export interface InboundPriceEntry {
  unit_price: number;
  quantity: number;
  inbound_codes: string[];
  latest_date?: string;
  is_direct_po: boolean;
}

/**
 * Gắn thông tin Giá Nhập Kho (PNK) vào từng đơn PO để Kế toán & Cung ứng đối chiếu với Giá PO.
 * Không làm thay đổi unit_price hay total_amount gốc của PO.
 */
export function attachInboundPriceComparisonToPOs(orders: any[], inboundTxRows: any[]): any[] {
  if (!Array.isArray(orders) || orders.length === 0) return orders;

  // 1. Gom giá nhập kho theo (PO_CODE | PRODUCT_CODE) và theo PRODUCT_CODE (phiếu nhập gần nhất)
  const directByPoAndCode = new Map<string, { totalValue: number; totalQty: number; lastPrice: number; codes: Set<string>; latestDate: string }>();
  const latestByCode = new Map<string, { unit_price: number; quantity: number; inbound_code: string; date: string }>();

  for (const tx of Array.isArray(inboundTxRows) ? inboundTxRows : []) {
    const txCode = String(tx.transaction_code || "").trim();
    const refRaw = String(tx.reference_code || "").trim();
    const notesRaw = String(tx.notes || "").trim();
    const txDate = tx.date ? String(tx.date).slice(0, 10) : "";
    const poCode = (
      (/^PO[A-Z0-9_-]+$/i.test(refRaw) ? refRaw : "") ||
      (refRaw.match(/\b(PO\d{2}-[A-Z0-9-]+)\b/i)?.[1] ?? "") ||
      (notesRaw.match(/\b(PO\d{2}-[A-Z0-9-]+)\b/i)?.[1] ?? "")
    ).toUpperCase();

    let txItems: any = tx.items;
    if (typeof txItems === "string") {
      try {
        txItems = JSON.parse(txItems);
      } catch {
        txItems = [];
      }
    }
    if (!Array.isArray(txItems)) continue;

    for (const it of txItems) {
      const code = String(it?.product_code || it?.productCode || "").trim().toUpperCase();
      if (!code) continue;
      const uPrice = r3(it?.unit_price ?? it?.cost_price ?? 0);
      const qty = Number(it?.quantity) || 0;
      if (uPrice > 0) {
        latestByCode.set(code, {
          unit_price: uPrice,
          quantity: qty,
          inbound_code: txCode,
          date: txDate,
        });
      }
      if (poCode && (uPrice > 0 || qty > 0)) {
        const key = `${poCode}|${code}`;
        const prev = directByPoAndCode.get(key) || {
          totalValue: 0,
          totalQty: 0,
          lastPrice: 0,
          codes: new Set<string>(),
          latestDate: "",
        };
        if (qty > 0 && uPrice > 0) {
          prev.totalValue += qty * uPrice;
          prev.totalQty += qty;
        }
        if (uPrice > 0) prev.lastPrice = uPrice;
        if (txCode) prev.codes.add(txCode);
        if (txDate) prev.latestDate = txDate;
        directByPoAndCode.set(key, prev);
      }
    }
  }

  return orders.map((po: any) => {
    const poCodeUpper = String(po.po_code || "").trim().toUpperCase();
    let items: any = po.items;
    if (typeof items === "string") {
      try {
        items = JSON.parse(items);
      } catch {
        items = [];
      }
    }
    if (!Array.isArray(items)) items = [];

    const rq: Record<string, number> = po.received_qty || {};
    const stUpper = String(po.status || "").toUpperCase();
    const isCompleted = ["COMPLETED", "RECEIVED", "DELIVERED"].includes(stUpper);
    const isPartiallyReceived = ["PARTIALLY_RECEIVED", "PARTIAL_RECEIVED"].includes(stUpper);
    const anyReceivedQty = Object.values(rq).some((v) => Number(v) > 0);
    const hasReceivedGoods = isCompleted || isPartiallyReceived || anyReceivedQty || Boolean(po.inbound_transaction_code);

    const inboundPriceMap: Record<string, InboundPriceEntry> = {};
    let inboundReceivedValue = 0;
    let inboundTotalPoValue = 0;
    let hasInboundPriceDiff = false;

    items.forEach((it: any, idx: number) => {
      const code = String(it?.product_code || "").trim().toUpperCase();
      if (!code) return;
      const orderedQty = Number(it?.quantity) || 0;
      const gotQty = isCompleted ? orderedQty : Number(rq[idx]) || 0;
      const poPrice = r3(it?.unit_price);
      const vatRate = Math.max(0, Number(it?.vat_rate ?? it?.tax_rate ?? 0) || 0);

      const direct = directByPoAndCode.get(`${poCodeUpper}|${code}`);
      const fallback = hasReceivedGoods ? latestByCode.get(code) : undefined;

      let inbPrice = 0;
      if (direct && direct.lastPrice > 0) {
        inbPrice = direct.totalQty > 0 ? r3(direct.totalValue / direct.totalQty) : direct.lastPrice;
        inboundPriceMap[code] = {
          unit_price: inbPrice,
          quantity: direct.totalQty,
          inbound_codes: Array.from(direct.codes),
          latest_date: direct.latestDate || undefined,
          is_direct_po: true,
        };
      } else if (fallback && fallback.unit_price > 0) {
        inbPrice = fallback.unit_price;
        inboundPriceMap[code] = {
          unit_price: inbPrice,
          quantity: fallback.quantity,
          inbound_codes: fallback.inbound_code ? [fallback.inbound_code] : [],
          latest_date: fallback.date || undefined,
          is_direct_po: false,
        };
      }

      const effectiveInbPrice = inbPrice > 0 ? inbPrice : poPrice;
      if (gotQty > 0 && inbPrice > 0) {
        const subRec = r3(gotQty * inbPrice);
        inboundReceivedValue += r3(subRec + r3((subRec * vatRate) / 100));
      }
      if (orderedQty > 0 && effectiveInbPrice > 0) {
        const subOrd = r3(orderedQty * effectiveInbPrice);
        inboundTotalPoValue += r3(subOrd + r3((subOrd * vatRate) / 100));
      }
      if (inbPrice > 0 && Math.abs(inbPrice - poPrice) > 0.01) {
        hasInboundPriceDiff = true;
      }
    });

    return {
      ...po,
      inbound_price_map: inboundPriceMap,
      inbound_received_value: r3(inboundReceivedValue),
      inbound_total_po_value: r3(inboundTotalPoValue),
      has_inbound_price_diff: hasInboundPriceDiff,
    };
  });
}
