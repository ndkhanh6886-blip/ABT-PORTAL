"use client";

import React, { useState, useEffect } from "react";
import { Navbar, MainTab } from "@/frontend/components/Navbar";
import { SalesFullABT } from "@/frontend/components/SalesFullABT";
import { WarehouseModule } from "@/frontend/components/WarehouseModule";
import { ApplicationFullABT } from "@/frontend/components/ApplicationFullABT";
import { ProcurementModule } from "@/frontend/components/ProcurementModule";
import { LegalModule } from "@/frontend/components/LegalModule";
import { SettingsModule } from "@/frontend/components/SettingsModule";
import { UnifiedWorkspace } from "@/frontend/components/UnifiedWorkspace";
import { EnterpriseChatModule } from "@/frontend/components/EnterpriseChatModule";
import { ZaloOperationsHub } from "@/frontend/components/ZaloOperationsHub";
import { FloatingChatWidget } from "@/frontend/components/FloatingChatWidget";
import { useAuth } from "@/frontend/contexts/AuthContext";
import { LoginScreen } from "@/frontend/components/LoginScreen";
import { SearchableSelectEnhancer } from "@/frontend/components/SearchableSelectEnhancer";
import { DataSyncGate } from "@/frontend/components/DataSyncGate";
import { AccountSecurityModal } from "@/frontend/components/AccountSecurityModal";
import { FactoryProvider } from "@/frontend/factory/FactoryProvider";
import { BUSINESS_TABS, BusinessTabs, TECHNICAL_TABS, TechnicalTabs, SETTINGS_TABS, SettingsTabs } from "@/frontend/components/GroupTabs";
import { FactoryWarehouseModule } from "@/frontend/factory/warehouse/FactoryWarehouseModule";
import { FactorySettingsModule } from "@/frontend/factory/settings/FactorySettingsModule";
import { FactoryPurchaseModule } from "@/frontend/factory/purchase/FactoryPurchaseModule";
import { FactoryOrdersModule } from "@/frontend/factory/orders/FactoryOrdersModule";
import { FactoryOligoModule } from "@/frontend/factory/oligo/FactoryOligoModule";
import { FactoryQaModule } from "@/frontend/factory/qa/FactoryQaModule";
import { FactoryRdModule } from "@/frontend/factory/rd/FactoryRdModule";
import FactoryDeviceModule from "@/frontend/factory/device/FactoryDeviceModule";
import FactoryKitModule from "@/frontend/factory/kit/FactoryKitModule";
import FactoryAnalyticsModule from "@/frontend/factory/analytics/FactoryAnalyticsModule";

export default function Home() {
  const [activeTab, setActiveTab] = useState<MainTab>("workspace");
  const { user, loading, can } = useAuth();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const resetKey = "tbr_clean_slate_2026_purge_all_v4";
      if (!localStorage.getItem(resetKey)) {
        const preservePrefixes = [
          "tbr_theme",
          "tbr_user",
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
    }
  }, []);

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
          <span className="text-xs font-mono">Đang kết nối ABT Portal...</span>
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
    <FactoryProvider>
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 transition-colors duration-200 w-full">
      <Navbar activeTab={activeTab} setActiveTab={setActiveTab} currentUser={user} />

      <main className="flex-1 w-full px-2 sm:px-4 lg:px-6 py-3.5 sm:py-4 pb-24 lg:pb-5">
        <DataSyncGate key={user.username || user.id}>
        {BUSINESS_TABS.includes(activeTab) && <BusinessTabs active={activeTab} onChange={setActiveTab} />}
        {TECHNICAL_TABS.includes(activeTab) && <TechnicalTabs active={activeTab} onChange={setActiveTab} />}
        {SETTINGS_TABS.includes(activeTab) && <SettingsTabs active={activeTab} onChange={setActiveTab} />}
        {activeTab === "workspace" && <UnifiedWorkspace />}
        {activeTab === "sales" && can("sales.view") && <SalesFullABT />}
        {activeTab === "warehouse" && can("warehouse.view") && <WarehouseModule />}
        {activeTab === "application" && can("application.view") && <ApplicationFullABT />}
        {activeTab === "procurement" && can("procurement.view") && <ProcurementModule />}
        {activeTab === "legal" && can("legal.view") && <LegalModule />}
        {activeTab === "chat" && <EnterpriseChatModule />}
        {activeTab === "zalo" && can("zalo.view") && <ZaloOperationsHub />}
        {activeTab === "settings" && can("settings.view") && <SettingsModule initialSubTab={settingsSubTab} />}
        {activeTab === "factory-warehouse" && <FactoryWarehouseModule />}
        {activeTab === "factory-settings" && <FactorySettingsModule />}
        {activeTab === "factory-orders" && <FactoryOrdersModule />}
        {activeTab === "factory-oligo" && <FactoryOligoModule />}
        {activeTab === "factory-rd" && <FactoryRdModule />}
        {activeTab === "factory-device" && <FactoryDeviceModule />}
        {activeTab === "factory-kit" && <FactoryKitModule />}
        {activeTab === "factory-purchase" && <FactoryPurchaseModule />}
        {activeTab === "factory-qa" && <FactoryQaModule />}
        {activeTab === "factory-analytics" && <FactoryAnalyticsModule />}
        </DataSyncGate>
      </main>

      {/* Floating Quick Chat Widget accessible across all modules */}
      <FloatingChatWidget activeTab={activeTab} setActiveTab={setActiveTab} />

      {/* Bổ sung ô gõ tìm nhanh cho mọi danh sách xổ (select) trong portal */}
      <SearchableSelectEnhancer />
    </div>
    </FactoryProvider>
  );
}
