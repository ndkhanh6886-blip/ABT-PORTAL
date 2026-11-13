"use client";

import * as XLSX from "xlsx";
import { writeSafePrintDocument } from "@/frontend/utils/safePrint";
import { formatDayVN } from "@/frontend/components/DateInputVN";

/** Thông tin tài chính của phiếu (NCC, số HĐ, tổng tiền...) - cùng dạng với txFinanceMeta trong WarehouseModule. */
export type SlipFinanceMeta = {
  supplier: string;
  invoice: string;
  inboundType: string;
  shipping: string;
  hasPrice: boolean;
  total: number;
};

export type SlipCompany = {
  companyName?: string;
  companyAddress?: string;
  companyPhone?: string;
  companyTaxCode?: string;
};

const esc = (v: any) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const money = (n: number) => new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(Number(n) || 0);

const slipItems = (tx: any): any[] => (Array.isArray(tx?.items) ? tx.items : []);

const hasUnitPrice = (it: any) => it?.unit_price !== undefined && it?.unit_price !== null;

/** Khách hàng của phiếu xuất (ghi trong ghi chú "… - Khách hàng: X") hoặc NCC của phiếu nhập. */
export function txPartnerName(tx: any, meta?: SlipFinanceMeta): string {
  if (String(tx?.transaction_type || "").toUpperCase() === "INBOUND") return meta?.supplier || "";
  const first = slipItems(tx).find((i: any) => i?.customer_name) || {};
  const notes = String(tx?.notes || "");
  const m = notes.match(/Khách hàng:\s*([^•|\n]+?)\s*(?:[•|]|$)/i);
  return String(first.customer_name || tx?.customer_name || (m ? m[1] : "") || "").trim();
}

/** Mẫu in phiếu nhập / xuất kho khổ A4: phần đầu in một lần, tiêu đề bảng lặp lại ở mỗi trang, có ô ký. */
export function buildWarehouseSlipHtml(tx: any, meta: SlipFinanceMeta, company: SlipCompany): string {
  const isIn = String(tx?.transaction_type || "").toUpperCase() === "INBOUND";
  const title = isIn ? "PHIẾU NHẬP KHO" : "PHIẾU XUẤT KHO";
  const items = slipItems(tx);
  const showPrice = items.some(hasUnitPrice);
  const partner = txPartnerName(tx, meta);
  const totalQty = items.reduce((s, it) => s + (Number(it?.quantity) || 0), 0);

  const rows = items
    .map((it: any, i: number) => {
      const price = hasUnitPrice(it) ? Number(it.unit_price) || 0 : null;
      return `<tr>
        <td class="c">${i + 1}</td>
        <td class="code">${esc(it.product_code || it.productCode)}</td>
        <td class="name">${esc(it.product_name || it.name)}${it.specification ? `<div class="sub">${esc(it.specification)}</div>` : ""}</td>
        <td class="mono">${esc(it.lot_number || "—")}</td>
        <td class="mono c">${esc(it.expiry_date ? formatDayVN(it.expiry_date) || it.expiry_date : "—")}</td>
        <td>${esc(it.unit || "")}</td>
        <td class="r b">${esc(it.quantity)}</td>
        ${showPrice ? `<td class="r">${price === null ? "—" : money(price)}</td><td class="r b">${price === null ? "—" : money(price * (Number(it.quantity) || 0))}</td>` : ""}
        <td class="sub2">${esc(it.storage_condition || "")}${it.shelf_position ? ` · ${esc(it.shelf_position)}` : ""}</td>
        <td class="sub2">${esc(it.notes || it.item_notes || "—")}</td>
      </tr>`;
    })
    .join("");

  const info = [
    ["Ngày", tx?.date ? formatDayVN(tx.date) : ""],
    [isIn ? "Nhà cung cấp" : "Khách hàng / Nơi nhận", partner || "—"],
    [isIn ? "PO / Chứng từ gốc" : "SO / Chứng từ gốc", tx?.reference_code || "—"],
    ...(isIn ? [["Số HĐ VAT / Tờ khai", meta.invoice || "—"]] : []),
    ["Kho", tx?.warehouse_name || "Kho Trung Tâm"],
    ["Người lập", tx?.performed_by || ""],
  ]
    .map(([k, v]) => `<div><span>${esc(k)}:</span> <b>${esc(v)}</b></div>`)
    .join("");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)} ${esc(tx?.transaction_code)}</title>
<style>
  @page { size: A4 portrait; margin: 12mm 10mm; }
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", Arial, sans-serif; color: #0f172a; font-size: 10.5px; margin: 0; padding: 12px; background: #fff; }
  .head { display: flex; justify-content: space-between; gap: 16px; border-bottom: 2px solid #0f172a; padding-bottom: 8px; }
  .co b { font-size: 13px; text-transform: uppercase; }
  .co div { color: #334155; }
  h1 { text-align: center; font-size: 20px; margin: 14px 0 2px; letter-spacing: .5px; }
  .no { text-align: center; color: #475569; margin-bottom: 10px; }
  .info { display: grid; grid-template-columns: 1fr 1fr; gap: 3px 24px; margin-bottom: 10px; }
  .info span { color: #475569; }
  .note { border: 1px solid #cbd5e1; padding: 6px 8px; margin-bottom: 10px; }
  table { width: 100%; border-collapse: collapse; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }
  th, td { border: 1px solid #94a3b8; padding: 3px 4px; vertical-align: top; }
  th { background: #e2e8f0; font-size: 9px; text-transform: uppercase; white-space: nowrap; }
  td.c, th.c { text-align: center; } td.r { text-align: right; white-space: nowrap; } td.b { font-weight: 700; }
  td.code { font-weight: 800; font-family: Consolas, monospace; font-size: 11px; white-space: nowrap; }
  td.mono { font-family: Consolas, monospace; font-size: 10px; word-break: break-all; max-width: 90px; }
  td.mono.c { white-space: nowrap; word-break: normal; max-width: none; }
  td.name { min-width: 160px; }
  .sub { color: #64748b; font-size: 10px; } .sub2 { color: #475569; font-size: 10px; }
  tfoot td { font-weight: 800; background: #f1f5f9; }
  .sign { display: grid; grid-template-columns: repeat(3, 1fr); text-align: center; margin-top: 22px; page-break-inside: avoid; }
  .sign b { display: block; } .sign i { color: #64748b; font-size: 10px; }
  .sign div { min-height: 90px; }
</style></head><body>
  <div class="head">
    <div class="co"><b>${esc(company.companyName)}</b>
      ${company.companyAddress ? `<div>${esc(company.companyAddress)}</div>` : ""}
      ${company.companyPhone ? `<div>ĐT: ${esc(company.companyPhone)}</div>` : ""}
      ${company.companyTaxCode ? `<div>MST: ${esc(company.companyTaxCode)}</div>` : ""}
    </div>
    <div style="text-align:right;color:#475569">Mẫu số: ${isIn ? "01-VT" : "02-VT"}</div>
  </div>
  <h1>${title}</h1>
  <div class="no">Số: <b>${esc(tx?.transaction_code)}</b></div>
  <div class="info">${info}</div>
  ${tx?.notes ? `<div class="note"><b>Ghi chú:</b> ${esc(tx.notes)}</div>` : ""}
  <table>
    <thead><tr>
      <th class="c">#</th><th>Mã hàng</th><th>Tên hàng hóa</th><th>Số lô</th><th class="c">Hạn dùng</th><th>ĐVT</th><th>SL</th>
      ${showPrice ? "<th>Đơn giá</th><th>Thành tiền</th>" : ""}<th>Bảo quản / Vị trí</th><th>Ghi chú</th>
    </tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr>
      <td colspan="6" class="r">Tổng cộng (${items.length} dòng)</td><td class="r">${totalQty}</td>
      ${showPrice ? `<td></td><td class="r">${money(meta.total)}</td>` : ""}<td></td><td></td>
    </tr></tfoot>
  </table>
  <div class="sign">
    <div><b>Người lập phiếu</b><i>(Ký, ghi rõ họ tên)</i></div>
    <div><b>${isIn ? "Người giao hàng" : "Người nhận hàng"}</b><i>(Ký, ghi rõ họ tên)</i></div>
    <div><b>Thủ kho</b><i>(Ký, ghi rõ họ tên)</i></div>
  </div>
</body></html>`;
}

/** Mở cửa sổ in phiếu kho (tài liệu chạy trong iframe sandbox, không chạy script). */
export function printWarehouseSlip(tx: any, meta: SlipFinanceMeta, company: SlipCompany) {
  const win = window.open("", "_blank");
  if (!win) {
    alert("Trình duyệt đã chặn cửa sổ in. Vui lòng cho phép cửa sổ bật lên (pop-up) cho trang này.");
    return;
  }
  writeSafePrintDocument(win, buildWarehouseSlipHtml(tx, meta, company), {
    title: `${String(tx?.transaction_type).toUpperCase() === "INBOUND" ? "PNK" : "PXK"} ${tx?.transaction_code || ""}`,
  });
}

/** Xuất phiếu kho ra file Excel (mỗi dòng hàng một dòng, kèm thông tin đầu phiếu). */
export function exportWarehouseSlipExcel(tx: any, meta: SlipFinanceMeta) {
  const isIn = String(tx?.transaction_type || "").toUpperCase() === "INBOUND";
  const partner = txPartnerName(tx, meta);
  const items = slipItems(tx);
  const showPrice = items.some(hasUnitPrice);
  const header: any[][] = [
    [isIn ? "PHIẾU NHẬP KHO" : "PHIẾU XUẤT KHO", tx?.transaction_code || ""],
    ["Ngày", tx?.date ? formatDayVN(tx.date) : ""],
    [isIn ? "Nhà cung cấp" : "Khách hàng", partner],
    ["Chứng từ gốc (PO / SO)", tx?.reference_code || ""],
    ...(isIn ? [["Số HĐ VAT / Tờ khai", meta.invoice || ""]] : []),
    ["Kho", tx?.warehouse_name || "Kho Trung Tâm"],
    ["Người lập", tx?.performed_by || ""],
    ["Ghi chú", tx?.notes || ""],
    [],
  ];
  const cols = ["STT", "Mã hàng", "Tên hàng hóa", "Quy cách", "Số lô", "Hạn dùng", "ĐVT", "Số lượng",
    ...(showPrice ? ["Đơn giá", "Thành tiền"] : []), "Điều kiện bảo quản", "Vị trí kệ", "Tình trạng QC", "Ghi chú"];
  const body = items.map((it: any, i: number) => {
    const price = hasUnitPrice(it) ? Number(it.unit_price) || 0 : "";
    return [
      i + 1,
      it.product_code || it.productCode || "",
      it.product_name || it.name || "",
      it.specification || "",
      it.lot_number || "",
      it.expiry_date ? formatDayVN(it.expiry_date) || it.expiry_date : "",
      it.unit || "",
      Number(it.quantity) || 0,
      ...(showPrice ? [price, price === "" ? "" : (price as number) * (Number(it.quantity) || 0)] : []),
      it.storage_condition || "",
      it.shelf_position || "",
      it.qc_status || "",
      it.notes || it.item_notes || "",
    ];
  });
  const ws = XLSX.utils.aoa_to_sheet([...header, cols, ...body]);
  ws["!cols"] = [{ wch: 6 }, { wch: 18 }, { wch: 48 }, { wch: 16 }, { wch: 18 }, { wch: 12 }, { wch: 8 }, { wch: 10 },
    ...(showPrice ? [{ wch: 14 }, { wch: 16 }] : []), { wch: 24 }, { wch: 18 }, { wch: 22 }, { wch: 24 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, isIn ? "PhieuNhapKho" : "PhieuXuatKho");
  const safeCode = String(tx?.transaction_code || "phieu").replace(/[^\w.-]+/g, "_");
  XLSX.writeFile(wb, `${isIn ? "PNK" : "PXK"}_${safeCode}.xlsx`);
}
