"use client";

import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Factory } from "lucide-react";
import { api, useFactoryMe } from "../api";
import { ErrorNote, inputClass } from "../ui";
import type { Role } from "./RolesView";

interface Grant {
  id: string;
  role_id: string;
  role_name: string;
  scope_org_unit_id: string | null;
  scope_name: string | null;
}
interface FactoryUser {
  id: number;
  username: string;
  role?: string;
  grants: Grant[];
}
interface OrgUnit {
  id: string;
  code: string;
  name: string;
  module_key: string | null;
  status: string;
}
interface Permission {
  code: string;
  module: string;
  description: string;
  is_gxp_critical: boolean;
}

/** Khối Kỹ thuật – Nhà máy: each department / function and the permission modules that open its tab. */
export const FACTORY_DEPTS: { key: string; short: string; name: string; modules: string[]; unit: string | null }[] = [
  { key: "rd", short: "Nghiên cứu R&D", name: "Phòng Nghiên cứu & Phát triển", modules: ["rd", "work"], unit: "RD" },
  { key: "kit", short: "Sản xuất Kit", name: "Phòng Sản xuất Kit Chẩn đoán", modules: ["kit"], unit: "KIT" },
  { key: "oligo", short: "Tổng hợp Oligo", name: "Phòng Tổng hợp Oligo", modules: ["oligo", "prep", "plan"], unit: "OLIGO" },
  { key: "device", short: "Kỹ thuật – Thiết bị", name: "Phòng Kỹ thuật – Thiết bị", modules: ["device", "asset"], unit: "DEVICE" },
  { key: "qa", short: "QA/QC", name: "Phòng Đảm bảo & Kiểm soát Chất lượng", modules: ["qms"], unit: "QA" },
  { key: "wh", short: "Kho Nhà máy", name: "Kho Vật tư & Thành phẩm Nhà máy", modules: ["inv", "master"], unit: "WH" },
  { key: "purchase", short: "Mua hàng Nhà máy", name: "Mua hàng & Nhà cung cấp Nhà máy", modules: ["purchase"], unit: null },
  { key: "intake", short: "Đơn Nội Bộ", name: "Tiếp nhận & điều phối đơn nội bộ", modules: ["intake"], unit: null },
  { key: "core", short: "Quản trị Nhà máy", name: "Vai trò, ủy quyền, nhật ký kiểm toán", modules: ["core"], unit: null },
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

  const user = users.data?.find((u) => u.id === userId);
  const roleById = useMemo(() => new Map((roles.data ?? []).map((r) => [r.id, r])), [roles.data]);
  // permission code → where it is held ("toàn công ty" / department names)
  const held = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const g of user?.grants ?? []) {
      for (const p of roleById.get(g.role_id)?.permissions ?? []) m.set(p, [...(m.get(p) ?? []), g.scope_name ?? "toàn công ty"]);
    }
    return m;
  }, [user, roleById]);

  return {
    user,
    roles: roles.data,
    roleById,
    units: (units.data ?? []).filter((u) => u.status === "ACTIVE"),
    catalogue: catalogue.data,
    held,
    error: users.error ?? roles.error ?? units.error ?? catalogue.error,
    ready: Boolean(user && roles.data && catalogue.data),
  };
}

/**
 * Factory access of one portal user inside "Phân Quyền Chi Tiết Cá Nhân". Factory permissions come only from
 * roles (scoped to a department, audited, GMP / 21 CFR Part 11), so a department is opened by granting /
 * revoking a role, which takes effect at once — not with the portal "Lưu" button.
 */
export function FactoryAccessSection({ userId, username, isRootAdmin }: { userId: number; username: string; isRootAdmin: boolean }) {
  const qc = useQueryClient();
  const me = useFactoryMe();
  const { user, roles, roleById, units, catalogue, held, error, ready } = useFactoryAccess(userId, username);
  const [open, setOpen] = useState<string | null>(null);
  const [form, setForm] = useState<{ dept: string; roleId: string; scope: string }>({ dept: "", roleId: "", scope: "" });

  const refresh = () => qc.invalidateQueries({ queryKey: ["factory", "users"] });
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
  const isSelf = me.data?.profile.user_id === userId;

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
            Bấm vào phòng để cấp / thu hồi vai trò (có hiệu lực ngay, ghi nhật ký kiểm toán). Tính năng chi tiết của từng phòng xem ở phần bên dưới.
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
            const heldCount = isRootAdmin ? perms.length : perms.filter((p) => held.has(p.code)).length;
            const grants = user.grants.filter((g) => roleById.get(g.role_id)?.permissions.some((c) => inDept(d, c)));
            const roleChoices = roles.filter((r) => r.status === "ACTIVE" && r.permissions.some((c) => inDept(d, c)));
            const deptUnit = units.find((u) => u.module_key === d.unit);
            const expanded = open === d.key;
            const on = heldCount > 0;
            return (
              <div
                key={d.key}
                className={`p-3.5 rounded-xl border-2 flex flex-col gap-2 transition-all ${expanded ? "md:col-span-2 lg:col-span-3" : ""} ${
                  on ? "bg-white dark:bg-slate-800 border-teal-500 ring-2 ring-teal-500/20" : "bg-slate-50/60 dark:bg-slate-850/40 border-slate-200 dark:border-slate-800"
                }`}
              >
                <button type="button" onClick={() => setOpen(expanded ? null : d.key)} className="flex items-start justify-between gap-2 text-left cursor-pointer">
                  <div>
                    <div className={`text-xs font-black ${on ? "text-slate-900 dark:text-white" : "text-slate-600 dark:text-slate-400"}`}>{d.short}</div>
                    <div className="text-[10px] text-slate-400 font-medium">{d.name}</div>
                  </div>
                  {expanded ? <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" /> : <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />}
                </button>
                <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800 text-[10px]">
                  <span className={`font-bold ${on ? "text-emerald-600 dark:text-emerald-400" : "text-slate-400"}`}>{on ? "✓ ĐƯỢC PHÉP VÀO" : "✕ ĐANG KHÓA TAB"}</span>
                  <span className="text-slate-400 font-mono">
                    {heldCount}/{perms.length} tính năng
                  </span>
                </div>

                {expanded && (
                  <div className="flex flex-col gap-3 pt-1">
                    <div className="flex flex-wrap gap-1.5">
                      {isRootAdmin && <span className="text-[11px] text-amber-700 dark:text-amber-300">Root admin · toàn quyền nhà máy.</span>}
                      {!isRootAdmin && grants.length === 0 && <span className="text-[11px] text-slate-400">Chưa có vai trò nào của phòng này.</span>}
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
      <ErrorNote error={grant.error ?? revoke.error} />
    </div>
  );
}

/**
 * Feature list of the Khối Kỹ thuật – Nhà máy in "Phân Quyền Tính Năng Chi Tiết Trong Từng Phân Hệ", numbered after
 * the portal groups. Read-only ticks: a factory feature is held through a role, and each feature names the roles
 * that carry it so the administrator knows which one to grant above.
 */
export function FactoryFeatureGroups({ userId, username, isRootAdmin, startIndex }: { userId: number; username: string; isRootAdmin: boolean; startIndex: number }) {
  const { roles, catalogue, held, error, ready } = useFactoryAccess(userId, username);
  if (error) return <ErrorNote error={error} />;
  if (!ready || !catalogue || !roles) return <div className="text-xs text-slate-400">Đang tải tính năng Khối Kỹ thuật – Nhà máy…</div>;

  return (
    <>
      {FACTORY_DEPTS.map((d, i) => {
        const perms = catalogue.filter((p) => d.modules.includes(p.module));
        if (!perms.length) return null;
        const activeCount = isRootAdmin ? perms.length : perms.filter((p) => held.has(p.code)).length;
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
              <span className="text-[11px] text-slate-400">Cấp qua vai trò ở mục “Khối Kỹ thuật – Nhà máy”</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {perms.map((p) => {
                const where = isRootAdmin ? ["toàn quyền"] : held.get(p.code);
                const carriers = roles.filter((r) => r.status === "ACTIVE" && r.permissions.includes(p.code)).map((r) => r.name);
                return (
                  <div
                    key={p.code}
                    title={carriers.length ? `Có trong vai trò: ${carriers.join(", ")}` : "Chưa vai trò nào chứa quyền này"}
                    className={`p-3 rounded-xl border flex items-start gap-3 ${
                      where ? "bg-white dark:bg-slate-800 border-teal-200 dark:border-teal-800/80 shadow-xs" : "bg-white/60 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700/60 opacity-60"
                    }`}
                  >
                    <input type="checkbox" checked={Boolean(where)} disabled readOnly className="mt-0.5 rounded text-teal-600 w-4 h-4 shrink-0" aria-label={p.description} />
                    <div className="space-y-0.5 flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <span className={`text-xs font-bold ${where ? "text-slate-900 dark:text-white" : "text-slate-600 dark:text-slate-400"}`}>{p.description}</span>
                        <span className="text-[9px] font-mono text-slate-400 shrink-0">{p.code}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-slate-500 dark:text-slate-400">
                        {p.is_gxp_critical && <span className="px-1.5 rounded bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 font-bold">GxP · ký điện tử</span>}
                        {where ? <span>Đang có · {[...new Set(where)].join(", ")}</span> : <span>Vai trò: {carriers.length ? carriers.join(", ") : "—"}</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </>
  );
}
