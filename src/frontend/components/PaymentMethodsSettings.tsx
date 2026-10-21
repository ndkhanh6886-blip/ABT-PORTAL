"use client";

import React, { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Save, Trash2, Wallet } from "lucide-react";
import {
  DEFAULT_PAYMENT_METHODS,
  PAYMENT_METHODS_KEY,
  PAYMENT_METHODS_UPDATED_EVENT,
  normalizePaymentMethods,
} from "@/frontend/utils/paymentMethods";

/** Cài đặt > Tài chính: danh sách phương thức thanh toán dùng khi chi tiền NCC */
export function PaymentMethodsSettings() {
  const [items, setItems] = useState<string[]>(DEFAULT_PAYMENT_METHODS);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    fetch(`/api/storage?key=${PAYMENT_METHODS_KEY}`)
      .then((r) => r.json())
      .then((d) => {
        const list = normalizePaymentMethods(d?.data);
        if (list.length > 0) setItems(list);
      })
      .catch(() => {});
  }, []);

  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    setItems(next);
  };

  const save = async () => {
    const list = normalizePaymentMethods(items);
    if (list.length === 0) {
      setMsg({ ok: false, text: "Cần ít nhất 1 phương thức thanh toán." });
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/storage?key=${PAYMENT_METHODS_KEY}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: PAYMENT_METHODS_KEY, data: list }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `Lỗi ${res.status}`);
      }
      setItems(list);
      window.dispatchEvent(new CustomEvent(PAYMENT_METHODS_UPDATED_EVENT, { detail: list }));
      setMsg({ ok: true, text: "Đã lưu danh sách phương thức thanh toán." });
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message || "Không lưu được" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-4 max-w-2xl">
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-xl bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300">
          <Wallet className="w-5 h-5" />
        </div>
        <div>
          <h3 className="text-sm font-black text-slate-900 dark:text-white">Phương thức thanh toán</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Hiện trong ô "Phương thức thanh toán" khi Kế toán ghi nhận chi tiền cho nhà cung cấp. Có thể ghi kèm số tài khoản.
          </p>
        </div>
      </div>

      <div className="space-y-1.5">
        {items.map((m, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <input
              value={m}
              onChange={(e) => setItems((prev) => prev.map((x, k) => (k === i ? e.target.value : x)))}
              className="flex-1 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 dark:text-white"
            />
            <button type="button" onClick={() => move(i, -1)} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 cursor-pointer" title="Lên">
              <ArrowUp className="w-3.5 h-3.5" />
            </button>
            <button type="button" onClick={() => move(i, 1)} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 cursor-pointer" title="Xuống">
              <ArrowDown className="w-3.5 h-3.5" />
            </button>
            <button type="button" onClick={() => setItems((prev) => prev.filter((_, k) => k !== i))} className="p-1.5 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/50 text-slate-400 hover:text-rose-600 cursor-pointer" title="Xóa">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-1.5">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && draft.trim()) {
              e.preventDefault();
              setItems((prev) => [...prev, draft.trim()]);
              setDraft("");
            }
          }}
          placeholder="VD: Chuyển khoản Vietinbank (TK: ...)"
          className="flex-1 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 dark:text-white"
        />
        <button
          type="button"
          disabled={!draft.trim()}
          onClick={() => { setItems((prev) => [...prev, draft.trim()]); setDraft(""); }}
          className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold flex items-center gap-1 cursor-pointer disabled:opacity-40"
        >
          <Plus className="w-3.5 h-3.5" /> Thêm
        </button>
      </div>

      <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
        <span className={`text-xs ${msg ? (msg.ok ? "text-emerald-600" : "text-rose-600") : "text-slate-400"}`}>{msg?.text || ""}</span>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
        >
          <Save className="w-3.5 h-3.5" /> {saving ? "Đang lưu..." : "Lưu"}
        </button>
      </div>
    </div>
  );
}
