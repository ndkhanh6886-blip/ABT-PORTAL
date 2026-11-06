"use client";

import React, { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { Navbar, MainTab } from "@/frontend/components/Navbar";
import { useAuth } from "@/frontend/contexts/AuthContext";
import { LoginScreen } from "@/frontend/components/LoginScreen";
import { SearchableSelectEnhancer } from "@/frontend/components/SearchableSelectEnhancer";
import { DataSyncGate } from "@/frontend/components/DataSyncGate";
import { AccountSecurityModal } from "@/frontend/components/AccountSecurityModal";

const SalesFullABT = dynamic(() => import("@/frontend/components/SalesFullABT").then(m => m.SalesFullABT), { ssr: false });
const WarehouseModule = dynamic(() => import("@/frontend/components/WarehouseModule").then(m => m.WarehouseModule), { ssr: false });
const ApplicationFullABT = dynamic(() => import("@/frontend/components/ApplicationFullABT").then(m => m.ApplicationFullABT), { ssr: false });
const ProcurementModule = dynamic(() => import("@/frontend/components/ProcurementModule").then(m => m.ProcurementModule), { ssr: false });
const LegalModule = dynamic(() => import("@/frontend/components/LegalModule").then(m => m.LegalModule), { ssr: false });
const SettingsModule = dynamic(() => import("@/frontend/components/SettingsModule").then(m => m.SettingsModule), { ssr: false });
const UnifiedWorkspace = dynamic(() => import("@/frontend/components/UnifiedWorkspace").then(m => m.UnifiedWorkspace), { ssr: false });
const EnterpriseChatModule = dynamic(() => import("@/frontend/components/EnterpriseChatModule").then(m => m.EnterpriseChatModule), { ssr: false });
const ZaloOperationsHub = dynamic(() => import("@/frontend/components/ZaloOperationsHub").then(m => m.ZaloOperationsHub), { ssr: false });
const FloatingChatWidget = dynamic(() => import("@/frontend/components/FloatingChatWidget").then(m => m.FloatingChatWidget), { ssr: false });

export default function Home() {
  const [activeTab, setActiveTabState] = useState<MainTab>(() => {
    if (typeof window !== "undefined") {
      try {
        const params = new URLSearchParams(window.location.search);
        const tabParam = params.get("tab") as MainTab | null;
        const validTabs: MainTab[] = ["workspace", "sales", "warehouse", "application", "procurement", "legal", "chat", "zalo", "settings"];
        if (tabParam && validTabs.includes(tabParam)) {
          return tabParam;
        }
      } catch (e) {}
    }
    return "workspace";
  });
  const [visitedTabs, setVisitedTabs] = useState<Record<string, boolean>>({});
  const { user, loading, can } = useAuth();
  const [mounted, setMounted] = useState(false);

  const setActiveTab = (nextTab: MainTab) => {
    setActiveTabState(nextTab);
    setVisitedTabs(prev => (prev[nextTab] ? prev : { ...prev, [nextTab]: true }));
    if (typeof window !== "undefined") {
      try {
        const url = new URL(window.location.href);
        const prevTab = url.searchParams.get("tab");
        url.searchParams.set("tab", nextTab);
        if (prevTab && prevTab !== nextTab) {
          url.searchParams.delete("sub");
        }
        window.history.replaceState({}, "", url.toString());
      } catch (e) {}
    }
  };

  useEffect(() => {
    setMounted(true);
    if (typeof window !== "undefined") {
      try {
        const params = new URLSearchParams(window.location.search);
        const tabParam = params.get("tab") as MainTab | null;
        const validTabs: MainTab[] = ["workspace", "sales", "warehouse", "application", "procurement", "legal", "chat", "zalo", "settings"];
        const initial = tabParam && validTabs.includes(tabParam) ? tabParam : activeTab;
        setActiveTabState(initial);
        setVisitedTabs(prev => ({ ...prev, [initial]: true }));
      } catch (e) {}
    }
  }, []);

  // Tự động làm ấm bộ nhớ đệm (prefetch ngầm) cho các phân hệ người dùng được cấp quyền
  useEffect(() => {
    if (!user) return;
    const t = setTimeout(() => {
      try {
        if (activeTab !== "workspace") fetch("/api/workflows?action=overview").catch(() => {});
        if (activeTab !== "warehouse" && can("warehouse.view")) fetch("/api/inventory?action=overview").catch(() => {});
        if (activeTab !== "sales" && can("sales.view")) fetch("/api/sales?action=overview").catch(() => {});
        if (activeTab !== "procurement" && can("procurement.view")) fetch("/api/procurement?action=overview").catch(() => {});
      } catch {}
    }, 1200);
    return () => clearTimeout(t);
  }, [user]);

  useEffect(() => {
    if (!user || typeof window === "undefined") return;
    const resetKey = "tbr_clean_slate_2026_purge_all_v4";
    if (!localStorage.getItem(resetKey)) {
      const preservePrefixes = [
        "tbr_theme",
        "tbr_user",
        "tbr_current_user",
        "current_user",
        "tbr_org_",
        "sales_company_"
      ];
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && !preservePrefixes.some(p => k.startsWith(p)) && k !== resetKey) {
          keysToRemove.push(k);
        }
      }
      keysToRemove.forEach(k => localStorage.removeItem(k));
      localStorage.setItem(resetKey, "true");
      window.dispatchEvent(new Event("storage"));
    }
  }, [user]);

  const [settingsSubTab, setSettingsSubTab] = useState<"personnel" | "users" | "departments" | "audit" | "notifications">("users");

  useEffect(() => {
    const handleNav = (e: any) => {
      if (e.detail && e.detail.tab) {
        setActiveTab(e.detail.tab as MainTab);
        if (e.detail.tab === "settings" && e.detail.subTab) {
          const validSubTabs = ["personnel", "users", "departments", "audit", "notifications"];
          if (validSubTabs.includes(e.detail.subTab)) {
            setSettingsSubTab(e.detail.subTab);
          }
        }
      }
    };
    window.addEventListener("tbr-navigate" as any, handleNav);
    return () => window.removeEventListener("tbr-navigate" as any, handleNav);
  }, []);

  // Tự động chuyển hướng về phân hệ được cấp quyền nếu người dùng vô tình truy cập phân hệ bị ẩn
  useEffect(() => {
    if (!user) return;
    const tabPermissionMap: Record<string, string> = {
      sales: "sales.view",
      warehouse: "warehouse.view",
      application: "application.view",
      procurement: "procurement.view",
      legal: "legal.view",
      zalo: "zalo.view",
      settings: "settings.view"
    };

    const requiredPerm = tabPermissionMap[activeTab];
    if (requiredPerm && !can(requiredPerm)) {
      setActiveTab("workspace");
    }
  }, [activeTab, user, can]);

  if (!mounted || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900 text-slate-300">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-3 border-orange-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-xs font-mono">Đang kết nối TBR Portal...</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginScreen />;
  }

  // Mật khẩu mặc định / tạm thời: bắt buộc đổi trước khi vào hệ thống (máy chủ cũng chặn mọi API khác)
  if (user.mustChangePassword) {
    return <AccountSecurityModal forced />;
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 transition-colors duration-200 w-full">
      <Navbar activeTab={activeTab} setActiveTab={setActiveTab} currentUser={user} />

      <main className="flex-1 w-full px-2 sm:px-4 lg:px-6 py-3.5 sm:py-4 pb-24 lg:pb-5">
        <DataSyncGate key={user.username || user.id}>
          {(activeTab === "workspace" || visitedTabs.workspace) && (
            <div className={activeTab === "workspace" ? "block" : "hidden"}>
              <UnifiedWorkspace />
            </div>
          )}
          {can("sales.view") && (activeTab === "sales" || visitedTabs.sales) && (
            <div className={activeTab === "sales" ? "block" : "hidden"}>
              <SalesFullABT />
            </div>
          )}
          {can("warehouse.view") && (activeTab === "warehouse" || visitedTabs.warehouse) && (
            <div className={activeTab === "warehouse" ? "block" : "hidden"}>
              <WarehouseModule />
            </div>
          )}
          {can("application.view") && (activeTab === "application" || visitedTabs.application) && (
            <div className={activeTab === "application" ? "block" : "hidden"}>
              <ApplicationFullABT />
            </div>
          )}
          {can("procurement.view") && (activeTab === "procurement" || visitedTabs.procurement) && (
            <div className={activeTab === "procurement" ? "block" : "hidden"}>
              <ProcurementModule />
            </div>
          )}
          {can("legal.view") && (activeTab === "legal" || visitedTabs.legal) && (
            <div className={activeTab === "legal" ? "block" : "hidden"}>
              <LegalModule />
            </div>
          )}
          {(activeTab === "chat" || visitedTabs.chat) && (
            <div className={activeTab === "chat" ? "block" : "hidden"}>
              <EnterpriseChatModule />
            </div>
          )}
          {can("zalo.view") && (activeTab === "zalo" || visitedTabs.zalo) && (
            <div className={activeTab === "zalo" ? "block" : "hidden"}>
              <ZaloOperationsHub />
            </div>
          )}
          {can("settings.view") && (activeTab === "settings" || visitedTabs.settings) && (
            <div className={activeTab === "settings" ? "block" : "hidden"}>
              <SettingsModule initialSubTab={settingsSubTab} />
            </div>
          )}
        </DataSyncGate>
      </main>

      {/* Floating Quick Chat Widget accessible across all modules */}
      <FloatingChatWidget activeTab={activeTab} setActiveTab={setActiveTab} />

      {/* Bổ sung ô gõ tìm nhanh cho mọi danh sách xổ (select) trong portal */}
      <SearchableSelectEnhancer />
    </div>
  );
}
