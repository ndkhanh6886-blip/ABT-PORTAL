"use client";

import React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { Button, Card, Empty, ErrorNote, Table } from "../ui";
import { PURIFICATION, useScales } from "./shared";

interface Candidate {
  normalized_sequence: string;
  purification: string;
  format: string;
  product_type: string;
  sequences: { id: string; code: string; name: string; scale_code: string; order_code: string }[];
}
interface Pool {
  id: string;
  code: string;
  normalized_sequence: string;
  scale_code: string;
  purification: string;
  status: string;
  members: { code: string; order_code: string | null; ratio_pct: number }[];
}

/** Identical pending sequences (also across orders) that can be synthesised once, and the pools already made. */
export function PoolsView({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const scales = useScales();
  const data = useQuery({ queryKey: ["factory", "oligo-pools"], queryFn: () => api<{ pools: Pool[]; candidates: Candidate[] }>("/api/factory/oligo/pools") });
  const act = useMutation({
    mutationFn: (f: () => Promise<unknown>) => f(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["factory", "oligo-pools"] });
      qc.invalidateQueries({ queryKey: ["factory", "oligo-order"] });
      qc.invalidateQueries({ queryKey: ["factory", "oligo-orders"] });
    },
  });
  const askScale = (fallback: string) => window.prompt(`Thang tổng hợp cho mẻ gộp (${scales.data?.map((s) => s.code).join(", ")}):`, fallback);

  return (
    <div className="flex flex-col gap-3">
      <ErrorNote error={data.error ?? act.error} />
      <Card title="Có thể gộp tổng hợp">
        {data.data?.candidates.length === 0 && <Empty>Không có trình tự trùng nhau đang chờ.</Empty>}
        {data.data && data.data.candidates.length > 0 && (
          <Table head={["Trình tự", "Tinh sạch", "Các trình tự (đơn)", ""]}>
            {data.data.candidates.map((c, i) => (
              <tr key={i}>
                <td className="py-2 pr-3 font-mono text-xs break-all max-w-96">{c.normalized_sequence}</td>
                <td className="py-2 pr-3 text-xs">{PURIFICATION[c.purification as keyof typeof PURIFICATION]}</td>
                <td className="py-2 pr-3 text-xs">{c.sequences.map((s) => `${s.code} (${s.order_code})`).join(", ")}</td>
                <td className="py-2 pr-3 text-right">
                  {canManage && (
                    <Button
                      variant="ghost"
                      onClick={() => {
                        const sc = askScale(c.sequences[0].scale_code);
                        if (sc) act.mutate(() => api("/api/factory/oligo/pools", { method: "POST", idempotent: true, json: { sequence_ids: c.sequences.map((s) => s.id), scale_code: sc } }));
                      }}
                    >
                      Gộp (chia đều)
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Card title="Mẻ gộp đang chờ">
        {data.data?.pools.length === 0 && <Empty>Chưa có mẻ gộp.</Empty>}
        {data.data && data.data.pools.length > 0 && (
          <Table head={["Mã gộp", "Trình tự", "Thang", "Thành phần (tỉ lệ)", ""]}>
            {data.data.pools.map((p) => (
              <tr key={p.id}>
                <td className="py-2 pr-3 font-mono">{p.code}</td>
                <td className="py-2 pr-3 font-mono text-xs break-all max-w-96">{p.normalized_sequence}</td>
                <td className="py-2 pr-3 text-xs">{scales.data?.find((s) => s.code === p.scale_code)?.label ?? p.scale_code}</td>
                <td className="py-2 pr-3 text-xs">{p.members.map((m) => `${m.code} (${m.order_code}) ${m.ratio_pct}%`).join(" · ")}</td>
                <td className="py-2 pr-3 text-right">
                  {canManage && p.status === "PENDING" && <Button variant="ghost" onClick={() => act.mutate(() => api(`/api/factory/oligo/pools/${p.id}/unpool`, { method: "POST" }))}>Hủy gộp</Button>}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
