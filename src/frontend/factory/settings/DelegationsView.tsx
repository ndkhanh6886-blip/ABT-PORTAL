"use client";

import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, useFactoryMe } from "../api";
import { Button, Card, Empty, ErrorNote, Field, inputClass, Table } from "../ui";

interface Delegation {
  id: string;
  from_name: string;
  to_name: string;
  role_name: string;
  valid_from: string;
  valid_to: string;
  reason: string;
  from_user_id: number;
}
interface UserRow {
  id: number;
  full_name: string;
  username: string;
  grants: { role_id: string; role_name: string }[];
}

const dt = (v: string) => new Date(v).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", dateStyle: "short", timeStyle: "short" });
/** datetime-local value (Vietnam time) → ISO with offset */
const toIso = (local: string) => (local ? new Date(`${local}:00+07:00`).toISOString() : "");

/** Temporary hand-over of a role (leave, business trip): at most 90 days, never more than the delegator holds. */
export function DelegationsView({ canManage }: { canManage: boolean }) {
  const me = useFactoryMe();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["factory", "delegations"], queryFn: () => api<Delegation[]>("/api/factory/delegations") });
  const users = useQuery({ queryKey: ["factory", "users", ""], queryFn: () => api<UserRow[]>("/api/factory/users?q="), enabled: canManage });
  const myId = me.data?.profile.user_id;
  const [form, setForm] = useState({ from_user_id: "", to_user_id: "", role_id: "", from: "", to: "", reason: "" });
  const fromUser = users.data?.find((u) => String(u.id) === (form.from_user_id || String(myId)));
  const create = useMutation({
    mutationFn: () =>
      api("/api/factory/delegations", {
        method: "POST",
        idempotent: true,
        json: {
          from_user_id: Number(form.from_user_id || myId),
          to_user_id: Number(form.to_user_id),
          role_id: form.role_id,
          valid_from: toIso(form.from),
          valid_to: toIso(form.to),
          reason: form.reason,
        },
      }),
    onSuccess: () => {
      setForm({ from_user_id: "", to_user_id: "", role_id: "", from: "", to: "", reason: "" });
      qc.invalidateQueries({ queryKey: ["factory", "delegations"] });
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/api/factory/delegations/${id}/revoke`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["factory", "delegations"] }),
  });

  return (
    <Card title="Ủy quyền tạm thời">
      {canManage && (
        <form
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 mb-4 p-3 rounded-xl bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <Field label="Người ủy quyền *">
            <select className={inputClass} value={form.from_user_id} onChange={(e) => setForm({ ...form, from_user_id: e.target.value, role_id: "" })} required>
              <option value="">Chọn người</option>
              {users.data?.filter((u) => u.grants.length).map((u) => (
                <option key={u.id} value={u.id}>{u.full_name} ({u.username})</option>
              ))}
            </select>
          </Field>
          <Field label="Vai trò ủy quyền *">
            <select className={inputClass} value={form.role_id} onChange={(e) => setForm({ ...form, role_id: e.target.value })} required>
              <option value="">Chọn vai trò</option>
              {[...new Map((fromUser?.grants ?? []).map((g) => [g.role_id, g])).values()].map((g) => (
                <option key={g.role_id} value={g.role_id}>{g.role_name}</option>
              ))}
            </select>
          </Field>
          <Field label="Người nhận *">
            <select className={inputClass} value={form.to_user_id} onChange={(e) => setForm({ ...form, to_user_id: e.target.value })} required>
              <option value="">Chọn người</option>
              {users.data?.filter((u) => String(u.id) !== form.from_user_id).map((u) => (
                <option key={u.id} value={u.id}>{u.full_name} ({u.username})</option>
              ))}
            </select>
          </Field>
          <Field label="Từ *"><input className={inputClass} type="datetime-local" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} required /></Field>
          <Field label="Đến * (tối đa 90 ngày)"><input className={inputClass} type="datetime-local" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} required /></Field>
          <Field label="Lý do *"><input className={inputClass} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} required /></Field>
          <div className="sm:col-span-2 lg:col-span-3 flex justify-end"><Button type="submit" disabled={create.isPending}>+ Tạo ủy quyền</Button></div>
          <div className="sm:col-span-2 lg:col-span-3"><ErrorNote error={create.error ?? users.error} /></div>
        </form>
      )}
      <ErrorNote error={list.error ?? revoke.error} />
      {list.data?.length === 0 && <Empty>Không có ủy quyền nào đang hoặc sắp hiệu lực.</Empty>}
      {list.data && list.data.length > 0 && (
        <Table head={["Người ủy quyền", "Người nhận", "Vai trò", "Hiệu lực", "Lý do", ""]}>
          {list.data.map((d) => (
            <tr key={d.id}>
              <td className="py-2 pr-3">{d.from_name}</td>
              <td className="py-2 pr-3">{d.to_name}</td>
              <td className="py-2 pr-3">{d.role_name}</td>
              <td className="py-2 pr-3 whitespace-nowrap">{dt(d.valid_from)} → {dt(d.valid_to)}</td>
              <td className="py-2 pr-3">{d.reason}</td>
              <td className="py-2 pr-3 text-right">
                {(canManage || d.from_user_id === myId) && (
                  <Button variant="ghost" onClick={() => window.confirm("Thu hồi ủy quyền này ngay?") && revoke.mutate(d.id)}>Thu hồi</Button>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  );
}
