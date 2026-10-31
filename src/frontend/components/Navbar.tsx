"use client";

import React, { useState, useEffect } from "react";
import { useTheme } from "@/frontend/contexts/ThemeContext";
import { NotificationDropdown } from "./NotificationDropdown";
import { useAuth } from "@/frontend/contexts/AuthContext";
import { AccountSecurityModal } from "./AccountSecurityModal";
import {
  Briefcase,
  FlaskConical,
  Settings,
  Sun,
  Moon,
  ShieldCheck,
  ChevronDown,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  Scale,
  Smartphone,
  Menu,
  X,
} from "lucide-react";
import { hasAny, useFactoryMe } from "@/frontend/factory/api";

export type MainTab =
  | "workspace"
  | "sales"
  | "warehouse"
  | "application"
  | "procurement"
  | "legal"
  | "chat"
  | "zalo"
  | "settings"
  | "factory-warehouse"
  | "factory-settings"
  | "factory-qa"
  | "factory-purchase"
  | "factory-orders"
  | "factory-oligo"
  | "factory-rd"
  | "factory-device"
  | "factory-kit"
  | "factory-analytics";

interface NavbarProps {
  activeTab: MainTab;
  setActiveTab: (tab: MainTab) => void;
  currentUser?: any;
}

export const Navbar: React.FC<NavbarProps> = ({ activeTab, setActiveTab, currentUser }) => {
  const { theme, toggleTheme } = useTheme();
  const { user, logout, can } = useAuth();
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isSecurityOpen, setIsSecurityOpen] = useState(false);
  const [isMobileMoreOpen, setIsMobileMoreOpen] = useState(false);
  const [chatUnreadCount, setChatUnreadCount] = useState(0);
  const activeUser = user || currentUser;
  const factoryMe = useFactoryMe(Boolean(user));
  const canFactoryWarehouse = hasAny(factoryMe.data, ["inv", "master"]);
  const canFactorySettings = Boolean(factoryMe.data?.permissions.length);

  // Khối Kinh Doanh groups the four Kinh doanh modules; the Navbar shows one entry for them
  const businessTabs = (["sales", "warehouse", "application", "procurement"] as const).filter((t) => can(`${t}.view`));
  const canBusiness = businessTabs.length > 0;
  const isBusinessTab = (businessTabs as readonly string[]).includes(activeTab);
  const firstBusinessTab: MainTab = isBusinessTab ? activeTab : businessTabs[0] ?? "sales";

  // Khối Kỹ Thuật groups all factory/R&D/production/QA/supply/warehouse modules into one Navbar entry
  const canFactoryRd = hasAny(factoryMe.data, ["rd", "work.plan"]);
  const canFactoryKit = hasAny(factoryMe.data, ["kit"]);
  const canFactoryOligo = hasAny(factoryMe.data, ["oligo"]);
  const canFactoryDevice = hasAny(factoryMe.data, ["device"]);
  const canFactoryQa = hasAny(factoryMe.data, ["qms.qc.view"]);
  const canFactoryOrders = hasAny(factoryMe.data, ["intake"]);
  const canFactoryPurchase = hasAny(factoryMe.data, ["purchase", "master.partner"]);

  const technicalTabs = ([
    canFactoryRd ? "factory-rd" : null,
    canFactoryKit ? "factory-kit" : null,
    canFactoryOligo ? "factory-oligo" : null,
    canFactoryDevice ? "factory-device" : null,
    canFactoryQa ? "factory-qa" : null,
    canFactoryOrders ? "factory-orders" : null,
    canFactoryPurchase ? "factory-purchase" : null,
    canFactoryWarehouse ? "factory-warehouse" : null,
    canFactorySettings ? "factory-analytics" : null,
  ] as const).filter((t): t is NonNullable<typeof t> => t !== null);
  const canTechnical = technicalTabs.length > 0;
  const isTechnicalTab = (technicalTabs as readonly string[]).includes(activeTab);
  const firstTechnicalTab: MainTab = isTechnicalTab ? activeTab : technicalTabs[0] ?? "factory-rd";

  const isSettingsTab = activeTab === "settings" || activeTab === "factory-settings";

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onUnread = (e: any) => {
      const cnt = Number(e?.detail?.count) || 0;
      setChatUnreadCount(cnt);
    };
    window.addEventListener("tbr-chat-unread-updated", onUnread as EventListener);
    return () => window.removeEventListener("tbr-chat-unread-updated", onUnread as EventListener);
  }, []);

  return (
    <>
      <header className="sticky top-0 z-40 w-full border-b transition-colors bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-xs">
        <div className="w-full px-3 sm:px-5 lg:px-6 h-14 flex items-center justify-between gap-2 sm:gap-3">
          {/* Brand & Left Navigation */}
          <div className="flex items-center gap-3 lg:gap-4 min-w-0 flex-1">
            <div
              className="flex items-center gap-2.5 cursor-pointer select-none shrink-0"
              onClick={() => { setActiveTab("workspace"); setIsMobileMoreOpen(false); }}
            >
              <div className="w-8 h-8 rounded-xl bg-white flex items-center justify-center shadow-sm shrink-0 overflow-hidden ring-1 ring-orange-200">
                <img src="/icon.png" alt="ABT" className="w-7 h-7 object-contain" />
              </div>
              <div className="leading-none">
                <div className="flex items-center gap-1.5">
                  <span className="font-extrabold tracking-tight text-slate-900 dark:text-white text-sm sm:text-base whitespace-nowrap">
                    ABT PORTAL
                  </span>
                  <span className="hidden xl:inline-block px-1.5 py-0.5 text-[9px] font-bold rounded-full bg-orange-50 dark:bg-orange-950/60 text-orange-700 dark:text-orange-400 border border-orange-200 dark:border-orange-800 whitespace-nowrap">
                    Y Sinh ABT
                  </span>
                </div>
                <span className="text-[9px] font-semibold text-slate-400 dark:text-slate-500 tracking-wider uppercase block mt-0.5 whitespace-nowrap">
                  Kinh Doanh &amp; Sản Xuất
                </span>
              </div>
            </div>

            {/* Desktop Primary Navigation Tabs */}
            <nav className="hidden lg:flex items-center gap-1 pl-3 border-l border-slate-200 dark:border-slate-800 overflow-x-auto no-scrollbar min-w-0 flex-1 py-1">
              <button
                onClick={() => setActiveTab("workspace")}
                className={`flex items-center gap-1.5 px-2.5 xl:px-3 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                  activeTab === "workspace"
                    ? "bg-indigo-600 text-white shadow-xs shadow-indigo-500/20"
                    : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white"
                }`}
              >
                <LayoutDashboard className="w-3.5 h-3.5 shrink-0" />
                <span>Điều Hành</span>
              </button>

              {canBusiness && (
                <button
                  onClick={() => setActiveTab(firstBusinessTab)}
                  className={`flex items-center gap-1.5 px-2.5 xl:px-3 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                    isBusinessTab
                      ? "bg-orange-600 text-white shadow-xs shadow-orange-500/20"
                      : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white"
                  }`}
                >
                  <Briefcase className="w-3.5 h-3.5 shrink-0" />
                  <span>Khối Kinh Doanh</span>
                </button>
              )}

              {canTechnical && (
                <button
                  onClick={() => setActiveTab(firstTechnicalTab)}
                  className={`flex items-center gap-1.5 px-2.5 xl:px-3 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                    isTechnicalTab
                      ? "bg-sky-700 text-white shadow-xs shadow-sky-500/20"
                      : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white"
                  }`}
                >
                  <FlaskConical className="w-3.5 h-3.5 shrink-0" />
                  <span>Khối Kỹ Thuật</span>
                </button>
              )}

              {can("legal.view") && (
                <button
                  onClick={() => setActiveTab("legal")}
                  className={`flex items-center gap-1.5 px-2.5 xl:px-3 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                    activeTab === "legal"
                      ? "bg-emerald-600 text-white shadow-xs shadow-emerald-500/20"
                      : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white"
                  }`}
                >
                  <Scale className="w-3.5 h-3.5 shrink-0" />
                  <span>Pháp Chế</span>
                </button>
              )}

              {can("chat.view") && (
                <button
                  onClick={() => setActiveTab("chat")}
                  className={`flex items-center gap-1.5 px-2.5 xl:px-3 py-1.5 rounded-xl text-xs font-bold transition-all relative whitespace-nowrap shrink-0 cursor-pointer ${
                    activeTab === "chat"
                      ? "bg-indigo-600 text-white shadow-xs shadow-indigo-500/20"
                      : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white"
                  }`}
                >
                  <MessageSquare className="w-3.5 h-3.5 shrink-0" />
                  <span>Chat Nội Bộ</span>
                  {chatUnreadCount > 0 ? (
                    <span className="min-w-[16px] h-4 px-1 rounded-full bg-rose-600 text-white text-[9px] font-extrabold flex items-center justify-center shrink-0">
                      {chatUnreadCount > 99 ? "99+" : chatUnreadCount}
                    </span>
                  ) : (
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                  )}
                </button>
              )}

              {can("zalo.view") && (
                <button
                  onClick={() => setActiveTab("zalo")}
                  className={`flex items-center gap-1.5 px-2.5 xl:px-3 py-1.5 rounded-xl text-xs font-bold transition-all relative whitespace-nowrap shrink-0 cursor-pointer ${
                    activeTab === "zalo"
                      ? "bg-blue-600 text-white shadow-xs shadow-blue-500/20"
                      : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white"
                  }`}
                >
                  <Smartphone className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                  <span>Zalo OA</span>
                </button>
              )}

              {(can("settings.view") || canFactorySettings) && (
                <button
                  onClick={() => setActiveTab(can("settings.view") ? "settings" : "factory-settings")}
                  className={`flex items-center gap-1.5 px-2.5 xl:px-3 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                    isSettingsTab
                      ? "bg-orange-600 text-white shadow-xs shadow-orange-500/20"
                      : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white"
                  }`}
                >
                  <Settings className="w-3.5 h-3.5 shrink-0" />
                  <span>Cấu Hình</span>
                </button>
              )}
            </nav>
          </div>

          {/* Right Status, Notification Bell, Mobile Menu Button & User Info */}
          <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
            <NotificationDropdown />

            {/* Mobile / Tablet Quick Menu Trigger in Top Header */}
            <button
              type="button"
              onClick={() => setIsMobileMoreOpen(prev => !prev)}
              className="lg:hidden flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-orange-50 dark:bg-orange-950/60 text-orange-700 dark:text-orange-400 border border-orange-200 dark:border-orange-800 text-xs font-bold cursor-pointer active:scale-95 transition-all"
              title="Mở danh mục tất cả các phân hệ"
            >
              {isMobileMoreOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
              <span className="text-[11px]">Menu</span>
            </button>

            {/* User Profile with Account Switcher */}
            <div className="relative pl-1.5 sm:pl-2 border-l border-slate-200 dark:border-slate-800">
              <button
                onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                className="flex items-center gap-2 p-1 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-all text-left cursor-pointer group"
                title="Tài khoản & Cài đặt cá nhân"
              >
                <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-orange-100 dark:bg-orange-950 text-orange-700 dark:text-orange-400 font-bold flex items-center justify-center text-xs border border-orange-200 dark:border-orange-800 shrink-0">
                  {activeUser?.name ? activeUser.name.slice(0, 2).toUpperCase() : (activeUser?.full_name ? activeUser.full_name.slice(0, 2).toUpperCase() : "AD")}
                </div>
                <div className="hidden sm:block text-left text-xs leading-tight max-w-[140px]">
                  <div className="font-bold text-slate-900 dark:text-white flex items-center gap-1">
                    <span className="truncate">{activeUser?.name || activeUser?.full_name || "Cán bộ ABT"}</span>
                    <ChevronDown className="w-3 h-3 text-slate-400 group-hover:text-slate-600 transition-transform shrink-0" />
                  </div>
                  <div className="text-[10px] text-slate-400 dark:text-slate-500 font-medium truncate">
                    {activeUser?.role === "Director" || activeUser?.role === "admin"
                      ? "Giám Đốc (Director)"
                      : activeUser?.role || "Thành viên"}
                  </div>
                </div>
              </button>

              {/* Account Switcher Dropdown */}
              {isUserMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setIsUserMenuOpen(false)} />
                  <div className="absolute right-0 mt-2 w-72 sm:w-80 bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 p-2 z-50 text-xs">
                    <div className="px-3 py-2.5 border-b border-slate-100 dark:border-slate-800 mb-2 bg-slate-50 dark:bg-slate-800/40 rounded-xl">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-slate-900 dark:text-white truncate">
                          {activeUser?.name || activeUser?.full_name || "Người dùng"}
                        </span>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-orange-100 dark:bg-orange-950 text-orange-700 dark:text-orange-400 font-bold border border-orange-200 dark:border-orange-800 shrink-0">
                          {activeUser?.role || "Thành viên"}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5 truncate">{activeUser?.email || activeUser?.department}</div>
                    </div>

                    <div className="p-1 space-y-1">
                      {can("settings.view") && (
                        <button
                          onClick={() => {
                            if (typeof window !== "undefined") {
                              localStorage.setItem("settings_target_subtab", "users");
                              window.dispatchEvent(
                                new CustomEvent("tbr-navigate", {
                                  detail: { tab: "settings", subTab: "users" }
                                })
                              );
                              window.scrollTo({ top: 0, behavior: "smooth" });
                            }
                            setActiveTab("settings");
                            setIsUserMenuOpen(false);
                          }}
                          className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-left font-semibold transition-all cursor-pointer"
                        >
                          <Settings className="w-4 h-4 text-orange-500" />
                          <span>Quản Lý Tài Khoản &amp; Phân Quyền</span>
                        </button>
                      )}
                      <button
                        onClick={() => {
                          setIsSecurityOpen(true);
                          setIsUserMenuOpen(false);
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-left font-semibold transition-all cursor-pointer"
                      >
                        <ShieldCheck className="w-4 h-4 text-orange-500" />
                        <span>Bảo mật tài khoản (Mật khẩu, Zalo)</span>
                      </button>
                      <button
                        onClick={() => {
                          toggleTheme();
                          setIsUserMenuOpen(false);
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-left font-semibold transition-all cursor-pointer"
                      >
                        {theme === "dark" ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-slate-500" />}
                        <span>{theme === "dark" ? "Chuyển sang giao diện Sáng" : "Chuyển sang giao diện Tối"}</span>
                      </button>
                      <button
                        onClick={() => {
                          logout();
                          setIsUserMenuOpen(false);
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/50 text-left font-bold transition-all cursor-pointer"
                      >
                        <LogOut className="w-4 h-4" />
                        <span>Đăng Xuất Khỏi Hệ Thống</span>
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Fixed Mobile Bottom Navigation Bar */}
      <nav
        aria-label="Mobile Navigation"
        className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-800 px-1.5 py-1 flex items-center justify-around shadow-2xl"
      >
        <button
          onClick={() => { setActiveTab("workspace"); setIsMobileMoreOpen(false); }}
          className={`flex flex-col items-center justify-center py-1 px-2.5 rounded-2xl transition-all cursor-pointer ${
            activeTab === "workspace" && !isMobileMoreOpen
              ? "text-orange-600 dark:text-orange-400 font-extrabold"
              : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
          }`}
        >
          <div className={`p-1 rounded-xl transition-transform ${activeTab === "workspace" && !isMobileMoreOpen ? "bg-orange-50 dark:bg-orange-950/60 scale-105" : ""}`}>
            <LayoutDashboard className="w-5 h-5" />
          </div>
          <span className="text-[10px] mt-0.5 tracking-tight font-bold">Điều Hành</span>
        </button>

        {canBusiness && (
          <button
            onClick={() => { setActiveTab(firstBusinessTab); setIsMobileMoreOpen(false); }}
            className={`flex flex-col items-center justify-center py-1 px-2.5 rounded-2xl transition-all cursor-pointer ${
              isBusinessTab && !isMobileMoreOpen
                ? "text-orange-600 dark:text-orange-400 font-extrabold"
                : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
            }`}
          >
            <div className={`p-1 rounded-xl transition-transform ${isBusinessTab && !isMobileMoreOpen ? "bg-orange-50 dark:bg-orange-950/60 scale-105" : ""}`}>
              <Briefcase className="w-5 h-5" />
            </div>
            <span className="text-[10px] mt-0.5 tracking-tight font-bold">Khối KD</span>
          </button>
        )}

        {canTechnical && (
          <button
            onClick={() => { setActiveTab(firstTechnicalTab); setIsMobileMoreOpen(false); }}
            className={`flex flex-col items-center justify-center py-1 px-2.5 rounded-2xl transition-all cursor-pointer ${
              isTechnicalTab && !isMobileMoreOpen
                ? "text-sky-600 dark:text-sky-400 font-extrabold"
                : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
            }`}
          >
            <div className={`p-1 rounded-xl transition-transform ${isTechnicalTab && !isMobileMoreOpen ? "bg-sky-50 dark:bg-sky-950/60 scale-105" : ""}`}>
              <FlaskConical className="w-5 h-5" />
            </div>
            <span className="text-[10px] mt-0.5 tracking-tight font-bold">Khối KT</span>
          </button>
        )}

        <button
          onClick={() => setIsMobileMoreOpen(prev => !prev)}
          className={`flex flex-col items-center justify-center py-1 px-2.5 rounded-2xl transition-all cursor-pointer ${
            isMobileMoreOpen || ["factory-settings", "legal", "chat", "zalo", "settings"].includes(activeTab)
              ? "text-orange-600 dark:text-orange-400 font-extrabold"
              : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
          }`}
        >
          <div className={`p-1 rounded-xl transition-transform ${isMobileMoreOpen || ["factory-settings", "legal", "chat", "zalo", "settings"].includes(activeTab) ? "bg-orange-50 dark:bg-orange-950/60 scale-105" : ""}`}>
            {isMobileMoreOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </div>
          <span className="text-[10px] mt-0.5 tracking-tight font-bold">Thêm</span>
        </button>
      </nav>

      {/* Mobile Full Navigation Drawer / Bottom Sheet */}
      {isMobileMoreOpen && (
        <div className="lg:hidden fixed inset-0 z-[70] flex flex-col justify-end">
          <div
            className="fixed inset-0 bg-slate-950/65 backdrop-blur-xs transition-opacity"
            onClick={() => setIsMobileMoreOpen(false)}
          />

          <div className="relative z-10 bg-white dark:bg-slate-900 rounded-t-3xl border-t border-slate-200 dark:border-slate-800 shadow-2xl p-4 sm:p-5 pb-20 max-h-[85vh] overflow-y-auto">
            <div className="w-12 h-1.5 bg-slate-300 dark:bg-slate-700 rounded-full mx-auto mb-3" />

            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800 mb-3.5">
              <div>
                <h3 className="text-sm sm:text-base font-extrabold text-slate-900 dark:text-white">
                  Danh Mục Phân Hệ &amp; Tiện Ích
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">Chọn phân hệ làm việc trên ABT Portal</p>
              </div>
              <button
                onClick={() => setIsMobileMoreOpen(false)}
                className="p-1.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-slate-800 dark:hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-2">
              Phân hệ nghiệp vụ chính
            </div>
            <div className="grid grid-cols-2 gap-2.5 mb-4">
              <button
                onClick={() => { setActiveTab("workspace"); setIsMobileMoreOpen(false); }}
                className={`p-2.5 rounded-2xl flex items-center gap-2.5 border text-left transition-all cursor-pointer ${
                  activeTab === "workspace"
                    ? "bg-indigo-50 dark:bg-indigo-950/50 border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300 font-bold"
                    : "bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700/60 text-slate-700 dark:text-slate-300"
                }`}
              >
                <div className="p-2 rounded-xl bg-indigo-100 dark:bg-indigo-950/70 text-indigo-600 dark:text-indigo-400 shrink-0">
                  <LayoutDashboard className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-bold leading-tight truncate">Điều Hành</div>
                  <div className="text-[10px] text-slate-400 truncate">Công việc &amp; Quy trình</div>
                </div>
              </button>

              {canBusiness && (
                <button
                  onClick={() => { setActiveTab(firstBusinessTab); setIsMobileMoreOpen(false); }}
                  className={`p-2.5 rounded-2xl flex items-center gap-2.5 border text-left transition-all cursor-pointer ${
                    isBusinessTab
                      ? "bg-orange-50 dark:bg-orange-950/50 border-orange-300 dark:border-orange-700 text-orange-700 dark:text-orange-300 font-bold"
                      : "bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700/60 text-slate-700 dark:text-slate-300"
                  }`}
                >
                  <div className="p-2 rounded-xl bg-orange-100 dark:bg-orange-950/70 text-orange-600 dark:text-orange-400 shrink-0">
                    <Briefcase className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-bold leading-tight truncate">Khối Kinh Doanh</div>
                    <div className="text-[10px] text-slate-400 truncate">Kinh doanh, Kho, Application, Cung ứng</div>
                  </div>
                </button>
              )}

              {canTechnical && (
                <button
                  onClick={() => { setActiveTab(firstTechnicalTab); setIsMobileMoreOpen(false); }}
                  className={`p-2.5 rounded-2xl flex items-center gap-2.5 border text-left transition-all cursor-pointer ${
                    isTechnicalTab
                      ? "bg-sky-50 dark:bg-sky-950/50 border-sky-300 dark:border-sky-700 text-sky-700 dark:text-sky-300 font-bold"
                      : "bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700/60 text-slate-700 dark:text-slate-300"
                  }`}
                >
                  <div className="p-2 rounded-xl bg-sky-100 dark:bg-sky-950/70 text-sky-700 dark:text-sky-400 shrink-0">
                    <FlaskConical className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-bold leading-tight truncate">Khối Kỹ Thuật</div>
                    <div className="text-[10px] text-slate-400 truncate">R&amp;D, SX Kit, Oligo, Thiết bị, QA/QC, Kho</div>
                  </div>
                </button>
              )}

              {can("legal.view") && (
                <button
                  onClick={() => { setActiveTab("legal"); setIsMobileMoreOpen(false); }}
                  className={`p-2.5 rounded-2xl flex items-center gap-2.5 border text-left transition-all cursor-pointer ${
                    activeTab === "legal"
                      ? "bg-emerald-50 dark:bg-emerald-950/50 border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300 font-bold"
                      : "bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700/60 text-slate-700 dark:text-slate-300"
                  }`}
                >
                  <div className="p-2 rounded-xl bg-emerald-100 dark:bg-emerald-950/70 text-emerald-600 dark:text-emerald-400 shrink-0">
                    <Scale className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-bold leading-tight truncate">Pháp Chế</div>
                    <div className="text-[10px] text-slate-400 truncate">Hợp đồng &amp; Hồ sơ thầu</div>
                  </div>
                </button>
              )}

              {can("chat.view") && (
                <button
                  onClick={() => { setActiveTab("chat"); setIsMobileMoreOpen(false); }}
                  className={`p-2.5 rounded-2xl flex items-center gap-2.5 border text-left transition-all cursor-pointer ${
                    activeTab === "chat"
                      ? "bg-indigo-50 dark:bg-indigo-950/50 border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300 font-bold"
                      : "bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700/60 text-slate-700 dark:text-slate-300"
                  }`}
                >
                  <div className="p-2 rounded-xl bg-indigo-100 dark:bg-indigo-950/70 text-indigo-600 dark:text-indigo-400 shrink-0">
                    <MessageSquare className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-bold leading-tight truncate">Trao Đổi &amp; Chat</div>
                    <div className="text-[10px] text-slate-400 truncate">Trò chuyện nội bộ</div>
                  </div>
                </button>
              )}

              {can("zalo.view") && (
                <button
                  onClick={() => { setActiveTab("zalo"); setIsMobileMoreOpen(false); }}
                  className={`p-2.5 rounded-2xl flex items-center gap-2.5 border text-left transition-all cursor-pointer ${
                    activeTab === "zalo"
                      ? "bg-blue-50 dark:bg-blue-950/50 border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300 font-bold"
                      : "bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700/60 text-slate-700 dark:text-slate-300"
                  }`}
                >
                  <div className="p-2 rounded-xl bg-blue-100 dark:bg-blue-950/70 text-blue-600 dark:text-blue-400 shrink-0">
                    <Smartphone className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-bold leading-tight truncate">Zalo Điều Hành</div>
                    <div className="text-[10px] text-slate-400 truncate">OA 4.0 Tin nhắn</div>
                  </div>
                </button>
              )}

              {(can("settings.view") || canFactorySettings) && (
                <button
                  onClick={() => { setActiveTab(can("settings.view") ? "settings" : "factory-settings"); setIsMobileMoreOpen(false); }}
                  className={`col-span-2 p-2.5 rounded-2xl flex items-center gap-2.5 border text-left transition-all cursor-pointer ${
                    isSettingsTab
                      ? "bg-orange-50 dark:bg-orange-950/50 border-orange-300 dark:border-orange-700 text-orange-700 dark:text-orange-300 font-bold"
                      : "bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700/60 text-slate-700 dark:text-slate-300"
                  }`}
                >
                  <div className="p-2 rounded-xl bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 shrink-0">
                    <Settings className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-bold leading-tight">Cấu Hình &amp; Nhật Ký Hệ Thống</div>
                    <div className="text-[10px] text-slate-400">Phân quyền tài khoản, danh bạ nhân sự, nhật ký</div>
                  </div>
                </button>
              )}
            </div>

            {/* Quick Actions in Drawer */}
            <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2 text-xs">
              <button
                onClick={toggleTheme}
                className="flex-1 flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold cursor-pointer"
              >
                {theme === "dark" ? <Sun className="w-4 h-4 text-amber-400 shrink-0" /> : <Moon className="w-4 h-4 text-slate-600 shrink-0" />}
                <span className="truncate">{theme === "dark" ? "Chế độ Sáng" : "Chế độ Tối"}</span>
              </button>

              <button
                onClick={() => {
                  setIsSecurityOpen(true);
                  setIsMobileMoreOpen(false);
                }}
                className="flex-1 flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold cursor-pointer"
              >
                <ShieldCheck className="w-4 h-4 text-orange-500 shrink-0" />
                <span className="truncate">Bảo mật</span>
              </button>

              <button
                onClick={() => {
                  logout();
                  setIsMobileMoreOpen(false);
                }}
                className="flex-1 flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-xl bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400 font-bold cursor-pointer"
              >
                <LogOut className="w-4 h-4 shrink-0" />
                <span className="truncate">Đăng Xuất</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {isSecurityOpen && <AccountSecurityModal onClose={() => setIsSecurityOpen(false)} />}
    </>
  );
};
