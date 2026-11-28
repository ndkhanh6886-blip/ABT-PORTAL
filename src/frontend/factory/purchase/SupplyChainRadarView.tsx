"use client";

import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Clock, Flame, PackageCheck, RefreshCw, ShoppingCart, Truck, Zap } from "lucide-react";
import { api, fmtDate, fmtQty } from "../api";
import { Button, Card, Empty, ErrorNote, StatusBadge, Table } from "../ui";

interface SupplyChainOverview {
  can_approve_transfer?: boolean;
  kpis: {
    urgent_pr_count: number;
    open_inbox_lines_count: number;
    hub_fulfillable_lines_count: number;
    active_po_count: number;
    overdue_po_count: number;
    low_stock_items_count: number;
    pending_transfer_count?: number;
  };
  pending_transfer_requests?: {
    id: string;
    code: string;
    status: string;
    created_at: string;
    notes: string | null;
    source_warehouse_code: string;
    target_warehouse_codes?: string[];
    created_by_name: string | null;
    line_summaries: string[];
  }[];
  open_pr_lines_dispatch: {
    pr_line_id: string;
    pr_id: string;
    pr_code: string;
    pr_status: string;
    priority: string;
    needed_by: string | null;
    days_until_needed: number | null;
    reason: string;
    org_unit_code: string;
    org_unit_name: string;
    warehouse_id: string;
    warehouse_code: string;
    item_id: string;
    item_code: string;
    item_name: string;
    uom: string;
    qty_requested: number;
    qty_ordered: number;
    qty_open: number;
    suggested_price: number;
    hub_available_qty: number;
    dept_available_qty: number;
    other_branch_available_qty?: number;
    other_branch_warehouse_id?: string | null;
    other_branch_warehouse_code?: string | null;
    item_type?: string;
    is_manufacturable?: boolean;
    has_kit_bom?: boolean;
    line_notes?: string | null;
    linked_po_code?: string | null;
    linked_po_status?: string | null;
    linked_mo_code?: string | null;
    linked_mo_status?: string | null;
  }[];
  mrp_shortage_radar: {
    item_id: string;
    item_code: string;
    item_name: string;
    item_type: string;
    base_uom: string;
    min_safety_stock: number;
    reorder_qty: number;
    lead_time_days: number;
    hub_available: number;
    branch_available: number;
    open_pr_qty: number;
    open_po_qty: number;
    last_price: number;
    preferred_supplier_id: string | null;
    preferred_supplier_name: string;
  }[];
  active_pos_tracking: {
    id: string;
    code: string;
    status: string;
    order_date: string;
    expected_date: string | null;
    days_to_eta: number | null;
    total_amount: number;
    supplier_code: string;
    supplier_name: string;
    line_count: number;
    qty_remaining: number;
  }[];
}

const PRIORITY_BADGE: Record<string, { label: string; cls: string }> = {
  URGENT: { label: "🔥 Khẩn cấp (SLA 24h)", cls: "bg-rose-100 text-rose-800 dark:bg-rose-950/70 dark:text-rose-300" },
  HIGH: { label: "⚡ Ưu tiên cao", cls: "bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300" },
  NORMAL: { label: "📋 Bình thường", cls: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
};

export function SupplyChainRadarView({
  onGoInbox,
  onOpenPo,
}: {
  onGoInbox: () => void;
  onOpenPo: (poId: string) => void;
}) {
  const qc = useQueryClient();
  const [toast, setToast] = useState<string | null>(null);

  const overview = useQuery({
    queryKey: ["factory", "supply-chain-ops"],
    queryFn: () => api<SupplyChainOverview>("/api/factory/purchase/ops"),
  });

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ["factory", "supply-chain-ops"] });
    qc.invalidateQueries({ queryKey: ["factory", "prs"] });
    qc.invalidateQueries({ queryKey: ["factory", "pr-inbox"] });
    qc.invalidateQueries({ queryKey: ["factory", "pos"] });
    qc.invalidateQueries({ queryKey: ["factory", "stock"] });
    qc.invalidateQueries({ queryKey: ["factory", "warehouse-hub-ops"] });
  };

  const fulfillFromHubMut = useMutation({
    mutationFn: (payload: { pr_line_id: string; source_warehouse_id?: string | null }) =>
      api<{
        transferred_qty: number;
        document_code: string;
        lot_codes?: string;
        fulfilled_date?: string;
        from_warehouse?: string;
        to_warehouse: string;
      }>("/api/factory/purchase/ops", {
        method: "POST",
        idempotent: true,
        json: {
          op: payload.source_warehouse_id ? "fulfill_from_branch" : "fulfill_from_hub",
          pr_line_id: payload.pr_line_id,
          source_warehouse_id: payload.source_warehouse_id ?? null,
        },
      }),
    onSuccess: (res) => {
      setToast(
        `⚡ Đã điều chuyển FEFO tức thì ${fmtQty(res.transferred_qty)} từ ${res.from_warehouse || "KHO-TONG"} sang ${res.to_warehouse} (Số Lot: ${res.lot_codes || "FEFO"} · Phiếu ${res.document_code}) — Tự động trừ kho!`
      );
      refreshAll();
    },
  });

  const dispatchToProductionMut = useMutation({
    mutationFn: (pr_line_id: string) =>
      api<{
        internal_order_code: string;
        production_order_code: string | null;
        warning: string | null;
        qty: number;
        item_code: string;
        to_warehouse: string;
      }>("/api/factory/purchase/ops", {
        method: "POST",
        idempotent: true,
        json: { op: "dispatch_pr_line_to_production", pr_line_id },
      }),
    onSuccess: (res) => {
      setToast(
        res.production_order_code
          ? `⚗️ Đã chuyển P.Sản xuất Kit (Anh Đoàn Hồng Sơn) pha chế / sản xuất ${res.item_code}: Đơn nội bộ ${res.internal_order_code} · Lệnh SX ${res.production_order_code}!`
          : `⚗️ Đã tạo Đơn nội bộ ${res.internal_order_code} chuyển P.Sản xuất Kit (${res.item_code})!${res.warning ? ` (${res.warning})` : ""}`
      );
      refreshAll();
    },
  });

  const approveTransferMut = useMutation({
    mutationFn: (document_id: string) =>
      api<{ code: string }>("/api/factory/inv/ops", {
        method: "POST",
        idempotent: true,
        json: { op: "approve_transfer_request", document_id },
      }),
    onSuccess: (res) => {
      setToast(`✅ Trưởng phòng Cung ứng / Thủ kho đã phê duyệt & xuất cấp phát phiếu chuyển kho ${res.code} từ KHO-TONG!`);
      refreshAll();
    },
  });

  const rejectTransferMut = useMutation({
    mutationFn: (payload: { document_id: string; reason?: string }) =>
      api<{ code: string }>("/api/factory/inv/ops", {
        method: "POST",
        idempotent: true,
        json: { op: "reject_transfer_request", ...payload },
      }),
    onSuccess: (res) => {
      setToast(`Đã từ chối / hủy phiếu yêu cầu chuyển kho ${res.code}.`);
      refreshAll();
    },
  });

  const fastTrackApproveMut = useMutation({
    mutationFn: (payload: { pr_id: string; priority?: "URGENT" | "HIGH" | "NORMAL" }) =>
      api<{ code: string; status: string }>("/api/factory/purchase/ops", {
        method: "POST",
        idempotent: true,
        json: { op: "fast_track_approve_pr", ...payload },
      }),
    onSuccess: (res) => {
      setToast(`✅ Đã duyệt nhanh Đề nghị mua ${res.code} (${res.status}) và đẩy vào Hộp thư Đặt hàng!`);
      refreshAll();
    },
  });

  const directPoMut = useMutation({
    mutationFn: (payload: { item_id: string; qty: number; unit_price: number; item_code: string }) =>
      api<{ pr_code: string; po: { id: string; code: string } }>("/api/factory/purchase/ops", {
        method: "POST",
        idempotent: true,
        json: {
          op: "create_direct_replenish_po",
          item_id: payload.item_id,
          qty: payload.qty,
          unit_price: payload.unit_price,
          priority: "HIGH",
          issue_immediately: true,
        },
      }),
    onSuccess: (res, vars) => {
      setToast(`🚀 Đã phát hành tự động PR ${res.pr_code} & Đơn mua hàng ${res.po.code} cho ${vars.item_code}!`);
      refreshAll();
    },
  });

  const d = overview.data;
  if (overview.isLoading) return <div className="p-6 text-xs text-slate-400">Đang tải Trung tâm Điều phối Cung ứng…</div>;

  return (
    <div className="flex flex-col gap-3">
      {toast && (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/50 px-4 py-2.5 text-xs font-semibold text-emerald-800 dark:text-emerald-200">
          <span>{toast}</span>
          <button type="button" className="text-emerald-600 hover:underline cursor-pointer" onClick={() => setToast(null)}>
            Đóng
          </button>
        </div>
      )}

      <ErrorNote
        error={
          overview.error ??
          fulfillFromHubMut.error ??
          dispatchToProductionMut.error ??
          fastTrackApproveMut.error ??
          directPoMut.error
        }
      />

      {/* 4 KPI CARDS */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/60 dark:bg-rose-950/20 p-3.5">
          <div className="flex items-center justify-between text-xs font-bold text-rose-700 dark:text-rose-300">
            <span>🔥 Nhu cầu Khẩn cấp / Cận hạn</span>
            <Flame className="w-4 h-4" />
          </div>
          <div className="text-2xl font-extrabold text-rose-800 dark:text-rose-200 mt-1">
            {d?.kpis.urgent_pr_count ?? 0} dòng
          </div>
          <div className="text-[11px] text-rose-600 dark:text-rose-400 mt-0.5">
            Ưu tiên xử lý trong 24h cho R&D / Sản xuất
          </div>
        </div>

        <div className="rounded-2xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/60 dark:bg-emerald-950/20 p-3.5">
          <div className="flex items-center justify-between text-xs font-bold text-emerald-700 dark:text-emerald-300">
            <span>⚡ Có sẵn tại KHO-TONG (Cấp ngay)</span>
            <Zap className="w-4 h-4" />
          </div>
          <div className="text-2xl font-extrabold text-emerald-800 dark:text-emerald-200 mt-1">
            {d?.kpis.hub_fulfillable_lines_count ?? 0} dòng PR
          </div>
          <div className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-0.5">
            Điều chuyển FEFO trong 15 phút, không cần mua ngoài
          </div>
        </div>

        <div className="rounded-2xl border border-sky-200 dark:border-sky-900/60 bg-sky-50/60 dark:bg-sky-950/20 p-3.5">
          <div className="flex items-center justify-between text-xs font-bold text-sky-700 dark:text-sky-300">
            <span>📦 Đã duyệt chờ Gom Đơn PO</span>
            <ShoppingCart className="w-4 h-4" />
          </div>
          <div className="text-2xl font-extrabold text-sky-800 dark:text-sky-200 mt-1">
            {d?.kpis.open_inbox_lines_count ?? 0} dòng
          </div>
          <div className="text-[11px] text-sky-600 dark:text-sky-400 mt-0.5">
            Gom đơn thông minh theo Nhà cung cấp ASL
          </div>
        </div>

        <div className="rounded-2xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/60 dark:bg-amber-950/20 p-3.5">
          <div className="flex items-center justify-between text-xs font-bold text-amber-700 dark:text-amber-300">
            <span>🚚 Đơn PO Đang Giao / Cảnh báo Trễ</span>
            <Clock className="w-4 h-4" />
          </div>
          <div className="text-2xl font-extrabold text-amber-800 dark:text-amber-200 mt-1">
            {d?.kpis.active_po_count ?? 0} PO{" "}
            {(d?.kpis.overdue_po_count ?? 0) > 0 && (
              <span className="text-xs font-bold text-rose-600">({d?.kpis.overdue_po_count} trễ hạn)</span>
            )}
          </div>
          <div className="text-[11px] text-amber-600 dark:text-amber-400 mt-0.5">
            Vật tư dưới ngưỡng an toàn: <b>{d?.kpis.low_stock_items_count ?? 0}</b> mã
          </div>
        </div>
      </div>

      {/* BẢNG 0: YÊU CẦU CHUYỂN NVL TỪ KHO TỔNG VỀ KHO PHÒNG BAN CHỜ THỦ KHO / TRƯỞNG PHÒNG CUNG ỨNG DUYỆT */}
      {(d?.pending_transfer_requests?.length ?? 0) > 0 && (
        <Card title={`🔔 Yêu cầu Chuyển NVL từ Kho Tổng (KHO-TONG) về Kho Phòng Ban chờ Thủ kho / Trưởng phòng Cung ứng duyệt (${d?.pending_transfer_requests?.length} phiếu)`}>
          <Table head={["Mã phiếu", "Từ Kho ➔ Kho Phòng", "Người đề xuất", "Vật tư & Lô yêu cầu chuyển", "Lý do / Mục đích", "Ngày gửi", "Phê duyệt xuất kho"]}>
            {(d?.pending_transfer_requests ?? []).map((t) => (
              <tr key={t.id}>
                <td className="py-2 pr-3 font-mono font-bold text-sky-700 dark:text-sky-400 whitespace-nowrap">{t.code}</td>
                <td className="py-2 pr-3 font-mono text-xs font-semibold whitespace-nowrap">
                  {t.source_warehouse_code} ➔ {(t.target_warehouse_codes ?? []).join(", ") || "Kho Phòng"}
                </td>
                <td className="py-2 pr-3 text-xs whitespace-nowrap">{t.created_by_name ?? "Nhân sự phòng"}</td>
                <td className="py-2 pr-3 text-xs font-mono">{t.line_summaries.join(" · ")}</td>
                <td className="py-2 pr-3 text-xs text-slate-600 dark:text-slate-300">{t.notes ?? "—"}</td>
                <td className="py-2 pr-3 text-xs whitespace-nowrap">{fmtDate(t.created_at)}</td>
                <td className="py-2 pr-2 whitespace-nowrap">
                  {d?.can_approve_transfer ? (
                    <div className="flex items-center gap-1.5">
                      <Button
                        onClick={() => approveTransferMut.mutate(t.id)}
                        disabled={approveTransferMut.isPending}
                      >
                        ✅ Duyệt &amp; Xuất từ KHO-TONG
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => rejectTransferMut.mutate({ document_id: t.id, reason: "Cung ứng từ chối yêu cầu chuyển kho" })}
                        disabled={rejectTransferMut.isPending}
                      >
                        ✕ Từ chối
                      </Button>
                    </div>
                  ) : (
                    <StatusBadge status="QUARANTINE" label="Chờ Thủ kho / Cung ứng duyệt" />
                  )}
                </td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      {/* BẢNG 1: ĐIỀU PHỐI THÔNG MINH NHU CẦU VẬT TƯ TỪ 5 PHÒNG BAN */}
      <Card
        title="1. Bảng Điều Phối Nhu Cầu Vật Tư 5 Phòng Ban (`1 Đầu Mối PR ➔ Cấp từ KHO-TONG / Luân chuyển Kho Nhánh / Chuyển P.SX Pha chế / Đặt PO`)"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={refreshAll}>
              <RefreshCw className="w-3.5 h-3.5 mr-1 inline" /> Làm mới
            </Button>
            <Button onClick={onGoInbox}>Mở Hộp thư Gom PO ({d?.kpis.open_inbox_lines_count ?? 0}) →</Button>
          </div>
        }
      >
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
          Các phòng ban chỉ cần bấm **`+ Đề nghị cấp / Mua vật tư (PR)`** gửi về đây. Tại bảng này, Cung ứng kiểm tra tồn kho thực tế của từng dòng để quyết định 1-Click: **(1) Cấp từ Kho Tổng (`KHO-TONG`)**, **(2) Luân chuyển từ Kho nhánh khác (VD: `KHO-KIT`)**, **(3) Chuyển P.Sản xuất (Anh Sơn) pha chế / sản xuất mới**, hoặc **(4) Tạo PO mua ngoài**.
        </p>
        {d?.open_pr_lines_dispatch.length === 0 ? (
          <Empty>Tất cả đề nghị vật tư của các phòng ban đã được cấp phát hoặc đặt hàng đầy đủ.</Empty>
        ) : (
          <Table
            head={[
              "Mức ưu tiên / SLA",
              "Mã PR & Phòng đề xuất",
              "Vật tư yêu cầu",
              "Số lượng cần",
              "Tồn sẵn tại KHO-TONG",
              "Tồn tại Kho Nhánh Khác",
              "Tồn tại Kho Phòng Xin",
              "Trạng thái PR",
              "Quyết định Điều phối (1-Click)",
            ]}
          >
            {d?.open_pr_lines_dispatch.map((l) => {
              const pri = PRIORITY_BADGE[l.priority] ?? PRIORITY_BADGE.NORMAL;
              const isLineFulfilled = l.qty_open <= 0;
              const canFulfillFromHub = !isLineFulfilled && l.warehouse_code !== "KHO-TONG" && l.hub_available_qty > 0;
              const otherBranchAvail = Number(l.other_branch_available_qty ?? 0);
              const canFulfillFromBranch =
                !isLineFulfilled &&
                otherBranchAvail > 0 &&
                Boolean(l.other_branch_warehouse_id) &&
                Boolean(l.other_branch_warehouse_code);
              const canProduceInHouse =
                Boolean(l.has_kit_bom) ||
                Boolean(l.is_manufacturable) ||
                l.item_type === "SEMI_FINISHED" ||
                l.item_type === "FINISHED_KIT" ||
                /^(BTP|ST|DD|MM|MIX|IC|BUF)/i.test(l.item_code);
              const isWaitingForProduction =
                !isLineFulfilled &&
                (Boolean(l.linked_mo_code) || /đang chờ p\.sx pha chế/i.test(String(l.line_notes || "")));
              return (
                <tr key={l.pr_line_id} className={isLineFulfilled ? "bg-emerald-50/40 dark:bg-emerald-950/15" : ""}>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${pri.cls}`}>{pri.label}</span>
                    {l.needed_by && (
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        Cần: {fmtDate(l.needed_by)}{" "}
                        {l.days_until_needed !== null && !isLineFulfilled && (
                          <b className={l.days_until_needed <= 2 ? "text-rose-600" : "text-slate-600"}>
                            ({l.days_until_needed < 0 ? `Trễ ${Math.abs(l.days_until_needed)}n` : `còn ${l.days_until_needed}n`})
                          </b>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    <div className="font-mono font-bold text-sky-700 dark:text-sky-400">{l.pr_code}</div>
                    <div className="text-xs font-semibold">
                      {l.org_unit_name} → <span className="font-mono">{l.warehouse_code}</span>
                    </div>
                    <div className="text-[11px] text-slate-500 truncate max-w-52">{l.reason}</div>
                  </td>
                  <td className="py-2 pr-3">
                    <div className="font-mono font-semibold">{l.item_code}</div>
                    <div className="text-[11px] text-slate-500">{l.item_name}</div>
                    {l.line_notes && (
                      <div className="text-[10px] font-semibold text-indigo-700 dark:text-indigo-300 mt-0.5">
                        {l.line_notes}
                      </div>
                    )}
                  </td>
                  <td className="py-2 pr-3 font-bold whitespace-nowrap">
                    {isLineFulfilled ? (
                      <span className="text-emerald-700 dark:text-emerald-400">
                        {fmtQty(l.qty_requested)} / {fmtQty(l.qty_requested)} {l.uom}
                      </span>
                    ) : (
                      <span>
                        {fmtQty(l.qty_open)} {l.uom}
                        {l.qty_ordered > 0 && (
                          <span className="block text-[10px] text-emerald-700 dark:text-emerald-400">
                            (Đã cấp/đặt: {fmtQty(l.qty_ordered)}/{fmtQty(l.qty_requested)})
                          </span>
                        )}
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    {l.hub_available_qty > 0 ? (
                      <span className="font-bold text-emerald-700 dark:text-emerald-400">
                        ✅ Có {fmtQty(l.hub_available_qty)} {l.uom}
                      </span>
                    ) : (
                      <span className="text-rose-600 text-xs font-semibold">Hết hàng (0)</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    {otherBranchAvail > 0 && l.other_branch_warehouse_code ? (
                      <span className="font-bold text-teal-700 dark:text-teal-400">
                        🧪 {l.other_branch_warehouse_code}: {fmtQty(otherBranchAvail)} {l.uom}
                      </span>
                    ) : (
                      <span className="text-slate-400 text-xs">0</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap text-xs">
                    {fmtQty(l.dept_available_qty)} {l.uom}
                  </td>
                  <td className="py-2 pr-3">
                    {isLineFulfilled && l.linked_po_code ? (
                      <StatusBadge status="RELEASED" label={`🛒 Đang đặt mua PO (${l.linked_po_code})`} />
                    ) : isLineFulfilled ? (
                      <StatusBadge status="RELEASED" label="✅ Đã cấp hoàn tất" />
                    ) : isWaitingForProduction ? (
                      <StatusBadge
                        status="QUARANTINE"
                        label={`⏳ Đang chờ P.SX pha chế (${l.linked_mo_code || "P.SX"})`}
                      />
                    ) : (
                      <StatusBadge
                        status={l.pr_status === "APPROVED" ? "RELEASED" : "QUARANTINE"}
                        label={l.pr_status === "APPROVED" ? "Đã duyệt chờ điều phối" : l.pr_status}
                      />
                    )}
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    {isLineFulfilled ? (
                      <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400">
                        {l.linked_po_code ? `🛒 Đã lên PO ${l.linked_po_code}` : "✅ Đã cấp & trừ kho"}
                      </span>
                    ) : (
                      <div className="flex flex-wrap items-center gap-1.5">
                        {canFulfillFromHub && (
                          <Button
                            onClick={() => fulfillFromHubMut.mutate({ pr_line_id: l.pr_line_id })}
                            disabled={fulfillFromHubMut.isPending}
                          >
                            ⚡ Cấp từ KHO-TONG ({fmtQty(Math.min(l.qty_open, l.hub_available_qty))})
                          </Button>
                        )}
                        {canFulfillFromBranch && (
                          <Button
                            variant={canFulfillFromHub ? "ghost" : "primary"}
                            onClick={() =>
                              fulfillFromHubMut.mutate({
                                pr_line_id: l.pr_line_id,
                                source_warehouse_id: l.other_branch_warehouse_id,
                              })
                            }
                            disabled={fulfillFromHubMut.isPending}
                          >
                            🧪 Cấp từ Kho SX ({l.other_branch_warehouse_code}: {fmtQty(Math.min(l.qty_open, otherBranchAvail))})
                          </Button>
                        )}
                        {canProduceInHouse && !canFulfillFromHub && !canFulfillFromBranch && !isWaitingForProduction && (
                          <Button
                            onClick={() => dispatchToProductionMut.mutate(l.pr_line_id)}
                            disabled={dispatchToProductionMut.isPending}
                          >
                            ⚗️ Yêu cầu P.SX (Anh Sơn) pha chế / Sản xuất
                          </Button>
                        )}
                        {["DRAFT", "SUBMITTED"].includes(l.pr_status) && (
                          <Button
                            variant="ghost"
                            onClick={() => fastTrackApproveMut.mutate({ pr_id: l.pr_id, priority: "HIGH" })}
                            disabled={fastTrackApproveMut.isPending}
                          >
                            ✅ Duyệt Nhanh PR
                          </Button>
                        )}
                        {l.pr_status === "APPROVED" && !isWaitingForProduction && (
                          <Button variant="ghost" onClick={onGoInbox}>
                            🛒 Tạo PO mua hàng →
                          </Button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>

      {/* BẢNG 2: RADAR BÙ TỒN KHO TỰ ĐỘNG MRP */}
      <Card title="2. Radar Dự Báo Thiếu Hụt Vật Tư & Phát Hành Nhanh Đơn Mua Bù Kho (`MRP Reorder Point`)">
        <Table
          head={[
            "Mã & Tên Vật tư",
            "Tồn KHO-TONG",
            "Tồn Kho Nhánh",
            "Đang về (Open PO)",
            "Định mức An toàn",
            "Lead Time",
            "Đơn giá chuẩn ASL",
            "Phát hành nhanh PO (1-Click)",
          ]}
        >
          {(d?.mrp_shortage_radar ?? []).slice(0, 12).map((m) => {
            const totalAvail = Number(m.hub_available) + Number(m.branch_available);
            const isBelowMin = totalAvail < Number(m.min_safety_stock);
            const orderQty = Math.max(Number(m.reorder_qty), Number(m.min_safety_stock) * 2);
            return (
              <tr key={m.item_id}>
                <td className="py-2 pr-3">
                  <div className="font-mono font-semibold">{m.item_code}</div>
                  <div className="text-[11px] text-slate-500">{m.item_name}</div>
                </td>
                <td className="py-2 pr-3 font-semibold whitespace-nowrap">
                  {fmtQty(m.hub_available)} {m.base_uom}
                </td>
                <td className="py-2 pr-3 whitespace-nowrap">
                  {fmtQty(m.branch_available)} {m.base_uom}
                </td>
                <td className="py-2 pr-3 whitespace-nowrap text-indigo-600 dark:text-indigo-400 font-semibold">
                  {m.open_po_qty > 0 ? `+${fmtQty(m.open_po_qty)} ${m.base_uom}` : "—"}
                </td>
                <td className="py-2 pr-3 whitespace-nowrap">
                  <span
                    className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${
                      isBelowMin
                        ? "bg-rose-100 text-rose-800 dark:bg-rose-950/70 dark:text-rose-300"
                        : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300"
                    }`}
                  >
                    {isBelowMin ? `⚠️ Thiếu (${fmtQty(totalAvail)}/${fmtQty(m.min_safety_stock)})` : `Đủ (${fmtQty(totalAvail)}/${fmtQty(m.min_safety_stock)})`}
                  </span>
                </td>
                <td className="py-2 pr-3 whitespace-nowrap text-xs">{m.lead_time_days} ngày</td>
                <td className="py-2 pr-3 whitespace-nowrap text-right font-mono">{fmtQty(m.last_price)} đ</td>
                <td className="py-2 pr-3 whitespace-nowrap">
                  <Button
                    variant={isBelowMin ? "primary" : "ghost"}
                    disabled={directPoMut.isPending}
                    onClick={() =>
                      directPoMut.mutate({
                        item_id: m.item_id,
                        qty: orderQty,
                        unit_price: m.last_price,
                        item_code: m.item_code,
                      })
                    }
                  >
                    🚀 Phát hành PO ({fmtQty(orderQty)} {m.base_uom})
                  </Button>
                </td>
              </tr>
            );
          })}
        </Table>
      </Card>

      {/* BẢNG 3: THEO DÕI TIẾN ĐỘ ĐƠN MUA HÀNG & CẢNH BÁO TRỄ HẠN */}
      <Card title="3. Giám Sát Tiến Độ Đơn Mua Hàng Đang Mở (`PO Expediting & Overdue SLA`)">
        {d?.active_pos_tracking.length === 0 ? (
          <Empty>Không có đơn mua hàng nào đang chờ giao.</Empty>
        ) : (
          <Table head={["Mã PO", "Nhà cung cấp", "Ngày đặt", "Ngày hẹn giao (ETA)", "Tình trạng SLA", "Tổng tiền", "Thao tác Nhận hàng"]}>
            {d?.active_pos_tracking.map((po) => {
              const isOverdue = po.days_to_eta !== null && po.days_to_eta < 0;
              return (
                <tr key={po.id}>
                  <td className="py-2 pr-3 font-mono font-bold text-sky-700 dark:text-sky-400">{po.code}</td>
                  <td className="py-2 pr-3 font-semibold">{po.supplier_name}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">{fmtDate(po.order_date)}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">{fmtDate(po.expected_date)}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    {po.days_to_eta === null ? (
                      <span className="text-xs text-slate-400">Chưa chốt ETA</span>
                    ) : isOverdue ? (
                      <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-rose-100 text-rose-800 dark:bg-rose-950/70 dark:text-rose-300">
                        🚨 Quá hạn {Math.abs(po.days_to_eta)} ngày
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300">
                        ⏱️ Còn {po.days_to_eta} ngày
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-right font-mono whitespace-nowrap">{fmtQty(po.total_amount)} đ</td>
                  <td className="py-2 pr-3">
                    <Button variant="ghost" onClick={() => onOpenPo(po.id)}>
                      📦 Nhận hàng vào Biệt trữ (GRN) →
                    </Button>
                  </td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>
    </div>
  );
}
