/**
 * Đồng bộ chiều Nhập Kho (PNK / Lô hàng / Giá vốn) -> Đơn Đặt Mua Hàng (PO) & Công nợ NCC.
 *
 * Giải quyết triệt để nghiệp vụ thực tế:
 *  1. Bộ phận Cung ứng lập PO khi chưa biết giá (unit_price = 0, total_amount = 0).
 *  2. Khi hàng về kho kèm phiếu giao hàng / hóa đơn có giá, Thủ kho hoặc Cung ứng nhập giá lúc Nhập kho
 *     (qua màn hình Nhập kho PO, Lập Phiếu Nhập Kho ở Quản lý Kho, Nhập Excel, Sửa Phiếu Nhập, hoặc Sửa Lô).
 *  3. Hệ thống tự động đồng bộ ngược Đơn giá nhập (unit_price), Thành tiền (total_amount), Số lượng đã nhận (received_qty),
 *     Trạng thái PO (PARTIALLY_RECEIVED / COMPLETED), Hóa đơn NCC (supplier_invoices) và Bảng giá NCC (supplier_products).
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

export interface ApplyPOReceiptOptions {
  vat_invoice_no?: string;
  invoice_date?: string;
  skipQuantityAdd?: boolean;
}

function recalcPOItemWithPrice(it: any, newUnitPrice: number) {
  const pQty = Number(it?.quantity) || 0;
  const pPrice = r3(newUnitPrice);
  const pSub = r3(pQty * pPrice);
  const pVatRate = Math.max(0, Number(it?.vat_rate ?? it?.tax_rate ?? 0) || 0);
  const pVatAmt = r3((pSub * pVatRate) / 100);
  const pTotalAfterVat = r3(pSub + pVatAmt);
  it.unit_price = pPrice;
  it.subtotal = pSub;
  it.vat_rate = pVatRate;
  it.vat_amount = pVatAmt;
  it.total_after_vat = pTotalAfterVat;
  it.total = pTotalAfterVat;
}

function computePOTotalFromItems(items: any[]): number {
  if (!Array.isArray(items)) return 0;
  return r3(
    items.reduce((sum: number, it: any) => {
      const qty = Number(it?.quantity) || 0;
      const price = r3(it?.unit_price);
      const sub = r3(qty * price);
      const vr = Math.max(0, Number(it?.vat_rate ?? it?.tax_rate ?? 0) || 0);
      const vat = r3((sub * vr) / 100);
      return sum + sub + vat;
    }, 0)
  );
}

export async function applyPOReceipt(
  c: { query: (sql: string, params?: any[]) => Promise<{ rows: any[] }> },
  poCode: string,
  lines: POReceiptLineInput[],
  inboundCode: string,
  opts?: ApplyPOReceiptOptions
): Promise<{ applied: boolean; status?: string; unmatched: string[] }> {
  const cleanPoCode = String(poCode || "").trim();
  if (!cleanPoCode) return { applied: false, unmatched: lines.map((l) => l.product_code) };

  const r = await c.query(
    "SELECT id, po_code, supplier_id, supplier_name, status, items, received_qty, total_amount, inbound_transaction_code FROM procurement_orders WHERE UPPER(TRIM(po_code)) = UPPER(TRIM($1)) FOR UPDATE",
    [cleanPoCode]
  );
  const po = r.rows[0];
  if (!po) return { applied: false, unmatched: lines.map((l) => l.product_code) };
  const st = String(po.status || "").toUpperCase();
  if (st === "CANCELLED") return { applied: false, status: po.status, unmatched: [] };

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
  const alreadyCompleted = st === "COMPLETED" || Boolean(opts?.skipQuantityAdd);
  let priceUpdated = false;

  for (const ln of lines) {
    let rem = Number(ln.quantity) || 0;
    const uPrice = r3(ln.unit_price ?? ln.cost_price ?? 0);
    const code = String(ln.product_code || "").trim().toUpperCase();
    if (!code) continue;

    const idxs = items
      .map((_: any, i: number) => i)
      .filter((i: number) => String(items[i]?.product_code || "").trim().toUpperCase() === code);

    if (idxs.length === 0) {
      unmatched.push(ln.product_code);
      continue;
    }

    // Cập nhật đơn giá cho các dòng cùng mã hàng trên PO nếu phiếu nhập kho có giá > 0
    if (uPrice > 0) {
      for (const i of idxs) {
        if (r3(items[i]?.unit_price) !== uPrice) {
          recalcPOItemWithPrice(items[i], uPrice);
          priceUpdated = true;
        }
      }
      if (po.supplier_id) {
        const refIt = items[idxs[0]] || {};
        await c
          .query(
            `INSERT INTO supplier_products (supplier_id, product_code, product_name, unit, specification, purchase_price)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (supplier_id, product_code) DO UPDATE SET
               purchase_price = EXCLUDED.purchase_price,
               product_name = COALESCE(NULLIF(EXCLUDED.product_name, ''), supplier_products.product_name),
               unit = COALESCE(NULLIF(EXCLUDED.unit, ''), supplier_products.unit),
               specification = COALESCE(NULLIF(EXCLUDED.specification, ''), supplier_products.specification),
               updated_at = CURRENT_TIMESTAMP`,
            [
              Number(po.supplier_id),
              String(refIt.product_code || ln.product_code).trim(),
              String(refIt.product_name || ln.product_name || ln.product_code)
                .replace(/^\[[A-Z]{2}\d{2}-[^\]]+\]\s*/, "")
                .trim(),
              String(refIt.unit || ln.unit || "Hộp").trim(),
              String(refIt.specification || ln.specification || "").trim(),
              uPrice,
            ]
          )
          .catch(() => {});
      }
    }

    if (!alreadyCompleted && rem > 0) {
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
  }

  const allDone =
    items.length > 0 &&
    items.every((it: any, i: number) => (Number(it?.quantity) || 0) <= 0 || (Number(received[i]) || 0) >= (Number(it.quantity) || 0));
  const anyReceived = Object.values(received).some((v) => Number(v) > 0);
  const newStatus = alreadyCompleted ? po.status : allDone ? "COMPLETED" : anyReceived ? "PARTIALLY_RECEIVED" : po.status;

  const computedTotal = computePOTotalFromItems(items);
  const newTotalAmount = priceUpdated || computedTotal > 0 ? computedTotal : Number(po.total_amount) || 0;

  await c.query(
    `UPDATE procurement_orders
        SET status = $1,
            received_qty = $2::jsonb,
            inbound_transaction_code = COALESCE(inbound_transaction_code, NULLIF($3::text, '')),
            items = $5::jsonb,
            total_amount = $6,
            version = COALESCE(version, 0) + 1
      WHERE id = $4`,
    [newStatus, JSON.stringify(received), inboundCode || "", po.id, JSON.stringify(items), newTotalAmount]
  );

  const invNo = String(opts?.vat_invoice_no || "").trim();
  if (invNo && invNo.toUpperCase() !== "N/A" && newTotalAmount > 0) {
    const invDate = opts?.invoice_date && /^\d{4}-\d{2}-\d{2}$/.test(opts.invoice_date) ? opts.invoice_date : new Date().toISOString().slice(0, 10);
    await c
      .query(
        `UPDATE supplier_invoices
            SET invoice_no = $1, amount = $2, invoice_date = $3
          WHERE po_id = $4 AND notes LIKE $5`,
        [invNo, newTotalAmount, invDate, po.id, `%${inboundCode}%`]
      )
      .then(async (res: any) => {
        if (!res?.rowCount) {
          const dupInv = await c.query(`SELECT id FROM supplier_invoices WHERE po_id = $1 AND invoice_no = $2 LIMIT 1`, [po.id, invNo]);
          if (dupInv.rows.length === 0) {
            await c.query(
              `INSERT INTO supplier_invoices (po_id, supplier_id, invoice_no, invoice_date, due_date, amount, status, notes)
               VALUES ($1, $2, $3, $4, ($4::date + INTERVAL '30 days')::date, $5, 'UNPAID', $6)`,
              [po.id, po.supplier_id || null, invNo, invDate, newTotalAmount, `Hoá đơn kèm phiếu nhập ${inboundCode} (${po.po_code})`]
            );
          }
        }
      })
      .catch(() => {});
  }

  return { applied: true, status: newStatus, unmatched };
}

/**
 * Khi nhập kho / cập nhật phiếu nhập kho / cập nhật giá vốn lô hàng tại Quản Lý Kho:
 * 1. Nếu có mã PO tham chiếu (trong reference_code hoặc notes) -> áp dụng applyPOReceipt cho PO đó.
 * 2. Nếu KHÔNG ghi mã PO tham chiếu -> tự động tìm PO đang mở (chưa nhận đủ) có cùng mặt hàng (ưu tiên cùng NCC)
 *    để cập nhật số lượng nhận & đơn giá PO, đồng thời điền bổ sung đơn giá cho mọi PO có dòng hàng đó đang để giá 0đ.
 */
export async function syncInboundPricesToPOs(
  c: { query: (sql: string, params?: any[]) => Promise<{ rows: any[] }> },
  lines: POReceiptLineInput[],
  opts: {
    reference_code?: string;
    notes?: string;
    transaction_code?: string;
    supplier_name?: string;
    vat_invoice_no?: string;
    invoice_date?: string;
    is_new_inbound?: boolean;
  }
) {
  const validLines = (Array.isArray(lines) ? lines : []).filter((l) => l && String(l.product_code || "").trim());
  if (validLines.length === 0) return;

  // 1. Cập nhật bảng giá NCC (supplier_products) nếu tìm thấy NCC theo tên
  const supName = String(opts.supplier_name || "").trim();
  let matchedSupplierId: number | null = null;
  if (supName) {
    const supRes = await c
      .query(
        `SELECT id FROM procurement_suppliers
          WHERE UPPER(TRIM(name)) = UPPER(TRIM($1))
             OR UPPER(TRIM(COALESCE(short_name, ''))) = UPPER(TRIM($1))
          LIMIT 1`,
        [supName]
      )
      .catch(() => ({ rows: [] as any[] }));
    if (supRes.rows[0]?.id) {
      matchedSupplierId = Number(supRes.rows[0].id);
      for (const ln of validLines) {
        const uPrice = r3(ln.unit_price ?? ln.cost_price ?? 0);
        if (uPrice > 0) {
          await c
            .query(
              `INSERT INTO supplier_products (supplier_id, product_code, product_name, unit, specification, purchase_price)
               VALUES ($1, $2, $3, $4, $5, $6)
               ON CONFLICT (supplier_id, product_code) DO UPDATE SET
                 purchase_price = EXCLUDED.purchase_price,
                 product_name = COALESCE(NULLIF(EXCLUDED.product_name, ''), supplier_products.product_name),
                 updated_at = CURRENT_TIMESTAMP`,
              [
                matchedSupplierId,
                String(ln.product_code).trim(),
                String(ln.product_name || ln.product_code).trim(),
                String(ln.unit || "Hộp").trim(),
                String(ln.specification || "").trim(),
                uPrice,
              ]
            )
            .catch(() => {});
        }
      }
    }
  }

  // 2. Kiểm tra mã PO trong reference_code hoặc notes
  const refRaw = String(opts.reference_code || "").trim();
  const notesRaw = String(opts.notes || "").trim();
  const poMatch =
    (/^PO[A-Z0-9_-]+$/i.test(refRaw) ? refRaw : "") ||
    (refRaw.match(/\b(PO\d{2}-[A-Z0-9-]+)\b/i)?.[1] ?? "") ||
    (notesRaw.match(/\b(PO\d{2}-[A-Z0-9-]+)\b/i)?.[1] ?? "");

  if (poMatch) {
    await applyPOReceipt(c, poMatch, validLines, opts.transaction_code || "", {
      vat_invoice_no: opts.vat_invoice_no,
      invoice_date: opts.invoice_date,
      skipQuantityAdd: !opts.is_new_inbound,
    });
  } else if (opts.is_new_inbound) {
    // Không nhập mã PO tham chiếu trên phiếu nhập kho: tìm PO đang mở có chứa mã hàng này
    const codeSet = new Set(validLines.map((l) => String(l.product_code || "").trim().toUpperCase()).filter(Boolean));
    if (codeSet.size > 0) {
      const openPOs = await c.query(
        `SELECT id, po_code, supplier_id, supplier_name, status, items, received_qty
           FROM procurement_orders
          WHERE status NOT IN ('CANCELLED', 'COMPLETED')
          ORDER BY
            CASE WHEN $1::int IS NOT NULL AND supplier_id = $1::int THEN 0
                 WHEN $2::text <> '' AND UPPER(TRIM(supplier_name)) = UPPER(TRIM($2::text)) THEN 0
                 ELSE 1 END ASC,
            id ASC`,
        [matchedSupplierId, supName]
      );

      const remainingLinesByCode = new Map<string, POReceiptLineInput>();
      for (const ln of validLines) {
        const k = String(ln.product_code || "").trim().toUpperCase();
        const prev = remainingLinesByCode.get(k);
        if (prev) {
          prev.quantity = (Number(prev.quantity) || 0) + (Number(ln.quantity) || 0);
          if (r3(ln.unit_price ?? ln.cost_price) > 0) prev.unit_price = r3(ln.unit_price ?? ln.cost_price);
        } else {
          remainingLinesByCode.set(k, { ...ln, quantity: Number(ln.quantity) || 0, unit_price: r3(ln.unit_price ?? ln.cost_price) });
        }
      }

      let linkedPoCode = "";
      for (const po of openPOs.rows) {
        let poItems: any = po.items;
        if (typeof poItems === "string") {
          try {
            poItems = JSON.parse(poItems);
          } catch {
            poItems = [];
          }
        }
        if (!Array.isArray(poItems)) continue;
        const rq = po.received_qty || {};

        const linesForThisPO: POReceiptLineInput[] = [];
        for (let i = 0; i < poItems.length; i++) {
          const itCode = String(poItems[i]?.product_code || "").trim().toUpperCase();
          const remInb = remainingLinesByCode.get(itCode);
          if (!remInb || remInb.quantity <= 0) continue;
          const room = Math.max(0, (Number(poItems[i]?.quantity) || 0) - (Number(rq[i]) || 0));
          if (room <= 0) continue;
          const take = Math.min(room, remInb.quantity);
          linesForThisPO.push({ ...remInb, quantity: take });
          remInb.quantity -= take;
        }

        if (linesForThisPO.length > 0) {
          await applyPOReceipt(c, po.po_code, linesForThisPO, opts.transaction_code || "", {
            vat_invoice_no: opts.vat_invoice_no,
            invoice_date: opts.invoice_date,
          });
          if (!linkedPoCode) linkedPoCode = po.po_code;
        }
      }

      // Nếu phiếu nhập kho chưa có reference_code (đang là 'N/A' hoặc rỗng), gắn luôn mã PO vừa khớp
      if (linkedPoCode && opts.transaction_code && (!refRaw || refRaw === "N/A")) {
        await c
          .query(
            `UPDATE inventory_transactions
                SET reference_code = $1
              WHERE transaction_code = $2 AND (reference_code IS NULL OR reference_code = '' OR reference_code = 'N/A')`,
            [linkedPoCode, opts.transaction_code]
          )
          .catch(() => {});
      }
    }
  }

  // 3. Điền bổ sung đơn giá cho MỌI đơn PO (chưa hủy) có chứa mã hàng vừa nhập kho nhưng dòng PO đang có giá = 0 VNĐ
  const priceMap = new Map<string, number>();
  for (const ln of validLines) {
    const code = String(ln.product_code || "").trim().toUpperCase();
    const uPrice = r3(ln.unit_price ?? ln.cost_price ?? 0);
    if (code && uPrice > 0) priceMap.set(code, uPrice);
  }
  if (priceMap.size === 0) return;

  const zeroPricePOs = await c.query(
    `SELECT id, po_code, supplier_id, items, total_amount
       FROM procurement_orders
      WHERE status != 'CANCELLED'
       FOR UPDATE`
  );

  for (const po of zeroPricePOs.rows) {
    let items: any = po.items;
    if (typeof items === "string") {
      try {
        items = JSON.parse(items);
      } catch {
        items = [];
      }
    }
    if (!Array.isArray(items) || items.length === 0) continue;

    let changed = false;
    for (const it of items) {
      const code = String(it?.product_code || "").trim().toUpperCase();
      const newPrice = priceMap.get(code);
      if (!newPrice || newPrice <= 0) continue;
      const curPrice = r3(it?.unit_price);
      // Nếu dòng PO chưa có giá (0đ), hoặc đây chính là PO tham chiếu trên phiếu nhập kho
      if (curPrice <= 0 || (poMatch && po.po_code.toUpperCase() === poMatch.toUpperCase() && curPrice !== newPrice)) {
        recalcPOItemWithPrice(it, newPrice);
        changed = true;
      }
    }

    const computedTotal = computePOTotalFromItems(items);
    const storedTotal = r3(po.total_amount);
    if (changed || (computedTotal > 0 && Math.abs(storedTotal - computedTotal) > 0.01)) {
      await c.query(
        `UPDATE procurement_orders
            SET items = $1::jsonb,
                total_amount = $2,
                version = COALESCE(version, 0) + 1
          WHERE id = $3`,
        [JSON.stringify(items), computedTotal, po.id]
      );
    }
  }
}

let lastReconcileAt = 0;

/**
 * Tự động đối soát & đồng bộ dữ liệu lịch sử giữa Kho (inventory_transactions INBOUND, inventory_lots, products)
 * và Đơn mua hàng (procurement_orders):
 *  - Các PO lập với giá 0đ nhưng hàng đã có giá khi nhập kho / trong danh mục kho -> tự động cập nhật unit_price & total_amount lên PO.
 *  - Các phiếu nhập kho (PNK) có tham chiếu PO nhưng chưa cộng received_qty vào PO -> tự động cộng received_qty & cập nhật trạng thái PO.
 */
export async function reconcileHistoricalPOsWithInbound(
  queryFn: (sql: string, params?: any[]) => Promise<{ rows: any[] }>,
  force = false
) {
  const now = Date.now();
  if (!force && now - lastReconcileAt < 15_000) return;
  lastReconcileAt = now;

  try {
    const [posRes, txRes, prodCostRes, supProdRes] = await Promise.all([
      queryFn(
        `SELECT id, po_code, supplier_id, supplier_name, status, items, received_qty, total_amount, inbound_transaction_code
           FROM procurement_orders
          WHERE status != 'CANCELLED'
          ORDER BY id ASC`
      ),
      queryFn(
        `SELECT id, transaction_code, reference_code, date, items, notes
           FROM inventory_transactions
          WHERE transaction_type = 'INBOUND'
          ORDER BY id ASC`
      ),
      queryFn(
        `SELECT UPPER(TRIM(p.code)) AS code,
                COALESCE(p.cost_price, 0)::numeric AS cost_price,
                COALESCE((SELECT MAX(l.unit_cost) FROM inventory_lots l WHERE UPPER(TRIM(l.product_code)) = UPPER(TRIM(p.code)) AND l.unit_cost > 0), 0)::numeric AS lot_cost
           FROM products p
          WHERE COALESCE(p.cost_price, 0) > 0
             OR EXISTS (SELECT 1 FROM inventory_lots l WHERE UPPER(TRIM(l.product_code)) = UPPER(TRIM(p.code)) AND l.unit_cost > 0)`
      ).catch(() => ({ rows: [] as any[] })),
      queryFn(
        `SELECT supplier_id, UPPER(TRIM(product_code)) AS code, purchase_price
           FROM supplier_products
          WHERE purchase_price > 0`
      ).catch(() => ({ rows: [] as any[] })),
    ]);

    if (posRes.rows.length === 0) return;

    // Bản đồ giá nhập theo (PO|SKU), theo SKU từ phiếu nhập kho, theo NCC|SKU, và theo giá vốn sản phẩm/lô
    const priceByPoAndCode = new Map<string, number>();
    const inboundPriceByCode = new Map<string, number>();
    const supplierPriceByKey = new Map<string, number>();
    const masterCostByCode = new Map<string, number>();

    for (const r of prodCostRes.rows) {
      const code = String(r.code || "").trim().toUpperCase();
      const cost = r3(Number(r.lot_cost) > 0 ? r.lot_cost : r.cost_price);
      if (code && cost > 0) masterCostByCode.set(code, cost);
    }

    for (const r of supProdRes.rows) {
      const code = String(r.code || "").trim().toUpperCase();
      const price = r3(r.purchase_price);
      if (r.supplier_id && code && price > 0) {
        supplierPriceByKey.set(`${r.supplier_id}|${code}`, price);
        if (!masterCostByCode.has(code)) masterCostByCode.set(code, price);
      }
    }

    // Tổng hợp số lượng đã nhập từ các phiếu INBOUND có gắn mã PO
    const txQtyByPoAndCode = new Map<string, number>();
    const firstTxCodeByPo = new Map<string, string>();

    // Chuẩn bị danh sách PO đang mở để tự động khớp các phiếu INBOUND quên gắn mã PO tham chiếu
    const openPoCandidates = posRes.rows
      .filter((p: any) => !["DRAFT", "CANCELLED", "COMPLETED"].includes(String(p.status || "").toUpperCase()))
      .map((p: any) => {
        let its: any = p.items;
        if (typeof its === "string") {
          try {
            its = JSON.parse(its);
          } catch {
            its = [];
          }
        }
        return {
          id: p.id,
          po_code: String(p.po_code || "").trim(),
          po_code_upper: String(p.po_code || "").trim().toUpperCase(),
          supplier_name: String(p.supplier_name || "").trim().toUpperCase(),
          items: Array.isArray(its) ? its : [],
          received: { ...(p.received_qty || {}) } as Record<string, number>,
        };
      });

    for (const tx of txRes.rows) {
      const refRaw = String(tx.reference_code || "").trim();
      const notesRaw = String(tx.notes || "").trim();
      let poCode = (
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

      // Nếu phiếu INBOUND không ghi mã PO tham chiếu -> tìm PO đang mở có cùng mã hàng (ưu tiên cùng NCC) còn thiếu số lượng
      if (!poCode && (!refRaw || refRaw === "N/A" || !/^SO/i.test(refRaw))) {
        const txSup = String(txItems[0]?.supplier_name || "").trim().toUpperCase();
        const txCodes = new Set(
          txItems.map((it: any) => String(it?.product_code || it?.productCode || "").trim().toUpperCase()).filter(Boolean)
        );
        if (txCodes.size > 0) {
          const matchedCand =
            openPoCandidates.find(
              (c) =>
                txSup &&
                c.supplier_name &&
                (c.supplier_name.includes(txSup) || txSup.includes(c.supplier_name)) &&
                c.items.some((it: any, idx: number) => {
                  const ic = String(it?.product_code || "").trim().toUpperCase();
                  const ord = Number(it?.quantity) || 0;
                  const rec = (Number(c.received[idx]) || 0) + (txQtyByPoAndCode.get(`${c.po_code_upper}|${ic}`) || 0);
                  return txCodes.has(ic) && ord > rec;
                })
            ) ||
            openPoCandidates.find((c) =>
              c.items.some((it: any, idx: number) => {
                const ic = String(it?.product_code || "").trim().toUpperCase();
                const ord = Number(it?.quantity) || 0;
                const rec = (Number(c.received[idx]) || 0) + (txQtyByPoAndCode.get(`${c.po_code_upper}|${ic}`) || 0);
                return txCodes.has(ic) && ord > rec;
              })
            );

          if (matchedCand) {
            poCode = matchedCand.po_code_upper;
            if (!refRaw || refRaw === "N/A") {
              await queryFn(`UPDATE inventory_transactions SET reference_code = $1 WHERE id = $2`, [matchedCand.po_code, tx.id]).catch(
                () => {}
              );
            }
          }
        }
      }

      if (poCode && tx.transaction_code && !firstTxCodeByPo.has(poCode)) {
        firstTxCodeByPo.set(poCode, tx.transaction_code);
      }

      for (const it of txItems) {
        const code = String(it?.product_code || it?.productCode || "").trim().toUpperCase();
        if (!code) continue;
        const uPrice = r3(it?.unit_price ?? it?.cost_price ?? 0);
        const qty = Number(it?.quantity) || 0;
        if (uPrice > 0) {
          inboundPriceByCode.set(code, uPrice);
          if (poCode) priceByPoAndCode.set(`${poCode}|${code}`, uPrice);
        }
        if (poCode && qty > 0) {
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
      let itemsChanged = false;
      let receivedChanged = false;

      // 1. Đối soát số lượng đã nhận từ các phiếu INBOUND gắn mã PO này
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

      // 2. Đồng bộ đơn giá lên các dòng PO đang có unit_price = 0 (hoặc lệch với giá trên phiếu nhập của chính PO đó)
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const code = String(it?.product_code || "").trim().toUpperCase();
        if (!code) continue;
        const curPrice = r3(it?.unit_price);
        const exactPoInboundPrice = priceByPoAndCode.get(`${poCodeUpper}|${code}`) || 0;

        if (exactPoInboundPrice > 0 && curPrice !== exactPoInboundPrice) {
          recalcPOItemWithPrice(it, exactPoInboundPrice);
          itemsChanged = true;
        } else if (curPrice <= 0) {
          const fallbackPrice =
            inboundPriceByCode.get(code) ||
            (po.supplier_id ? supplierPriceByKey.get(`${po.supplier_id}|${code}`) : 0) ||
            masterCostByCode.get(code) ||
            0;
          if (fallbackPrice > 0) {
            recalcPOItemWithPrice(it, fallbackPrice);
            itemsChanged = true;
          }
        }
      }

      const computedTotal = computePOTotalFromItems(items);
      const storedTotal = r3(po.total_amount);
      const totalNeedsUpdate = computedTotal > 0 && Math.abs(storedTotal - computedTotal) > 0.01;

      if (itemsChanged || receivedChanged || totalNeedsUpdate) {
        const st = String(po.status || "").toUpperCase();
        const allDone = items.every(
          (it: any, i: number) => (Number(it?.quantity) || 0) <= 0 || (Number(received[i]) || 0) >= (Number(it?.quantity) || 0)
        );
        const anyReceived = Object.values(received).some((v) => Number(v) > 0);
        const newStatus =
          st === "COMPLETED"
            ? "COMPLETED"
            : receivedChanged
            ? allDone
              ? "COMPLETED"
              : anyReceived
              ? "PARTIALLY_RECEIVED"
              : po.status
            : po.status;
        const txCode = firstTxCodeByPo.get(poCodeUpper) || po.inbound_transaction_code || null;

        await queryFn(
          `UPDATE procurement_orders
              SET items = $1::jsonb,
                  total_amount = $2,
                  received_qty = $3::jsonb,
                  status = $4,
                  inbound_transaction_code = COALESCE(inbound_transaction_code, $5),
                  version = COALESCE(version, 0) + 1
            WHERE id = $6`,
          [JSON.stringify(items), computedTotal > 0 ? computedTotal : storedTotal, JSON.stringify(received), newStatus, txCode, po.id]
        ).catch(() => {});
      }
    }
  } catch (err) {
    console.error("[PO_RECEIPT_RECONCILE] error:", err);
  }
}
