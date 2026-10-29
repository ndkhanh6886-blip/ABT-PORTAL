"use client";

import React, { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { Button, ErrorNote, inputClass } from "../ui";

/** Moves a released lot out of quarantine onto a normal location of the same warehouse. */
export function PutAway({ lotId, warehouseId, onDone }: { lotId: string; warehouseId: string; onDone: () => void }) {
  const [to, setTo] = useState("");
  const locs = useQuery({
    queryKey: ["factory", "locations", warehouseId],
    queryFn: () => api<{ id: string; code: string; name: string; is_quarantine: boolean; status: string }[]>(`/api/factory/master/warehouses/${warehouseId}/locations`),
  });
  const move = useMutation({
    mutationFn: () => api(`/api/factory/inv/lots/${lotId}/putaway`, { method: "POST", idempotent: true, json: { to_location_id: to } }),
    onSuccess: onDone,
  });
  return (
    <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); move.mutate(); }}>
      <span className="text-xs text-slate-600 dark:text-slate-300">Lô đã giải phóng, còn ở khu biệt trữ:</span>
      <select className={`${inputClass} w-56`} value={to} onChange={(e) => setTo(e.target.value)} required aria-label="Vị trí đích">
        <option value="">Chọn vị trí lưu</option>
        {locs.data?.filter((l) => !l.is_quarantine && l.status === "ACTIVE").map((l) => <option key={l.id} value={l.id}>{l.code} — {l.name}</option>)}
      </select>
      <Button type="submit" disabled={move.isPending}>{move.isPending ? "Đang chuyển…" : "Chuyển lên kệ"}</Button>
      <div className="w-full"><ErrorNote error={move.error ?? locs.error} /></div>
    </form>
  );
}
