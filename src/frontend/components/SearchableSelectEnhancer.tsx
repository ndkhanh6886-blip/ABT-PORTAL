"use client";

/**
 * SearchableSelectEnhancer
 * ------------------------------------------------------------------
 * Tự động bổ sung ô "gõ để tìm nhanh" cho MỌI thẻ <select> trong portal
 * mà không phải sửa từng chỗ sử dụng.
 *
 * Cách hoạt động:
 *  - Khi người dùng bấm (hoặc gõ phím) vào một <select> đủ điều kiện,
 *    danh sách xổ mặc định của trình duyệt bị chặn và thay bằng một
 *    popover có ô tìm kiếm (không phân biệt hoa/thường & dấu tiếng Việt).
 *  - Khi chọn một mục, giá trị được gán ngược vào <select> gốc và phát
 *    sự kiện "change" => toàn bộ logic onChange / required / form của
 *    React vẫn hoạt động y như cũ.
 *  - Chỉ cho phép chọn các mục có sẵn trong danh sách (không nhập tay).
 *
 * Bỏ qua (giữ danh sách xổ gốc) khi:
 *  - <select multiple>, <select size="n" > 1>, <select disabled>
 *  - Ít hơn MIN_OPTIONS lựa chọn
 *  - Có thuộc tính data-native-select
 */

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** Số lựa chọn tối thiểu để bật tìm kiếm (danh sách quá ngắn thì không cần) */
const MIN_OPTIONS = 6;
/** Số dòng tối đa hiển thị một lúc (tránh lag khi danh sách hàng nghìn mục) */
const MAX_RENDER = 300;
const POPOVER_MAX_HEIGHT = 340;

type Item =
  | { kind: "group"; label: string }
  | { kind: "option"; value: string; label: string; disabled: boolean };

interface OpenState {
  select: HTMLSelectElement;
  items: Item[];
  rect: DOMRect;
}

/** Chuẩn hóa chuỗi để tìm kiếm: bỏ dấu tiếng Việt, đ -> d, chữ thường */
export const normalizeSearch = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .trim();

const shouldEnhance = (el: Element | null): el is HTMLSelectElement => {
  if (!(el instanceof HTMLSelectElement)) return false;
  if (el.multiple || el.disabled || el.size > 1) return false;
  if (el.hasAttribute("data-native-select")) return false;
  return el.options.length >= MIN_OPTIONS;
};

const readItems = (select: HTMLSelectElement): Item[] => {
  const items: Item[] = [];
  const pushOption = (o: HTMLOptionElement, groupDisabled = false) => {
    if (o.hidden) return;
    items.push({
      kind: "option",
      value: o.value,
      label: (o.label || o.text || "").trim(),
      disabled: o.disabled || groupDisabled
    });
  };
  Array.from(select.children).forEach(child => {
    if (child instanceof HTMLOptGroupElement) {
      items.push({ kind: "group", label: child.label });
      Array.from(child.children).forEach(o => {
        if (o instanceof HTMLOptionElement) pushOption(o, child.disabled);
      });
    } else if (child instanceof HTMLOptionElement) {
      pushOption(child);
    }
  });
  return items;
};

/** Gán giá trị cho <select> do React quản lý và kích hoạt onChange */
const commitSelectValue = (select: HTMLSelectElement, value: string) => {
  if (select.value === value) return;
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
  if (setter) setter.call(select, value);
  else select.value = value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
};

export const SearchableSelectEnhancer: React.FC = () => {
  const [state, setState] = useState<OpenState | null>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const stateRef = useRef<OpenState | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const open = useCallback((select: HTMLSelectElement, initialQuery = "") => {
    const next = { select, items: readItems(select), rect: select.getBoundingClientRect() };
    stateRef.current = next;
    setState(next);
    setQuery(initialQuery);
  }, []);

  const close = useCallback((refocus: boolean) => {
    const current = stateRef.current;
    stateRef.current = null;
    setState(null);
    setQuery("");
    if (refocus && current?.select.isConnected) {
      current.select.focus({ preventScroll: true });
    }
  }, []);

  // ---------- Lắng nghe toàn cục: chặn danh sách xổ gốc & mở popover ----------
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Element | null;

      // Bấm bên trong popover: không để các handler "click outside" khác đóng modal/dropdown cha
      if (popoverRef.current && target && popoverRef.current.contains(target)) {
        e.stopPropagation();
        if (target !== inputRef.current) e.preventDefault(); // giữ focus ở ô tìm kiếm
        return;
      }

      const select = (target?.closest?.("select") ?? null) as Element | null;

      if (stateRef.current && select !== stateRef.current.select) {
        close(false); // bấm ra ngoài
      }

      if (e.button !== 0 || !shouldEnhance(select)) return;

      e.preventDefault(); // chặn danh sách xổ mặc định của trình duyệt
      if (stateRef.current?.select === select) {
        close(true);
        return;
      }
      select.focus({ preventScroll: true });
      open(select);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (stateRef.current) return;
      const select = e.target as Element | null;
      if (!shouldEnhance(select)) return;

      const isPrintable = e.key.length === 1 && e.key !== " " && !e.ctrlKey && !e.metaKey && !e.altKey;
      const isOpenKey =
        e.key === "Enter" || e.key === " " || e.key === "F4" ||
        (e.altKey && (e.key === "ArrowDown" || e.key === "ArrowUp"));

      if (isPrintable) {
        e.preventDefault();
        open(select, e.key);
      } else if (isOpenKey) {
        e.preventDefault();
        open(select);
      }
    };

    // Giữ popover bám theo ô select khi cuộn trang / modal
    const onScrollOrResize = (e: Event) => {
      const current = stateRef.current;
      if (!current) return;
      if (e.target instanceof Node && popoverRef.current?.contains(e.target)) return;
      if (!current.select.isConnected) {
        close(false);
        return;
      }
      const rect = current.select.getBoundingClientRect();
      setState(s => (s ? { ...s, rect } : s));
    };

    document.addEventListener("mousedown", onMouseDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      document.removeEventListener("mousedown", onMouseDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open, close]);

  // ---------- Lọc danh sách ----------
  const { rows, selectable, truncated } = useMemo(() => {
    const out: (Item & { selIndex?: number })[] = [];
    const sel: { value: string }[] = [];
    if (!state) return { rows: out, selectable: sel, truncated: false };

    const tokens = normalizeSearch(query).split(/\s+/).filter(Boolean);
    let pendingGroup: Item | null = null;
    let count = 0;
    let cut = false;

    for (const item of state.items) {
      if (item.kind === "group") {
        pendingGroup = item;
        continue;
      }
      if (tokens.length > 0) {
        if (item.value === "") continue; // ẩn dòng "-- Chọn ... --" khi đang tìm
        const hay = normalizeSearch(item.label);
        if (!tokens.every(t => hay.includes(t))) continue;
      }
      if (count >= MAX_RENDER) {
        cut = true;
        break;
      }
      if (pendingGroup) {
        out.push(pendingGroup);
        pendingGroup = null;
      }
      if (item.disabled) {
        out.push(item);
      } else {
        out.push({ ...item, selIndex: sel.length });
        sel.push({ value: item.value });
      }
      count++;
    }
    return { rows: out, selectable: sel, truncated: cut };
  }, [state, query]);

  // Đặt dòng đang chọn: khi chưa gõ thì trỏ vào giá trị hiện tại, khi gõ thì trỏ dòng đầu
  useEffect(() => {
    if (!state) return;
    if (!query.trim()) {
      const idx = selectable.findIndex(s => s.value === state.select.value);
      setActive(idx >= 0 ? idx : 0);
    } else {
      setActive(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, state?.select, state?.items]);

  // Focus ô tìm kiếm khi mở
  useLayoutEffect(() => {
    if (state && inputRef.current && document.activeElement !== inputRef.current) {
      inputRef.current.focus({ preventScroll: true });
      const len = inputRef.current.value.length;
      inputRef.current.setSelectionRange(len, len);
    }
  }, [state]);

  // Cuộn dòng đang chọn vào tầm nhìn
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-sel-index="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active, rows]);

  const choose = (value: string) => {
    const current = stateRef.current;
    if (!current) return;
    commitSelectValue(current.select, value);
    close(true);
  };

  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive(a => Math.min(a + 1, Math.max(selectable.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(a => Math.max(a - 1, 0));
    } else if (e.key === "PageDown") {
      e.preventDefault();
      setActive(a => Math.min(a + 10, Math.max(selectable.length - 1, 0)));
    } else if (e.key === "PageUp") {
      e.preventDefault();
      setActive(a => Math.max(a - 10, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      const target = selectable[active];
      if (target) choose(target.value);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation(); // không đóng modal cha
      close(true);
    } else if (e.key === "Tab") {
      close(true);
    }
  };

  if (!state || typeof document === "undefined") return null;

  // ---------- Tính vị trí popover ----------
  const { rect } = state;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.min(Math.max(rect.width, 280), 560, vw - 16);
  const left = Math.max(8, Math.min(rect.left, vw - width - 8));
  const spaceBelow = vh - rect.bottom;
  const placeAbove = spaceBelow < POPOVER_MAX_HEIGHT && rect.top > spaceBelow;
  const positionStyle: React.CSSProperties = placeAbove
    ? { bottom: vh - rect.top + 4, maxHeight: Math.min(POPOVER_MAX_HEIGHT, rect.top - 12) }
    : { top: rect.bottom + 4, maxHeight: Math.min(POPOVER_MAX_HEIGHT, spaceBelow - 12) };

  const currentValue = state.select.value;

  return createPortal(
    <div
      ref={popoverRef}
      role="dialog"
      aria-label="Tìm kiếm lựa chọn"
      style={{ position: "fixed", left, width, zIndex: 2147483000, ...positionStyle }}
      className="flex flex-col rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl shadow-black/30 overflow-hidden text-xs"
    >
      <div className="p-2 border-b border-slate-100 dark:border-slate-800 shrink-0">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={onSearchKeyDown}
          placeholder="🔍 Gõ để tìm nhanh..."
          autoComplete="off"
          spellCheck={false}
          className="w-full px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white placeholder:text-slate-400 outline-none focus:border-indigo-500"
        />
      </div>

      <ul ref={listRef} role="listbox" className="flex-1 min-h-0 overflow-y-auto py-1">
        {rows.map((row, i) => {
          if (row.kind === "group") {
            return (
              <li
                key={`g-${i}`}
                className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 select-none"
              >
                {row.label}
              </li>
            );
          }
          const isActive = row.selIndex !== undefined && row.selIndex === active;
          const isSelected = row.value === currentValue;
          return (
            <li
              key={`o-${i}`}
              role="option"
              aria-selected={isSelected}
              aria-disabled={row.disabled}
              data-sel-index={row.selIndex}
              onMouseEnter={() => row.selIndex !== undefined && setActive(row.selIndex)}
              onClick={() => !row.disabled && choose(row.value)}
              className={[
                "px-3 py-1.5 leading-snug select-none",
                row.disabled
                  ? "text-slate-300 dark:text-slate-600 cursor-not-allowed"
                  : "cursor-pointer",
                isActive
                  ? "bg-indigo-600 text-white"
                  : isSelected
                    ? "text-indigo-600 dark:text-indigo-400 font-bold"
                    : !row.disabled
                      ? "text-slate-700 dark:text-slate-200"
                      : ""
              ].join(" ")}
            >
              {isSelected ? "✓ " : ""}
              {row.label || "\u00A0"}
            </li>
          );
        })}
        {rows.length === 0 && (
          <li className="px-3 py-3 text-slate-400 italic select-none">Không tìm thấy kết quả phù hợp</li>
        )}
      </ul>

      {truncated && (
        <div className="px-3 py-1.5 text-[10px] text-slate-400 border-t border-slate-100 dark:border-slate-800 shrink-0">
          Đang hiển thị {MAX_RENDER} kết quả đầu tiên — gõ thêm để lọc chính xác hơn
        </div>
      )}
    </div>,
    document.body
  );
};
