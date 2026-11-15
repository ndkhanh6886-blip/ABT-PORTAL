"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { inputClass } from "../ui";

export interface CatalogMasterItemOption {
  id: string;
  code: string;
  name: string;
  base_uom: string;
  item_type?: string;
  category_name?: string | null;
  kd_item_code?: string | null;
}

export interface CatalogItemComboboxProps {
  value: string;
  selectedLabel?: string;
  items: CatalogMasterItemOption[];
  totalCatalogCount?: number;
  placeholder?: string;
  onSelect: (item: CatalogMasterItemOption) => void;
  onClear?: () => void;
  onSwitchToNew?: (typedText: string) => void;
}

function normalizeSearchText(raw: string | null | undefined): string {
  return String(raw ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .trim();
}

const MAX_VISIBLE_OPTIONS = 80;

/** Portal-backed searchable combobox for selecting catalog items by code, name, or category. */
export function CatalogItemCombobox({
  value,
  selectedLabel,
  items,
  totalCatalogCount,
  placeholder = "🔍 Gõ mã (VD: LF203) hoặc tên nguyên vật liệu để tìm & chọn...",
  onSelect,
  onClear,
  onSwitchToNew,
}: CatalogItemComboboxProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlightIdx, setHighlightIdx] = useState(0);
  const [cachedSelected, setCachedSelected] = useState<CatalogMasterItemOption | null>(null);
  const [coords, setCoords] = useState<{
    left: number;
    top: number;
    bottom: number;
    width: number;
    openUp: boolean;
  } | null>(null);

  const trimmedQuery = query.trim();
  const shouldRemoteSearch =
    open &&
    trimmedQuery.length >= 1 &&
    ((totalCatalogCount ?? items.length) > items.length || items.length === 0);

  const remoteSearch = useQuery({
    queryKey: ["factory", "items", "combobox-search", trimmedQuery],
    queryFn: () =>
      api<{ rows: CatalogMasterItemOption[] }>(
        `/api/factory/master/items?page_size=50&status=ACTIVE&q=${encodeURIComponent(trimmedQuery)}`
      ),
    enabled: shouldRemoteSearch,
    staleTime: 30_000,
  });

  const mergedItems = useMemo(() => {
    const remoteRows = remoteSearch.data?.rows ?? [];
    if (remoteRows.length === 0) return items;
    const byId = new Map<string, CatalogMasterItemOption>();
    for (const it of items) byId.set(it.id, it);
    for (const it of remoteRows) {
      if (!byId.has(it.id)) byId.set(it.id, it);
    }
    return Array.from(byId.values());
  }, [items, remoteSearch.data?.rows]);

  const selectedItem = useMemo(() => {
    if (!value) return undefined;
    return (
      mergedItems.find((it) => it.id === value) ??
      (cachedSelected?.id === value ? cachedSelected : undefined)
    );
  }, [value, mergedItems, cachedSelected]);

  const selectedDisplay = selectedItem
    ? `${selectedItem.code} — ${selectedItem.name} (${selectedItem.base_uom})`
    : selectedLabel || "";

  const filteredItems = useMemo(() => {
    const normQuery = normalizeSearchText(trimmedQuery);
    if (!normQuery) return mergedItems;
    const tokens = normQuery.split(/\s+/).filter(Boolean);

    const matched = mergedItems.filter((it) => {
      const haystack = normalizeSearchText(
        `${it.code} ${it.name} ${it.kd_item_code ?? ""} ${it.category_name ?? ""}`
      );
      return tokens.every((t) => haystack.includes(t));
    });

    const rankOf = (it: CatalogMasterItemOption): number => {
      const code = normalizeSearchText(it.code);
      const kdCode = normalizeSearchText(it.kd_item_code);
      const name = normalizeSearchText(it.name);
      if (code === normQuery || (kdCode && kdCode === normQuery)) return 0;
      if (code.startsWith(normQuery) || (kdCode && kdCode.startsWith(normQuery))) return 1;
      if (name.startsWith(normQuery)) return 2;
      return 3;
    };

    return matched.sort((a, b) => {
      const diff = rankOf(a) - rankOf(b);
      return diff !== 0 ? diff : a.code.localeCompare(b.code);
    });
  }, [mergedItems, trimmedQuery]);

  const visibleOptions = useMemo(
    () => filteredItems.slice(0, MAX_VISIBLE_OPTIONS),
    [filteredItems]
  );

  const updatePosition = useCallback(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const width = Math.min(Math.max(rect.width, 360), window.innerWidth - 16);
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUp = spaceBelow < 240 && rect.top > 260;
    setCoords({
      left,
      top: rect.bottom + 4,
      bottom: window.innerHeight - rect.top + 4,
      width,
      openUp,
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePosition();
    const handleReposition = () => updatePosition();
    const handleOutsideMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (wrapperRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
      setQuery("");
    };
    window.addEventListener("scroll", handleReposition, true);
    window.addEventListener("resize", handleReposition);
    document.addEventListener("mousedown", handleOutsideMouseDown);
    return () => {
      window.removeEventListener("scroll", handleReposition, true);
      window.removeEventListener("resize", handleReposition);
      document.removeEventListener("mousedown", handleOutsideMouseDown);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open || !listRef.current) return;
    const activeRow = listRef.current.children[highlightIdx] as HTMLElement | undefined;
    activeRow?.scrollIntoView({ block: "nearest" });
  }, [open, highlightIdx]);

  const openDropdown = () => {
    if (!open) {
      setOpen(true);
      setQuery("");
      setHighlightIdx(0);
    }
  };

  const commitSelection = (it: CatalogMasterItemOption) => {
    setCachedSelected(it);
    setOpen(false);
    setQuery("");
    onSelect(it);
  };

  const closeAndReset = () => {
    setOpen(false);
    setQuery("");
  };

  const activePlaceholder =
    open && selectedDisplay
      ? `Đang chọn: ${selectedDisplay} — gõ để đổi...`
      : placeholder;

  const menuNode =
    open && coords && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={menuRef}
            style={{
              position: "fixed",
              left: coords.left,
              width: coords.width,
              zIndex: 9999,
              ...(coords.openUp ? { bottom: coords.bottom } : { top: coords.top }),
            }}
            className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl text-xs overflow-hidden"
          >
            <div className="px-3 py-1.5 bg-slate-50 dark:bg-slate-800/70 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
              <span>
                {remoteSearch.isFetching
                  ? "Đang tìm thêm trên máy chủ..."
                  : filteredItems.length === 0
                    ? "Không có vật tư khớp từ khóa"
                    : filteredItems.length > MAX_VISIBLE_OPTIONS
                      ? `Hiển thị ${MAX_VISIBLE_OPTIONS} / ${filteredItems.length} mã phù hợp — gõ thêm ký tự để lọc chính xác hơn`
                      : `${filteredItems.length} vật tư phù hợp${totalCatalogCount ? ` / ${totalCatalogCount} mã` : ""}`}
              </span>
              <span className="font-mono text-[10px]">↑↓ Enter · Esc</span>
            </div>

            <ul
              ref={listRef}
              role="listbox"
              className="max-h-64 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800"
            >
              {visibleOptions.length === 0 ? (
                <li className="px-3 py-4 text-center text-slate-400">
                  {remoteSearch.isFetching
                    ? "Đang tải kết quả tìm kiếm..."
                    : trimmedQuery
                      ? `Không tìm thấy mã hoặc tên chứa "${trimmedQuery}".`
                      : "Chưa có vật tư nào trong danh mục."}
                </li>
              ) : (
                visibleOptions.map((it, idx) => {
                  const isHighlighted = idx === highlightIdx;
                  const isSelected = it.id === value;
                  return (
                    <li key={it.id} role="option" aria-selected={isSelected}>
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onMouseEnter={() => setHighlightIdx(idx)}
                        onClick={() => commitSelection(it)}
                        className={`w-full text-left px-3 py-2 flex items-center justify-between gap-2 cursor-pointer transition-colors ${
                          isHighlighted
                            ? "bg-sky-50 dark:bg-sky-950/60"
                            : isSelected
                              ? "bg-emerald-50/70 dark:bg-emerald-950/30"
                              : "hover:bg-slate-50 dark:hover:bg-slate-800/50"
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <span className="font-mono font-bold text-sky-700 dark:text-sky-400">
                            {it.code}
                          </span>
                          <span className="text-slate-600 dark:text-slate-300"> — {it.name}</span>
                          {it.kd_item_code && (
                            <span className="ml-1.5 text-[10px] font-mono text-slate-400">
                              [{it.kd_item_code}]
                            </span>
                          )}
                        </div>
                        <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono text-[11px] text-slate-600 dark:text-slate-300 shrink-0">
                          {it.base_uom}
                        </span>
                      </button>
                    </li>
                  );
                })
              )}
            </ul>

            {onSwitchToNew && (
              <div className="border-t border-slate-200 dark:border-slate-700 bg-amber-50/90 dark:bg-amber-950/40">
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    const typed = trimmedQuery;
                    closeAndReset();
                    onSwitchToNew(typed);
                  }}
                  className="w-full text-left px-3 py-2 text-amber-800 dark:text-amber-300 font-bold hover:bg-amber-100 dark:hover:bg-amber-900/50 cursor-pointer transition-colors"
                >
                  {trimmedQuery
                    ? `✨ Không tìm thấy "${trimmedQuery}"? → Chuyển sang Gõ mã / Tên mới`
                    : "✨ Không có trong danh mục? → Chuyển sang Gõ mã mới / Tên mới..."}
                </button>
              </div>
            )}
          </div>,
          document.body
        )
      : null;

  return (
    <div ref={wrapperRef} className="relative w-full">
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        className={`${inputClass} pr-12`}
        value={open ? query : selectedDisplay}
        placeholder={activePlaceholder}
        onFocus={openDropdown}
        onClick={openDropdown}
        onChange={(e) => {
          setQuery(e.target.value);
          setHighlightIdx(0);
          if (!open) setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            if (!open) {
              openDropdown();
              return;
            }
            setHighlightIdx((prev) =>
              visibleOptions.length > 0 ? Math.min(prev + 1, visibleOptions.length - 1) : 0
            );
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            if (!open) {
              openDropdown();
              return;
            }
            setHighlightIdx((prev) => Math.max(prev - 1, 0));
          } else if (e.key === "Enter") {
            if (!open) return;
            e.preventDefault();
            const picked = visibleOptions[highlightIdx] ?? visibleOptions[0];
            if (picked) {
              commitSelection(picked);
            } else if (visibleOptions.length === 0 && onSwitchToNew && trimmedQuery) {
              const typed = trimmedQuery;
              closeAndReset();
              onSwitchToNew(typed);
            }
          } else if (e.key === "Escape") {
            if (!open) return;
            e.preventDefault();
            closeAndReset();
            inputRef.current?.blur();
          } else if (e.key === "Tab" && open) {
            closeAndReset();
          }
        }}
      />

      <div className="absolute inset-y-0 right-1.5 flex items-center gap-0.5 pointer-events-none">
        {value && onClear && (
          <button
            type="button"
            tabIndex={-1}
            title="Xóa lựa chọn hiện tại"
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onClick={(e) => {
              e.stopPropagation();
              onClear();
              setQuery("");
              setHighlightIdx(0);
              setOpen(true);
              inputRef.current?.focus();
            }}
            className="pointer-events-auto w-5 h-5 rounded-md flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs cursor-pointer"
          >
            ✕
          </button>
        )}
        <button
          type="button"
          tabIndex={-1}
          aria-label="Mở danh sách tìm kiếm vật tư"
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onClick={(e) => {
            e.stopPropagation();
            if (open) {
              closeAndReset();
            } else {
              openDropdown();
              inputRef.current?.focus();
            }
          }}
          className="pointer-events-auto w-5 h-5 rounded-md flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 text-xs cursor-pointer"
        >
          {open ? "▴" : "▾"}
        </button>
      </div>

      {menuNode}
    </div>
  );
}
