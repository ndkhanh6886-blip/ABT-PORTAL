"use client";

import React, { useState } from "react";
import { KeyRound, Link2, X, ShieldCheck, Copy } from "lucide-react";
import { useAuth } from "@/frontend/contexts/AuthContext";

type Props = {
  /** Forced mode: shown full screen after logging in with a default password; cannot be closed. */
  forced?: boolean;
  onClose?: () => void;
};

/** Self-service account security: change password and get a one-time Zalo link code. */
export function AccountSecurityModal({ forced = false, onClose }: Props) {
  const { user, completePasswordChange, logout } = useAuth();
  const [tab, setTab] = useState<"password" | "zalo">("password");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [linkCode, setLinkCode] = useState<{ code: string; minutes: number } | null>(null);

  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    if (newPassword !== confirmPassword) {
      setMessage({ type: "error", text: "Mật khẩu nhập lại không khớp." });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "change_password", currentPassword, newPassword })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        setMessage({ type: "error", text: data.error || "Không đổi được mật khẩu." });
        return;
      }
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setMessage({ type: "ok", text: "Đã đổi mật khẩu. Các phiên đăng nhập khác của tài khoản này đã bị đăng xuất." });
      completePasswordChange();
    } catch {
      setMessage({ type: "error", text: "Không kết nối được máy chủ." });
    } finally {
      setBusy(false);
    }
  };

  const createLinkCode = async () => {
    setMessage(null);
    setBusy(true);
    try {
      const res = await fetch("/api/zalo/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create_link_code" })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        setMessage({ type: "error", text: data.error || "Không tạo được mã liên kết." });
        return;
      }
      setLinkCode({ code: data.code, minutes: data.expires_in_minutes || 30 });
    } catch {
      setMessage({ type: "error", text: "Không kết nối được máy chủ." });
    } finally {
      setBusy(false);
    }
  };

  const inputCls = "w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-orange-500";

  const card = (
    <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl p-5">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-orange-500" />
          <div>
            <div className="font-bold text-slate-800 dark:text-slate-100">{forced ? "Đổi mật khẩu mặc định" : "Bảo mật tài khoản"}</div>
            <div className="text-xs text-slate-500">{user?.full_name || user?.name} ({user?.username})</div>
          </div>
        </div>
        {!forced && (
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer" aria-label="Đóng">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {forced && (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/40 dark:border-amber-800 p-3 text-xs text-amber-800 dark:text-amber-200">
          Tài khoản đang dùng mật khẩu mặc định / tạm thời. Vui lòng đặt mật khẩu mới (tối thiểu 8 ký tự) để tiếp tục sử dụng hệ thống.
        </div>
      )}

      {!forced && (
        <div className="flex gap-2 mb-4">
          <button onClick={() => { setTab("password"); setMessage(null); }} className={`flex-1 flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold cursor-pointer ${tab === "password" ? "bg-orange-600 text-white" : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300"}`}>
            <KeyRound className="w-4 h-4" /> Đổi mật khẩu
          </button>
          <button onClick={() => { setTab("zalo"); setMessage(null); }} className={`flex-1 flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold cursor-pointer ${tab === "zalo" ? "bg-orange-600 text-white" : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300"}`}>
            <Link2 className="w-4 h-4" /> Liên kết Zalo
          </button>
        </div>
      )}

      {message && (
        <div className={`mb-3 rounded-xl px-3 py-2 text-xs ${message.type === "ok" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" : "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"}`}>
          {message.text}
        </div>
      )}

      {(forced || tab === "password") && (
        <form onSubmit={submitPassword} className="space-y-3">
          <input type="password" autoComplete="current-password" placeholder="Mật khẩu hiện tại" className={inputCls} value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} required />
          <input type="password" autoComplete="new-password" placeholder="Mật khẩu mới (tối thiểu 8 ký tự)" className={inputCls} value={newPassword} onChange={e => setNewPassword(e.target.value)} required minLength={8} />
          <input type="password" autoComplete="new-password" placeholder="Nhập lại mật khẩu mới" className={inputCls} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required minLength={8} />
          <button type="submit" disabled={busy} className="w-full rounded-xl bg-orange-600 hover:bg-orange-700 text-white font-bold py-2 text-sm disabled:opacity-60 cursor-pointer">
            {busy ? "Đang xử lý..." : "Đổi mật khẩu"}
          </button>
          {forced && (
            <button type="button" onClick={logout} className="w-full text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 cursor-pointer">
              Đăng xuất
            </button>
          )}
        </form>
      )}

      {!forced && tab === "zalo" && (
        <div className="space-y-3 text-sm text-slate-700 dark:text-slate-300">
          <p className="text-xs leading-relaxed">
            Tạo mã liên kết rồi nhắn mã đó vào khung chat Zalo OA của công ty để liên kết tài khoản Zalo với hồ sơ của bạn.
            Mã dùng một lần, hết hạn sau 30 phút. Không chia sẻ mã cho người khác.
          </p>
          {linkCode && (
            <div className="flex items-center justify-between gap-2 rounded-xl border border-orange-300 bg-orange-50 dark:bg-orange-950/30 dark:border-orange-800 px-3 py-3">
              <span className="font-mono text-lg font-bold tracking-widest text-orange-700 dark:text-orange-300">{linkCode.code}</span>
              <button
                onClick={() => { try { navigator.clipboard.writeText(linkCode.code); } catch {} }}
                className="flex items-center gap-1 text-xs text-orange-700 dark:text-orange-300 cursor-pointer"
              >
                <Copy className="w-3.5 h-3.5" /> Sao chép
              </button>
            </div>
          )}
          <button onClick={createLinkCode} disabled={busy} className="w-full rounded-xl bg-orange-600 hover:bg-orange-700 text-white font-bold py-2 text-sm disabled:opacity-60 cursor-pointer">
            {busy ? "Đang tạo..." : linkCode ? "Tạo mã mới" : "Tạo mã liên kết Zalo"}
          </button>
        </div>
      )}
    </div>
  );

  if (forced) {
    return <div className="min-h-screen flex items-center justify-center bg-slate-100 dark:bg-slate-950 px-4">{card}</div>;
  }
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 px-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="w-full max-w-md">{card}</div>
    </div>
  );
}
