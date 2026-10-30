"use client";

import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, fmtDate, fmtQty } from "../api";
import { Button, Card, ErrorNote, inputClass, StatusBadge, Table } from "../ui";
import { SEQ_STATUS } from "./shared";

const time = (v: string | null) => (v ? new Date(v).toLocaleString("vi-VN") : "—");
const REL: Record<string, string> = { SPLIT: "ống tách", FRAGMENT: "mảnh lắp ráp", RESYNTH: "tổng hợp lại", POOL_MASTER: "trình tự gộp" };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="text-xs font-bold text-sky-800 dark:text-sky-300 border-b border-slate-200 dark:border-slate-800 pb-1">{title}</div>
      {children}
    </div>
  );
}

/** "Truy vết" (as OligoFlow): one sequence from order to delivery — synthesis, post-processing, QC, quality events. */
export function TraceView() {
  const [code, setCode] = useState("");
  const [q, setQ] = useState("");
  const t = useQuery({ queryKey: ["factory", "oligo-trace", q], enabled: !!q, queryFn: () => api<any>(`/api/factory/oligo/trace?q=${encodeURIComponent(q)}`) });
  const d = t.data;
  return (
    <Card title="Truy vết trình tự">
      <form className="flex gap-2 mb-3" onSubmit={(e) => { e.preventDefault(); setQ(code.trim()); }}>
        <input className={`${inputClass} w-64 font-mono`} placeholder="Mã trình tự" value={code} onChange={(e) => setCode(e.target.value)} />
        <Button type="submit">Truy vết</Button>
      </form>
      <ErrorNote error={t.error} />
      {d && (
        <div className="flex flex-col gap-4 text-xs">
          <div className="flex flex-wrap gap-3 items-center">
            <b className="font-mono text-sm">{d.sequence.code}</b> {d.sequence.name}
            <StatusBadge status={SEQ_STATUS[d.sequence.status][0]} label={SEQ_STATUS[d.sequence.status][1]} />
            <span>{d.sequence.base_count} nt · MW {d.sequence.mw} · {d.sequence.scale_code} · {d.sequence.purification}</span>
            {d.order && <span>Đơn {d.order.code}{d.order.kd_po_code ? ` · PO ${d.order.kd_po_code}` : ""}{d.order.customer_label ? ` · ${d.order.customer_label}` : ""}</span>}
          </div>
          <p className="font-mono break-all">{d.sequence.normalized_sequence}</p>
          {(d.relatives.length > 0 || d.pool_master) && (
            <Section title="Liên quan">
              {d.pool_master && <div>Tổng hợp chung trong trình tự gộp <span className="font-mono">{d.pool_master.code}</span> (truy vết bên dưới là của trình tự gộp)</div>}
              {d.relatives.map((r: any) => <div key={r.id}>{r.link === "parent" ? "Thuộc" : "Có"} {REL[r.relation] ?? r.relation}: <span className="font-mono">{r.code}</span> {r.name} — {SEQ_STATUS[r.status]?.[1] ?? r.status}</div>)}
            </Section>
          )}
          <Section title="Tổng hợp">
            {d.synthesis.length === 0 && <span className="text-slate-400">Chưa vào mẻ.</span>}
            {d.synthesis.map((b: any) => (
              <div key={b.batch_id} className="flex flex-col gap-1 p-2 rounded-lg border border-slate-200 dark:border-slate-800">
                <div>
                  Mẻ <b className="font-mono">{b.batch_code}</b> · {b.synthesizer_code} {b.synthesizer_name} · vị trí {b.position_no} · người chạy {b.operator_name ?? "—"} · {time(b.started_at)} → {time(b.finished_at)}
                </div>
                <div>Cột {b.column_lot_code} · {b.couplings} lần ghép · hiệu suất {b.coupling_efficiency_pct ?? "—"} % · {b.result === "OK" ? "Đạt" : b.result === "FAILED" ? "Không đạt" : "chưa có kết quả"}</div>
                {b.lots.length > 0 && <div className="text-slate-500">Lô đã dùng: {b.lots.map((l: any) => `${l.item_code} ${l.lot_code ?? ""} (${fmtQty(l.qty)} ${l.base_uom})`).join(" · ")}</div>}
                {b.bottle_changes.length > 0 && <div className="text-slate-500">Thay chai: {b.bottle_changes.map((c: any) => `cổng ${c.port_no} ${c.old_lot} → ${c.new_lot} từ chu kỳ ${c.swap_cycle}`).join(" · ")}</div>}
              </div>
            ))}
          </Section>
          <Section title="Sau tổng hợp">
            {d.post.length === 0 && <span className="text-slate-400">Chưa có.</span>}
            {d.post.map((p: any) => (
              <div key={p.id} className="p-2 rounded-lg border border-slate-200 dark:border-slate-800">
                <div>{p.status === "VOID" ? "Hồ sơ cũ (làm lại)" : p.status === "SUBMITTED" ? "Đã gửi QC" : "Đang làm"} · {fmtQty(p.od_total)} OD · {fmtQty(p.nmol)} nmol · {p.tube_count} ống{p.notes && ` · ${p.notes}`}</div>
                {p.steps.length > 0 && (
                  <Table head={["Bước", "Ghi nhận", "Người / lúc"]}>
                    {p.steps.map((s: any) => (
                      <tr key={s.step_no}>
                        <td className="py-1 pr-3">{s.step_no}. {s.step_name}</td>
                        <td className="py-1 pr-3">{Object.entries(s.values ?? {}).filter(([, v]) => v != null && v !== "").map(([k, v]) => `${k}: ${v}`).join(" · ")}{s.stock_document_code && ` · phiếu xuất ${s.stock_document_code}`}</td>
                        <td className="py-1 pr-3 whitespace-nowrap">{s.performed_by_name ?? ""} · {time(s.performed_at)}</td>
                      </tr>
                    ))}
                  </Table>
                )}
              </div>
            ))}
          </Section>
          <Section title="QC">
            {d.qc.length === 0 && <span className="text-slate-400">Chưa có phiếu QC.</span>}
            {d.qc.map((q: any) => (
              <div key={q.id}>
                Phiếu <span className="font-mono">{q.code}</span> · {q.overall_result === "PASS" ? "ĐẠT" : q.overall_result === "FAIL" ? "KHÔNG ĐẠT" : q.status} · KN {q.analyst_name ?? "—"} · duyệt {q.reviewer_name ?? "—"} {q.reviewed_at && `(${time(q.reviewed_at)})`}
                {q.results && <div className="text-slate-500">{q.results.map((r: any) => `${r.name}: ${r.value ?? r.text ?? ""}${r.unit ? ` ${r.unit}` : ""}${r.observed != null ? ` (đo ${r.observed})` : ""}`).join(" · ")}</div>}
              </div>
            ))}
          </Section>
          <Section title="Sự cố / NCR">
            {d.quality.length === 0 && <span className="text-slate-400">Không có.</span>}
            {d.quality.map((x: any, i: number) => (
              <div key={i}>
                <span className="font-mono">{x.code}</span> {x.title ?? x.description} · {x.severity} · {x.status}{x.step_ref && ` · bước ${x.step_ref}`}
                {x.ncr_code && ` · NCR ${x.ncr_code} (${x.disposition}, ${x.ncr_status})`}
                {x.root_cause && <div className="text-slate-500">Nguyên nhân: {x.root_cause} · Khắc phục: {x.corrective_action}</div>}
              </div>
            ))}
          </Section>
          <Section title="Nhãn & giao hàng">
            {d.labels.map((l: any, i: number) => <div key={i}>{l.reprint ? "In lại" : "In"} {l.labels} nhãn · {l.printed_by_name ?? ""} · {time(l.printed_at)}{l.reason && ` · ${l.reason}`}</div>)}
            {d.delivery ? <div>Giao phiếu <span className="font-mono">{d.delivery.code}</span> ({d.delivery.tube_count} ống) · {fmtDate(d.delivery.created_at)} · {d.delivery.recipient ?? (d.delivery.kd_inbound_code ? `KD nhận ${d.delivery.kd_inbound_code}` : "gửi Kinh doanh")}</div> : <span className="text-slate-400">Chưa giao.</span>}
          </Section>
        </div>
      )}
    </Card>
  );
}
