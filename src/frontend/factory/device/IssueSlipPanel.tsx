"use client";

import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, escHtml, fmtDate, fmtDateTime, fmtQty } from "../api";
import { Button, Card, ErrorNote, inputClass } from "../ui";

interface IssueSlip {
  form: { code: string; name: string };
  order: { id: string; code: string; lot_no: string | null; qty: number; model_code: string; model_name: string; mfg_date: string };
  serials: string[];
  lines: {
    line_no: number;
    item_code: string;
    item_name: string;
    uom: string;
    qty_per_unit: number;
    qty_lot: number;
    qty_issued: number;
    lot_code: string | null;
    received_date: string | null;
  }[];
  signatures: { role: "PRODUCTION" | "LEAD" | "WAREHOUSE"; label: string; meaning: string; signer_name: string | null; signed_at: string | null; valid: boolean }[];
}

const serialRange = (s: string[]) => (s.length > 2 ? `${s[0]} → ${s[s.length - 1]}` : s.join(", ") || "—");

/** BM 21-01 laid out as the controlled paper form (QT 21), with the e-signatures printed in its three boxes. */
function printSlip(slip: IssueSlip) {
  const win = window.open("", "_blank", "width=1000,height=760");
  if (!win) return;
  const rows = slip.lines
    .map(
      (l, i) => `<tr>
        <td class="c">${i + 1}</td><td>${escHtml(l.item_name)}</td><td>${escHtml(l.item_code)}</td><td class="c">${escHtml(l.uom)}</td>
        <td class="r">${escHtml(fmtQty(l.qty_per_unit))}</td><td class="r">${escHtml(fmtQty(l.qty_lot))}</td><td class="r">${l.qty_issued ? escHtml(fmtQty(l.qty_issued)) : ""}</td>
        <td>${l.lot_code ? `${escHtml(l.lot_code)}<br/><small>(${escHtml(fmtDate(l.received_date))})</small>` : ""}</td><td></td>
      </tr>`
    )
    .join("");
  const sign = slip.signatures
    .map(
      (s) => `<div class="sig"><b>${escHtml(s.label)}</b><br/><i>(Ký, họ tên)</i><div class="box">${
        s.signer_name && s.valid
          ? `<span class="ok">Đã ký điện tử</span><br/><b>${escHtml(s.signer_name)}</b><br/><small>${escHtml(fmtDateTime(s.signed_at))}</small>`
          : ""
      }</div></div>`
    )
    .join("");
  win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${escHtml(slip.form.code)} — ${escHtml(slip.order.code)}</title>
    <style>
      body{font-family:"Times New Roman",serif;padding:20px;color:#000;font-size:14px}
      table{width:100%;border-collapse:collapse}td,th{border:1px solid #000;padding:4px 6px;vertical-align:top}
      .head td{text-align:center;font-weight:bold}.c{text-align:center}.r{text-align:right}
      .info{border:none;margin:10px 0}.info td{border:none;padding:2px 4px}
      h4{margin:12px 0 4px}.sigs{display:flex;justify-content:space-around;margin-top:24px;text-align:center}
      .sig{width:30%}.box{min-height:70px;margin-top:6px}.ok{color:#15803d;font-weight:bold}
    </style></head><body>
    <table class="head"><tr><td rowspan="2" style="width:16%;font-size:26px;color:#1d4ed8">ABT</td>
      <td style="font-size:16px">${escHtml(slip.form.name.toUpperCase())}</td><td rowspan="2" style="width:16%;font-weight:normal">Mã số:<br/><b>${escHtml(slip.form.code)}</b></td></tr>
      <tr><td>CÔNG TY TNHH GIẢI PHÁP Y SINH ABT</td></tr></table>
    <h4>I. Thông tin chung</h4>
    <table class="info"><tr><td>Tên sản phẩm: <b>${escHtml(slip.order.model_name)}</b></td><td>Ngày sản xuất: <b>${escHtml(fmtDate(slip.order.mfg_date))}</b></td><td>Số lô: <b>${escHtml(slip.order.lot_no ?? "")}</b></td></tr>
      <tr><td>Model: <b>${escHtml(slip.order.model_code)}</b></td><td>Cỡ lô: <b>${escHtml(slip.order.qty)}</b></td><td>Số seri: <b>${escHtml(serialRange(slip.serials))}</b></td></tr></table>
    <h4>II. Thông tin NVL</h4>
    <table><thead><tr><th>STT</th><th>Tên chi tiết</th><th>Mã chi tiết</th><th>ĐVT</th><th>Số lượng</th><th>Số lượng lô</th><th>Số lượng xuất</th><th>Số lot<br/><i>(Ngày nhận hàng NVL)</i></th><th>Ghi chú</th></tr></thead>
      <tbody>${rows}</tbody></table>
    <div class="sigs">${sign}</div>
    <script>window.onload=()=>window.print();</script></body></html>`);
  win.document.close();
}

/** BM 21-01 of an assembly order: issued lots, the three e-signature boxes, print. */
export function IssueSlipPanel({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const slip = useQuery({ queryKey: ["factory", "device", "issue-slip", orderId], queryFn: () => api<IssueSlip>(`/api/factory/device/orders/${orderId}/issue-slip`) });
  const [signing, setSigning] = useState<IssueSlip["signatures"][number]["role"] | null>(null);
  const [method, setMethod] = useState<"PIN" | "PASSWORD">("PIN");
  const [secret, setSecret] = useState("");
  const sign = useMutation({
    mutationFn: () => api<IssueSlip>(`/api/factory/device/orders/${orderId}/issue-slip`, { method: "POST", json: { role: signing, credential: { method, secret } } }),
    onSuccess: (data) => {
      qc.setQueryData(["factory", "device", "issue-slip", orderId], data);
      setSigning(null);
      setSecret("");
    },
  });
  const s = slip.data;

  return (
    <Card
      title={s ? `${s.form.code} — ${s.form.name}` : "Phiếu xuất kho nguyên vật liệu"}
      actions={
        <div className="flex gap-2">
          {s && <Button onClick={() => printSlip(s)}>🖨 In {s.form.code}</Button>}
          <Button variant="ghost" onClick={onClose}>Đóng</Button>
        </div>
      }
    >
      <ErrorNote error={slip.error} />
      {s && (
        <div className="flex flex-col gap-3 text-xs">
          <div className="grid sm:grid-cols-3 gap-1 text-slate-600 dark:text-slate-300">
            <span>Tên sản phẩm: <b>{s.order.model_name}</b></span>
            <span>Ngày sản xuất: <b>{fmtDate(s.order.mfg_date)}</b></span>
            <span>Số lô: <b className="font-mono">{s.order.lot_no ?? "—"}</b></span>
            <span>Model: <b>{s.order.model_code}</b></span>
            <span>Cỡ lô: <b>{s.order.qty}</b></span>
            <span>Số seri: <b className="font-mono">{serialRange(s.serials)}</b></span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="text-slate-500">
                <tr>
                  {["STT", "Tên chi tiết", "Mã chi tiết", "ĐVT", "Số lượng", "Số lượng lô", "Số lượng xuất", "Số lot (Ngày nhận NVL)"].map((h) => (
                    <th key={h} className="py-1 pr-2 font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {s.lines.map((l, i) => (
                  <tr key={`${l.line_no}-${l.lot_code ?? i}`} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="py-1 pr-2">{i + 1}</td>
                    <td className="py-1 pr-2">{l.item_name}</td>
                    <td className="py-1 pr-2 font-mono">{l.item_code}</td>
                    <td className="py-1 pr-2">{l.uom}</td>
                    <td className="py-1 pr-2 text-right">{fmtQty(l.qty_per_unit)}</td>
                    <td className="py-1 pr-2 text-right">{fmtQty(l.qty_lot)}</td>
                    <td className={`py-1 pr-2 text-right font-semibold ${l.qty_issued < l.qty_lot ? "text-amber-600" : ""}`}>{l.qty_issued ? fmtQty(l.qty_issued) : "—"}</td>
                    <td className="py-1 pr-2 font-mono">{l.lot_code ? `${l.lot_code} (${fmtDate(l.received_date)})` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid sm:grid-cols-3 gap-2">
            {s.signatures.map((g) => (
              <div key={g.role} className="rounded-xl border border-slate-200 dark:border-slate-800 p-2.5 flex flex-col gap-1">
                <b>{g.label}</b>
                {g.signer_name ? (
                  <span className={g.valid ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400 line-through"} title={g.valid ? "" : "Phiếu đã thay đổi sau khi ký — cần ký lại"}>
                    ✍ {g.signer_name} · {fmtDateTime(g.signed_at)}
                  </span>
                ) : (
                  <span className="text-slate-400">Chưa ký</span>
                )}
                {!g.valid && signing !== g.role && (
                  <Button variant="ghost" onClick={() => { setSigning(g.role); sign.reset(); }}>
                    {g.signer_name ? "Ký lại" : "Ký điện tử"}
                  </Button>
                )}
                {signing === g.role && (
                  <form className="flex flex-wrap gap-1.5" onSubmit={(e) => { e.preventDefault(); sign.mutate(); }}>
                    <select className={`${inputClass} !w-24`} value={method} onChange={(e) => setMethod(e.target.value as "PIN" | "PASSWORD")} aria-label="Cách ký">
                      <option value="PIN">PIN</option>
                      <option value="PASSWORD">Mật khẩu</option>
                    </select>
                    <input className={`${inputClass} flex-1 min-w-24`} type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={method === "PIN" ? "Mã PIN" : "Mật khẩu"} required />
                    <Button type="submit" disabled={sign.isPending}>Ký</Button>
                    <Button variant="ghost" type="button" onClick={() => setSigning(null)}>Hủy</Button>
                  </form>
                )}
              </div>
            ))}
          </div>
          <ErrorNote error={sign.error} />
        </div>
      )}
    </Card>
  );
}
