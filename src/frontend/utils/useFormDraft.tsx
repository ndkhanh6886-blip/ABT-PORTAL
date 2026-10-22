"use client";

import React, { useEffect, useRef, useState } from "react";

type Draft<T> = { savedAt: number; data: T };

/**
 * Tự lưu nháp một biểu mẫu dài (báo giá, đơn hàng, hợp đồng) vào trình duyệt khi người dùng đang nhập.
 * Nháp còn lại sau khi tải lại trang / mất điện; mở lại biểu mẫu sẽ có nút "Khôi phục bản nháp".
 * Đóng biểu mẫu (lưu xong hoặc chủ động bỏ) thì nháp bị xóa.
 *
 * @param key     tên nháp, nên kèm tài khoản (vd. `quote_${username}`)
 * @param open    biểu mẫu đang mở
 * @param enabled chỉ lưu nháp khi lập mới (không lưu khi đang sửa một chứng từ có sẵn)
 */
export function useFormDraft<T>(key: string, open: boolean, enabled: boolean, snapshot: T, apply: (data: T) => void) {
    const storageKey = `tbr_draft_${key}`;
    const [pending, setPending] = useState<Draft<T> | null>(null);
    const wasOpen = useRef(false);
    const touched = useRef(false);
    const json = JSON.stringify(snapshot);

    // Mở biểu mẫu: tìm nháp cũ. Đóng biểu mẫu: xóa nháp.
    useEffect(() => {
        if (open && !wasOpen.current) {
            touched.current = false;
            let found: Draft<T> | null = null;
            if (enabled) {
                try {
                    const raw = window.localStorage.getItem(storageKey);
                    if (raw) found = JSON.parse(raw);
                } catch {}
            }
            setPending(found && found.data ? found : null);
        } else if (!open && wasOpen.current) {
            try { window.localStorage.removeItem(storageKey); } catch {}
            setPending(null);
        }
        wasOpen.current = open;
    }, [open, enabled, storageKey]);

    // Chỉ lưu sau khi người dùng thực sự nhập (không lưu các giá trị mặc định được điền sẵn)
    useEffect(() => {
        if (!open || !enabled) return;
        const mark = () => { touched.current = true; };
        // nút thêm / xóa dòng trong biểu mẫu cũng là nhập liệu
        const markClick = (e: MouseEvent) => {
            const b = (e.target as HTMLElement | null)?.closest?.("form button") as HTMLButtonElement | null;
            if (b && b.type !== "submit" && !b.closest("[data-no-dirty]")) touched.current = true;
        };
        document.addEventListener("input", mark, true);
        document.addEventListener("change", mark, true);
        document.addEventListener("click", markClick, true);
        return () => {
            document.removeEventListener("input", mark, true);
            document.removeEventListener("change", mark, true);
            document.removeEventListener("click", markClick, true);
        };
    }, [open, enabled]);

    useEffect(() => {
        if (!open || !enabled || !touched.current) return;
        const t = setTimeout(() => {
            try { window.localStorage.setItem(storageKey, JSON.stringify({ savedAt: Date.now(), data: JSON.parse(json) })); } catch {}
        }, 800);
        return () => clearTimeout(t);
    }, [json, open, enabled, storageKey]);

    const restore = () => {
        if (!pending) return;
        apply(pending.data);
        touched.current = true;
        setPending(null);
    };
    const dismiss = () => {
        try { window.localStorage.removeItem(storageKey); } catch {}
        setPending(null);
    };
    return { pending, restore, dismiss };
}

/** Thanh báo "có bản nháp chưa lưu" đặt ở đầu biểu mẫu. */
export function DraftBanner({ draft }: { draft: { pending: Draft<any> | null; restore: () => void; dismiss: () => void } }) {
    if (!draft.pending) return null;
    const at = new Date(draft.pending.savedAt).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
    return (
        <div data-no-dirty className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            <span>Có bản nháp chưa lưu lúc <b>{at}</b>.</span>
            <span className="flex gap-2">
                <button type="button" data-mark-dirty onClick={draft.restore} className="rounded-lg bg-amber-500 px-3 py-1 font-bold text-slate-950 hover:bg-amber-400 cursor-pointer">Khôi phục bản nháp</button>
                <button type="button" onClick={draft.dismiss} className="rounded-lg border border-amber-500/40 px-3 py-1 font-semibold hover:bg-amber-500/20 cursor-pointer">Bỏ qua</button>
            </span>
        </div>
    );
}
