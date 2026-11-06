"use client";

import React, { useEffect, useRef, useState } from "react";
import { CalendarDays } from "lucide-react";

/** "YYYY-MM-DD" từ chuỗi ngày bất kỳ ("YYYY-MM-DD...", "DD/MM/YYYY", "DD.MM.YYYY"); không hợp lệ -> "". */
export function toISODate(v: any): string {
    const s = String(v ?? "").trim();
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/);
    if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    return "";
}

/** "DD/MM/YYYY" từ chuỗi ngày ISO (hiển thị theo kiểu Việt Nam). */
export function formatDateVN(v: any): string {
    const iso = toISODate(v);
    return iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "";
}

const isValidISO = (iso: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
    const d = new Date(`${iso}T00:00:00Z`);
    return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
};

/** Gõ số -> tự chèn "/" thành dd/mm/yyyy. Gõ kèm dấu phân cách ("4/9/2031", "4.9.31") thì giữ nguyên cách gõ. */
const mask = (raw: string) => {
    const parts = raw.replace(/[^\d/.\-]/g, "").split(/[/.\-]/);
    if (parts.length > 1 && parts.length <= 3 && (parts[0] || "").length <= 2 && (parts[1] || "").length <= 2 && (parts[2] || "").length <= 4) {
        return parts.join("/");
    }
    const digits = raw.replace(/\D/g, "").slice(0, 8);
    if (digits.length <= 2) return digits;
    if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
    return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
};

/** Ngày gõ tay -> "YYYY-MM-DD": d/m/yyyy, d/m/yy, ddmmyy, ddmmyyyy (năm 2 số = 20yy). `full`: chỉ nhận năm 4 số. */
const parseTyped = (t: string, full = false): string => {
    const s = t.trim();
    let d = "", m = "", y = "";
    const sep = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})$/);
    if (sep) { [, d, m, y] = sep; }
    else {
        const digits = s.replace(/\D/g, "");
        if (digits.length === 8 || digits.length === 6) { d = digits.slice(0, 2); m = digits.slice(2, 4); y = digits.slice(4); }
    }
    if (!d || (full && y.length !== 4)) return "";
    if (y.length === 2) y = String(2000 + Number(y));
    const iso = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
    return isValidISO(iso) ? iso : "";
};

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange" | "min" | "max"> & {
    value?: string | null;
    min?: string;
    max?: string;
    /** Giống ô ngày của trình duyệt: e.target.value là "YYYY-MM-DD" (hoặc "" khi xóa). */
    onChange?: (e: { target: { value: string } }) => void;
};

/**
 * Ô chọn ngày luôn hiển thị theo kiểu Việt Nam (dd/mm/yyyy), không phụ thuộc ngôn ngữ của trình duyệt
 * (ô <input type="date"> hiện mm/dd/yyyy trên trình duyệt tiếng Anh). Gõ tay hoặc bấm biểu tượng lịch.
 * Giá trị vào / ra vẫn là "YYYY-MM-DD" như ô ngày gốc, nên thay thế trực tiếp được.
 */
export function DateInputVN({ value, onChange, className = "", min, max, disabled, required, placeholder, onBlur, ...rest }: Props) {
    const iso = toISODate(value);
    const [text, setText] = useState(formatDateVN(iso));
    const [focused, setFocused] = useState(false);
    const pickerRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!focused) setText(formatDateVN(iso));
    }, [iso, focused]);

    const emit = (v: string) => onChange?.({ target: { value: v } });

    const inRange = (next: string) => (!min || next >= toISODate(min)) && (!max || next <= toISODate(max));

    const handleText = (raw: string) => {
        const t = mask(raw);
        setText(t);
        if (t === "") { emit(""); return; }
        const next = parseTyped(t, true);
        if (next && inRange(next)) emit(next);
    };

    const openPicker = () => {
        const el = pickerRef.current as any;
        if (!el || disabled) return;
        try { if (typeof el.showPicker === "function") { el.showPicker(); return; } } catch { /* trình duyệt cũ */ }
        el.focus();
        el.click();
    };

    const wide = /\bw-full\b/.test(className);
    return (
        <span className={`relative ${wide ? "block w-full" : "inline-block"}`}>
            <input
                {...rest}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                placeholder={placeholder || "dd/mm/yyyy"}
                value={text}
                disabled={disabled}
                required={required}
                // Bấm vào ô để gõ tay (lịch chỉ mở khi bấm biểu tượng lịch hoặc Alt+↓)
                onKeyDown={(e) => {
                    if (e.altKey && e.key === "ArrowDown") { e.preventDefault(); openPicker(); }
                    rest.onKeyDown?.(e);
                }}
                onFocus={(e) => { setFocused(true); e.currentTarget.select(); }}
                onBlur={(e) => {
                    setFocused(false);
                    // năm 2 số / gõ không có "/" (vd 4/9/31, 040931): đổi thành ngày đầy đủ
                    const typed = text ? parseTyped(text) : "";
                    if (typed && inRange(typed)) {
                        if (typed !== iso) emit(typed);
                        setText(formatDateVN(typed));
                    } else if (text) {
                        // gõ dở / sai ngày: trả lại ngày đang chọn
                        setText(formatDateVN(iso));
                    }
                    onBlur?.(e);
                }}
                onChange={(e) => handleText(e.target.value)}
                className={`${className} pr-6 cursor-text`}
            />
            <button
                type="button"
                tabIndex={-1}
                onClick={openPicker}
                disabled={disabled}
                title="Bấm để chọn ngày trên lịch"
                className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-indigo-500 disabled:opacity-40 cursor-pointer"
            >
                <CalendarDays className="w-3.5 h-3.5" />
            </button>
            {/* lịch của trình duyệt (ẩn): chỉ dùng để chọn ngày bằng chuột */}
            <input
                ref={pickerRef}
                type="date"
                tabIndex={-1}
                aria-hidden="true"
                value={iso}
                min={min ? toISODate(min) : undefined}
                max={max ? toISODate(max) : undefined}
                disabled={disabled}
                onChange={(e) => emit(e.target.value)}
                className="absolute right-0 bottom-0 w-px h-px opacity-0 pointer-events-none"
            />
        </span>
    );
}

/**
 * Ngày hiển thị kiểu Việt Nam (dd/mm/yyyy) cho mọi giá trị: chuỗi ngày "YYYY-MM-DD" giữ nguyên ngày;
 * thời điểm (ISO có giờ / Date) đổi sang ngày theo giờ Việt Nam. `short`: chỉ dd/mm.
 */
export function formatDayVN(v: any, short = false): string {
    if (v === null || v === undefined || v === "") return "";
    const s = v instanceof Date ? "" : String(v).trim();
    let iso = /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
    if (!iso) {
        const d = v instanceof Date ? v : new Date(s);
        iso = isNaN(d.getTime()) ? toISODate(s) : new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
    }
    const full = formatDateVN(iso);
    return short ? full.slice(0, 5) : full;
}
