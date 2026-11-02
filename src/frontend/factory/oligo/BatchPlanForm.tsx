"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, fmtDate, fmtQty } from "../api";
import { Button, Empty, ErrorNote, Field, inputClass, Table } from "../ui";
import { PURIFICATION, useOligoUnits } from "./shared";

interface Candidates {
  sequences: {
    id: string;
    code: string;
    name: string;
    normalized_sequence: string;
    base_count: number;
    scale_code: string;
    purification: string;
    product_type?: string;
    oligo_role?: string;
    target_pathogen?: string | null;
    order_id?: string | null;
    order_code: string | null;
    customer_label?: string | null;
    internal_order_code?: string | null;
    kd_po_code?: string | null;
    due_date: string | null;
  }[];
  synthesizers: { id: string; code: string; name: string; status: string; next_calibration_due: string | null; column_positions: number; supported_scales: string[] }[];
  column_lots: { id: string; code: string; expiry_date: string | null; item_code: string; item_name: string; available: number }[];
}

/**
 * Plans a batch: pick a synthesizer, tick pending sequences (positions follow the tick order) and a CPG column lot.
 * The server re-checks everything (scale, positions, calibration, stock) and reserves reagents on save.
 */
export function BatchPlanForm({ onCreated }: { onCreated: (id: string) => void }) {
  const qc = useQueryClient();
  const units = useOligoUnits("oligo.batch.manage");
  const [unitId, setUnitId] = useState("");
  const unit = unitId || (units.data?.length ? units.data[0].id : "");
  const cand = useQuery({
    queryKey: ["factory", "oligo-batch-candidates", unit],
    enabled: !!unit,
    queryFn: () => api<Candidates>(`/api/factory/oligo/batch-candidates?org_unit_id=${unit}`),
  });
  const [synthId, setSynthId] = useState("");
  const [lotId, setLotId] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [program, setProgram] = useState("");
  const [allowAdjacentContam, setAllowAdjacentContam] = useState(false);

  // Bộ lọc trình tự theo Đơn hàng, Vai trò, Thang tổng hợp & Từ khóa
  const [orderFilter, setOrderFilter] = useState("ALL");
  const [roleFilter, setRoleFilter] = useState("ALL");
  const [scaleFilter, setScaleFilter] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");

  // Auto-select first usable synthesizer and CPG column lot when candidates arrive
  useEffect(() => {
    if (!cand.data) return;
    if (!synthId) {
      const firstSynth = cand.data.synthesizers.find((s) => s.status === "IN_SERVICE") ?? cand.data.synthesizers[0];
      if (firstSynth) setSynthId(firstSynth.id);
    }
    if (!lotId && cand.data.column_lots.length > 0) {
      setLotId(cand.data.column_lots[0].id);
    }
  }, [cand.data, synthId, lotId]);

  const synth = cand.data?.synthesizers.find((s) => s.id === synthId);
  const fits = (scale: string) => !synth || !synth.supported_scales.length || synth.supported_scales.includes(scale);
  const full = !!synth && picked.length >= synth.column_positions;
  const allSequences = useMemo(() => cand.data?.sequences ?? [], [cand.data]);

  // Danh sách các Đơn Oligo đang có trình tự chờ tổng hợp
  const orderGroups = useMemo(() => {
    const map = new Map<
      string,
      {
        key: string;
        order_code: string;
        customer_label: string | null;
        kd_po_code: string | null;
        internal_order_code: string | null;
        due_date: string | null;
        count: number;
      }
    >();
    for (const s of allSequences) {
      const key = s.order_code ?? "__POOL__";
      const existing = map.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        map.set(key, {
          key,
          order_code: s.order_code ?? "Trình tự gộp",
          customer_label: s.customer_label ?? null,
          kd_po_code: s.kd_po_code ?? null,
          internal_order_code: s.internal_order_code ?? null,
          due_date: s.due_date ?? null,
          count: 1,
        });
      }
    }
    return Array.from(map.values());
  }, [allSequences]);

  const availableScales = useMemo(
    () => Array.from(new Set(allSequences.map((s) => s.scale_code))).filter(Boolean),
    [allSequences]
  );

  // Danh sách trình tự sau khi lọc theo Đơn hàng / Vai trò / Thang / Tìm kiếm
  const visible = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return allSequences.filter((s) => {
      if (orderFilter !== "ALL") {
        const key = s.order_code ?? "__POOL__";
        if (key !== orderFilter) return false;
      }
      if (roleFilter === "PRIMER_PROBE") {
        const isAmp =
          s.product_type === "AMPLICON_LINEAR" ||
          s.product_type === "AMPLICON_PLASMID" ||
          s.oligo_role === "POSITIVE_CONTROL" ||
          s.oligo_role === "TEMPLATE";
        if (isAmp) return false;
      } else if (roleFilter === "AMPLICON") {
        const isAmp =
          s.product_type === "AMPLICON_LINEAR" ||
          s.product_type === "AMPLICON_PLASMID" ||
          s.oligo_role === "POSITIVE_CONTROL" ||
          s.oligo_role === "TEMPLATE";
        if (!isAmp) return false;
      }
      if (scaleFilter !== "ALL" && s.scale_code !== scaleFilter) return false;
      if (q) {
        const hay = `${s.code} ${s.name ?? ""} ${s.order_code ?? ""} ${s.kd_po_code ?? ""} ${s.internal_order_code ?? ""} ${s.target_pathogen ?? ""} ${s.normalized_sequence}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [allSequences, orderFilter, roleFilter, scaleFilter, searchQuery]);

  const plan = useMutation({
    mutationFn: () =>
      api<{ id: string }>("/api/factory/oligo/batches", {
        method: "POST",
        idempotent: true,
        json: {
          org_unit_id: unit,
          synthesizer_id: synthId,
          program_name: program || null,
          allow_adjacent_contamination: allowAdjacentContam,
          positions: picked.map((id) => ({ sequence_id: id, column_lot_id: lotId })),
        },
      }),
    onSuccess: (b) => {
      setPicked([]);
      qc.invalidateQueries({ queryKey: ["factory", "oligo-batches"] });
      qc.invalidateQueries({ queryKey: ["factory", "oligo-batch-candidates"] });
      qc.invalidateQueries({ queryKey: ["factory", "oligo-orders"] });
      onCreated(b.id);
    },
  });
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : full ? p : [...p, id]));
  const selectAllFitting = () => {
    if (!synth) return;
    const fittingIds = visible.filter((s) => fits(s.scale_code)).map((s) => s.id).slice(0, synth.column_positions);
    setPicked(fittingIds);
  };

  if (units.data && !units.data.length) return <Empty>Bạn chưa có quyền lập mẻ tổng hợp ở phòng Oligo nào.</Empty>;
  return (
    <div className="flex flex-col gap-3 mb-4 p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-sky-200 dark:border-sky-900/60">
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-200 dark:border-slate-800">
        <div>
          <div className="text-xs font-bold text-sky-700 dark:text-sky-400">🧪 LẬP MẺ TỔNG HỢP OLIGO TRÊN MÁY DẠNG CỘT</div>
          <div className="text-[11px] text-slate-500">
            <b>Bước 1:</b> Chọn Máy tổng hợp & Lô cột CPG → <b>Bước 2:</b> Lọc theo Đơn hàng & tích chọn các trình tự chờ tổng hợp bên dưới để xếp vào <b>Cột 1, Cột 2…</b> → <b>Bước 3:</b> Bấm nút <b>+ Lập mẻ tổng hợp</b>.
          </div>
        </div>
        {visible.length > 0 && synth && (
          <div className="flex flex-wrap gap-1.5">
            <Button
              variant="ghost"
              onClick={selectAllFitting}
              title="Tự động xếp các trình tự phù hợp đang hiển thị trong bộ lọc vào các vị trí cột trống của máy"
            >
              Chọn nhanh {orderFilter !== "ALL" ? `đơn ${orderFilter}` : "theo bộ lọc"} ({Math.min(visible.filter((s) => fits(s.scale_code)).length, synth.column_positions)} cột)
            </Button>
            {picked.length > 0 && <Button variant="ghost" onClick={() => setPicked([])}>Bỏ chọn ({picked.length})</Button>}
          </div>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 items-end">
        {(units.data?.length ?? 0) > 1 && (
          <Field label="Phòng Oligo">
            <select className={inputClass} value={unit} onChange={(e) => { setUnitId(e.target.value); setSynthId(""); setLotId(""); setPicked([]); }}>
              {units.data?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </Field>
        )}
        <Field label="1. Máy tổng hợp (dạng cột) *">
          <select className={inputClass} value={synthId} onChange={(e) => { setSynthId(e.target.value); setPicked([]); }}>
            <option value="">— Chọn máy tổng hợp —</option>
            {cand.data?.synthesizers.map((s) => (
              <option key={s.id} value={s.id} disabled={s.status !== "IN_SERVICE"}>
                {s.code} · {s.name} ({s.column_positions} cột{s.next_calibration_due ? `, HC ${fmtDate(s.next_calibration_due)}` : ""})
              </option>
            ))}
          </select>
        </Field>
        <Field label="2. Lô cột CPG *" hint="Mỗi vị trí giữ chỗ 1 cột">
          <select className={inputClass} value={lotId} onChange={(e) => setLotId(e.target.value)}>
            <option value="">— Chọn lô cột CPG —</option>
            {cand.data?.column_lots.map((l) => <option key={l.id} value={l.id}>{l.item_code} · {l.code} (còn {fmtQty(l.available)}{l.expiry_date ? `, HD ${fmtDate(l.expiry_date)}` : ""})</option>)}
          </select>
        </Field>
        <Field label="Chương trình chạy máy"><input className={inputClass} value={program} onChange={(e) => setProgram(e.target.value)} placeholder="VD: STD-200NM-COL" /></Field>
      </div>

      {/* Bộ lọc trình tự theo Đơn hàng, Vai trò, Thang & Tìm kiếm */}
      {allSequences.length > 0 && (
        <div className="flex flex-col gap-2.5 p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/60">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-bold text-slate-600 dark:text-slate-300 mr-1">📦 Lọc nhanh theo Đơn hàng:</span>
              <button
                type="button"
                onClick={() => setOrderFilter("ALL")}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition cursor-pointer ${
                  orderFilter === "ALL"
                    ? "bg-sky-700 text-white border-sky-700"
                    : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-sky-400"
                }`}
              >
                Tất cả đơn ({allSequences.length})
              </button>
              {orderGroups.map((og) => (
                <button
                  key={og.key}
                  type="button"
                  onClick={() => setOrderFilter(og.key)}
                  title={og.customer_label ? `${og.order_code} — ${og.customer_label}` : og.order_code}
                  className={`px-2.5 py-1 rounded-lg text-xs font-mono font-bold border transition cursor-pointer ${
                    orderFilter === og.key
                      ? "bg-sky-700 text-white border-sky-700"
                      : "bg-white dark:bg-slate-900 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-800 hover:bg-sky-50 dark:hover:bg-sky-950/50"
                  }`}
                >
                  🧬 {og.order_code}
                  {og.kd_po_code ? <span className="font-sans font-normal opacity-80"> · {og.kd_po_code}</span> : null}{" "}
                  <span className="font-sans">({og.count})</span>
                </button>
              ))}
            </div>
            {(orderFilter !== "ALL" || roleFilter !== "ALL" || scaleFilter !== "ALL" || searchQuery.trim() !== "") && (
              <button
                type="button"
                onClick={() => {
                  setOrderFilter("ALL");
                  setRoleFilter("ALL");
                  setScaleFilter("ALL");
                  setSearchQuery("");
                }}
                className="text-xs font-semibold text-rose-600 dark:text-rose-400 hover:underline cursor-pointer"
              >
                ✕ Xóa bộ lọc (Đang hiện {visible.length}/{allSequences.length} trình tự)
              </button>
            )}
          </div>

          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4 items-end">
            <Field label="Lọc theo Đơn Oligo / PO">
              <select
                className={inputClass}
                value={orderFilter}
                onChange={(e) => setOrderFilter(e.target.value)}
                aria-label="Lọc theo Đơn Oligo"
              >
                <option value="ALL">— Tất cả đơn hàng ({allSequences.length} trình tự) —</option>
                {orderGroups.map((og) => (
                  <option key={og.key} value={og.key}>
                    {og.order_code}
                    {og.kd_po_code ? ` · ${og.kd_po_code}` : ""}
                    {og.customer_label ? ` — ${og.customer_label}` : ""} ({og.count} trình tự)
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Phân nhóm trình tự (Primer/Probe vs Amplicon)">
              <select
                className={inputClass}
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
                aria-label="Phân nhóm trình tự"
              >
                <option value="ALL">Mọi vai trò (Primer, Probe & Amplicon)</option>
                <option value="PRIMER_PROBE">🧪 Primer & Probe</option>
                <option value="AMPLICON">🧬 Amplicon / Chứng dương</option>
              </select>
            </Field>
            <Field label="Thang tổng hợp (Scale)">
              <select
                className={inputClass}
                value={scaleFilter}
                onChange={(e) => setScaleFilter(e.target.value)}
                aria-label="Thang tổng hợp"
              >
                <option value="ALL">Mọi thang tổng hợp</option>
                {availableScales.map((sc) => (
                  <option key={sc} value={sc}>{sc}</option>
                ))}
              </select>
            </Field>
            <Field label="Tìm nhanh mã ống / tên trình tự / tác nhân đích">
              <input
                className={inputClass}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="VD: HBV, DENV, O2610, Primer-F..."
              />
            </Field>
          </div>
        </div>
      )}

      {cand.data && cand.data.synthesizers.length === 0 && <Empty>Phòng chưa khai báo máy tổng hợp (vào tab Thiết bị & định mức để thêm máy).</Empty>}
      {cand.data && cand.data.column_lots.length === 0 && <Empty>Kho chưa có lô cột CPG (CONSUMABLE) ở trạng thái RELEASED.</Empty>}
      {cand.data && allSequences.length === 0 && <Empty>Hiện không có trình tự nào ở trạng thái Chờ tổng hợp (PENDING). Vào tab &quot;Đơn Oligo &amp; Giao hàng&quot; để tạo đơn hoặc thêm trình tự mới.</Empty>}
      {cand.data && allSequences.length > 0 && visible.length === 0 && (
        <Empty>Không có trình tự nào khớp bộ lọc đang chọn. Hãy bấm &quot;✕ Xóa bộ lọc&quot; để xem toàn bộ {allSequences.length} trình tự.</Empty>
      )}
      {visible.length > 0 && (
        <Table head={["Vị trí cột #", "Mã & Tên trình tự", "Vai trò / Tác nhân đích", "Đơn hàng / PO", "Hạn giao", "Thang", "Tinh sạch", "Số base", "Chuỗi (5'→3')"]}>
          {visible.map((s) => {
            const pos = picked.indexOf(s.id);
            const ok = fits(s.scale_code);
            return (
              <tr key={s.id} className={ok ? "cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800/50" : "opacity-40"} onClick={() => ok && toggle(s.id)}>
                <td className="py-1.5 pr-3 whitespace-nowrap">
                  <input type="checkbox" readOnly checked={pos >= 0} disabled={!ok || (full && pos < 0)} className="mr-1.5" />
                  {pos >= 0 ? <span className="px-1.5 py-0.5 rounded bg-sky-700 text-white font-bold text-xs">Cột {pos + 1}</span> : <span className="text-xs text-slate-400">Chưa xếp</span>}
                </td>
                <td className="py-1.5 pr-3 font-mono text-xs">{s.code} <span className="font-sans text-slate-500">{s.name}</span></td>
                <td className="py-1.5 pr-3 text-xs">
                  <span className={`px-1.5 py-0.5 rounded font-mono text-[10px] ${s.oligo_role === "POSITIVE_CONTROL" || s.oligo_role === "TEMPLATE" || s.product_type === "AMPLICON_LINEAR" || s.product_type === "AMPLICON_PLASMID" ? "bg-rose-100 text-rose-800 font-bold" : "bg-slate-100 text-slate-700"}`}>
                    {s.product_type === "AMPLICON_LINEAR" || s.product_type === "AMPLICON_PLASMID" ? "AMPLICON" : s.oligo_role || "PRIMER"}
                  </span>
                  {s.target_pathogen && <span className="ml-1 text-slate-500">({s.target_pathogen})</span>}
                </td>
                <td className="py-1.5 pr-3 text-xs">
                  <div className="flex flex-col gap-0.5">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setOrderFilter(s.order_code ?? "__POOL__");
                      }}
                      title="Bấm để lọc riêng các trình tự thuộc đơn hàng này"
                      className="font-mono font-bold text-sky-700 dark:text-sky-400 hover:underline text-left cursor-pointer"
                    >
                      {s.order_code ?? "gộp"}
                    </button>
                    {(s.kd_po_code || s.internal_order_code) && (
                      <span className="text-[10px] text-slate-500 font-mono">
                        {s.internal_order_code ? `${s.internal_order_code}` : ""}
                        {s.kd_po_code ? ` · ${s.kd_po_code}` : ""}
                      </span>
                    )}
                  </div>
                </td>
                <td className="py-1.5 pr-3 text-xs whitespace-nowrap">{fmtDate(s.due_date)}</td>
                <td className="py-1.5 pr-3 text-xs">{s.scale_code}</td>
                <td className="py-1.5 pr-3 text-xs">{PURIFICATION[s.purification as keyof typeof PURIFICATION]}</td>
                <td className="py-1.5 pr-3 text-right">{s.base_count}</td>
                <td className="py-1.5 pr-3 font-mono text-[11px] break-all max-w-80">{s.normalized_sequence}</td>
              </tr>
            );
          })}
        </Table>
      )}
      <div className="flex flex-wrap items-center gap-3 pt-1">
        <Button disabled={!synthId || !lotId || !picked.length || plan.isPending} onClick={() => plan.mutate()}>
          + Lập mẻ tổng hợp ({picked.length}{synth ? `/${synth.column_positions}` : ""} vị trí cột)
        </Button>
        <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
          <input type="checkbox" checked={allowAdjacentContam} onChange={(e) => setAllowAdjacentContam(e.target.checked)} />
          Cho phép xếp cột Chứng dương/Template cạnh cột Primer/Probe (ghi nhận cảnh báo nhiễm chéo cột)
        </label>
        <span className="text-[11px] text-slate-500">Lưu mẻ sẽ giữ chỗ cột CPG & hóa chất theo định mức và kiểm tra nhiễm chéo giữa các vị trí cột liền kề.</span>
      </div>
      <ErrorNote error={plan.error ?? cand.error ?? units.error} />
    </div>
  );
}
