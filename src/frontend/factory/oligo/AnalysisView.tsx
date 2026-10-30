"use client";

import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { Button, Card, Empty, ErrorNote, Field, inputClass, Pager, StatusBadge, Table } from "../ui";
import { SEQ_STATUS } from "./shared";

type Kind = "PRIMER" | "PROBE" | "AMPLICON" | "PLASMID";
interface Row {
  id: string; code: string; name: string; normalized_sequence: string; base_count: number; molecule_type: string; product_type: string; status: string; relation: string | null; version: number;
  gc_percent: number; tm: number; ext_coeff_260: number; nmol_per_od: number; ug_per_od: number; mw: number; modifications: string[]; order_code: string | null;
  plasmid_id: string | null; plasmid_name: string | null; fragment_count: number; fragment_design: Record<string, unknown> | null;
}
interface Plasmid { id: string; name: string; length_bp: number; notes: string | null; status: string; version: number; used_by: number }
interface Frag { name: string; direction?: "F" | "R"; start?: number; end?: number; sequence: string }

const n = (v: number) => v.toLocaleString("vi-VN");

/** Fragment wizard (as OligoFlow): automatic tiling with overlap and adapters, or fragments typed in. */
function FragmentWizard({ amp, onDone, onClose }: { amp: Row; onDone: () => void; onClose: () => void }) {
  const [mode, setMode] = useState<"AUTO" | "MANUAL">("AUTO");
  const [d, setD] = useState({ oligo_len: "60", overlap: "20", adapter5: "", adapter3: "" });
  const [manual, setManual] = useState("");
  const [frags, setFrags] = useState<Frag[]>([]);
  const preview = useMutation({
    mutationFn: () => api<Frag[]>("/api/factory/oligo/fragments/preview", { method: "POST", json: { name: amp.name, sequence: amp.normalized_sequence, ...d } }),
    onSuccess: setFrags,
  });
  const parseManual = () => {
    const out: Frag[] = [];
    manual.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).forEach((l, i) => {
      const parts = l.split(/[\t;,]/).map((x) => x.trim()).filter(Boolean);
      out.push(parts.length >= 2 ? { name: parts[0], sequence: parts[1].toUpperCase() } : { name: `${amp.name}_${i + 1}`, sequence: parts[0].toUpperCase() });
    });
    setFrags(out);
  };
  const save = useMutation({
    mutationFn: () =>
      api(`/api/factory/oligo/sequences/${amp.id}/fragments`, {
        method: "POST",
        idempotent: true,
        json: {
          version: amp.version,
          design: mode === "AUTO" ? { mode, oligo_len: Number(d.oligo_len), overlap: Number(d.overlap), adapter5: d.adapter5, adapter3: d.adapter3 } : { mode },
          fragments: frags.map((f) => ({ name: f.name, sequence: f.sequence })),
        },
      }),
    onSuccess: onDone,
  });
  const full = (d.adapter5 + amp.normalized_sequence + d.adapter3).toUpperCase();
  return (
    <Card title={<span>Phân mảnh lắp ráp — <span className="font-mono">{amp.code}</span> {amp.name}</span>} actions={<Button variant="ghost" onClick={onClose}>Đóng</Button>}>
      <div className="flex flex-col gap-3">
        <p className="text-xs font-mono break-all p-2 rounded-lg bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800">
          {d.adapter5 && <span className="text-amber-700 dark:text-amber-400 underline decoration-dashed">{d.adapter5.toUpperCase()}</span>}
          {amp.normalized_sequence}
          {d.adapter3 && <span className="text-amber-700 dark:text-amber-400 underline decoration-dashed">{d.adapter3.toUpperCase()}</span>}
        </p>
        <p className="text-[11px] text-slate-500">Chiều dài {full.length} bp{d.adapter5 || d.adapter3 ? ` (gốc ${amp.base_count} bp)` : ""} · GC {n(amp.gc_percent)} %</p>
        <div className="flex gap-1">
          {(["AUTO", "MANUAL"] as const).map((m) => (
            <button key={m} onClick={() => { setMode(m); setFrags([]); }} className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${mode === m ? "bg-sky-700 text-white" : "hover:bg-slate-100 dark:hover:bg-slate-800"}`}>
              {m === "AUTO" ? "Tự động phân mảnh" : "Nhập thủ công"}
            </button>
          ))}
        </div>
        {mode === "AUTO" ? (
          <div className="grid gap-3 sm:grid-cols-5 items-end">
            <Field label="Chiều dài oligo (base)"><input className={inputClass} type="number" min="40" max="200" value={d.oligo_len} onChange={(e) => setD({ ...d, oligo_len: e.target.value })} /></Field>
            <Field label="Độ trùng lắp (base)"><input className={inputClass} type="number" min="15" value={d.overlap} onChange={(e) => setD({ ...d, overlap: e.target.value })} /></Field>
            <Field label="Adapter 5' (tùy chọn)"><input className={`${inputClass} font-mono`} value={d.adapter5} onChange={(e) => setD({ ...d, adapter5: e.target.value })} /></Field>
            <Field label="Adapter 3' (tùy chọn)"><input className={`${inputClass} font-mono`} value={d.adapter3} onChange={(e) => setD({ ...d, adapter3: e.target.value })} /></Field>
            <Button onClick={() => preview.mutate()} disabled={preview.isPending}>Phân mảnh</Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <textarea className={`${inputClass} h-32 font-mono`} placeholder={"Mỗi dòng: tên; trình tự (hoặc chỉ trình tự)"} value={manual} onChange={(e) => setManual(e.target.value)} />
            <div><Button variant="ghost" onClick={parseManual}>Nạp danh sách mảnh</Button></div>
          </div>
        )}
        <ErrorNote error={preview.error ?? save.error} />
        {frags.length > 0 && (
          <>
            <Table head={["Mảnh", "Hướng", "Phạm vi", "Dài", "Trình tự 5'→3'"]}>
              {frags.map((f) => (
                <tr key={f.name}>
                  <td className="py-1 pr-3 text-xs font-bold">{f.name}</td>
                  <td className="py-1 pr-3 text-xs">{f.direction === "F" ? "Xuôi" : f.direction === "R" ? "Ngược (bổ sung)" : "—"}</td>
                  <td className="py-1 pr-3 text-xs">{f.start ? `${f.start}–${f.end}` : "—"}</td>
                  <td className="py-1 pr-3 text-xs text-right">{f.sequence.length}</td>
                  <td className="py-1 pr-3 font-mono text-[11px] break-all">{f.sequence}</td>
                </tr>
              ))}
            </Table>
            <p className="text-[11px] text-slate-500">Lưu: amplicon chuyển sang "Đã tách", các mảnh thành trình tự chờ tổng hợp trong cùng đơn (cùng thang, tinh sạch, dạng giao). Hủy tách ở màn hình đơn khi các mảnh chưa xếp mẻ.</p>
            <div><Button onClick={() => save.mutate()} disabled={save.isPending}>Xác nhận {frags.length} mảnh tổng hợp</Button></div>
          </>
        )}
      </div>
    </Card>
  );
}

function PlasmidsView({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["factory", "oligo-plasmids"], queryFn: () => api<Plasmid[]>("/api/factory/oligo/plasmids") });
  const [f, setF] = useState({ name: "", length_bp: "", notes: "" });
  const add = useMutation({
    mutationFn: () => api("/api/factory/oligo/plasmids", { method: "POST", json: { name: f.name, length_bp: Number(f.length_bp), notes: f.notes || null } }),
    onSuccess: () => {
      setF({ name: "", length_bp: "", notes: "" });
      qc.invalidateQueries({ queryKey: ["factory", "oligo-plasmids"] });
    },
  });
  const toggle = useMutation({
    mutationFn: (p: Plasmid) => api(`/api/factory/oligo/plasmids/${p.id}`, { method: "PUT", json: { name: p.name, length_bp: p.length_bp, notes: p.notes, status: p.status === "ACTIVE" ? "INACTIVE" : "ACTIVE", version: p.version } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["factory", "oligo-plasmids"] }),
  });
  return (
    <div className="flex flex-col gap-3">
      {canManage && (
        <form className="flex flex-wrap gap-2 items-end" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
          <Field label="Tên plasmid *"><input className={inputClass} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></Field>
          <Field label="Chiều dài (bp) *"><input className={`${inputClass} w-28`} type="number" min="1" value={f.length_bp} onChange={(e) => setF({ ...f, length_bp: e.target.value })} required /></Field>
          <Field label="Ghi chú"><input className={inputClass} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
          <Button type="submit" disabled={add.isPending}>+ Thêm plasmid</Button>
        </form>
      )}
      <ErrorNote error={list.error ?? add.error ?? toggle.error} />
      {list.data?.length === 0 && <Empty>Chưa có plasmid.</Empty>}
      {list.data && list.data.length > 0 && (
        <Table head={["Tên", "Chiều dài", "Ghi chú", "Đang gắn", "Trạng thái", ""]}>
          {list.data.map((p) => (
            <tr key={p.id} className={p.status === "ACTIVE" ? "" : "opacity-50"}>
              <td className="py-1.5 pr-3">{p.name}</td>
              <td className="py-1.5 pr-3 text-right">{n(p.length_bp)} bp</td>
              <td className="py-1.5 pr-3 text-xs">{p.notes ?? "—"}</td>
              <td className="py-1.5 pr-3 text-right">{p.used_by}</td>
              <td className="py-1.5 pr-3 text-xs">{p.status === "ACTIVE" ? "Đang dùng" : "Ngừng"}</td>
              <td className="py-1.5 pr-3 text-right">{canManage && <Button variant="ghost" onClick={() => toggle.mutate(p)}>{p.status === "ACTIVE" ? "Ngừng dùng" : "Dùng lại"}</Button>}</td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}

/** "Phân tích trình tự" (as OligoFlow): every primer / probe / amplicon across orders with its parameters; plasmids; fragmentation. */
export function AnalysisView({ canManageOrders, canManageCatalog }: { canManageOrders: boolean; canManageCatalog: boolean }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<Kind>("PRIMER");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [wizard, setWizard] = useState<Row | null>(null);
  const list = useQuery({
    queryKey: ["factory", "oligo-analysis", kind, q, page],
    enabled: kind !== "PLASMID",
    queryFn: () => api<{ rows: Row[]; total: number; page: number; page_size: number }>(`/api/factory/oligo/analysis?type=${kind}&page=${page}&q=${encodeURIComponent(q)}`),
  });
  const plasmids = useQuery({ queryKey: ["factory", "oligo-plasmids"], queryFn: () => api<Plasmid[]>("/api/factory/oligo/plasmids"), enabled: kind === "AMPLICON" });
  const setPlasmid = useMutation({
    mutationFn: ({ r, plasmid_id }: { r: Row; plasmid_id: string | null }) => api(`/api/factory/oligo/sequences/${r.id}/plasmid`, { method: "PUT", json: { plasmid_id, version: r.version } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["factory", "oligo-analysis"] }),
  });
  const tabs: [Kind, string][] = [["PRIMER", "Primer"], ["PROBE", "Probe đánh dấu"], ["AMPLICON", "Amplicon"], ["PLASMID", "Cấu hình plasmid"]];
  const params = (r: Row) => (
    <>
      <td className="py-1.5 pr-3 text-right">{r.base_count}</td>
      <td className="py-1.5 pr-3 text-right">{n(r.gc_percent)}</td>
      <td className="py-1.5 pr-3 text-right">{n(r.tm)}</td>
      <td className="py-1.5 pr-3 text-right whitespace-nowrap">{n(r.ext_coeff_260)}</td>
      <td className="py-1.5 pr-3 text-right">{n(r.nmol_per_od)}</td>
      <td className="py-1.5 pr-3 text-right">{n(r.ug_per_od)}</td>
      <td className="py-1.5 pr-3 text-right whitespace-nowrap">{n(r.mw)}</td>
    </>
  );
  return (
    <div className="flex flex-col gap-3">
      {wizard && <FragmentWizard key={wizard.id} amp={wizard} onClose={() => setWizard(null)} onDone={() => { setWizard(null); qc.invalidateQueries({ queryKey: ["factory", "oligo-analysis"] }); qc.invalidateQueries({ queryKey: ["factory", "oligo-order"] }); }} />}
      <Card
        title="Phân tích trình tự"
        actions={kind !== "PLASMID" && <input className={`${inputClass} w-64`} placeholder="Tìm mã, tên, trình tự, đơn…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />}
      >
        <div className="flex gap-1 mb-3 overflow-x-auto">
          {tabs.map(([k, v]) => (
            <button key={k} onClick={() => { setKind(k); setPage(1); }} className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap cursor-pointer ${kind === k ? "bg-sky-700 text-white" : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"}`}>
              {v}{kind === k && list.data && k !== "PLASMID" ? ` (${list.data.total})` : ""}
            </button>
          ))}
        </div>
        {kind === "PLASMID" ? <PlasmidsView canManage={canManageCatalog} /> : (
          <>
            <ErrorNote error={list.error ?? setPlasmid.error} />
            {list.data?.rows.length === 0 && <Empty>Không có trình tự.</Empty>}
            {list.data && list.data.rows.length > 0 && (
              <Table
                head={
                  kind === "AMPLICON"
                    ? ["Đơn", "Mã / tên", "Trình tự 5'→3'", "Dài", "GC %", "MW", "Plasmid", "Phân mảnh", "Trạng thái"]
                    : ["Đơn", "Mã / tên", "Trình tự 5'→3'", "Dài", "GC %", "Tm °C", "ε260", "nmol/OD", "µg/OD", "MW", "Trạng thái"]
                }
              >
                {list.data.rows.map((r) => (
                  <tr key={r.id}>
                    <td className="py-1.5 pr-3 font-mono text-xs">{r.order_code ?? "gộp"}</td>
                    <td className="py-1.5 pr-3 text-xs"><span className="font-mono">{r.code}</span> {r.name}{r.relation === "FRAGMENT" && <span className="text-slate-400"> (mảnh)</span>}</td>
                    <td className="py-1.5 pr-3 font-mono text-[11px] break-all max-w-80">
                      {r.normalized_sequence}
                      {r.modifications.length > 0 && <div className="font-sans text-sky-700 dark:text-sky-400">{r.modifications.join(", ")}</div>}
                    </td>
                    {kind === "AMPLICON" ? (
                      <>
                        <td className="py-1.5 pr-3 text-right">{r.base_count}</td>
                        <td className="py-1.5 pr-3 text-right">{n(r.gc_percent)}</td>
                        <td className="py-1.5 pr-3 text-right whitespace-nowrap">{n(r.mw)}</td>
                        <td className="py-1.5 pr-3">
                          {canManageOrders && ["PENDING", "SPLIT"].includes(r.status) ? (
                            <select className={`${inputClass} w-40`} value={r.plasmid_id ?? ""} onChange={(e) => setPlasmid.mutate({ r, plasmid_id: e.target.value || null })} aria-label="Plasmid">
                              <option value="">Mạch thẳng</option>
                              {plasmids.data?.filter((p) => p.status === "ACTIVE" || p.id === r.plasmid_id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                            </select>
                          ) : <span className="text-xs">{r.plasmid_name ?? "Mạch thẳng"}</span>}
                        </td>
                        <td className="py-1.5 pr-3 text-xs whitespace-nowrap">
                          {r.fragment_count > 0 ? `${r.fragment_count} mảnh` : canManageOrders && r.status === "PENDING" && !r.relation ? <Button variant="ghost" onClick={() => setWizard(r)}>Phân mảnh</Button> : "—"}
                        </td>
                      </>
                    ) : params(r)}
                    <td className="py-1.5 pr-3"><StatusBadge status={SEQ_STATUS[r.status][0]} label={SEQ_STATUS[r.status][1]} /></td>
                  </tr>
                ))}
              </Table>
            )}
            {list.data && <Pager page={list.data.page} pageSize={list.data.page_size} total={list.data.total} onPage={setPage} />}
          </>
        )}
      </Card>
    </div>
  );
}
