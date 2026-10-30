"use client";

import { api } from "./api";

const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const d = (v: string | null | undefined) => (v ? v.slice(0, 10).split("-").reverse().join("/") : "");
const num = (v: number | null | undefined) => (v == null ? "" : v.toLocaleString("vi-VN", { maximumFractionDigits: 3 }));
const lines = (s: string | null) => (s ? s.split(/\r?\n/).map(esc).join("<br>") : "");

interface Result { name: string; unit: string | null; method?: string | null; value_type: string; lower_limit: number | string | null; upper_limit: number | string | null; target: string | null }
const spec = (p: Result) =>
  p.value_type === "NUMERIC"
    ? [p.lower_limit != null ? `≥ ${num(Number(p.lower_limit))}` : "", p.upper_limit != null ? `≤ ${num(Number(p.upper_limit))}` : ""].filter(Boolean).join(", ")
    : p.value_type === "PASS_FAIL"
      ? "Đạt"
      : p.target ?? "";
const value = (r: { value_numeric: number | string | null; observed_numeric?: number | string | null; value_text: string | null }, unit: string | null) =>
  r.value_numeric != null
    ? `${num(Number(r.value_numeric))} ${esc(unit ?? "")}${r.observed_numeric != null ? ` (đo ${num(Number(r.observed_numeric))})` : ""}`
    : r.value_text === "PASS" ? "Đạt" : r.value_text === "FAIL" ? "Không đạt" : esc(r.value_text);
const sig = (s: { signer_name: string; signed_at: string } | null) => (s ? `${esc(s.signer_name)} — ký điện tử ${new Date(s.signed_at).toLocaleString("vi-VN")}` : "");

function page(title: string, header: string | null, body: string, footer: string | null) {
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
@page { size: A4; margin: 14mm 12mm }
body { font: 10pt/1.35 Arial, sans-serif; color: #000; margin: 0 }
.head { border-bottom: 1.5pt solid #000; padding-bottom: 4pt; margin-bottom: 8pt; font-size: 9pt }
h1 { text-align: center; font-size: 14pt; margin: 6pt 0 2pt } .sub { text-align: center; margin-bottom: 8pt }
table { width: 100%; border-collapse: collapse; margin: 6pt 0 } th, td { border: 0.5pt solid #555; padding: 2pt 4pt; vertical-align: top; text-align: left }
th { background: #eee } .seq { font-family: "Courier New", monospace; word-break: break-all; font-size: 8.5pt } .r { text-align: right }
.meta td { border: none; padding: 1pt 4pt } .sign { margin-top: 10pt } .foot { margin-top: 12pt; font-size: 8.5pt; border-top: 0.5pt solid #555; padding-top: 4pt }
.block { page-break-inside: avoid; margin-bottom: 10pt }
</style></head><body><div class="head">${lines(header)}</div>${body}<div class="foot">${lines(footer)}</div><script>window.onload = () => { window.focus(); window.print() }</script></body></html>`;
}

function print(html: string) {
  const frame = document.createElement("iframe");
  frame.style.cssText = "position:fixed;width:0;height:0;border:0;right:0;bottom:0";
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  doc.open();
  doc.write(html);
  doc.close();
  setTimeout(() => frame.remove(), 60_000);
}

/** COA of one reviewed QC test (lot or sequence), printed from the reviewed results. */
export async function printTestCoa(testId: string) {
  const c = await api<any>(`/api/factory/qms/tests/${testId}/coa`);
  const t = c.test;
  const subject = c.lot
    ? `<tr><td>Sản phẩm</td><td>${esc(c.lot.item_code)} — ${esc(c.lot.item_name)}</td><td>Số lô</td><td>${esc(c.lot.code)}${c.lot.mfr_lot_no ? ` (NSX ${esc(c.lot.mfr_lot_no)})` : ""}</td></tr>
       <tr><td>Ngày sản xuất</td><td>${d(c.lot.mfg_date)}</td><td>Hạn dùng</td><td>${d(c.lot.expiry_date)}</td></tr>`
    : `<tr><td>Đối tượng</td><td colspan="3">${esc(t.subject?.label ?? "")}</td></tr>`;
  const ref = t.subject?.reference;
  const oligo = ref
    ? `<tr><td>Trình tự 5'→3'</td><td colspan="3" class="seq">${esc(ref.normalized_sequence)}</td></tr>
       <tr><td>Số base / MW lý thuyết</td><td>${esc(ref.base_count)} nt · ${num(ref.mw)} Da</td><td>Thang / tinh sạch</td><td>${esc(ref.scale_code)} · ${esc(ref.purification)}</td></tr>
       <tr><td>Lượng thu được</td><td colspan="3">${num(ref.od_total)} OD · ${num(ref.nmol)} nmol · ${num(ref.ug)} µg${ref.tube_count ? ` · ${ref.tube_count} ống` : ""}</td></tr>`
    : "";
  const rows = t.parameters
    .map((p: any) => {
      const r = t.results.find((x: any) => x.parameter_id === p.id);
      return `<tr><td>${esc(p.name)}</td><td>${esc(p.method ?? "")}</td><td>${spec(p)} ${esc(p.unit ?? "")}</td><td>${r ? value(r, p.unit) : ""}</td><td>${r?.passed == null ? "" : r.passed ? "Đạt" : "Không đạt"}</td></tr>`;
    })
    .join("");
  const body = `<h1>PHIẾU KẾT QUẢ PHÂN TÍCH (COA)</h1><div class="sub">Số phiếu ${esc(t.code)} · Tiêu chuẩn ${esc(t.spec_code)} rev ${esc(t.spec_version)}</div>
    <table class="meta">${subject}${oligo}</table>
    <table><tr><th>Chỉ tiêu</th><th>Phương pháp</th><th>Yêu cầu</th><th>Kết quả</th><th>Đánh giá</th></tr>${rows}</table>
    <p><b>Kết luận: ${t.overall_result === "PASS" ? "ĐẠT" : "KHÔNG ĐẠT"}</b></p>
    <div class="sign">Kiểm nghiệm: ${esc(t.analyst_name ?? "")}<br>Duyệt kết quả: ${sig(c.signature) || esc(t.reviewer_name ?? "")}</div>`;
  print(page(`COA ${t.code}`, c.header, body, c.footer));
}

/** COA of an Oligo order: every sequence with its theoretical values, measured quantity and passed QC results. */
export async function printOrderCoa(orderId: string) {
  const c = await api<any>(`/api/factory/oligo/orders/${orderId}/coa`);
  const blocks = c.sequences
    .map((s: any) => {
      const head = `<tr><td>Mã / tên</td><td colspan="3"><b>${esc(s.code)}</b> — ${esc(s.name)}</td></tr>
        <tr><td>Trình tự 5'→3'</td><td colspan="3" class="seq">${esc(s.normalized_sequence)}</td></tr>
        <tr><td>Số base / loại</td><td>${esc(s.base_count)} nt · ${esc(s.molecule_type)}</td><td>Thang / tinh sạch / dạng</td><td>${esc(s.scale_code)} · ${esc(s.purification)} · ${s.format === "LIQUID" ? "Dung dịch" : "Đông khô"}</td></tr>
        <tr><td>MW / Tm / GC</td><td>${num(s.mw)} Da · ${num(s.tm)} °C · ${num(s.gc_percent)} %</td><td>ε260 / nmol/OD / µg/OD</td><td>${num(s.ext_coeff_260)} · ${num(s.nmol_per_od)} · ${num(s.ug_per_od)}</td></tr>
        <tr><td>Lượng thu được</td><td colspan="3">${s.measured ? `${num(s.measured.od_total)} OD · ${num(s.measured.nmol)} nmol · ${num(s.measured.ug)} µg · ${s.measured.tube_count} ống` : "—"}</td></tr>`;
      const qc = s.qc
        ? `<table><tr><th>Chỉ tiêu</th><th>Yêu cầu</th><th>Kết quả</th><th>Đánh giá</th></tr>${s.qc.results
            .map((r: any) => `<tr><td>${esc(r.name)}</td><td>${spec(r)} ${esc(r.unit ?? "")}</td><td>${value(r, r.unit)}</td><td>${r.passed == null ? "" : r.passed ? "Đạt" : "Không đạt"}</td></tr>`)
            .join("")}</table><div>Phiếu QC ${esc(s.qc.code)} · Duyệt: ${sig(s.qc.signature)}</div>`
        : "<p><i>Chưa có kết quả QC đạt.</i></p>";
      return `<div class="block"><table class="meta">${head}</table>${qc}</div>`;
    })
    .join("");
  const o = c.order;
  const body = `<h1>PHIẾU PHÂN TÍCH CHẤT LƯỢNG SẢN PHẨM</h1><div class="sub">Đơn ${esc(o.code)}${o.kd_po_code ? ` · PO ${esc(o.kd_po_code)}` : ""}${o.customer_label ? ` · ${esc(o.customer_label)}` : ""}</div>${blocks}`;
  print(page(`COA ${o.code}`, c.header, body, c.footer));
}
