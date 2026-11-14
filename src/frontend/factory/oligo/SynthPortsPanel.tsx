"use client";

import React, { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, fmtDate, fmtQty } from "../api";
import { Button, Card, Empty, ErrorNote, inputClass, Table } from "../ui";
import { BarcodeScanVerifier } from "../BarcodeScanVerifier";
import { ItemPicker } from "./EquipmentView";

interface PortRow {
  port_no: number;
  role: string;
  label: string | null;
  item_id?: string | null;
  current_lot_id: string | null;
  lot_code: string | null;
  expiry_date: string | null;
  installed_at: string | null;
  rule_name: string | null;
  display_name: string | null;
  rule_qty?: number | null;
  rule_uom?: string | null;
  rule_basis?: string | null;
  available: number | null;
  item: { id: string; code: string; name: string; base_uom: string } | null;
  lots: { lot_id: string; code: string; available: number; expiry_date: string | null }[];
}
interface PortsData {
  synthesizer: { id: string; code: string; name: string };
  ports: PortRow[];
  events: { port_no: number; role: string; event: string; swap_cycle: number | null; qty: number | null; created_at: string; lot_code: string | null; old_lot_code: string | null; batch_code: string | null }[];
}
interface RuleOpt {
  role: string;
  name: string;
  display_name: string | null;
  item_id: string | null;
  item_code: string | null;
  item_name: string | null;
  qty: number;
  uom: string;
}
interface ModOpt {
  code: string;
  name: string;
  kind: string;
  status: string;
  amidite_item_id: string | null;
}

const STANDARD_10_PORTS = [
  { port_no: "1", role: "dA", label: "Bottle 1 — dA Amidite" },
  { port_no: "2", role: "dC", label: "Bottle 2 — dC Amidite" },
  { port_no: "3", role: "dG", label: "Bottle 3 — dG Amidite" },
  { port_no: "4", role: "dT", label: "Bottle 4 — dT Amidite" },
  { port_no: "5", role: "DEBLOCK", label: "Bottle 5 — TCA Deblock" },
  { port_no: "6", role: "ACTIVATOR", label: "Bottle 6 — ETT Activator" },
  { port_no: "7", role: "CAP_A", label: "Bottle 7 — Cap A (THF/Ac2O)" },
  { port_no: "8", role: "CAP_B", label: "Bottle 8 — Cap B (NMI)" },
  { port_no: "9", role: "OXIDATION", label: "Bottle 9 — Iodine Oxidizer" },
  { port_no: "10", role: "ACN", label: "Bottle 10 — Acetonitrile Wash" },
];

/** Taking a bottle off with the measured volumes: calibrates the rule and books the difference on the lot. */
function RemoveBottle({ synthId, port, onDone }: { synthId: string; port: PortRow; onDone: () => void }) {
  const [f, setF] = useState({ volume_start: "", volume_left: "", uom: port.item?.base_uom ?? "mL", adjust_stock: true, notes: "" });
  const remove = useMutation({
    mutationFn: () =>
      api<{ ratio: number | null; suggested_qty: number | null }>(`/api/factory/oligo/synthesizers/${synthId}/ports/${port.port_no}/remove`, {
        method: "POST",
        json: { ...f, volume_start: Number(f.volume_start), volume_left: Number(f.volume_left), notes: f.notes || null },
      }),
    onSuccess: onDone,
  });
  return (
    <form className="flex flex-wrap gap-1 items-center text-xs" onSubmit={(e) => { e.preventDefault(); remove.mutate(); }}>
      <input className={`${inputClass} w-24`} inputMode="decimal" placeholder="Lúc lắp" value={f.volume_start} onChange={(e) => setF({ ...f, volume_start: e.target.value })} required aria-label="Dung tích chai lúc lắp" />
      <input className={`${inputClass} w-24`} inputMode="decimal" placeholder="Còn lại" value={f.volume_left} onChange={(e) => setF({ ...f, volume_left: e.target.value })} required aria-label="Lượng còn lại khi tháo" />
      <input className={`${inputClass} w-14`} value={f.uom} onChange={(e) => setF({ ...f, uom: e.target.value })} aria-label="Đơn vị" />
      <label className="flex items-center gap-1"><input type="checkbox" checked={f.adjust_stock} onChange={(e) => setF({ ...f, adjust_stock: e.target.checked })} />Ghi chênh lệch vào kho</label>
      <Button type="submit" variant="ghost" disabled={remove.isPending}>Tháo chai</Button>
      {remove.error != null && <ErrorNote error={remove.error} />}
    </form>
  );
}

const EVENT: Record<string, string> = { INSTALL: "Lắp chai", REMOVE: "Tháo chai", SWAP: "Thay chai trong mẻ" };

/** Ports of one synthesizer (as OligoFlow): which reagent each port feeds and which bottle (lot) is on it. */
export function SynthPortsPanel({ synthId, canConfigure, canOperate, onClose }: { synthId: string; canConfigure: boolean; canOperate: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const data = useQuery({ queryKey: ["factory", "oligo-ports", synthId], queryFn: () => api<PortsData>(`/api/factory/oligo/synthesizers/${synthId}/ports`) });
  const rules = useQuery({ queryKey: ["factory", "oligo-reagent-rules"], queryFn: () => api<RuleOpt[]>("/api/factory/oligo/reagent-rules") });
  const mods = useQuery({ queryKey: ["factory", "oligo-catalog"], queryFn: () => api<ModOpt[]>("/api/factory/oligo/modifications") });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<{ port_no: string; role: string; item_id: string; item_label?: string; label: string }[]>([]);

  const resolveRoleItem = (role: string): { item_id: string; item_label?: string } => {
    if (!role) return { item_id: "" };
    if (role.startsWith("MOD:")) {
      const m = (mods.data ?? []).find((x) => x.code === role.slice(4));
      if (m?.amidite_item_id) return { item_id: m.amidite_item_id, item_label: `Amidite ${m.code}` };
      const defRule = (rules.data ?? []).find((r) => r.role === "MOD_DEFAULT");
      return {
        item_id: defRule?.item_id ?? "",
        item_label: defRule?.item_code ? `${defRule.item_code} · ${defRule.item_name}` : undefined,
      };
    }
    const r = (rules.data ?? []).find((x) => x.role === role);
    return {
      item_id: r?.item_id ?? "",
      item_label: r?.item_code ? `${r.item_code} · ${r.item_name}` : undefined,
    };
  };

  useEffect(() => {
    if (data.data) {
      setDraft(
        data.data.ports.map((p) => ({
          port_no: String(p.port_no),
          role: p.role,
          item_id: p.item?.id ?? p.item_id ?? resolveRoleItem(p.role).item_id,
          item_label: p.item ? `${p.item.code} · ${p.item.name}` : resolveRoleItem(p.role).item_label,
          label: p.label ?? "",
        }))
      );
    }
  }, [data.data, rules.data, mods.data]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["factory", "oligo-ports", synthId] });
    qc.invalidateQueries({ queryKey: ["factory", "oligo-reagent-rules"] });
    qc.invalidateQueries({ queryKey: ["factory", "oligo-catalog"] });
  };

  const save = useMutation({
    mutationFn: () =>
      api(`/api/factory/oligo/synthesizers/${synthId}/ports`, {
        method: "PUT",
        json: {
          ports: draft
            .filter((d) => d.port_no && d.role)
            .map((d) => ({
              port_no: Number(d.port_no),
              role: d.role,
              item_id: d.item_id || null,
              label: d.label || null,
            })),
        },
      }),
    onSuccess: () => {
      setEditing(false);
      refresh();
    },
  });
  const bottle = useMutation({
    mutationFn: ({ port, lot }: { port: number; lot: string | null }) => api(`/api/factory/oligo/synthesizers/${synthId}/ports/${port}/bottle`, { method: "PUT", json: { lot_id: lot } }),
    onSuccess: refresh,
  });
  const roleOptions = [
    ...(rules.data ?? []).filter((r) => r.role !== "MOD_DEFAULT").map((r) => ({
      value: r.role,
      label: `${r.role} — ${r.display_name ?? r.name}${r.item_code ? ` [${r.item_code}]` : ""}`,
    })),
    ...(mods.data ?? []).filter((m) => m.kind !== "BASE" && m.status === "ACTIVE").map((m) => ({
      value: `MOD:${m.code}`,
      label: `Amidite ${m.code} (${m.name})`,
    })),
  ];
  const d = data.data;

  return (
    <Card title={d ? `Cổng hóa chất — ${d.synthesizer.code} ${d.synthesizer.name}` : "Cổng hóa chất"} actions={<Button variant="ghost" onClick={onClose}>Đóng</Button>}>
      <ErrorNote error={data.error ?? bottle.error} />
      {d && !editing && (
        <div className="flex flex-col gap-3">
          {d.ports.length === 0 && <Empty>Chưa khai báo cổng. Máy chưa có cổng thì hóa chất được giữ chỗ theo hạn dùng (FEFO) từ kho.</Empty>}
          {d.ports.length > 0 && (
            <BarcodeScanVerifier
              label="Quét mã vạch chai hóa chất trên cổng"
              expectedCodes={d.ports.map((p) => p.lot_code).filter((x): x is string => Boolean(x))}
            />
          )}
          {d.ports.length > 0 && (
            <Table head={["Cổng", "Vai trò & Hóa chất", "Mã hóa chất / Reagent kho", "Định mức", "Chai / Lô đang lắp", "Còn (sổ kho)", "Hạn dùng", "Lắp / thay chai", "Tháo chai (đo lượng còn)"]}>
              {d.ports.map((p) => (
                <tr key={p.port_no}>
                  <td className="py-1.5 pr-3 font-bold">#{p.port_no}</td>
                  <td className="py-1.5 pr-3 text-xs">
                    <span className="font-mono font-bold text-sky-700 dark:text-sky-400">{p.role}</span>{" "}
                    <span className="text-slate-600 dark:text-slate-300">{p.label ?? p.display_name ?? p.rule_name ?? ""}</span>
                  </td>
                  <td className="py-1.5 pr-3 text-xs">
                    {p.item ? (
                      <div>
                        <span className="font-mono font-bold">{p.item.code}</span> · {p.item.name}
                      </div>
                    ) : (
                      <span className="text-amber-700 dark:text-amber-400 font-semibold">⚠️ Chưa gắn mã hóa chất kho (Bấm Cấu hình cổng để chọn)</span>
                    )}
                  </td>
                  <td className="py-1.5 pr-3 text-xs whitespace-nowrap font-mono">
                    {p.rule_qty != null ? `${p.rule_qty} ${p.rule_uom ?? "mL"}` : "—"}
                  </td>
                  <td className="py-1.5 pr-3 font-mono text-xs">{p.lot_code ?? <span className="font-sans text-amber-700 dark:text-amber-400">Trống</span>}</td>
                  <td className="py-1.5 pr-3 text-right text-xs">{p.available == null ? "—" : `${fmtQty(p.available)} ${p.item?.base_uom ?? ""}`}</td>
                  <td className="py-1.5 pr-3 text-xs">{fmtDate(p.expiry_date)}</td>
                  <td className="py-1.5 pr-3">
                    {canOperate && (
                      <select
                        className={`${inputClass} w-56`}
                        value={p.current_lot_id ?? ""}
                        disabled={bottle.isPending}
                        onChange={(e) => bottle.mutate({ port: p.port_no, lot: e.target.value || null })}
                        aria-label={`Chai cho cổng ${p.port_no}`}
                      >
                        <option value="">— không lắp —</option>
                        {p.lots.map((l) => <option key={l.lot_id} value={l.lot_id}>{l.code} (còn {fmtQty(l.available)}{l.expiry_date ? `, HD ${fmtDate(l.expiry_date)}` : ""})</option>)}
                      </select>
                    )}
                  </td>
                  <td className="py-1.5 pr-3">{canOperate && p.current_lot_id && <RemoveBottle synthId={synthId} port={p} onDone={refresh} />}</td>
                </tr>
              ))}
            </Table>
          )}
          <p className="text-[11px] text-slate-500">
            Tháo chai hết: nhập dung tích lúc lắp và lượng còn lại — hệ thống so với lượng các mẻ đã ghi sổ, đề xuất định mức mới (xem ở Mẻ tổng hợp → Hiệu chuẩn định mức).
            Lập mẻ giữ chỗ hóa chất của mỗi cổng từ chai đang lắp; đổi chai trước khi chạy thì mẻ tự chuyển sang chai mới.
          </p>
          {canConfigure && (
            <div>
              <Button variant="ghost" onClick={() => setEditing(true)}>
                ⚙ Cấu hình cổng & Liên kết mã hóa chất kho
              </Button>
            </div>
          )}
          {d.events.length > 0 && (
            <Table head={["Lúc", "Cổng", "Sự kiện", "Chai mới", "Chai cũ", "Mẻ / chu kỳ"]}>
              {d.events.map((e, i) => (
                <tr key={i}>
                  <td className="py-1 pr-3 text-xs whitespace-nowrap">{new Date(e.created_at).toLocaleString("vi-VN")}</td>
                  <td className="py-1 pr-3 text-xs">{e.port_no} · {e.role}</td>
                  <td className="py-1 pr-3 text-xs">{EVENT[e.event] ?? e.event}</td>
                  <td className="py-1 pr-3 font-mono text-xs">{e.lot_code ?? "—"}</td>
                  <td className="py-1 pr-3 font-mono text-xs">{e.old_lot_code ?? "—"}</td>
                  <td className="py-1 pr-3 text-xs">{e.batch_code ? `${e.batch_code} từ chu kỳ ${e.swap_cycle} (${fmtQty(e.qty)})` : "—"}</td>
                </tr>
              ))}
            </Table>
          )}
        </div>
      )}
      {d && editing && (
        <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-200 dark:border-slate-800">
            <div className="text-xs text-slate-600 dark:text-slate-300">
              Chọn <b>Số cổng</b>, <b>Vai trò hóa chất trên máy</b> và <b>Mã hóa chất / Reagent liên kết trong kho</b> (hệ thống tự động đồng bộ mã hàng kho với định mức của vai trò đó).
            </div>
            <Button
              type="button"
              variant="ghost"
              onClick={() =>
                setDraft(
                  STANDARD_10_PORTS.map((sp) => {
                    const resolved = resolveRoleItem(sp.role);
                    return {
                      port_no: sp.port_no,
                      role: sp.role,
                      item_id: resolved.item_id,
                      item_label: resolved.item_label,
                      label: sp.label,
                    };
                  })
                )
              }
            >
              ⚡ Nạp nhanh 10 cổng chuẩn (dA/dC/dG/dT + Deblock/Act/Cap/Ox/ACN)
            </Button>
          </div>

          <div className="hidden lg:grid lg:grid-cols-12 gap-2 text-[11px] font-bold text-slate-500 px-1">
            <div className="col-span-1">Cổng #</div>
            <div className="col-span-3">Vai trò hóa chất trên máy *</div>
            <div className="col-span-5">Mã hóa chất / Reagent liên kết trong Kho *</div>
            <div className="col-span-2">Nhãn hiển thị (tùy chọn)</div>
            <div className="col-span-1 text-right">Thao tác</div>
          </div>

          {draft.map((p, i) => (
            <div key={i} className="grid grid-cols-1 lg:grid-cols-12 gap-2 items-center p-2 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800">
              <div className="lg:col-span-1">
                <input
                  className={`${inputClass} w-full font-mono font-bold`}
                  type="number"
                  min="1"
                  max="200"
                  placeholder="Cổng"
                  value={p.port_no}
                  onChange={(e) => setDraft(draft.map((x, j) => (j === i ? { ...x, port_no: e.target.value } : x)))}
                />
              </div>
              <div className="lg:col-span-3">
                <select
                  className={`${inputClass} w-full`}
                  value={p.role}
                  onChange={(e) => {
                    const nextRole = e.target.value;
                    const resolved = resolveRoleItem(nextRole);
                    setDraft(
                      draft.map((x, j) =>
                        j === i
                          ? {
                              ...x,
                              role: nextRole,
                              item_id: resolved.item_id || x.item_id,
                              item_label: resolved.item_label || x.item_label,
                            }
                          : x
                      )
                    );
                  }}
                  aria-label="Vai trò hóa chất"
                >
                  <option value="">— Chọn vai trò hóa chất —</option>
                  {roleOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div className="lg:col-span-5">
                <ItemPicker
                  value={p.item_id}
                  current={p.item_label}
                  onChange={(id) => setDraft(draft.map((x, j) => (j === i ? { ...x, item_id: id } : x)))}
                />
              </div>
              <div className="lg:col-span-2">
                <input
                  className={`${inputClass} w-full`}
                  placeholder="Nhãn (VD: Bottle 1 - dA)"
                  value={p.label}
                  onChange={(e) => setDraft(draft.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                />
              </div>
              <div className="lg:col-span-1 text-right">
                <button
                  type="button"
                  className="text-rose-600 hover:underline text-xs font-semibold cursor-pointer"
                  onClick={() => setDraft(draft.filter((_, j) => j !== i))}
                >
                  Xóa
                </button>
              </div>
            </div>
          ))}
          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              type="button"
              variant="ghost"
              onClick={() =>
                setDraft([
                  ...draft,
                  {
                    port_no: String(Math.max(0, ...draft.map((x) => Number(x.port_no) || 0)) + 1),
                    role: "",
                    item_id: "",
                    label: "",
                  },
                ])
              }
            >
              + Thêm cổng
            </Button>
            <Button type="button" variant="ghost" onClick={() => setEditing(false)}>Hủy</Button>
            <Button type="submit" disabled={save.isPending}>Lưu cấu hình cổng & liên kết kho</Button>
          </div>
          <ErrorNote error={save.error} />
        </form>
      )}
    </Card>
  );
}
