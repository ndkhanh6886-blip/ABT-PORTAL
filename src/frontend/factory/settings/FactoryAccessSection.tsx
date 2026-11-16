"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Factory } from "lucide-react";
import { api, useFactoryMe } from "../api";
import { ErrorNote, inputClass } from "../ui";
import type { Role } from "./RolesView";

interface Grant {
  id: string;
  role_id: string;
  role_code?: string;
  role_name: string;
  scope_org_unit_id: string | null;
  scope_name: string | null;
  scope_module_key?: string | null;
  scope_unit_type?: string | null;
}
interface FactoryUser {
  id: number;
  username: string;
  role?: string;
  grants: Grant[];
  excluded_permissions?: string[];
}
interface OrgUnit {
  id: string;
  code: string;
  name: string;
  unit_type?: string;
  parent_id?: string | null;
  module_key: string | null;
  status: string;
}
interface Permission {
  code: string;
  module: string;
  description: string;
  is_gxp_critical: boolean;
}

const QA_CROSS_DEPT_SET = new Set([
  "master.data.view",
  "inv.stock.view",
  "inv.lot.sample",
  "inv.lot.release",
  "inv.lot.hold",
  "inv.lot.reject",
  "kit.view",
  "kit.bom.approve",
  "kit.ebr.check",
  "kit.order.release",
  "kit.quality.manage",
  "oligo.view",
  "device.view",
  "device.eco.approve",
  "device.unit.release",
  "device.qa.release",
  "rd.view",
  "rd.gate.review",
]);

const WH_CROSS_DEPT_SET = new Set([
  "master.data.view",
  "master.item.manage",
  "master.partner.manage",
  "purchase.po.view",
  "purchase.po.manage",
  "purchase.pr.view",
  "purchase.receipt.post",
  "inv.stock.view",
  "intake.order.view",
  "intake.shipment.post",
]);

function grantAppliesToDept(grant: Grant, permCode: string, deptUnitKey: string | null, allUnits: OrgUnit[]): boolean {
  if (!grant.scope_org_unit_id || grant.scope_unit_type === "COMPANY") return true;
  if (grant.scope_module_key === "QA" && (permCode.startsWith("qms.") || QA_CROSS_DEPT_SET.has(permCode))) {
    return true;
  }
  if ((grant.scope_module_key === "WH" || grant.scope_module_key === "PURCHASE") && WH_CROSS_DEPT_SET.has(permCode)) {
    return true;
  }
  if (!deptUnitKey) {
    if (permCode.startsWith("core.")) return false;
    if (permCode.startsWith("purchase.po.") || permCode === "purchase.receipt.post") return false;
    return true;
  }
  const target = allUnits.find((u) => u.module_key === deptUnitKey);
  if (!target) return grant.scope_module_key === deptUnitKey;
  let cur: OrgUnit | undefined = target;
  const visited = new Set<string>();
  while (cur && !visited.has(cur.id)) {
    if (cur.id === grant.scope_org_unit_id) return true;
    visited.add(cur.id);
    cur = cur.parent_id ? allUnits.find((u) => u.id === cur!.parent_id) : undefined;
  }
  return false;
}

/** Khối Kỹ thuật – Nhà máy: each department / function and the permission modules that open its tab. */
export const FACTORY_DEPTS: { key: string; short: string; name: string; modules: string[]; unit: string | null }[] = [
  { key: "rd", short: "Nghiên cứu R&D", name: "Phòng Nghiên cứu & Phát triển (P-RD)", modules: ["rd", "work"], unit: "RD" },
  { key: "kit", short: "Sản xuất Kit", name: "Phòng Sản xuất Kit IVD (P-KIT)", modules: ["kit"], unit: "KIT" },
  { key: "oligo", short: "Tổng hợp Oligo", name: "Phòng Tổng hợp Oligo (P-OLIGO)", modules: ["oligo", "prep", "plan"], unit: "OLIGO" },
  { key: "device", short: "KTCN – Thiết bị", name: "Phòng Kỹ thuật Công nghệ & Thiết bị (P-DEVICE)", modules: ["device", "asset"], unit: "DEVICE" },
  { key: "qa", short: "QC/QA Nhà máy", name: "Phòng Đảm bảo & Kiểm soát Chất lượng ISO 13485 (P-QA)", modules: ["qms"], unit: "QA" },
  { key: "wh", short: "Kho Nhà máy (P-KHO)", name: "Kho NVL, Hóa chất, BTP & Thành phẩm SX (Khối Kỹ thuật)", modules: ["inv", "master"], unit: "WH" },
  { key: "purchase", short: "Cung ứng Kỹ thuật (P-KHO)", name: "Mua sắm NVL / Hóa chất Sản xuất & NCC Kỹ thuật", modules: ["purchase"], unit: null },
  { key: "intake", short: "Đơn Nội Bộ (KD ↔ NM)", name: "Tiếp nhận & Điều phối Đơn đặt hàng nội bộ", modules: ["intake"], unit: null },
  { key: "core", short: "Quản trị Nhà máy", name: "Vai trò 21 CFR Part 11, Ủy quyền & Nhật ký kiểm toán", modules: ["core"], unit: null },
];

const inDept = (d: (typeof FACTORY_DEPTS)[number], code: string) => d.modules.includes(code.split(".")[0]);

/** Factory grants of one portal user, the roles and catalogue behind them (queries shared by the cards and the feature list). */
function useFactoryAccess(userId: number, username: string) {
  const users = useQuery({
    queryKey: ["factory", "users", username],
    queryFn: () => api<FactoryUser[]>(`/api/factory/users?q=${encodeURIComponent(username)}`),
    retry: false,
  });
  const roles = useQuery({ queryKey: ["factory", "roles"], queryFn: () => api<Role[]>("/api/factory/roles"), retry: false });
  const units = useQuery({ queryKey: ["factory", "org-units"], queryFn: () => api<OrgUnit[]>("/api/factory/org-units"), retry: false });
  const catalogue = useQuery({ queryKey: ["factory", "permissions"], queryFn: () => api<Permission[]>("/api/factory/permissions"), retry: false });

  const matchedUser = users.data?.find((u) => Number(u.id) === Number(userId) || u.username?.toLowerCase() === username?.toLowerCase());
  const user: FactoryUser | undefined = matchedUser ?? (users.data ? { id: userId, username, grants: [], excluded_permissions: [] } : undefined);
  const roleById = useMemo(() => new Map((roles.data ?? []).map((r) => [r.id, r])), [roles.data]);
  const allUnits = useMemo(() => units.data ?? [], [units.data]);
  const customRoleCode = `USER_CUSTOM_${userId}`;
  const excludedSet = useMemo(() => new Set(user?.excluded_permissions ?? []), [user?.excluded_permissions]);

  // Helper computing effective inherited roles for (deptUnitKey, permissionCode) plus personal overrides
  const { customPermSet, inheritedRolesFor } = useMemo(() => {
    const customSet = new Set<string>();
    const nonCustomGrants: { grant: Grant; perms: Set<string> }[] = [];
    for (const g of user?.grants ?? []) {
      const roleObj = roleById.get(g.role_id);
      const rCode = g.role_code ?? roleObj?.code ?? "";
      if (rCode === customRoleCode) {
        for (const p of roleObj?.permissions ?? []) customSet.add(p);
      } else {
        nonCustomGrants.push({ grant: g, perms: new Set(roleObj?.permissions ?? []) });
      }
    }
    const getInherited = (permCode: string, deptUnitKey: string | null): string[] => {
      const names: string[] = [];
      for (const item of nonCustomGrants) {
        if (!item.perms.has(permCode)) continue;
        if (grantAppliesToDept(item.grant, permCode, deptUnitKey, allUnits)) {
          names.push(item.grant.role_name);
        }
      }
      if (permCode === "intake.order.view" && names.length === 0) {
        names.push("Mặc định nội bộ");
      }
      return [...new Set(names)];
    };
    return { customPermSet: customSet, inheritedRolesFor: getInherited };
  }, [user, roleById, customRoleCode, allUnits]);

  const isPermActiveInDept = useMemo(
    () => (permCode: string, deptUnitKey: string | null, isRoot: boolean) => {
      if (isRoot) return true;
      if (excludedSet.has(permCode)) return false;
      if (customPermSet.has(permCode)) return true;
      return inheritedRolesFor(permCode, deptUnitKey).length > 0;
    },
    [excludedSet, customPermSet, inheritedRolesFor]
  );

  return {
    user,
    roles: roles.data,
    roleById,
    allUnits,
    units: allUnits.filter((u) => u.status === "ACTIVE"),
    catalogue: catalogue.data,
    excludedSet,
    customPermSet,
    inheritedRolesFor,
    isPermActiveInDept,
    error: users.error ?? roles.error ?? units.error ?? catalogue.error,
    ready: Boolean(users.data && roles.data && catalogue.data),
  };
}

const DEFAULT_DEPT_ENTRY_PERMS: Record<string, string[]> = {
  rd: ["rd.view"],
  kit: ["kit.view"],
  oligo: ["oligo.view"],
  device: ["device.view"],
  qa: ["qms.qc.view"],
  wh: ["inv.stock.view", "master.data.view"],
  purchase: ["purchase.pr.view", "purchase.po.view"],
  intake: ["intake.order.view"],
  core: ["core.audit.view"],
};

/**
 * Factory access of one portal user inside "Phân Quyền Chi Tiết Cá Nhân". Admins can either toggle a
 * whole department card on/off in 1 click (per-user enable/exclusion, without stripping their primary role
 * elsewhere) or expand a card to grant/revoke roles.
 */
export function FactoryAccessSection({ userId, username, isRootAdmin }: { userId: number; username: string; isRootAdmin: boolean }) {
  const qc = useQueryClient();
  const me = useFactoryMe();
  const { user, roles, roleById, allUnits, units, catalogue, excludedSet, customPermSet, inheritedRolesFor, isPermActiveInDept, error, ready } =
    useFactoryAccess(userId, username);
  const [open, setOpen] = useState<string | null>(null);
  const [form, setForm] = useState<{ dept: string; roleId: string; scope: string }>({ dept: "", roleId: "", scope: "" });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["factory", "users"] });
    qc.invalidateQueries({ queryKey: ["factory", "roles"] });
    qc.invalidateQueries({ queryKey: ["factory", "me"] });
  };
  const grant = useMutation({
    mutationFn: () =>
      api(`/api/factory/users/${userId}/roles`, { method: "POST", idempotent: true, json: { role_id: form.roleId, scope_org_unit_id: form.scope || null } }),
    onSuccess: () => {
      setForm({ dept: "", roleId: "", scope: "" });
      refresh();
    },
  });
  const revoke = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => api(`/api/factory/user-roles/${id}/revoke`, { method: "POST", json: { reason } }),
    onSuccess: refresh,
  });
  const toggleDeptMut = useMutation({
    mutationFn: (arg: { codes: string[]; enabled: boolean; reason: string }) =>
      api(`/api/factory/users/${userId}/permissions`, {
        method: "POST",
        json: { permission_codes: arg.codes, enabled: arg.enabled, reason: arg.reason },
      }),
    onSuccess: refresh,
  });
  const isSelf = me.data?.profile.user_id === userId;
  const canToggleDept = !isRootAdmin && (!isSelf || Boolean(me.data?.is_root));

  return (
    <div className="bg-gradient-to-br from-teal-50/80 via-white to-slate-50 dark:from-slate-800/80 dark:via-slate-850/60 dark:to-slate-900 rounded-2xl border-2 border-teal-500/40 p-5 space-y-4 shadow-sm">
      <div className="flex items-center gap-3 pb-3 border-b border-teal-200/60 dark:border-teal-900/60">
        <div className="w-9 h-9 rounded-xl bg-teal-600 text-white flex items-center justify-center shadow-md shadow-teal-500/20 shrink-0">
          <Factory className="w-5 h-5" />
        </div>
        <div>
          <h4 className="font-extrabold text-sm text-slate-900 dark:text-white flex items-center gap-2 flex-wrap">
            <span>Khối Kỹ thuật – Nhà máy</span>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300 border border-teal-200 dark:border-teal-800">
              Cấp theo vai trò · GMP / 21 CFR Part 11
            </span>
          </h4>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
            Gạt công tắc <strong>Bật/Tắt</strong> ở góc phải từng thẻ để mở hoặc khóa nhanh quyền vào phòng cho riêng cá nhân này (không làm mất vai trò chính ở phòng khác), hoặc bấm vào tên phòng để cấp / thu hồi vai trò. Lưu ý: <strong>Kho Nhà máy &amp; Cung ứng Kỹ thuật (P-KHO)</strong> tách biệt hoàn toàn với <strong>Kho Kinh Doanh &amp; Cung Ứng Kinh Doanh</strong> ở trên.
          </p>
        </div>
      </div>

      {error ? (
        <ErrorNote error={error} />
      ) : !ready || !user || !roles || !catalogue ? (
        <div className="text-xs text-slate-400">Đang tải quyền nhà máy…</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {FACTORY_DEPTS.map((d) => {
            const perms = catalogue.filter((p) => d.modules.includes(p.module));
            const heldCount = perms.filter((p) => isPermActiveInDept(p.code, d.unit, isRootAdmin)).length;
            const customInDeptCount = perms.filter((p) => customPermSet.has(p.code) && !excludedSet.has(p.code)).length;
            const grants = user.grants.filter(
              (g) =>
                !g.role_code?.startsWith("USER_CUSTOM_") &&
                (roleById.get(g.role_id)?.permissions ?? []).some((c) => inDept(d, c) && grantAppliesToDept(g, c, d.unit, allUnits))
            );
            const roleChoices = roles.filter(
              (r) => r.status === "ACTIVE" && !r.code.startsWith("USER_CUSTOM_") && r.permissions.some((c) => inDept(d, c))
            );
            const deptUnit = units.find((u) => u.module_key === d.unit);
            const expanded = open === d.key;
            const on = heldCount > 0;
            const handleQuickToggle = (e: React.MouseEvent | React.KeyboardEvent) => {
              e.stopPropagation();
              if (!canToggleDept || toggleDeptMut.isPending || perms.length === 0) return;
              if (on) {
                toggleDeptMut.mutate({
                  codes: perms.map((p) => p.code),
                  enabled: false,
                  reason: `Khóa quyền vào phân hệ ${d.short}`,
                });
              } else {
                const excludedInherited = perms
                  .filter((p) => excludedSet.has(p.code) && inheritedRolesFor(p.code, d.unit).length > 0)
                  .map((p) => p.code);
                const defaults = (DEFAULT_DEPT_ENTRY_PERMS[d.key] ?? perms.slice(0, 1).map((p) => p.code)).filter((c) =>
                  perms.some((p) => p.code === c)
                );
                const codesToEnable = excludedInherited.length > 0 ? excludedInherited : defaults;
                if (codesToEnable.length > 0) {
                  toggleDeptMut.mutate({
                    codes: codesToEnable,
                    enabled: true,
                    reason: `Mở quyền vào phân hệ ${d.short}`,
                  });
                }
                setOpen(d.key);
              }
            };
            return (
              <div
                key={d.key}
                className={`p-3.5 rounded-xl border-2 flex flex-col gap-2 transition-all ${expanded ? "md:col-span-2 lg:col-span-3" : ""} ${
                  on ? "bg-white dark:bg-slate-800 border-teal-500 ring-2 ring-teal-500/20" : "bg-slate-50/60 dark:bg-slate-850/40 border-slate-200 dark:border-slate-800"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setOpen(expanded ? null : d.key)}
                    className="flex-1 text-left cursor-pointer min-w-0"
                  >
                    <div className={`text-xs font-black ${on ? "text-slate-900 dark:text-white" : "text-slate-600 dark:text-slate-400"}`}>{d.short}</div>
                    <div className="text-[10px] text-slate-400 font-medium">{d.name}</div>
                  </button>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {canToggleDept && perms.length > 0 && (
                      <button
                        type="button"
                        role="switch"
                        aria-checked={on}
                        disabled={toggleDeptMut.isPending}
                        onClick={handleQuickToggle}
                        title={
                          on
                            ? `Bấm để khóa toàn bộ quyền vào "${d.short}" cho riêng cá nhân này`
                            : `Bấm để mở quyền vào "${d.short}"`
                        }
                        aria-label={on ? `Khóa ${d.short}` : `Mở ${d.short}`}
                        className={`w-9 h-5 rounded-full transition-colors p-0.5 shrink-0 cursor-pointer disabled:opacity-50 ${
                          on ? "bg-teal-600 hover:bg-teal-500" : "bg-slate-300 dark:bg-slate-700 hover:bg-slate-400"
                        }`}
                      >
                        <div
                          className={`w-4 h-4 rounded-full bg-white transition-transform ${
                            on ? "translate-x-4 shadow-sm" : "translate-x-0"
                          }`}
                        />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setOpen(expanded ? null : d.key)}
                      aria-label={expanded ? `Thu gọn ${d.short}` : `Mở rộng ${d.short}`}
                      className="p-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 cursor-pointer"
                    >
                      {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800 text-[10px]">
                  <span className={`font-bold ${on ? "text-emerald-600 dark:text-emerald-400" : "text-slate-400"}`}>{on ? "✓ ĐƯỢC PHÉP VÀO" : "✕ ĐANG KHÓA TAB"}</span>
                  <span className="text-slate-400 font-mono">
                    {heldCount}/{perms.length} tính năng
                  </span>
                </div>

                {expanded && (
                  <div className="flex flex-col gap-3 pt-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap gap-1.5 items-center">
                        {isRootAdmin && <span className="text-[11px] text-amber-700 dark:text-amber-300">Root admin · toàn quyền nhà máy.</span>}
                        {!isRootAdmin && grants.length === 0 && customInDeptCount === 0 && (
                          <span className="text-[11px] text-slate-400">Chưa có vai trò nào của phòng này.</span>
                        )}
                        {customInDeptCount > 0 && (
                          <span className="px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-[11px] text-emerald-700 dark:text-emerald-300 font-semibold">
                            Cấp riêng cá nhân · {customInDeptCount} quyền
                          </span>
                        )}
                        {grants.map((g) => (
                          <span key={g.id} className="flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full bg-teal-50 dark:bg-teal-950/40 border border-teal-200 dark:border-teal-900 text-[11px] text-teal-800 dark:text-teal-200">
                            {g.role_name} · {g.scope_name ?? "toàn công ty"}
                            {!isSelf && (
                              <button
                                type="button"
                                className="ml-1 w-5 h-5 rounded-full hover:bg-teal-200 dark:hover:bg-teal-900 cursor-pointer"
                                title="Thu hồi vai trò"
                                onClick={() => {
                                  const reason = window.prompt(`Lý do thu hồi vai trò "${g.role_name}":`);
                                  if (reason) revoke.mutate({ id: g.id, reason });
                                }}
                              >
                                ×
                              </button>
                            )}
                          </span>
                        ))}
                      </div>
                      {canToggleDept && perms.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                          {on ? (
                            <button
                              type="button"
                              disabled={toggleDeptMut.isPending}
                              onClick={() =>
                                toggleDeptMut.mutate({
                                  codes: perms.map((p) => p.code),
                                  enabled: false,
                                  reason: `Khóa tab ${d.short} (tắt toàn bộ ${perms.length} quyền của phân hệ)`,
                                })
                              }
                              className="px-2.5 py-1 rounded-lg bg-rose-50 dark:bg-rose-950/50 hover:bg-rose-100 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-[11px] font-bold cursor-pointer disabled:opacity-50"
                            >
                              Khóa tab phòng này (Tắt hết)
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={toggleDeptMut.isPending}
                              onClick={handleQuickToggle}
                              className="px-2.5 py-1 rounded-lg bg-teal-50 dark:bg-teal-950/50 hover:bg-teal-100 border border-teal-200 dark:border-teal-800 text-teal-700 dark:text-teal-300 text-[11px] font-bold cursor-pointer disabled:opacity-50"
                            >
                              Mở tab (Quyền xem)
                            </button>
                          )}
                          {heldCount < perms.length && (
                            <button
                              type="button"
                              disabled={toggleDeptMut.isPending}
                              onClick={() =>
                                toggleDeptMut.mutate({
                                  codes: perms.map((p) => p.code),
                                  enabled: true,
                                  reason: `Bật đủ ${perms.length} tính năng trong phân hệ ${d.short}`,
                                })
                              }
                              className="px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 hover:bg-emerald-100 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-[11px] font-bold cursor-pointer disabled:opacity-50"
                            >
                              Bật đủ {perms.length} tính năng
                            </button>
                          )}
                        </div>
                      )}
                    </div>

                    {isSelf ? (
                      <p className="text-[11px] text-slate-400">Không tự cấp quyền nhà máy cho chính mình — nhờ một quản trị viên khác.</p>
                    ) : (
                      <form
                        className="flex flex-wrap gap-2"
                        onSubmit={(e) => {
                          e.preventDefault();
                          grant.mutate();
                        }}
                      >
                        <select
                          className={`${inputClass} flex-1 min-w-48`}
                          value={form.dept === d.key ? form.roleId : ""}
                          onChange={(e) => setForm({ dept: d.key, roleId: e.target.value, scope: form.dept === d.key ? form.scope : deptUnit?.id ?? "" })}
                          required
                          aria-label="Vai trò"
                        >
                          <option value="">Chọn vai trò để cấp…</option>
                          {roleChoices.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.name}
                            </option>
                          ))}
                        </select>
                        <select
                          className={`${inputClass} flex-1 min-w-48`}
                          value={form.dept === d.key ? form.scope : deptUnit?.id ?? ""}
                          onChange={(e) => setForm({ dept: d.key, roleId: form.dept === d.key ? form.roleId : "", scope: e.target.value })}
                          aria-label="Phạm vi"
                        >
                          <option value="">Toàn công ty</option>
                          {units.map((u) => (
                            <option key={u.id} value={u.id}>
                              Chỉ {u.name}
                            </option>
                          ))}
                        </select>
                        <button
                          type="submit"
                          disabled={grant.isPending || form.dept !== d.key || !form.roleId}
                          className="px-3 py-1.5 rounded-xl bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white text-xs font-bold cursor-pointer"
                        >
                          Cấp vai trò
                        </button>
                      </form>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <ErrorNote error={grant.error ?? revoke.error ?? toggleDeptMut.error} />
    </div>
  );
}

/**
 * Interactive feature list of Khối Kỹ thuật – Nhà máy in "Phân Quyền Tính Năng Chi Tiết Trong Từng Phân Hệ".
 * Respects role scope isolation and allows admins to grant, revoke (even for role-inherited permissions),
 * bulk-toggle a department, or reset overrides per user — applied immediately and audited.
 */
export function FactoryFeatureGroups({
  userId,
  username,
  isRootAdmin,
  startIndex,
  onSummaryChange,
}: {
  userId: number;
  username: string;
  isRootAdmin: boolean;
  startIndex: number;
  onSummaryChange?: (summary: { active: number; total: number }) => void;
}) {
  const qc = useQueryClient();
  const me = useFactoryMe();
  const { roles, catalogue, excludedSet, customPermSet, inheritedRolesFor, isPermActiveInDept, error, ready } =
    useFactoryAccess(userId, username);

  const togglePermMut = useMutation({
    mutationFn: (arg: { code?: string; codes?: string[]; enabled?: boolean; resetOverrides?: boolean; reason?: string }) =>
      api(`/api/factory/users/${userId}/permissions`, {
        method: "POST",
        json: arg.resetOverrides
          ? { reset_overrides: true, reason: arg.reason ?? "Khôi phục phân quyền chi tiết theo vai trò gốc" }
          : arg.codes
            ? { permission_codes: arg.codes, enabled: Boolean(arg.enabled), reason: arg.reason ?? "Cập nhật nhanh nhóm quyền cá nhân" }
            : { permission_code: arg.code, enabled: Boolean(arg.enabled), reason: arg.reason ?? "Cấu hình phân quyền chi tiết cá nhân" },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["factory", "users"] });
      qc.invalidateQueries({ queryKey: ["factory", "roles"] });
      qc.invalidateQueries({ queryKey: ["factory", "me"] });
    },
  });
  const isSelf = me.data?.profile.user_id === userId;
  const canEditCustom = !isRootAdmin && (!isSelf || Boolean(me.data?.is_root));
  const hasPersonalOverrides = customPermSet.size > 0 || excludedSet.size > 0;

  const summary = useMemo(() => {
    if (!ready || !catalogue) return null;
    let total = 0;
    let active = 0;
    for (const d of FACTORY_DEPTS) {
      const perms = catalogue.filter((p) => d.modules.includes(p.module));
      total += perms.length;
      active += perms.filter((p) => isPermActiveInDept(p.code, d.unit, isRootAdmin)).length;
    }
    return { active, total };
  }, [ready, catalogue, isPermActiveInDept, isRootAdmin]);

  useEffect(() => {
    if (ready && summary) {
      onSummaryChange?.(summary);
    }
  }, [ready, summary, onSummaryChange]);

  if (error) return <ErrorNote error={error} />;
  if (!ready || !catalogue || !roles) return <div className="text-xs text-slate-400">Đang tải tính năng Khối Kỹ thuật – Nhà máy…</div>;

  return (
    <>
      {togglePermMut.error && <ErrorNote error={togglePermMut.error} />}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-teal-200/80 dark:border-teal-900/60 bg-teal-50/50 dark:bg-teal-950/20 px-3.5 py-2 text-[11px]">
        <span className="text-teal-900 dark:text-teal-200 font-medium">
          ⚡ Thay đổi ở <strong>Khối Kỹ thuật – Nhà máy</strong> có hiệu lực ngay và tự động lưu <strong>Audit Trail 21 CFR Part 11</strong> (có thể tích/bỏ tích lẻ cả quyền kế thừa từ vai trò).
        </span>
        {canEditCustom && hasPersonalOverrides && (
          <button
            type="button"
            disabled={togglePermMut.isPending}
            onClick={() => togglePermMut.mutate({ resetOverrides: true })}
            className="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 border border-teal-300 dark:border-teal-700 text-teal-800 dark:text-teal-200 font-bold hover:bg-teal-100/60 cursor-pointer shrink-0 disabled:opacity-50"
          >
            ↺ Khôi phục theo vai trò gốc
          </button>
        )}
      </div>

      {FACTORY_DEPTS.map((d, i) => {
        const perms = catalogue.filter((p) => d.modules.includes(p.module));
        if (!perms.length) return null;
        const activeCount = perms.filter((p) => isPermActiveInDept(p.code, d.unit, isRootAdmin)).length;
        return (
          <div key={d.key} className="bg-teal-50/30 dark:bg-slate-800/30 rounded-2xl border border-teal-200/70 dark:border-teal-900/60 p-4 space-y-3">
            <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-200 dark:border-slate-700/60 flex-wrap">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-extrabold text-sm text-slate-900 dark:text-white">
                  {startIndex + i}. {d.short} <span className="text-teal-700 dark:text-teal-300">(Khối Kỹ thuật)</span>
                </span>
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold ${
                    activeCount === perms.length
                      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                      : activeCount > 0
                        ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                        : "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-400"
                  }`}
                >
                  {activeCount}/{perms.length} quyền kích hoạt
                </span>
              </div>
              {canEditCustom ? (
                <div className="flex items-center gap-2 text-xs">
                  <button
                    type="button"
                    disabled={togglePermMut.isPending}
                    onClick={() => togglePermMut.mutate({ codes: perms.map((p) => p.code), enabled: true })}
                    className="text-[11px] text-teal-700 dark:text-teal-300 font-bold hover:underline cursor-pointer disabled:opacity-50"
                  >
                    Chọn nhóm này
                  </button>
                  <span className="text-slate-300 dark:text-slate-600">|</span>
                  <button
                    type="button"
                    disabled={togglePermMut.isPending}
                    onClick={() => togglePermMut.mutate({ codes: perms.map((p) => p.code), enabled: false })}
                    className="text-[11px] text-slate-500 font-bold hover:underline cursor-pointer disabled:opacity-50"
                  >
                    Bỏ chọn nhóm
                  </button>
                </div>
              ) : (
                <span className="text-[11px] text-slate-400">
                  {isRootAdmin ? "Tài khoản Root Admin mặc định có toàn quyền" : "Nhờ quản trị viên khác để chỉnh sửa quyền của chính bạn"}
                </span>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {perms.map((p) => {
                const inheritedRoles = inheritedRolesFor(p.code, d.unit);
                const isExcluded = excludedSet.has(p.code);
                const isInheritedActive = inheritedRoles.length > 0 && !isExcluded;
                const isCustomActive = customPermSet.has(p.code) && !isExcluded;
                const checked = isPermActiveInDept(p.code, d.unit, isRootAdmin);
                const interactive = canEditCustom;
                const carriers = roles
                  .filter((r) => r.status === "ACTIVE" && !r.code.startsWith("USER_CUSTOM_") && r.permissions.includes(p.code))
                  .map((r) => r.name);
                return (
                  <label
                    key={p.code}
                    title={
                      isRootAdmin
                        ? "Tài khoản Root Admin mặc định có toàn quyền"
                        : !interactive
                          ? "Không thể tự chỉnh sửa quyền cho chính mình"
                          : isInheritedActive
                            ? `Đang bật theo vai trò (${inheritedRoles.join(", ")}). Bấm để tắt riêng cho cá nhân này.`
                            : isExcluded && inheritedRoles.length > 0
                              ? `Đã tắt riêng cá nhân (mặc dù vai trò ${inheritedRoles.join(", ")} có). Bấm để bật lại.`
                              : isCustomActive
                                ? "Đang bật cấp riêng cho cá nhân này. Bấm để thu hồi."
                                : "Chưa cấp quyền. Bấm để cấp riêng quyền này cho cá nhân."
                    }
                    className={`p-3 rounded-xl border-2 flex items-start gap-3 transition-colors ${
                      interactive ? "cursor-pointer" : ""
                    } ${
                      checked
                        ? "bg-emerald-50/50 dark:bg-emerald-950/25 border-emerald-400 dark:border-emerald-700 shadow-xs"
                        : isExcluded && inheritedRoles.length > 0
                          ? "bg-rose-50/40 dark:bg-rose-950/15 border-rose-200 dark:border-rose-900/70"
                          : "bg-white/70 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700/60 hover:border-teal-300"
                    }`}
                  >
                    {interactive ? (
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={togglePermMut.isPending}
                        onChange={() => togglePermMut.mutate({ code: p.code, enabled: !checked })}
                        className="mt-0.5 rounded accent-emerald-600 w-4 h-4 shrink-0 cursor-pointer"
                        aria-label={p.description}
                      />
                    ) : (
                      <span
                        aria-label={checked ? "Đang được cấp quyền" : "Chưa cấp quyền"}
                        className={`mt-0.5 w-4 h-4 rounded flex items-center justify-center text-[10px] font-extrabold shrink-0 ${
                          checked
                            ? "bg-emerald-600 text-white"
                            : "bg-slate-200 dark:bg-slate-700 text-slate-400"
                        }`}
                      >
                        {checked ? "✓" : ""}
                      </span>
                    )}
                    <div className="space-y-0.5 flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <span className={`text-xs font-bold ${checked ? "text-slate-900 dark:text-white" : "text-slate-600 dark:text-slate-400"}`}>{p.description}</span>
                        <span className="text-[9px] font-mono text-slate-400 shrink-0">{p.code}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-slate-500 dark:text-slate-400">
                        {p.is_gxp_critical && <span className="px-1.5 rounded bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 font-bold">GxP · ký điện tử</span>}
                        {isRootAdmin ? (
                          <span className="text-emerald-700 dark:text-emerald-400 font-semibold">✓ Đang cấp · Admin gốc (toàn quyền)</span>
                        ) : isInheritedActive ? (
                          <span className="text-emerald-700 dark:text-emerald-400 font-semibold">✓ Đang cấp · Theo vai trò ({inheritedRoles.join(", ")})</span>
                        ) : isCustomActive ? (
                          <span className="text-teal-700 dark:text-teal-300 font-semibold">✓ Đang cấp · Cấp riêng cá nhân</span>
                        ) : isExcluded && inheritedRoles.length > 0 ? (
                          <span className="text-rose-700 dark:text-rose-400 font-semibold">✕ Đã tắt riêng cá nhân (vai trò gốc: {inheritedRoles.join(", ")})</span>
                        ) : (
                          <span>Chưa cấp quyền · Vai trò chuẩn: {carriers.length ? carriers.join(", ") : "—"}</span>
                        )}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>
        );
      })}
    </>
  );
}
