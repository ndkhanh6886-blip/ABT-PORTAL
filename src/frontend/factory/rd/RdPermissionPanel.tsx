"use client";

import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, useFactoryMe } from "../api";
import { Button, Card, ErrorNote, inputClass, Table } from "../ui";
import type { Role } from "../settings/RolesView";

interface FactoryUserGrant {
  id: string;
  role_id: string;
  role_code: string;
  role_name: string;
  scope_org_unit_id: string | null;
  scope_name: string | null;
  scope_module_key?: string | null;
  scope_unit_type?: string | null;
}

interface FactoryUserRow {
  id: number;
  username: string;
  full_name: string;
  department: string | null;
  is_active: boolean;
  role?: string;
  grants: FactoryUserGrant[];
  excluded_permissions?: string[];
}

const RELEVANT_ROLE_CODES = new Set([
  "RD_HEAD",
  "RD_TRUONG_PHONG",
  "RD_STAFF",
  "RD_NGHIEN_CUU_VIEN",
  "DEVICE_HEAD",
  "DEVICE_TRUONG_PHONG",
  "DEVICE_STAFF",
  "DEVICE_KY_SU",
  "QA_HEAD",
  "BAN_GIAM_DOC",
]);

function isRelevantDept(dept: string | null, grants: FactoryUserGrant[]): boolean {
  const d = (dept || "").toLowerCase();
  if (
    d.includes("r&d") ||
    d.includes("nghiên cứu") ||
    d.includes("kỹ thuật") ||
    d.includes("ktcn") ||
    d.includes("thiết bị") ||
    d.includes("qa") ||
    d.includes("qc") ||
    d.includes("giám đốc")
  ) {
    return true;
  }
  return grants.some((g) => RELEVANT_ROLE_CODES.has(g.role_code));
}

export function RdPermissionPanel({
  title,
  editPerm,
  deletePerm,
  editLabel,
  deleteLabel,
  onClose,
}: {
  title: string;
  editPerm: string;
  deletePerm: string;
  editLabel: string;
  deleteLabel: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const me = useFactoryMe();
  const [userSearch, setUserSearch] = useState("");
  const [showAllUsers, setShowAllUsers] = useState(false);

  const rolesQuery = useQuery({
    queryKey: ["factory", "roles"],
    queryFn: () => api<Role[]>("/api/factory/roles"),
  });
  const usersQuery = useQuery({
    queryKey: ["factory", "users", ""],
    queryFn: () => api<FactoryUserRow[]>("/api/factory/users?q="),
  });

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["factory", "roles"] });
    qc.invalidateQueries({ queryKey: ["factory", "users"] });
    qc.invalidateQueries({ queryKey: ["factory", "me"] });
  };

  const toggleRolePermMut = useMutation({
    mutationFn: ({ role, perm, enabled }: { role: Role; perm: string; enabled: boolean }) => {
      const nextPerms = enabled
        ? [...new Set([...role.permissions, perm])].sort()
        : role.permissions.filter((p) => p !== perm);
      return api(`/api/factory/roles/${role.id}`, {
        method: "PATCH",
        json: {
          version: role.version,
          name: role.name,
          description: role.description,
          permissions: nextPerms,
          reason: `Cấu hình quyền "${perm}" từ bảng quản trị R&D`,
        },
      });
    },
    onSuccess: invalidateAll,
  });

  const toggleUserPermMut = useMutation({
    mutationFn: ({ userId, perm, enabled }: { userId: number; perm: string; enabled: boolean }) =>
      api(`/api/factory/users/${userId}/permissions`, {
        method: "POST",
        json: {
          permission_code: perm,
          enabled,
          reason: `Cấu hình quyền "${perm}" trực tiếp trên phân hệ R&D`,
        },
      }),
    onSuccess: invalidateAll,
  });

  const allRoles = rolesQuery.data ?? [];
  const roleById = useMemo(() => new Map(allRoles.map((r) => [r.id, r])), [allRoles]);

  const rdRoles = useMemo(
    () =>
      allRoles.filter(
        (r) =>
          r.status === "ACTIVE" &&
          !r.code.startsWith("USER_CUSTOM_") &&
          (RELEVANT_ROLE_CODES.has(r.code) || r.permissions.some((p) => p.startsWith("rd.")))
      ),
    [allRoles]
  );

  const activeUsers = useMemo(() => {
    const rows = (usersQuery.data ?? []).filter((u) => u.is_active !== false);
    const q = userSearch.trim().toLowerCase();
    const filtered = rows.filter((u) => {
      if (q) {
        const hay = `${u.full_name || ""} ${u.username || ""} ${u.department || ""}`.toLowerCase();
        return hay.includes(q);
      }
      if (showAllUsers) return true;
      return isRelevantDept(u.department, u.grants) || u.role?.toLowerCase() === "admin";
    });
    return filtered.sort((a, b) => {
      const aRel = isRelevantDept(a.department, a.grants) ? 0 : 1;
      const bRel = isRelevantDept(b.department, b.grants) ? 0 : 1;
      if (aRel !== bRel) return aRel - bRel;
      return (a.full_name || a.username).localeCompare(b.full_name || b.username, "vi");
    });
  }, [usersQuery.data, userSearch, showAllUsers]);

  const myUserId = me.data?.profile?.user_id;
  const amIRoot = Boolean(me.data?.is_root);

  return (
    <Card
      title={`🛡️ ${title}`}
      actions={
        <Button variant="ghost" onClick={onClose}>
          Đóng cài đặt
        </Button>
      }
    >
      <ErrorNote error={rolesQuery.error ?? usersQuery.error ?? toggleRolePermMut.error ?? toggleUserPermMut.error} />
      <div className="flex flex-col gap-4 text-xs">
        <div className="rounded-xl border border-amber-200 dark:border-amber-900/70 bg-amber-50/50 dark:bg-amber-950/20 px-3 py-2 text-amber-900 dark:text-amber-200">
          Áp dụng ngay lập tức và tự động ghi Nhật ký kiểm toán (Audit Trail). Quản trị viên có thể bật/tắt theo <b>Vai trò phòng ban</b> hoặc cấp/thu hồi <b>riêng cho từng cá nhân</b>.
        </div>

        {/* Section A: Group Roles */}
        <div className="flex flex-col gap-2">
          <div className="font-bold text-slate-800 dark:text-slate-100">
            1. Phân quyền theo Vai trò phòng ban ({rdRoles.length})
          </div>
          {rdRoles.length > 0 && (
            <Table head={["Vai trò", "Mã", "Nhân sự đang giữ", editLabel, deleteLabel]}>
              {rdRoles.map((r) => {
                const hasEdit = r.permissions.includes(editPerm);
                const hasDelete = r.permissions.includes(deletePerm);
                return (
                  <tr key={r.id}>
                    <td className="py-2 pr-3 font-semibold">{r.name}</td>
                    <td className="py-2 pr-3 font-mono text-slate-500">{r.code}</td>
                    <td className="py-2 pr-3 font-mono">{r.holders} người</td>
                    <td className="py-2 pr-3">
                      <label className="inline-flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={hasEdit}
                          disabled={toggleRolePermMut.isPending}
                          onChange={() => toggleRolePermMut.mutate({ role: r, perm: editPerm, enabled: !hasEdit })}
                          className="w-4 h-4 rounded text-sky-600 cursor-pointer"
                        />
                        <span className={hasEdit ? "text-emerald-700 dark:text-emerald-400 font-semibold" : "text-slate-500"}>
                          {hasEdit ? "Cho phép" : "Không"}
                        </span>
                      </label>
                    </td>
                    <td className="py-2 pr-3">
                      <label className="inline-flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={hasDelete}
                          disabled={toggleRolePermMut.isPending}
                          onChange={() => toggleRolePermMut.mutate({ role: r, perm: deletePerm, enabled: !hasDelete })}
                          className="w-4 h-4 rounded text-rose-600 cursor-pointer"
                        />
                        <span className={hasDelete ? "text-rose-700 dark:text-rose-400 font-semibold" : "text-slate-500"}>
                          {hasDelete ? "Cho phép" : "Không"}
                        </span>
                      </label>
                    </td>
                  </tr>
                );
              })}
            </Table>
          )}
        </div>

        {/* Section B: Individual Users */}
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-bold text-slate-800 dark:text-slate-100">
              2. Phân quyền Chi tiết từng Nhân sự ({activeUsers.length})
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <input
                className={`${inputClass} sm:w-56 !min-h-8 !py-1 !px-2.5 !text-xs`}
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                placeholder="🔍 Tìm tên, mã NV, phòng ban..."
              />
              <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showAllUsers}
                  onChange={(e) => setShowAllUsers(e.target.checked)}
                  className="rounded cursor-pointer"
                />
                Hiện tất cả phòng ban
              </label>
            </div>
          </div>

          <Table head={["Nhân sự", "Phòng ban & Vai trò", editLabel, deleteLabel]}>
            {activeUsers.map((u) => {
              const isRoot =
                u.role?.toLowerCase() === "admin" || u.username?.toLowerCase() === "admin";
              const customRoleCode = `USER_CUSTOM_${u.id}`;

              const findInheritedRole = (perm: string): string | null => {
                for (const g of u.grants) {
                  if (g.role_code === customRoleCode) continue;
                  const rolePerms = roleById.get(g.role_id)?.permissions;
                  if (!rolePerms?.includes(perm)) continue;
                  const inScope =
                    !g.scope_org_unit_id ||
                    g.scope_unit_type === "COMPANY" ||
                    g.scope_module_key === "RD" ||
                    g.scope_module_key === "DEVICE";
                  if (inScope) return g.role_name;
                }
                return null;
              };

              const hasCustomPerm = (perm: string): boolean =>
                u.grants.some(
                  (g) => g.role_code === customRoleCode && roleById.get(g.role_id)?.permissions.includes(perm)
                );

              const excludedSet = new Set(u.excluded_permissions ?? []);
              const inhEdit = findInheritedRole(editPerm);
              const custEdit = hasCustomPerm(editPerm);
              const inhDel = findInheritedRole(deletePerm);
              const custDel = hasCustomPerm(deletePerm);
              const blockSelf = u.id === myUserId && !amIRoot;

              const renderToggle = (perm: string, inheritedRole: string | null, isCustom: boolean) => {
                if (isRoot) {
                  return (
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                      <span className="w-4 h-4 rounded bg-emerald-600 text-white text-[10px] font-extrabold flex items-center justify-center">✓</span>
                      👑 Admin (Mặc định)
                    </span>
                  );
                }
                const isExcluded = excludedSet.has(perm);
                const isGranted = !isExcluded && (Boolean(inheritedRole) || isCustom);
                return (
                  <label
                    className={`inline-flex items-center gap-2 ${blockSelf ? "opacity-60" : "cursor-pointer"}`}
                    title={
                      inheritedRole
                        ? isGranted
                          ? `Đang bật theo vai trò (${inheritedRole}). Bấm để tắt riêng cho cá nhân này.`
                          : `Đã tắt riêng cá nhân (vai trò gốc: ${inheritedRole}). Bấm để bật lại.`
                        : "Bấm để bật / tắt quyền riêng cho cá nhân này"
                    }
                  >
                    <input
                      type="checkbox"
                      checked={isGranted}
                      disabled={blockSelf || toggleUserPermMut.isPending}
                      onChange={() => toggleUserPermMut.mutate({ userId: u.id, perm, enabled: !isGranted })}
                      className="w-4 h-4 rounded accent-emerald-600 cursor-pointer disabled:cursor-not-allowed"
                    />
                    {isGranted ? (
                      inheritedRole ? (
                        <span className="text-emerald-700 dark:text-emerald-400 font-semibold">Theo vai trò ({inheritedRole})</span>
                      ) : (
                        <span className="text-teal-700 dark:text-teal-300 font-semibold">✓ Cấp riêng</span>
                      )
                    ) : isExcluded && inheritedRole ? (
                      <span className="text-rose-600 dark:text-rose-400 font-semibold">✕ Đã tắt ({inheritedRole})</span>
                    ) : (
                      <span className="text-slate-500">Chưa cấp</span>
                    )}
                  </label>
                );
              };

              const groupRoleNames = u.grants
                .filter((g) => !g.role_code.startsWith("USER_CUSTOM_"))
                .map((g) => g.role_name);

              return (
                <tr key={u.id}>
                  <td className="py-2 pr-3">
                    <div className="font-semibold text-slate-900 dark:text-slate-100">{u.full_name}</div>
                    <div className="font-mono text-[10px] text-slate-400">@{u.username}</div>
                  </td>
                  <td className="py-2 pr-3">
                    <div>{u.department || "—"}</div>
                    {groupRoleNames.length > 0 && (
                      <div className="text-[10px] text-slate-500">{groupRoleNames.join(", ")}</div>
                    )}
                  </td>
                  <td className="py-2 pr-3">{renderToggle(editPerm, inhEdit, custEdit)}</td>
                  <td className="py-2 pr-3">{renderToggle(deletePerm, inhDel, custDel)}</td>
                </tr>
              );
            })}
          </Table>
        </div>
      </div>
    </Card>
  );
}
