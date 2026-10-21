"use client";

import React, { ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "@/backend/services/utils";

interface ModalProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    children: ReactNode;
    size?: "md" | "lg" | "xl" | "2xl" | "3xl" | "4xl" | "5xl" | "6xl" | "7xl" | "full";
}

export const Modal = ({ isOpen, onClose, title, children, size = "md" }: ModalProps) => {
    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-[110]"
                    />
                    {/* Modal Content */}
                    <div className="fixed inset-0 flex items-center justify-center p-4 z-[120] pointer-events-none">
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95, y: 20 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, y: 20 }}
                            className={cn(
                                "bg-slate-900 border border-white/10 w-full rounded-3xl shadow-2xl pointer-events-auto overflow-hidden glass-dark",
                                size === "md" && "max-w-2xl",
                                size === "lg" && "max-w-3xl",
                                size === "xl" && "max-w-4xl",
                                size === "2xl" && "max-w-5xl",
                                size === "3xl" && "max-w-6xl",
                                size === "4xl" && "max-w-7xl",
                                size === "5xl" && "max-w-[88rem]",
                                size === "6xl" && "max-w-[92rem]",
                                size === "7xl" && "max-w-[96rem]",
                                size === "full" && "max-w-[98vw]",
                            )}
                        >
                            <div className="flex items-center justify-between gap-3 px-6 py-4 sm:py-5 border-b border-white/5 bg-white/5">
                                <h3 className="text-lg sm:text-xl font-bold text-white tracking-tight min-w-0 break-words leading-snug">{title}</h3>
                                <button
                                    onClick={onClose}
                                    className="p-2 shrink-0 hover:bg-white/10 rounded-xl transition-all text-slate-400 hover:text-white"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </div>
                            <div className="p-5 sm:p-6 max-h-[calc(100vh-120px)] overflow-y-auto overflow-x-hidden custom-scrollbar">
                                {children}
                            </div>
                        </motion.div>
                    </div>
                </>
            )}
        </AnimatePresence>
    );
};
