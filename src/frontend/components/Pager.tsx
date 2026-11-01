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
 * `size === 0` nghĩa là hiển thị Tất cả.
 * Bảng chỉ vẽ một trang, nên hàng nghìn dòng vẫn mở và lọc nhanh.
 */
export function usePaged<T>(list: T[], defaultSize = 20, resetKey?: unknown) {
    const safeList = Array.isArray(list) ? list : [];
    const [page, setPage] = useState(1);
    const [size, setSize] = useState<number>(defaultSize);
    useEffect(() => { setPage(1); }, [resetKey, size]);
    const effectiveSize = size <= 0 ? Math.max(1, safeList.length) : size;
    const pages = size <= 0 ? 1 : Math.max(1, Math.ceil(safeList.length / effectiveSize));
    const current = Math.min(Math.max(1, page), pages);
    const items = useMemo(
        () => (size <= 0 ? safeList : safeList.slice((current - 1) * effectiveSize, current * effectiveSize)),
        [safeList, current, size, effectiveSize]
    );
    return { items, page: current, pages, setPage, size, setSize, total: safeList.length };
}

export type Paged = ReturnType<typeof usePaged<any>>;

/** Hàm thuần tạo đối tượng Paged từ state [page, setPage] và [size, setSize] (dùng được cả trong render IIFE). */
export function buildPaged<T>(
    list: T[],
    page: number,
    setPage: (p: number) => void,
    size: number,
    setSize: (s: number) => void
): {
    items: T[];
    page: number;
    pages: number;
    setPage: React.Dispatch<React.SetStateAction<number>>;
    size: number;
    setSize: React.Dispatch<React.SetStateAction<number>>;
    total: number;
} {
    const safeList = Array.isArray(list) ? list : [];
    const effectiveSize = size <= 0 ? Math.max(1, safeList.length) : size;
    const pages = size <= 0 ? 1 : Math.max(1, Math.ceil(safeList.length / effectiveSize));
    const current = Math.min(Math.max(1, page), pages);
    const items = size <= 0 ? safeList : safeList.slice((current - 1) * effectiveSize, current * effectiveSize);
    return {
        items,
        page: current,
        pages,
        setPage: ((val: any) => {
            const next = typeof val === "function" ? val(current) : val;
            setPage(next);
        }) as React.Dispatch<React.SetStateAction<number>>,
        size,
        setSize: ((val: any) => {
            const next = typeof val === "function" ? val(size) : val;
            setSize(next);
            setPage(1);
        }) as React.Dispatch<React.SetStateAction<number>>,
        total: safeList.length,
    };
}

/** Thanh chia trang: "Hiển thị 1–20 / 3.000" · trang đầu / trước / nhập trang / sau / cuối · số dòng mỗi trang. */
export function Pager({
    p,
    unit = "dòng",
    sizes = [20, 50, 100, 200],
    className = "",
}: {
    p: Paged;
    unit?: string;
    sizes?: number[];
    className?: string;
}) {
    if (p.total === 0) return null;
    const isAll = p.size <= 0;
    const from = isAll ? 1 : (p.page - 1) * p.size + 1;
    const to = isAll ? p.total : Math.min(p.total, p.page * p.size);
    const btn =
        "p-1.5 px-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-600 dark:text-slate-300 disabled:opacity-30 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer disabled:cursor-default transition-colors flex items-center gap-1";
    const sizeList = sizes.includes(p.size) || isAll ? sizes : [p.size, ...sizes].sort((a, b) => a - b);

    return (
        <div
            className={`flex flex-wrap items-center justify-between gap-2.5 px-3 py-2.5 text-xs text-slate-500 dark:text-slate-400 border-t border-slate-200/70 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/50 rounded-b-xl ${className}`}
        >
            <div className="flex items-center gap-3 flex-wrap">
                <span>
                    Hiển thị{" "}
                    <b className="text-slate-800 dark:text-white font-mono">
                        {from.toLocaleString("vi-VN")}–{to.toLocaleString("vi-VN")}
                    </b>{" "}
                    trong tổng số{" "}
                    <b className="text-indigo-600 dark:text-sky-400 font-mono">
                        {p.total.toLocaleString("vi-VN")}
                    </b>{" "}
                    {unit}
                </span>
                <div className="flex items-center gap-1.5 pl-3 border-l border-slate-200 dark:border-slate-800">
                    <span className="text-[11px] text-slate-400 dark:text-slate-500">Hiển thị:</span>
                    <select
                        data-no-enhance="true"
                        value={p.size}
                        onChange={(e) => p.setSize(Number(e.target.value))}
                        className="px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-700 dark:text-slate-200 font-mono text-xs cursor-pointer outline-none focus:border-indigo-500"
                    >
                        {sizeList.map((s) => (
                            <option key={s} value={s}>
                                {s} / trang
                            </option>
                        ))}
                        <option value={0}>Tất cả ({p.total})</option>
                    </select>
                </div>
            </div>

            {!isAll && p.pages > 1 && (
                <div className="flex items-center gap-1">
                    <button
                        type="button"
                        className={btn}
                        disabled={p.page <= 1}
                        onClick={() => p.setPage(1)}
                        title="Trang đầu"
                    >
                        <ChevronsLeft className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline text-[10px]">Đầu</span>
                    </button>
                    <button
                        type="button"
                        className={btn}
                        disabled={p.page <= 1}
                        onClick={() => p.setPage(Math.max(1, p.page - 1))}
                        title="Trang trước"
                    >
                        <ChevronLeft className="w-3.5 h-3.5" />
                        <span className="text-[10px]">Trước</span>
                    </button>
                    <div className="flex items-center gap-1 px-1.5">
                        <span className="text-[11px] font-mono">Trang</span>
                        <input
                            type="number"
                            min={1}
                            max={p.pages}
                            value={p.page}
                            onChange={(e) => {
                                const val = parseInt(e.target.value, 10);
                                if (!isNaN(val) && val >= 1 && val <= p.pages) {
                                    p.setPage(val);
                                }
                            }}
                            className="w-12 text-center bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded py-0.5 text-xs font-mono font-bold text-indigo-600 dark:text-indigo-400 focus:outline-none focus:border-indigo-500"
                        />
                        <span className="text-[11px] font-mono">/ {p.pages}</span>
                    </div>
                    <button
                        type="button"
                        className={btn}
                        disabled={p.page >= p.pages}
                        onClick={() => p.setPage(Math.min(p.pages, p.page + 1))}
                        title="Trang sau"
                    >
                        <span className="text-[10px]">Sau</span>
                        <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                    <button
                        type="button"
                        className={btn}
                        disabled={p.page >= p.pages}
                        onClick={() => p.setPage(p.pages)}
                        title="Trang cuối"
                    >
                        <span className="hidden sm:inline text-[10px]">Cuối</span>
                        <ChevronsRight className="w-3.5 h-3.5" />
                    </button>
                </div>
            )}
        </div>
    );
}
