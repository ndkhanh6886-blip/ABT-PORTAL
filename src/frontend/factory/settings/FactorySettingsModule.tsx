"use client";

import React, { useState } from "react";
import { Building2, KeyRound, ShieldCheck, UserCog, UsersRound } from "lucide-react";
import { useFactoryMe } from "../api";
import { ErrorNote } from "../ui";
import { DelegationsView } from "./DelegationsView";
import { OrgUnitsView } from "./OrgUnitsView";
import { PinView } from "./PinView";
import { RolesView } from "./RolesView";
import { UsersView } from "./UsersView";

type SubTab = "pin" | "delegations" | "users" | "roles" | "org";

/** "Cấu hình Nhà Máy": own signature PIN for everyone; org structure, roles and grants for administrators. */
export function FactorySettingsModule() {
  const me = useFactoryMe();
  const perms = new Set(me.data?.permissions ?? []);
  const manageRoles = perms.has("core.role.manage");
  const tabs: { key: SubTab; label: string; icon: React.ElementType; show: boolean }[] = [
    { key: "pin", label: "PIN chữ ký của tôi", icon: KeyRound, show: true },
    { key: "delegations", label: "Ủy quyền", icon: UserCog, show: true },
    { key: "users", label: "Người dùng & quyền", icon: UsersRound, show: manageRoles },
    { key: "roles", label: "Vai trò", icon: ShieldCheck, show: manageRoles },
    { key: "org", label: "Cơ cấu tổ chức", icon: Building2, show: perms.has("core.org.manage") },
  ];
  const visible = tabs.filter((t) => t.show);
  const [tab, setTab] = useState<SubTab>("pin");
  const active = visible.find((t) => t.key === tab)?.key ?? "pin";

  if (me.isLoading) return <div className="text-sm text-slate-400 p-6">Đang tải…</div>;
  if (me.error) return <ErrorNote error={me.error} />;

  return (
    <div className="flex flex-col gap-3">
      {me.data?.is_root && (
        <div className="rounded-2xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 px-4 py-2 text-xs text-amber-900 dark:text-amber-200">
          Bạn là <b>Root admin</b>: có toàn bộ quyền của nhà máy ở mọi phòng và cấp vai trò cho người khác. Các bước cần ký vẫn yêu cầu PIN, và vẫn không được tự duyệt hồ sơ do chính mình thực hiện.
        </div>
      )}
      <div className="flex items-center gap-1 overflow-x-auto no-scrollbar rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-1">
        {visible.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap cursor-pointer transition-colors ${
              active === t.key ? "bg-sky-700 text-white" : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            }`}
          >
            <t.icon className="w-3.5 h-3.5" />
            {t.label}
          </button>
        ))}
      </div>
      {active === "pin" && <PinView />}
      {active === "delegations" && <DelegationsView canManage={manageRoles} />}
      {active === "users" && <UsersView />}
      {active === "roles" && <RolesView />}
      {active === "org" && <OrgUnitsView />}
    </div>
  );
}
