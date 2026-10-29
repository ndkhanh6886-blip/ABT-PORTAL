"use client";

import { api, ApiError } from "../api";

export interface TubeLabel {
  code: string; name: string; order_code: string | null; customer: string | null; sequence: string; bases: number; mw: number; tm: number;
  scale: string; purification: string; format: string; modifications: string[]; tube: string; od: number; nmol: number;
  volume_ul: number | null; conc_um: number | null; released: boolean; date: string;
}

const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const vnDate = (d: string) => d.split("-").reverse().join("/");

/** One 50 × 30 mm label per page (thermal label printer); a tube not yet released by QC is marked as such. */
function labelHtml(labels: TubeLabel[]) {
  const body = labels
    .map(
      (l) => `<section>
  <div class="top"><b>${esc(l.code)}</b><span>${esc(l.tube)}</span></div>
  <div class="name">${esc(l.name)}</div>
  <div class="seq">5'-${esc(l.sequence.length > 60 ? `${l.sequence.slice(0, 57)}…` : l.sequence)}-3'</div>
  <div>${esc(l.bases)} nt · MW ${esc(l.mw)} · Tm ${esc(l.tm)}°C</div>
  <div>${esc(l.od)} OD · ${esc(l.nmol)} nmol${l.volume_ul ? ` · ${esc(l.volume_ul)} µL @ ${esc(l.conc_um)} µM` : ""}</div>
  <div>${esc(l.scale)} · ${esc(l.purification)}${l.order_code ? ` · ${esc(l.order_code)}` : ""}</div>
  <div class="foot"><span>${esc(l.customer ?? "")}</span><span>${esc(vnDate(l.date))}</span></div>
  ${l.released ? "" : '<div class="hold">CHƯA XUẤT XƯỞNG</div>'}
</section>`
    )
    .join("");
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Nhãn ống Oligo</title><style>
@page { size: 50mm 30mm; margin: 0 }
* { box-sizing: border-box }
body { margin: 0; font: 6.5pt/1.25 Arial, sans-serif; color: #000; background: #fff }
section { width: 50mm; height: 30mm; padding: 1.5mm 2mm; page-break-after: always; overflow: hidden; position: relative }
.top { display: flex; justify-content: space-between; font-size: 8pt }
.name { font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis }
.seq { font-family: "Courier New", monospace; word-break: break-all; font-size: 6pt }
.foot { display: flex; justify-content: space-between; position: absolute; left: 2mm; right: 2mm; bottom: 1.2mm }
.hold { position: absolute; right: 2mm; top: 5mm; border: 0.3mm solid #000; padding: 0 1mm; font-weight: bold; font-size: 6pt }
@media screen { body { background: #ddd; padding: 8px } section { background: #fff; margin: 0 0 8px; box-shadow: 0 0 2px #888 } }
</style></head><body>${body}<script>window.onload = () => { window.focus(); window.print() }</script></body></html>`;
}

/** Asks the server for the label data (which records the print), then prints it from a hidden frame (no pop-up). */
export async function printTubeLabels(sequenceIds: string[], reason?: string) {
  const labels = await api<TubeLabel[]>("/api/factory/oligo/labels", { method: "POST", json: { sequence_ids: sequenceIds, reason: reason || null } });
  const frame = document.createElement("iframe");
  frame.style.cssText = "position:fixed;width:0;height:0;border:0;right:0;bottom:0";
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  doc.open();
  doc.write(labelHtml(labels));
  doc.close();
  setTimeout(() => frame.remove(), 60_000);
  return labels.length;
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
