"use client";

import QRCode from "qrcode";
import { api, ApiError } from "../api";
import { openPrintWindowSync, renderHtmlToPrintWindow } from "../coa";

export interface TubeLabel {
  code: string; name: string; order_code: string | null; customer: string | null; sequence: string; bases: number; mw: number; tm: number;
  scale: string; purification: string; format: string; modifications: string[]; tube: string;
  volume_ul: number | null; conc_um: number | null; released: boolean; date: string;
  sequence_id: string; od: number | null; nmol: number | null; preview?: boolean; printable?: boolean; printed?: boolean;
}

const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const vnDate = (d: string) => d.split("-").reverse().join("/");

function addMonthsIso(isoDate: string, months: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) return isoDate;
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1 + months, Number(m[3])));
  return dt.toISOString().slice(0, 10);
}

function renderQrSvgSync(payload: string): string {
  try {
    const qr = QRCode.create(payload || "ABT-OLIGO", { errorCorrectionLevel: "M" });
    const size = qr.modules.size;
    const data = qr.modules.data;
    let d = "";
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (data[r * size + c]) {
          d += `M${c + 1},${r + 1}h1v1h-1z`;
        }
      }
    }
    return `<svg class="qr" viewBox="0 0 ${size + 2} ${size + 2}" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges"><rect width="${size + 2}" height="${size + 2}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
  } catch {
    return "";
  }
}

/** One 50 × 30 mm label per page (thermal label printer); a tube not yet released by QC is marked as such. */
export function labelHtml(labels: TubeLabel[], autoPrint = true) {
  const body = labels
    .map((l) => {
      const expDate = addMonthsIso(l.date, 12);
      const qrPayload = `OLIGO:${l.code}|NAME:${l.name}|TUBE:${l.tube}|MFG:${l.date}|EXP:${expDate}`;
      return `<section>
  ${renderQrSvgSync(qrPayload)}
  <div class="top"><b>${esc(l.code)}</b><span>${esc(l.tube)}</span></div>
  <div class="name">${esc(l.name)}</div>
  <div class="seq">5'-${esc(l.sequence.length > 60 ? `${l.sequence.slice(0, 57)}…` : l.sequence)}-3'</div>
  <div>${esc(l.bases)} nt · MW ${esc(l.mw)} · Tm ${esc(l.tm)}°C</div>
  <div>${l.od == null ? "— OD (chưa đo)" : `${esc(l.od)} OD · ${esc(l.nmol)} nmol`}${l.volume_ul ? ` · ${esc(l.volume_ul)} µL @ ${esc(l.conc_um)} µM` : ""}</div>
  <div>${esc(l.scale)} · ${esc(l.purification)}${l.order_code ? ` · ${esc(l.order_code)}` : ""}</div>
  <div class="storage">Bảo quản: -20°C · NSX: ${esc(vnDate(l.date))} · HSD: ${esc(vnDate(expDate))}</div>
  <div class="foot"><span>${esc(l.customer ?? "")}</span></div>
  ${l.preview ? '<div class="hold">XEM TRƯỚC</div>' : l.released ? "" : '<div class="hold">CHƯA XUẤT XƯỞNG</div>'}
</section>`;
    })
    .join("");
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Nhãn ống Oligo (${labels.length} tem)</title><style>
@page { size: 50mm 30mm; margin: 0 }
* { box-sizing: border-box }
body { margin: 0; font: 6pt/1.2 Arial, sans-serif; color: #000; background: #fff }
section { width: 50mm; height: 30mm; padding: 1.3mm 1.8mm; page-break-after: always; overflow: hidden; position: relative }
.top { display: flex; justify-content: space-between; font-size: 7.5pt; padding-right: 11mm }
.name { font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding-right: 11mm }
.seq { font-family: "Courier New", monospace; word-break: break-all; font-size: 5.5pt; padding-right: 11mm }
.storage { font-size: 5.5pt; font-weight: bold; margin-top: 0.4mm }
.qr { position: absolute; right: 1.5mm; top: 1.5mm; width: 10mm; height: 10mm; border: 0.2mm solid #000 }
.foot { display: flex; justify-content: space-between; position: absolute; left: 1.8mm; right: 1.8mm; bottom: 1mm; font-size: 5.5pt }
.hold { position: absolute; right: 1.5mm; top: 12mm; border: 0.3mm solid #000; padding: 0 1mm; font-weight: bold; font-size: 5.5pt; background: #fff }
.no-print { display: flex; justify-content: space-between; align-items: center; background: #fff; padding: 8px 12px; border-radius: 6px; border: 1px solid #cbd5e1; margin-bottom: 10px; font-size: 12px }
.no-print-btn { background: #0284c7; color: #fff; border: none; padding: 6px 12px; border-radius: 6px; font-weight: bold; cursor: pointer; font-size: 12px }
@media screen { body { background: #e2e8f0; padding: 12px } section { background: #fff; margin: 0 auto 10px; box-shadow: 0 2px 6px rgba(0,0,0,0.15); border: 1px solid #94a3b8 } }
@media print { .no-print { display: none !important } body { background: #fff; padding: 0 } section { margin: 0; box-shadow: none; border: none } }
</style></head><body>
${
  autoPrint
    ? `<div class="no-print">
  <div><b>🏷️ Bản in Nhãn Ống Oligo (${labels.length} tem · Khổ 50 × 30 mm)</b></div>
  <div style="display:flex;gap:8px">
    <button class="no-print-btn" onclick="window.print()">🖨️ In Tem Nhãn</button>
    <button class="no-print-btn" style="background:#475569" onclick="window.close()">Đóng</button>
  </div>
</div>`
    : ""
}
${body}</body></html>`;
}

/** Asks the server for the label data (which records the print), then opens a dedicated print window for the labels. */
export async function printTubeLabels(sequenceIds: string[], reason?: string) {
  const win = openPrintWindowSync("Đang chuẩn bị bản in Nhãn Ống Oligo...");
  try {
    const labels = await api<TubeLabel[]>("/api/factory/oligo/labels", { method: "POST", json: { sequence_ids: sequenceIds, reason: reason || null } });
    renderHtmlToPrintWindow(labelHtml(labels, true), win);
    return labels.length;
  } catch (err) {
    win?.close();
    throw err;
  }
}

/** Prints; when a sequence was printed before, asks for the reprint reason and tries once more. */
export async function printWithReprint(sequenceIds: string[]) {
  try {
    return await printTubeLabels(sequenceIds);
  } catch (e) {
    if (!(e instanceof ApiError) || e.code !== "REPRINT_REASON") throw e;
    const reason = window.prompt(`${e.message}\nLý do in lại:`);
    if (!reason) return 0;
    return printTubeLabels(sequenceIds, reason);
  }
}

/** Label preview (nothing recorded): what the tubes of these sequences will carry, at any stage of production. */
export async function previewTubeLabels(sequenceIds: string[]) {
  return api<TubeLabel[]>("/api/factory/oligo/labels", { method: "POST", json: { sequence_ids: sequenceIds, preview: true } });
}
