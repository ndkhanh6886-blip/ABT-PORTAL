"use client";

import React, { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";

/** Giá trị trễ: chỉ cập nhật sau khi người dùng ngừng gõ `delay` ms (lọc danh sách lớn không giật). */
export function useDebouncedValue<T>(value: T, delay = 300): T {
    const [v, setV] = useState(value);
    useEffect(() => {
        const t = setTimeout(() => setV(value), delay);
        return () => clearTimeout(t);
    }, [value, delay]);
    return v;
}

/**
 * Chia trang một danh sách đã lọc. `resetKey` đổi (bộ lọc / từ khóa) thì quay về trang 1.
 * Bảng chỉ vẽ một trang, nên hàng nghìn dòng vẫn mở và lọc nhanh.
 */
export function usePaged<T>(list: T[], defaultSize = 50, resetKey?: unknown) {
    const [page, setPage] = useState(1);
    const [size, setSize] = useState<number>(defaultSize);
    useEffect(() => { setPage(1); }, [resetKey, size]);
    const pages = Math.max(1, Math.ceil(list.length / size));
    const current = Math.min(page, pages);
    const items = useMemo(() => list.slice((current - 1) * size, current * size), [list, current, size]);
    return { items, page: current, pages, setPage, size, setSize, total: list.length };
}

export type Paged = ReturnType<typeof usePaged<any>>;

/** Thanh chia trang: "Hiển thị 1–50 / 3.000" · trang trước / sau · số dòng mỗi trang. */
export function Pager({ p, unit = "dòng", sizes = [25, 50, 100, 200], className = "" }: { p: Paged; unit?: string; sizes?: number[]; className?: string }) {
    if (p.total === 0) return null;
    const from = (p.page - 1) * p.size + 1;
    const to = Math.min(p.total, p.page * p.size);
    const btn = "p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 disabled:opacity-30 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer disabled:cursor-default";
    return (
        <div className={`flex flex-wrap items-center justify-between gap-2 px-2 py-2 text-xs text-slate-500 dark:text-slate-400 ${className}`}>
            <span>
                Hiển thị <b className="text-slate-700 dark:text-slate-200">{from.toLocaleString("vi-VN")}–{to.toLocaleString("vi-VN")}</b> / {p.total.toLocaleString("vi-VN")} {unit}
            </span>
            <div className="flex items-center gap-1">
                <button type="button" className={btn} disabled={p.page <= 1} onClick={() => p.setPage(1)} title="Trang đầu"><ChevronsLeft className="w-3.5 h-3.5" /></button>
                <button type="button" className={btn} disabled={p.page <= 1} onClick={() => p.setPage(p.page - 1)} title="Trang trước"><ChevronLeft className="w-3.5 h-3.5" /></button>
                <span className="px-2 font-bold text-slate-700 dark:text-slate-200">{p.page}/{p.pages}</span>
                <button type="button" className={btn} disabled={p.page >= p.pages} onClick={() => p.setPage(p.page + 1)} title="Trang sau"><ChevronRight className="w-3.5 h-3.5" /></button>
                <button type="button" className={btn} disabled={p.page >= p.pages} onClick={() => p.setPage(p.pages)} title="Trang cuối"><ChevronsRight className="w-3.5 h-3.5" /></button>
                <select value={p.size} onChange={e => p.setSize(Number(e.target.value))}
                    className="ml-1 px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200">
                    {sizes.map(s => <option key={s} value={s}>{s} / trang</option>)}
                </select>
            </div>
        </div>
    );
}
