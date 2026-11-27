"use client";

import React, { ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Maximize2, Minimize2 } from "lucide-react";
import { cn } from "@/backend/services/utils";

interface ModalProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    /** Có thể truyền một hàm: nội dung chỉ được tính khi khung đang mở (trang có nhiều khung nặng chạy nhanh hơn). */
    children: ReactNode | (() => ReactNode);
    size?: "md" | "lg" | "xl" | "2xl" | "3xl" | "4xl" | "5xl" | "6xl" | "7xl" | "full";
}

// Thứ tự các khung đang mở: Esc chỉ đóng khung trên cùng
const openStack: number[] = [];
let modalSeq = 0;

const FOCUSABLE =
    'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

const DISCARD_MESSAGE = "Bạn có thay đổi chưa lưu. Đóng và bỏ các thay đổi này?";

export const Modal = ({ isOpen, onClose, title, children, size = "md" }: ModalProps) => {
    const [maximized, setMaximized] = useState(false);
    // Có người dùng nhập / sửa gì trong khung chưa (tự nhận biết qua sự kiện nhập liệu)
    const dirtyRef = useRef(false);
    const dialogRef = useRef<HTMLDivElement>(null);
    const titleId = useId();
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;

    // Gán thứ tự lớp (z-index) ngay khi mở để khung mở sau luôn nằm trên khung mở trước
    const prevOpenRef = useRef(false);
    const seqRef = useRef(0);
    if (isOpen && !prevOpenRef.current) {
        if (openStack.length === 0) modalSeq = 0;
        seqRef.current = ++modalSeq;
    }
    prevOpenRef.current = isOpen;
    const backdropZ = 110 + seqRef.current * 2;
    const contentZ = backdropZ + 1;

    const requestClose = useCallback(() => {
        if (dirtyRef.current && !window.confirm(DISCARD_MESSAGE)) return;
        onCloseRef.current();
    }, []);

    useEffect(() => {
        if (!isOpen) return;
        dirtyRef.current = false;
        setMaximized(false);
        const id = seqRef.current || ++modalSeq;
        openStack.push(id);
        // Bàn phím: đưa con trỏ vào khung khi mở, trả về chỗ cũ khi đóng
        const returnFocusTo = document.activeElement as HTMLElement | null;
        const focusTimer = window.setTimeout(() => {
            const dialog = dialogRef.current;
            if (dialog && !dialog.contains(document.activeElement)) dialog.focus({ preventScroll: true });
        }, 0);
        const onKey = (e: KeyboardEvent) => {
            if (e.defaultPrevented || openStack[openStack.length - 1] !== id) return;
            if (e.key === "Escape") {
                e.preventDefault();
                requestClose();
                return;
            }
            // Tab / Shift+Tab chỉ đi vòng trong khung trên cùng
            if (e.key !== "Tab") return;
            const dialog = dialogRef.current;
            if (!dialog) return;
            // Con trỏ đang ở phần nổi ngoài khung (danh sách chọn gắn vào body...): để trình duyệt tự xử lý
            const current = document.activeElement;
            if (current && current !== document.body && !dialog.contains(current)) return;
            const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(el => el.offsetParent !== null);
            if (items.length === 0) {
                e.preventDefault();
                dialog.focus();
                return;
            }
            const first = items[0];
            const last = items[items.length - 1];
            const active = document.activeElement;
            if (e.shiftKey && (active === first || active === dialog || active === document.body)) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && (active === last || active === document.body)) {
                e.preventDefault();
                first.focus();
            }
        };
        // Tải lại trang / đóng tab khi đang có thay đổi chưa lưu
        const onBeforeUnload = (e: BeforeUnloadEvent) => {
            if (!dirtyRef.current) return;
            e.preventDefault();
            e.returnValue = "";
        };
        window.addEventListener("keydown", onKey);
        window.addEventListener("beforeunload", onBeforeUnload);
        return () => {
            window.clearTimeout(focusTimer);
            if (returnFocusTo && document.contains(returnFocusTo)) returnFocusTo.focus({ preventScroll: true });
            const i = openStack.indexOf(id);
            if (i >= 0) openStack.splice(i, 1);
            window.removeEventListener("keydown", onKey);
            window.removeEventListener("beforeunload", onBeforeUnload);
        };
    }, [isOpen, requestClose]);

    const markDirty = (e: React.SyntheticEvent) => {
        const t = e.target as HTMLInputElement | null;
        // ô tìm kiếm / lọc không phải là thay đổi dữ liệu
        if (!t || t.type === "search" || t.closest?.("[data-no-dirty]")) return;
        dirtyRef.current = true;
    };
    // Nút trong biểu mẫu (thêm / xóa dòng, chọn nhanh VAT, khôi phục nháp...) cũng là thay đổi
    const markDirtyOnClick = (e: React.MouseEvent) => {
        const t = e.target as HTMLElement | null;
        if (!t?.closest) return;
        if (t.closest("[data-mark-dirty]")) { dirtyRef.current = true; return; }
        const b = t.closest("button") as HTMLButtonElement | null;
        if (b && b.type !== "submit" && b.closest("form") && !b.closest("[data-no-dirty]")) dirtyRef.current = true;
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    {/* Backdrop: chưa nhập gì thì bấm ra ngoài là đóng; đã nhập thì hỏi trước */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={requestClose}
                        style={{ zIndex: backdropZ }}
                        className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-[110]"
                    />
                    {/* Modal Content */}
                    <div
                        style={{ zIndex: contentZ }}
                        className={cn("fixed inset-0 flex items-center justify-center z-[120] pointer-events-none", maximized ? "p-0" : "p-4")}
                    >
                        <motion.div
                            ref={dialogRef}
                            role="dialog"
                            aria-modal="true"
                            aria-labelledby={titleId}
                            tabIndex={-1}
                            initial={{ opacity: 0, scale: 0.95, y: 20 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, y: 20 }}
                            onInputCapture={markDirty}
                            onChangeCapture={markDirty}
                            onClickCapture={markDirtyOnClick}
                            className={cn(
                                "bg-slate-900 border border-white/10 w-full shadow-2xl pointer-events-auto overflow-hidden glass-dark",
                                maximized ? "h-[100dvh] max-w-none rounded-none flex flex-col" : "rounded-3xl",
                                !maximized && size === "md" && "max-w-2xl",
                                !maximized && size === "lg" && "max-w-3xl",
                                !maximized && size === "xl" && "max-w-4xl",
                                !maximized && size === "2xl" && "max-w-5xl",
                                !maximized && size === "3xl" && "max-w-6xl",
                                !maximized && size === "4xl" && "max-w-7xl",
                                !maximized && size === "5xl" && "max-w-[88rem]",
                                !maximized && size === "6xl" && "max-w-[92rem]",
                                !maximized && size === "7xl" && "max-w-[96rem]",
                                !maximized && size === "full" && "max-w-[98vw]",
                            )}
                        >
                            <div className="flex items-center justify-between gap-3 px-6 py-4 sm:py-5 border-b border-white/5 bg-white/5">
                                <h3 id={titleId} className="text-lg sm:text-xl font-bold text-white tracking-tight min-w-0 break-words leading-snug">{title}</h3>
                                <div className="flex items-center gap-1 shrink-0">
                                    <button
                                        type="button"
                                        onClick={() => setMaximized(m => !m)}
                                        title={maximized ? "Thu nhỏ" : "Phóng to toàn màn hình"}
                                        aria-label={maximized ? "Thu nhỏ khung" : "Phóng to khung toàn màn hình"}
                                        className="p-2 hover:bg-white/10 rounded-xl transition-all text-slate-400 hover:text-white"
                                    >
                                        {maximized ? <Minimize2 className="w-5 h-5" /> : <Maximize2 className="w-5 h-5" />}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={requestClose}
                                        title="Đóng (Esc)"
                                        aria-label="Đóng"
                                        className="p-2 hover:bg-white/10 rounded-xl transition-all text-slate-400 hover:text-white"
                                    >
                                        <X className="w-5 h-5" />
                                    </button>
                                </div>
                            </div>
                            <div className={cn("p-5 sm:p-6 overflow-y-auto overflow-x-hidden custom-scrollbar", maximized ? "flex-1 min-h-0" : "max-h-[calc(100vh-120px)]")}>
                                {typeof children === "function" ? (children as () => ReactNode)() : children}
                            </div>
                        </motion.div>
                    </div>
                </>
            )}
        </AnimatePresence>
    );
};
