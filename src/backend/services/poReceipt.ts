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

const r3 = (v: any): number => Math.round(Number(v) || 0);

/**
 * Kiểm tra xem một phiếu INBOUND có thực sự là Phiếu Nhập Kho của đơn PO hay không.
 * Loại trừ các phiếu nhập tồn đầu kỳ / nhập Excel chung bị bản cũ tự động gắn mã PO.
 */
function extractGenuinePoCodeFromTx(tx: any): { poCode: string; wasAutoLinkedInitialStock: boolean } {
  const refRaw = String(tx?.reference_code || "").trim();
  const notesRaw = String(tx?.notes || "").trim();
  const txCode = String(tx?.transaction_code || "").trim();

  const candidatePo = (
    (/^PO[A-Z0-9_-]+$/i.test(refRaw) ? refRaw : "") ||
    (refRaw.match(/\b(PO\d{2}-[A-Z0-9-]+)\b/i)?.[1] ?? "") ||
    (notesRaw.match(/\bNhập kho theo PO\s+(PO\d{2}-[A-Z0-9-]+)\b/i)?.[1] ?? "")
  ).toUpperCase();

  if (!candidatePo) return { poCode: "", wasAutoLinkedInitialStock: false };

  let parsedItems: any[] = [];
  if (Array.isArray(tx?.items)) {
    parsedItems = tx.items;
  } else if (typeof tx?.items === "string") {
    try {
      const p = JSON.parse(tx.items);
      if (Array.isArray(p)) parsedItems = p;
    } catch {}
  }

  // Phiếu lập từ chức năng "Nhập kho theo PO" hoặc có loại hình "Nhập mua hàng theo Đơn PO" (kể cả sau khi Kế toán sửa giá PNK)
  const isPoInbound =
    /Nhập kho theo PO|Nhập mua hàng theo Đơn PO/i.test(notesRaw) ||
    parsedItems.some((it: any) => /Đơn PO|theo PO/i.test(String(it?.inbound_type || "")));
  if (isPoInbound) {
    return { poCode: candidatePo, wasAutoLinkedInitialStock: false };
  }

  // Chỉ loại trừ các phiếu nhập kho đầu kỳ / Excel tổng hợp bị bản cũ (51af48a) tự gắn reference_code
  const isInitialOrStandaloneStock =
    /^Nhập kho theo Lô\b/i.test(notesRaw) ||
    /^Nhập kho \(Không có số lô\)/i.test(notesRaw) ||
    /Tồn kho đầu kỳ|Nhập kho đầu kỳ|Nhập tồn đầu kỳ|NHAP-KHO-EXCEL/i.test(notesRaw) ||
    /^PNK-EXCEL-/i.test(txCode);

  if (isInitialOrStandaloneStock) {
    return { poCode: "", wasAutoLinkedInitialStock: /^PO/i.test(refRaw) };
  }

  return { poCode: candidatePo, wasAutoLinkedInitialStock: false };
}

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
    const [posRes, txRes, inboundAuditRes] = await Promise.all([
      queryFn(
        `SELECT id, po_code, supplier_name, status, items, received_qty, inbound_transaction_code, supplier_invoices, created_by
           FROM procurement_orders
          WHERE status != 'CANCELLED'
          ORDER BY id ASC`
      ),
      queryFn(
        `SELECT id, transaction_code, reference_code, performed_by, items, notes
           FROM inventory_transactions
          WHERE transaction_type = 'INBOUND'
          ORDER BY id ASC`
      ),
      queryFn(
        `SELECT action, details, actor_name
           FROM audit_logs
          WHERE action IN ('RECEIVE_PO', 'INBOUND', 'UPDATE_INBOUND')
            AND actor_name IS NOT NULL AND actor_name != '' AND actor_name != 'Hệ Thống'
          ORDER BY id ASC`
      ).catch(() => ({ rows: [] as any[] })),
    ]);

    if (posRes.rows.length === 0 && txRes.rows.length === 0) return;

    const originalReceiverByTxCode = new Map<string, string>();
    const editedByTxCode = new Set<string>();
    for (const log of inboundAuditRes.rows || []) {
      const det = String(log.details || "");
      const actor = String(log.actor_name || "").trim();
      if (!actor) continue;
      const pnkMatch = det.match(/\b(PNK[A-Z0-9_-]+)\b/i);
      if (!pnkMatch) continue;
      const pnkCode = pnkMatch[1].toUpperCase();
      if (log.action === "RECEIVE_PO" || log.action === "INBOUND") {
        if (!originalReceiverByTxCode.has(pnkCode)) {
          originalReceiverByTxCode.set(pnkCode, actor);
        }
      } else if (log.action === "UPDATE_INBOUND") {
        editedByTxCode.add(pnkCode);
      }
    }

    // Tự động khôi phục liên kết PO & người nhập kho gốc cho các phiếu PNK từng bị sửa bởi Kế toán
    for (const tx of txRes.rows) {
      const txCodeUpper = String(tx?.transaction_code || "").trim().toUpperCase();
      const refUpper = String(tx?.reference_code || "").trim().toUpperCase();
      let origActor = originalReceiverByTxCode.get(txCodeUpper) || "";
      if (!origActor && editedByTxCode.has(txCodeUpper) && /^PO/i.test(refUpper)) {
        const linkedPo = posRes.rows.find((po: any) => String(po.po_code || "").trim().toUpperCase() === refUpper);
        if (linkedPo?.created_by) origActor = String(linkedPo.created_by).trim();
      }
      if (origActor && String(tx.performed_by || "").trim() !== origActor) {
        tx.performed_by = origActor;
        if (tx.id) {
          await queryFn(
            `UPDATE inventory_transactions SET performed_by = $1 WHERE id = $2`,
            [origActor, tx.id]
          ).catch(() => {});
        }
      }
      const notesRaw = String(tx?.notes || "").trim();
      let parsedTxItems: any[] = [];
      if (Array.isArray(tx?.items)) {
        parsedTxItems = tx.items;
      } else if (typeof tx?.items === "string") {
        try {
          const p = JSON.parse(tx.items);
          if (Array.isArray(p)) parsedTxItems = p;
        } catch {}
      }
      const isPoPurchaseReceipt =
        /Nhập mua hàng theo Đơn PO|Nhập kho theo PO/i.test(notesRaw) ||
        parsedTxItems.some((it: any) => /Đơn PO|theo PO/i.test(String(it?.inbound_type || "")));

      if (refUpper === "NHAP-KHO-DAU-KY" && isPoPurchaseReceipt && parsedTxItems.length > 0) {
        const txCode = String(tx.transaction_code || "").trim();
        const txSupplier = String(
          parsedTxItems[0]?.supplier_name ||
          notesRaw.match(/NCC:\s*([^.•]+)/i)?.[1] ||
          ""
        ).trim().toLowerCase();

        const matchedPo = posRes.rows.find((po: any) => {
          if (txCode && String(po.inbound_transaction_code || "").trim() === txCode) return true;
          const invs = Array.isArray(po.supplier_invoices) ? po.supplier_invoices : [];
          if (txCode && invs.some((inv: any) => String(inv?.inbound_code || "").trim() === txCode)) return true;

          let poItems: any = po.items;
          if (typeof poItems === "string") {
            try { poItems = JSON.parse(poItems); } catch { poItems = []; }
          }
          if (!Array.isArray(poItems) || poItems.length === 0) return false;
          const poSup = String(po.supplier_name || "").trim().toLowerCase();
          if (txSupplier && poSup && !poSup.includes(txSupplier) && !txSupplier.includes(poSup)) return false;

          return parsedTxItems.every((ti: any) => {
            const tCode = String(ti?.product_code || ti?.productCode || "").trim().toUpperCase();
            const tQty = Number(ti?.quantity) || 0;
            return poItems.some((pi: any) =>
              String(pi?.product_code || "").trim().toUpperCase() === tCode &&
              Math.abs((Number(pi?.quantity) || 0) - tQty) < 0.001
            );
          });
        });

        if (matchedPo && matchedPo.po_code) {
          const restoredRef = String(matchedPo.po_code).trim();
          const restoredNotes = /^Nhập kho theo PO\s+/i.test(notesRaw)
            ? notesRaw
            : `Nhập kho theo PO ${restoredRef} • ${notesRaw}`;
          const restoredPerformer =
            originalReceiverByTxCode.get(txCodeUpper) ||
            (editedByTxCode.has(txCodeUpper) && matchedPo.created_by ? String(matchedPo.created_by).trim() : "") ||
            tx.performed_by;
          tx.reference_code = restoredRef;
          tx.notes = restoredNotes;
          tx.performed_by = restoredPerformer;
          if (tx.id) {
            await queryFn(
              `UPDATE inventory_transactions SET reference_code = $1, notes = $2, performed_by = COALESCE(NULLIF($3, ''), performed_by) WHERE id = $4`,
              [restoredRef, restoredNotes, restoredPerformer || "", tx.id]
            ).catch(() => {});
          }
        }
      }
    }

    const txQtyByPoAndCode = new Map<string, number>();
    const firstTxCodeByPo = new Map<string, string>();

    for (const tx of txRes.rows) {
      const { poCode, wasAutoLinkedInitialStock } = extractGenuinePoCodeFromTx(tx);
      if (wasAutoLinkedInitialStock && tx.id) {
        await queryFn(`UPDATE inventory_transactions SET reference_code = 'NHAP-KHO-DAU-KY' WHERE id = $1`, [tx.id]).catch(() => {});
      }
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
        const currentRecSum = idxs.reduce((s, i) => s + (Number(received[i]) || 0), 0);
        if (txTotalQty !== currentRecSum) {
          // Tính lại số lượng đã nhận của mã này đúng bằng tổng số lượng trên các Phiếu Nhập Kho thực tế của PO
          for (const i of idxs) {
            delete received[i];
          }
          if (txTotalQty > 0) {
            let rem = txTotalQty;
            for (const i of idxs) {
              if (rem <= 0) break;
              const room = Math.max(0, Number(items[i]?.quantity) || 0);
              const take = Math.min(room, rem);
              if (take > 0) {
                received[i] = take;
                rem -= take;
              }
            }
            if (rem > 0) {
              const last = idxs[idxs.length - 1];
              received[last] = (Number(received[last]) || 0) + rem;
            }
          }
          receivedChanged = true;
        }
      }

      const roundedItems = items.map((it: any) => {
        const q = Number(it?.quantity) || 0;
        const p = r3(it?.unit_price);
        const sub = r3(q * p);
        const vr = Math.max(0, Number(it?.vat_rate ?? it?.tax_rate ?? 0) || 0);
        const va = r3((sub * vr) / 100);
        const tav = r3(sub + va);
        return {
          ...it,
          unit_price: p,
          subtotal: sub,
          vat_rate: vr,
          vat_amount: va,
          total_after_vat: tav,
          total: tav,
        };
      });
      const roundedTotal = roundedItems.reduce((s: number, x: any) => s + (Number(x.total_after_vat ?? x.total) || 0), 0);
      const hasFractionInDb =
        items.some((it: any) => (Number(it?.unit_price) || 0) !== r3(it?.unit_price) || (Number(it?.total) || 0) !== r3(it?.total)) ||
        (Number(po.total_amount) || 0) !== r3(po.total_amount);

      const st = String(po.status || "").toUpperCase();
      const anyReceived = Object.values(received).some((v) => Number(v) > 0);
      const hasGenuinePoTx = firstTxCodeByPo.has(poCodeUpper);
      // Nếu PO đang ở trạng thái PARTIALLY_RECEIVED (hoặc có gắn mã PNK cũ) nhưng thực tế chưa có phiếu nhập kho nào của PO này -> trả về ORDERED
      const statusNeedsReset =
        !anyReceived &&
        !hasGenuinePoTx &&
        (["PARTIALLY_RECEIVED", "PARTIAL_RECEIVED"].includes(st) ||
          (st === "COMPLETED" && Boolean(po.inbound_transaction_code)));

      if (receivedChanged || hasFractionInDb || statusNeedsReset) {
        const allDone =
          anyReceived &&
          items.every(
            (it: any, i: number) => (Number(it?.quantity) || 0) <= 0 || (Number(received[i]) || 0) >= (Number(it?.quantity) || 0)
          );
        const newStatus = statusNeedsReset
          ? "ORDERED"
          : allDone
          ? "COMPLETED"
          : anyReceived
          ? "PARTIALLY_RECEIVED"
          : st === "PARTIALLY_RECEIVED" || st === "PARTIAL_RECEIVED"
          ? "ORDERED"
          : po.status;
        const txCode = firstTxCodeByPo.get(poCodeUpper) || (anyReceived ? po.inbound_transaction_code : null);

        await queryFn(
          `UPDATE procurement_orders
              SET received_qty = $1::jsonb,
                  status = $2,
                  inbound_transaction_code = $3,
                  items = $4::jsonb,
                  total_amount = $5,
                  version = COALESCE(version, 0) + 1
            WHERE id = $6`,
          [JSON.stringify(received), newStatus, txCode, JSON.stringify(roundedItems), roundedTotal || r3(po.total_amount), po.id]
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

  // 1. Gom giá nhập kho thực tế theo đúng (PO_CODE | PRODUCT_CODE) của những phiếu nhập thuộc về PO đó
  const directByPoAndCode = new Map<string, { totalValue: number; totalQty: number; lastPrice: number; codes: Set<string>; latestDate: string }>();

  for (const tx of Array.isArray(inboundTxRows) ? inboundTxRows : []) {
    const txCode = String(tx.transaction_code || "").trim();
    const txDate = tx.date ? String(tx.date).slice(0, 10) : "";
    const { poCode } = extractGenuinePoCodeFromTx(tx);
    if (!poCode) continue;

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
      if (uPrice > 0 || qty > 0) {
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

      // Chỉ hiển thị Giá PNK khi có phiếu nhập kho thực sự thuộc về đơn PO này (không lấy từ phiếu nhập tồn đầu kỳ rời)
      const direct = directByPoAndCode.get(`${poCodeUpper}|${code}`);

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

    const normalizedItems = items.map((it: any) => {
      const q = Number(it?.quantity) || 0;
      const p = r3(it?.unit_price);
      const sub = r3(q * p);
      const vr = Math.max(0, Number(it?.vat_rate ?? it?.tax_rate ?? 0) || 0);
      const va = r3((sub * vr) / 100);
      const tav = r3(sub + va);
      return {
        ...it,
        unit_price: p,
        subtotal: sub,
        vat_rate: vr,
        vat_amount: va,
        total_after_vat: tav,
        total: tav,
      };
    });
    const normalizedTotal = normalizedItems.reduce((s: number, x: any) => s + (Number(x.total_after_vat ?? x.total) || 0), 0);

    return {
      ...po,
      items: normalizedItems,
      total_amount: normalizedTotal > 0 ? normalizedTotal : r3(po.total_amount),
      inbound_price_map: inboundPriceMap,
      inbound_received_value: r3(inboundReceivedValue),
      inbound_total_po_value: r3(inboundTotalPoValue),
      has_inbound_price_diff: hasInboundPriceDiff,
    };
  });
}
