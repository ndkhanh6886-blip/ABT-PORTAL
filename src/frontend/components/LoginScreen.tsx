"use client";

import React, { useState } from "react";
import { useAuth } from "@/frontend/contexts/AuthContext";
import { useTheme } from "@/frontend/contexts/ThemeContext";
import { 
  Lock, 
  User as UserIcon, 
  Eye, 
  EyeOff, 
  ArrowRight, 
  ShieldCheck, 
  CheckCircle2, 
  AlertCircle, 
  Sun, 
  Moon,
  Layers,
  KeyRound,
  Package,
  HeartPulse
} from "lucide-react";
import CustomerPortalView from "./CustomerPortalView";

export const LoginScreen: React.FC = () => {
  const { login } = useAuth();
  const { theme, toggleTheme } = useTheme();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [portalMode, setPortalMode] = useState<"staff" | "customer">("staff");

  if (portalMode === "customer") {
    return <CustomerPortalView onBackToStaffLogin={() => setPortalMode("staff")} />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      setErrorMsg("Vui lòng nhập tên đăng nhập và mật khẩu");
      return;
    }

    setLoading(true);
    setErrorMsg("");
    setSuccessMsg("");

    try {
      const res = await login(username.trim(), password.trim());
      if (res.success) {
        setSuccessMsg("Đăng nhập thành công! Đang chuyển hướng...");
      } else {
        setErrorMsg(res.error || "Tên đăng nhập hoặc mật khẩu không chính xác.");
      }
    } catch (err: any) {
      setErrorMsg(err.message || "Lỗi kết nối máy chủ. Vui lòng thử lại sau.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex flex-col justify-between bg-slate-900 text-slate-100 relative overflow-hidden selection:bg-orange-500 selection:text-white">
      {/* Dynamic Background Effects */}
      <div className="absolute inset-0 bg-radial from-orange-500/10 via-transparent to-transparent pointer-events-none -top-40 -left-40 w-[800px] h-[800px] rounded-full blur-3xl opacity-50" />
      <div className="absolute inset-0 bg-radial from-indigo-500/10 via-transparent to-transparent pointer-events-none -bottom-40 -right-40 w-[800px] h-[800px] rounded-full blur-3xl opacity-50" />
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#1e293b15_1px,transparent_1px),linear-gradient(to_bottom,#1e293b15_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_70%,transparent_100%)] pointer-events-none" />

      {/* Top Navigation Bar */}
      <header className="relative z-10 w-full px-6 py-4 flex items-center justify-between border-b border-slate-800/80 bg-slate-950/60 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center shadow-lg ring-2 ring-orange-400/30 overflow-hidden">
            <img src="/icon.png" alt="ABT" className="w-9 h-9 object-contain" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-base tracking-tight text-white font-mono">ABT PORTAL</span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-orange-500/20 text-orange-400 border border-orange-500/30">
                Y Sinh ABT
              </span>
            </div>
            <p className="text-[11px] text-slate-400 text-left">Công ty TNHH Giải pháp Y sinh ABT</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Dual Portal Switcher */}
          <div className="flex items-center p-1 bg-slate-900 border border-slate-800 rounded-xl">
            <button
              type="button"
              onClick={() => setPortalMode("staff")}
              className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all bg-orange-600 text-white shadow-sm flex items-center gap-1.5 cursor-pointer"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Cổng Nội Bộ ABT</span>
            </button>
            <button
              type="button"
              onClick={() => setPortalMode("customer")}
              className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all text-teal-400 hover:text-white hover:bg-teal-600/20 flex items-center gap-1.5 cursor-pointer"
            >
              <HeartPulse className="w-3.5 h-3.5 text-rose-400" />
              <span>Cổng Khách Hàng (Client Hub)</span>
            </button>
          </div>

          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-900/80 border border-slate-800 text-[11px] text-emerald-400 font-mono">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            PostgreSQL 18 Online
          </div>
          <button
            onClick={toggleTheme}
            className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 text-slate-300 border border-slate-700/60 transition-all cursor-pointer"
            title="Đổi nền sáng/tối"
          >
            {theme === "dark" ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-slate-300" />}
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="relative z-10 flex-1 flex items-center justify-center px-4 py-8">
        <div className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          
          {/* Left Hero Column */}
          <div className="lg:col-span-5 space-y-6 text-left">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-orange-500/10 border border-orange-500/20 text-orange-400 text-xs font-semibold">
              <ShieldCheck className="w-4 h-4 text-orange-400" />
              <span>Cổng Đăng Nhập Xác Thực Tập Trung</span>
            </div>

            <div className="space-y-3">
              <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-white leading-tight">
                Quản Trị Vận Hành <br />
                <span className="bg-gradient-to-r from-orange-400 via-amber-300 to-yellow-400 bg-clip-text text-transparent">
                  Thông Suốt &amp; Chuẩn Xác
                </span>
              </h1>
              <p className="text-sm text-slate-400 leading-relaxed">
                Tích hợp toàn diện các phân hệ: Điều Hành Công Việc, Kinh Doanh Thương Mại, Quản Lý Kho &amp; Giám Sát Chuỗi Lạnh, Phòng Application, Cung Ứng và Kế Toán Xuất Hóa Đơn.
              </p>
            </div>

            {/* Feature Highlights */}
            <div className="space-y-3 pt-2">
              <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-950/40 border border-slate-800/80">
                <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <CheckCircle2 className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs font-bold text-slate-200">Cơ Sở Dữ Liệu PostgreSQL 18 Chuẩn ACID</div>
                  <div className="text-[11px] text-slate-400">Lưu trữ tập trung, cam kết không ghi đè và chống mất mát dữ liệu</div>
                </div>
              </div>

              <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-950/40 border border-slate-800/80">
                <div className="p-2 rounded-lg bg-orange-500/10 text-orange-400 border border-orange-500/20">
                  <Layers className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs font-bold text-slate-200">Phân Quyền Vai Trò Độc Lập (RBAC)</div>
                  <div className="text-[11px] text-slate-400">Tự động điều hướng và hiển thị giao diện theo đúng thẩm quyền tài khoản</div>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Login Card & Quick Select */}
          <div className="lg:col-span-7 space-y-6">
            {/* Login Box */}
            <div className="bg-slate-950/80 backdrop-blur-xl border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl shadow-black/60 relative">
              <div className="flex items-center justify-between pb-5 border-b border-slate-800/80">
                <div className="text-left">
                  <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
                    <KeyRound className="w-5 h-5 text-orange-500" />
                    Đăng Nhập Tài Khoản
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">Nhập thông tin xác thực để truy cập hệ thống</p>
                </div>
                <div className="w-8 h-8 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-400">
                  <Lock className="w-4 h-4" />
                </div>
              </div>

              {/* Alerts */}
              {errorMsg && (
                <div className="mt-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs flex items-center gap-2 text-left">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{errorMsg}</span>
                </div>
              )}

              {successMsg && (
                <div className="mt-4 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs flex items-center gap-2 text-left">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>{successMsg}</span>
                </div>
              )}

              {/* Form */}
              <form onSubmit={handleSubmit} className="mt-5 space-y-4">
                <div className="space-y-1.5 text-left">
                  <label className="text-xs font-bold text-slate-300">Tên Đăng Nhập hoặc Email</label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                      <UserIcon className="w-4 h-4" />
                    </div>
                    <input
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="admin, sales_head, hoặc email..."
                      className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-100 placeholder-slate-500 text-xs focus:outline-hidden focus:border-orange-500 focus:ring-1 focus:ring-orange-500 transition-all"
                      required
                    />
                  </div>
                </div>

                <div className="space-y-1.5 text-left">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-slate-300">Mật Khẩu</label>
                    <span className="text-[11px] text-slate-500 hover:text-orange-400 cursor-pointer">Quên mật khẩu?</span>
                  </div>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                      <Lock className="w-4 h-4" />
                    </div>
                    <input
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full pl-10 pr-10 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-100 placeholder-slate-500 text-xs focus:outline-hidden focus:border-orange-500 focus:ring-1 focus:ring-orange-500 transition-all font-mono"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-500 hover:text-slate-300 cursor-pointer"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-1">
                  <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-400">
                    <input
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                      className="rounded bg-slate-900 border-slate-700 text-orange-500 focus:ring-orange-500 w-3.5 h-3.5"
                    />
                    <span>Duy trì đăng nhập trên thiết bị này</span>
                  </label>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-orange-600 to-orange-800 hover:from-orange-500 hover:to-orange-700 text-white font-bold text-xs shadow-lg shadow-orange-600/30 flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50"
                >
                  {loading ? (
                    <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <>
                      <span>ĐĂNG NHẬP VÀO HỆ THỐNG</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </form>

              {/* Customer Portal Entry Banner */}
              <div className="mt-5 pt-4 border-t border-slate-800/80">
                <button
                  type="button"
                  onClick={() => setPortalMode("customer")}
                  className="w-full p-3 rounded-2xl bg-gradient-to-r from-teal-950/60 to-slate-900 hover:from-teal-900/60 hover:to-slate-850 border border-teal-800/50 hover:border-teal-500/80 text-left transition-all cursor-pointer group shadow-lg shadow-teal-950/20"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 rounded-xl bg-teal-500/10 text-teal-400 border border-teal-500/20 group-hover:scale-105 transition-transform">
                        <HeartPulse className="w-5 h-5 text-rose-400" />
                      </div>
                      <div>
                        <div className="text-xs font-bold text-white group-hover:text-teal-300 transition-colors flex items-center gap-1.5">
                          <span>Dành Cho Khách Hàng Y Tế &amp; Bệnh Viện</span>
                          <span className="text-[9px] px-2 py-0.5 rounded-full bg-teal-500/20 text-teal-300 font-mono font-bold">Client Hub</span>
                        </div>
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          Tra cứu đơn hàng, Góp ý CSAT/NPS &amp; Báo cáo sự cố Lô chuẩn ISO 13485
                        </div>
                      </div>
                    </div>
                    <ArrowRight className="w-4 h-4 text-teal-400 group-hover:translate-x-1 transition-transform shrink-0" />
                  </div>
                </button>
              </div>
            </div>

          </div>

        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 w-full py-4 px-6 text-center text-xs text-slate-500 border-t border-slate-800/80 bg-slate-950/40">
        ABT PORTAL v2.0 • Hệ Thống Điều Hành &amp; Quản Trị Phân Phối Sinh Phẩm Y Tế • PostgreSQL 18
      </footer>
    </div>
  );
};
