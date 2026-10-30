"use client";

import { api } from "../api";

const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const d = (v: string | null | undefined) => (v ? v.slice(0, 10).split("-").reverse().join("/") : "");
const num = (v: number) => v.toLocaleString("vi-VN", { maximumFractionDigits: 4 });

/** Printed preparation record ("In phiếu pha"), from the recorded preparation — what was used, not the formula. */
export async function printPreparation(id: string) {
  const p = await api<any>(`/api/factory/prep/preparations/${id}`);
  const rows = (p.lines as any[])
    .map((l, i) => `<tr><td>${i + 1}</td><td>${esc(l.item_code)}</td><td>${esc(l.lot_code ?? "")}</td><td class="r">${num(l.qty_base)} ${esc(l.uom)}</td><td></td></tr>`)
    .join("");
  const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Phiếu pha ${esc(p.code)}</title><style>
@page { size: A4; margin: 14mm 12mm } body { font: 10pt/1.4 Arial, sans-serif; margin: 0 }
h1 { text-align: center; font-size: 14pt; margin: 0 0 4pt } .sub { text-align: center; margin-bottom: 10pt }
table { width: 100%; border-collapse: collapse; margin: 6pt 0 } th, td { border: 0.5pt solid #555; padding: 3pt 5pt; text-align: left; vertical-align: top } th { background: #eee }
.meta td { border: none; padding: 1pt 4pt } .r { text-align: right } .box { border: 0.5pt solid #555; padding: 5pt; min-height: 40pt; white-space: pre-line }
.sign { display: flex; justify-content: space-between; margin-top: 24pt; text-align: center } .sign div { width: 30% }
</style></head><body>
<h1>PHIẾU PHA CHẾ HÓA CHẤT</h1><div class="sub">Số ${esc(p.code)}${p.status === "CANCELLED" ? " — ĐÃ HỦY" : ""}</div>
<table class="meta">
<tr><td>Công thức</td><td><b>${esc(p.formula_code)}</b> — ${esc(p.formula_name)}</td><td>Kho</td><td>${esc(p.warehouse_code)}</td></tr>
<tr><td>Sản phẩm</td><td>${esc(p.item_code)} — ${esc(p.item_name)}</td><td>Số lô</td><td><b>${esc(p.lot_code)}</b></td></tr>
<tr><td>Lượng pha</td><td>${num(p.qty_out)} ${esc(p.uom_out)}</td><td>Ngày pha / hạn dùng</td><td>${d(p.mfg_date)} / ${d(p.expiry_date)}</td></tr>
<tr><td>Ủ / QC</td><td colspan="3">${p.incubation_days ? `Ủ ${p.incubation_days} ngày (đến ${d(p.incubation_until)})${p.incubated_at ? ` — ủ xong ${new Date(p.incubated_at).toLocaleString("vi-VN")} (${esc(p.incubated_by_name ?? "")})` : ""}` : "Không ủ"} · ${p.requires_qc ? "Cần QC trước khi dùng" : "Không cần QC"}</td></tr>
</table>
<table><tr><th>#</th><th>Nguyên liệu</th><th>Lô đã dùng</th><th>Lượng</th><th>Kiểm tra (ký)</th></tr>${rows}</table>
<div><b>Hướng dẫn pha</b></div><div class="box">${esc(p.instructions ?? "")}</div>
${p.notes ? `<p>Ghi chú: ${esc(p.notes)}</p>` : ""}
<div class="sign"><div>Người pha<br><br><br>${esc(p.prepared_by_name ?? "")}<br>${new Date(p.prepared_at).toLocaleString("vi-VN")}</div><div>Người kiểm tra<br><br><br><br></div><div>Trưởng bộ phận<br><br><br><br></div></div>
<script>window.onload = () => { window.focus(); window.print() }</script></body></html>`;
  const frame = document.createElement("iframe");
  frame.style.cssText = "position:fixed;width:0;height:0;border:0;right:0;bottom:0";
  document.body.appendChild(frame);
  frame.contentDocument!.open();
  frame.contentDocument!.write(html);
  frame.contentDocument!.close();
  setTimeout(() => frame.remove(), 60_000);
}
