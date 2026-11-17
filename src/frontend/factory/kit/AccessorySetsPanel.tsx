"use client";

import React, { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { ErrorNote } from "../ui";

interface AccessoryConfigItem {
  code: string;
  name: string;
  default_qty: number;
  qty: number;
  in_catalog: boolean;
}
interface AccessoryConfigSet {
  key: string;
  group: string;
  variant: string;
  items: AccessoryConfigItem[];
}

/**
 * Cài đặt định mức vật tư cấp kèm của từng mã phụ kit tách chiết máy (số lượng / 1 kit).
 * Áp dụng cho lệnh sản xuất xác nhận sau khi lưu; lệnh đã xác nhận giữ nguyên số đã giữ chỗ.
 */
export function AccessorySetsPanel({ canEdit }: { canEdit: boolean }) {
  const [open, setOpen] = useState(false);
  const [sets, setSets] = useState<AccessoryConfigSet[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string>("");
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await api<{ sets: AccessoryConfigSet[] }>("/api/factory/kit/accessory-sets");
      setSets(res.sets);
      setDraft({});
    } catch (e) {
      setError(e);
    }
  }, []);

  useEffect(() => {
    if (open && sets.length === 0) load();
  }, [open, sets.length, load]);

  const save = async (set: AccessoryConfigSet, it: AccessoryConfigItem) => {
    const k = `${set.key}|${it.code}`;
    const raw = draft[k];
    if (raw === undefined) return;
    const n = Number(raw);
    if (!(n > 0)) {
      setError(new Error("Định mức phải là số lớn hơn 0."));
      return;
    }
    setSaving(k);
    setError(null);
    try {
      await api("/api/factory/kit/accessory-sets", {
        method: "POST",
        json: { accessory_set: set.key, item_code: it.code, qty_per_kit: n },
      });
      setNotice(`Đã lưu định mức ${it.code} của mã phụ ${set.variant} (${set.group}): ${n} / kit.`);
      await load();
    } catch (e) {
      setError(e);
    } finally {
      setSaving("");
    }
  };

  const groups = Array.from(new Set(sets.map((s) => s.group)));

  return (
    <div className="rounded-xl border border-teal-200 dark:border-teal-800 bg-teal-50/40 dark:bg-teal-950/20">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-left text-xs font-extrabold uppercase text-teal-900 dark:text-teal-200"
      >
        <span>🧪 Mã phụ kit tách chiết máy — định mức vật tư cấp kèm (số lượng trừ kho / 1 kit)</span>
        <span>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-3">
          <p className="text-[11px] text-slate-600 dark:text-slate-300">
            Mỗi mã phụ cấp kèm một bộ vật tư. Số lượng mặc định 1 / kit; chỉnh tại đây (vd 2 tube strip cho mỗi kit). Lệnh sản xuất tự giữ chỗ và trừ kho
            theo số lượng này khi xác nhận lệnh. Mã NVL đánh dấu ⚠ chưa có trong danh mục vật tư (cần tạo trước khi xác nhận lệnh).
          </p>
          <ErrorNote error={error} />
          {notice && <div className="text-[11px] font-semibold text-emerald-700">{notice}</div>}
          {groups.map((g) => (
            <div key={g}>
              <div className="text-[11px] font-bold text-slate-700 dark:text-slate-200 mb-1">Nhóm {g}</div>
              <table className="w-full text-[11px] border border-teal-100 dark:border-teal-900">
                <thead>
                  <tr className="bg-teal-100/60 dark:bg-teal-900/40 text-left">
                    <th className="px-2 py-1 w-20">Mã phụ</th>
                    <th className="px-2 py-1">Mã NVL — Tên vật tư</th>
                    <th className="px-2 py-1 w-44">SL / 1 kit</th>
                  </tr>
                </thead>
                <tbody>
                  {sets
                    .filter((s) => s.group === g)
                    .flatMap((s) =>
                      s.items.map((it, idx) => {
                        const k = `${s.key}|${it.code}`;
                        const val = draft[k] ?? String(it.qty);
                        const dirty = draft[k] !== undefined && Number(draft[k]) !== it.qty;
                        return (
                          <tr key={k} className="border-t border-teal-100 dark:border-teal-900">
                            {idx === 0 && (
                              <td rowSpan={s.items.length} className="px-2 py-1 font-bold align-top">
                                {s.variant}
                              </td>
                            )}
                            <td className="px-2 py-1">
                              <span className="font-mono font-semibold">{it.code}</span> — {it.name}
                              {!it.in_catalog && <span className="ml-1 text-amber-600 font-semibold">⚠ chưa có trong danh mục vật tư</span>}
                            </td>
                            <td className="px-2 py-1">
                              <div className="flex items-center gap-1">
                                <input
                                  type="number"
                                  min="0"
                                  step="any"
                                  disabled={!canEdit}
                                  value={val}
                                  onChange={(e) => setDraft((p) => ({ ...p, [k]: e.target.value }))}
                                  className="w-20 px-1.5 py-0.5 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-right"
                                />
                                {canEdit && (
                                  <button
                                    type="button"
                                    disabled={!dirty || saving === k}
                                    onClick={() => save(s, it)}
                                    className="px-2 py-0.5 rounded bg-teal-600 text-white font-bold disabled:opacity-40"
                                  >
                                    {saving === k ? "..." : "Lưu"}
                                  </button>
                                )}
                                {it.qty !== it.default_qty && <span className="text-slate-400">(mặc định {it.default_qty})</span>}
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
