"use client";

import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, useFactoryMe } from "../api";
import { Button, Card, Empty, ErrorNote, inputClass } from "../ui";
import type { Role } from "./RolesView";

interface Grant {
  id: string;
  role_id: string;
  role_code: string;
  role_name: string;
  scope_org_unit_id: string | null;
  scope_name: string | null;
  valid_to: string | null;
}
interface UserRow {
  id: number;
  username: string;
  full_name: string;
  department: string | null;
  is_active: boolean;
  org_unit_id: string | null;
  has_pin: boolean;
  grants: Grant[];
}
interface OrgUnit {
  id: string;
  code: string;
  name: string;
}

function UserCard({ user, roles, units, isSelf }: { user: UserRow; roles: Role[]; units: OrgUnit[]; isSelf: boolean }) {
  const qc = useQueryClient();
  const [roleId, setRoleId] = useState("");
  const [scope, setScope] = useState("");
  const refresh = () => qc.invalidateQueries({ queryKey: ["factory", "users"] });
  const grant = useMutation({
    mutationFn: () => api(`/api/factory/users/${user.id}/roles`, { method: "POST", idempotent: true, json: { role_id: roleId, scope_org_unit_id: scope || null } }),
    onSuccess: () => {
      setRoleId("");
      setScope("");
      refresh();
    },
  });
  const revoke = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => api(`/api/factory/user-roles/${id}/revoke`, { method: "POST", json: { reason } }),
    onSuccess: refresh,
  });
  const setUnit = useMutation({
    mutationFn: (org_unit_id: string) => api(`/api/factory/users/${user.id}/org-unit`, { method: "PUT", json: { org_unit_id } }),
    onSuccess: refresh,
  });

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 flex flex-col gap-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-sm font-bold text-slate-800 dark:text-slate-100">
            {user.full_name} {!user.is_active && <span className="text-rose-600 text-xs">(đã khóa)</span>}
          </div>
          <div className="text-[11px] text-slate-400">
            {user.username} · {user.department || "—"} · PIN: {user.has_pin ? "đã đặt" : "chưa đặt"}
          </div>
        </div>
        <select className={`${inputClass} w-56`} value={user.org_unit_id ?? ""} onChange={(e) => setUnit.mutate(e.target.value)} aria-label="Phòng ban trong nhà máy">
          <option value="">— Chưa gán phòng —</option>
          {units.map((u) => (
            <option key={u.id} value={u.id}>{u.code} — {u.name}</option>
          ))}
        </select>
      </div>
      <ul className="flex flex-wrap gap-1.5">
        {user.grants.length === 0 && <li className="text-xs text-slate-400">Chưa có vai trò.</li>}
        {user.grants.map((g) => (
          <li key={g.id} className="flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-900 text-[11px] text-sky-800 dark:text-sky-200">
            {g.role_name} · {g.scope_name ?? "toàn công ty"}
            <button
              className="ml-1 w-5 h-5 rounded-full hover:bg-sky-200 dark:hover:bg-sky-900 cursor-pointer"
              title="Thu hồi"
              onClick={() => {
                const reason = window.prompt(`Lý do thu hồi vai trò "${g.role_name}" của ${user.full_name}:`);
                if (reason) revoke.mutate({ id: g.id, reason });
              }}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      {isSelf ? (
        <p className="text-[11px] text-slate-400">Không tự cấp quyền cho chính mình — nhờ một quản trị viên khác.</p>
      ) : (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            grant.mutate();
          }}
        >
          <select className={`${inputClass} flex-1 min-w-40`} value={roleId} onChange={(e) => setRoleId(e.target.value)} required aria-label="Vai trò">
            <option value="">Chọn vai trò…</option>
            {roles.filter((r) => r.status === "ACTIVE").map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
          <select className={`${inputClass} flex-1 min-w-40`} value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Phạm vi">
            <option value="">Toàn công ty</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>Chỉ {u.name}</option>
            ))}
          </select>
          <Button type="submit" disabled={grant.isPending}>Cấp</Button>
        </form>
      )}
      <ErrorNote error={grant.error ?? revoke.error ?? setUnit.error} />
    </div>
  );
}

export function UsersView() {
  const me = useFactoryMe();
  const [q, setQ] = useState("");
  const users = useQuery({ queryKey: ["factory", "users", q], queryFn: () => api<UserRow[]>(`/api/factory/users?q=${encodeURIComponent(q)}`) });
  const roles = useQuery({ queryKey: ["factory", "roles"], queryFn: () => api<Role[]>("/api/factory/roles") });
  const units = useQuery({ queryKey: ["factory", "org-units"], queryFn: () => api<OrgUnit[]>("/api/factory/org-units") });

  return (
    <Card title="Người dùng và quyền" actions={<input className={`${inputClass} w-64`} placeholder="Tìm tên, tài khoản, bộ phận…" value={q} onChange={(e) => setQ(e.target.value)} />}>
      <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
        Tài khoản lấy từ ABT Portal (đăng nhập chung). Vai trò có phạm vi một phòng chỉ có hiệu lực với dữ liệu và kho của phòng đó (và các tổ trực thuộc).
      </p>
      <ErrorNote error={users.error ?? roles.error ?? units.error} />
      {users.data?.length === 0 && <Empty>Không tìm thấy tài khoản.</Empty>}
      <div className="grid gap-3 lg:grid-cols-2">
        {users.data?.map((u) => (
          <UserCard key={u.id} user={u} roles={roles.data ?? []} units={units.data ?? []} isSelf={u.id === me.data?.profile.user_id} />
        ))}
      </div>
    </Card>
  );
}
