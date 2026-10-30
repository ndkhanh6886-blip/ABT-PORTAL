"use client";

import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { Button, Card, ErrorNote, inputClass, Table } from "../ui";

interface Setting { key: string; value: unknown; description: string; version: number; updated_at: string }

/** Text settings are edited as text (multi-line allowed); others as JSON (numbers, null, …). */
function SettingRow({ s }: { s: Setting }) {
  const qc = useQueryClient();
  const isText = typeof s.value === "string" || s.key.startsWith("company.");
  const [draft, setDraft] = useState(isText ? (typeof s.value === "string" ? s.value : "") : JSON.stringify(s.value));
  const [edit, setEdit] = useState(false);
  const save = useMutation({
    mutationFn: () => {
      const reason = window.prompt("Lý do thay đổi tham số:");
      if (!reason) throw new Error("Cần lý do.");
      let value: unknown = draft;
      if (!isText) {
        try {
          value = JSON.parse(draft);
        } catch {
          throw new Error("Giá trị phải là số, true/false hoặc null.");
        }
      }
      return api(`/api/factory/settings/${encodeURIComponent(s.key)}`, { method: "PUT", json: { value, version: s.version, reason } });
    },
    onSuccess: () => {
      setEdit(false);
      qc.invalidateQueries({ queryKey: ["factory", "settings"] });
    },
  });
  return (
    <tr>
      <td className="py-2 pr-3 font-mono text-xs align-top">{s.key}</td>
      <td className="py-2 pr-3 text-xs align-top">{s.description}</td>
      <td className="py-2 pr-3 text-xs align-top min-w-64">
        {edit ? (
          isText ? <textarea className={`${inputClass} h-24`} value={draft} onChange={(e) => setDraft(e.target.value)} /> : <input className={inputClass} value={draft} onChange={(e) => setDraft(e.target.value)} />
        ) : (
          <span className="whitespace-pre-line">{s.value == null ? <i className="text-slate-400">chưa đặt</i> : typeof s.value === "string" ? s.value : JSON.stringify(s.value)}</span>
        )}
        {save.error != null && <ErrorNote error={save.error} />}
      </td>
      <td className="py-2 pr-3 text-right whitespace-nowrap align-top">
        {!edit && <Button variant="ghost" onClick={() => setEdit(true)}>Sửa</Button>}
        {edit && (
          <>
            <Button variant="ghost" onClick={() => setEdit(false)}>Hủy</Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>Lưu</Button>
          </>
        )}
      </td>
    </tr>
  );
}

export function ParamsView() {
  const list = useQuery({ queryKey: ["factory", "settings"], queryFn: () => api<Setting[]>("/api/factory/settings") });
  return (
    <Card title="Tham số cấu hình">
      <ErrorNote error={list.error} />
      {list.data && (
        <Table head={["Mã", "Ý nghĩa", "Giá trị", ""]}>
          {list.data.map((s) => <SettingRow key={`${s.key}-${s.version}`} s={s} />)}
        </Table>
      )}
    </Card>
  );
}
