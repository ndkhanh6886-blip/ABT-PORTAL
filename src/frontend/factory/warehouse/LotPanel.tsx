"use client";

import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ActionBar, type AllowedAction } from "../actions";
import { api, fmtDate, fmtQty, useFactoryMe } from "../api";
import { PutAway } from "./PutAway";
import { Button, Card, ErrorNote, inputClass, StatusBadge, Table } from "../ui";

const LOT_MOVEMENT_REASON_LABEL: Record<string, string> = {
  INITIAL_BALANCE: "📦 Tồn kho đầu kỳ",
  PURCHASE_RECEIPT: "📥 Nhập mua hàng (NCC)",
  PO_RECEIPT: "📥 Nhập mua hàng (PO)",
  GOODS_RECEIPT: "📥 Nhập hàng mua về",
  PREPARATION: "🧪 Nhập bán thành phẩm pha chế",
  PRODUCTION_OUTPUT: "🏭 Nhập thành phẩm sản xuất",
  PUTAWAY: "📦 Cất lên kệ chính (BT ➔ A1)",
  DEPT_SUPPLY: "🚚 Cấp phát sang Kho Nhánh",
  INTER_WAREHOUSE: "🔄 Điều chuyển Liên kho",
  REPLENISHMENT: "🚚 Bổ sung tồn kho nhánh",
  RELOCATE: "Đổi vị trí trong kho",
  PRODUCTION: "📤 Xuất sản xuất",
  SYNTHESIS: "🧬 Xuất chạy Mẻ tổng hợp Oligo",
  POST_SYNTHESIS: "🧪 Xuất Hậu tổng hợp Oligo",
  RND: "🔬 Xuất Nghiên cứu R&D",
  QC_SAMPLE: "🛡️ Xuất mẫu kiểm nghiệm QC",
  SCRAP: "🗑️ Xuất hủy",
  RETURN_TO_SUPPLIER: "↩️ Xuất trả nhà cung cấp",
  COUNT_DIFF: "⚖️ Điều chỉnh kiểm kê",
  DAMAGE: "⚠️ Điều chỉnh hư hỏng",
};

interface LotDetail {
  id: string;
  code: string;
  item_id: string;
  item_code: string;
  item_name: string;
  item_type?: string;
  base_uom: string;
  mfr_lot_no: string | null;
  status: string;
  expiry_date: string | null;
  mfg_date: string | null;
  received_date: string;
  origin: string;
  version: number;
  balances: { location_id: string; location_code: string; is_quarantine: boolean; warehouse_id: string; warehouse_code: string; qty_on_hand: string; qty_reserved: string }[];
  qc_tests: { id: string; code: string; test_kind: string; status: string; overall_result: string | null; created_at: string }[];
  movements?: {
    line_id: string;
    document_id: string;
    document_code: string;
    doc_type: string;
    reason_code: string;
    notes: string | null;
    occurred_at: string;
    performed_by_name: string | null;
    from_wh_code: string | null;
    from_loc_code: string | null;
    to_wh_code: string | null;
    to_loc_code: string | null;
    qty: number;
    uom: string;
  }[];
  actions: AllowedAction[];
}

export type LotPanelMode = "VIEW" | "EDIT" | "ISSUE" | "ADJUST";

export const LOT_ACTION_LABEL: Record<string, string> = {
  sample: "Lấy mẫu QC",
  release: "Giải phóng lô",
  hold: "Tạm giữ",
  unhold: "Gỡ tạm giữ",
  reject: "Loại lô",
};
const QC_STATUS: Record<string, string> = {
  PLANNED: "Chờ kiểm nghiệm",
  IN_PROGRESS: "Đang kiểm nghiệm",
  RESULTS_ENTERED: "Chờ duyệt",
  REVIEWED: "Đã duyệt",
  CANCELLED: "Đã hủy",
};

/** Lot detail: quality status, QC history, basic info editing, direct stock issue, and stock balance adjustment. */
export function LotPanel({
  lotId,
  initialMode = "VIEW",
  defaultLocationId,
  onClose,
}: {
  lotId: string;
  initialMode?: LotPanelMode;
  defaultLocationId?: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const me = useFactoryMe();
  const [mode, setMode] = useState<LotPanelMode>(initialMode);
  const [opSuccessMsg, setOpSuccessMsg] = useState<string | null>(null);
  const [prepQcNote, setPrepQcNote] = useState("");
  const lot = useQuery({ queryKey: ["factory", "lot", lotId], queryFn: () => api<LotDetail>(`/api/factory/inv/lots/${lotId}`) });

  React.useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  const l = lot.data;

  // State for EDIT basic info
  const [editForm, setEditForm] = useState({
    code: "",
    mfr_lot_no: "",
    mfg_date: "",
    expiry_date: "",
    received_date: "",
    item_name: "",
    item_type: "REAGENT",
    base_uom: "",
  });

  // State for ISSUE
  const [issueLocId, setIssueLocId] = useState("");
  const [issueQty, setIssueQty] = useState("");
  const [issueReason, setIssueReason] = useState("PRODUCTION");
  const [issueNotes, setIssueNotes] = useState("");

  // State for ADJUST
  const [adjustLocId, setAdjustLocId] = useState("");
  const [adjustNewQty, setAdjustNewQty] = useState("");
  const [adjustReason, setAdjustReason] = useState("COUNT_DIFF");
  const [adjustNotes, setAdjustNotes] = useState("");

  React.useEffect(() => {
    if (!l) return;
    setEditForm({
      code: l.code || "",
      mfr_lot_no: l.mfr_lot_no || "",
      mfg_date: l.mfg_date ? l.mfg_date.slice(0, 10) : "",
      expiry_date: l.expiry_date ? l.expiry_date.slice(0, 10) : "",
      received_date: l.received_date ? l.received_date.slice(0, 10) : "",
      item_name: l.item_name || "",
      item_type: l.item_type || "REAGENT",
      base_uom: l.base_uom || "g",
    });
    const preferredBal =
      (defaultLocationId ? l.balances.find((b) => b.location_id === defaultLocationId) : undefined) ??
      l.balances.find((b) => Number(b.qty_on_hand) > 0) ??
      l.balances[0];
    if (preferredBal) {
      setIssueLocId(preferredBal.location_id);
      setAdjustLocId(preferredBal.location_id);
      setAdjustNewQty(String(Number(preferredBal.qty_on_hand)));
    }
  }, [l, defaultLocationId]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["factory", "lot", lotId] });
    qc.invalidateQueries({ queryKey: ["factory", "stock"] });
    qc.invalidateQueries({ queryKey: ["factory", "items"] });
    qc.invalidateQueries({ queryKey: ["factory", "documents"] });
    qc.invalidateQueries({ queryKey: ["factory", "qc-tests"] });
    qc.invalidateQueries({ queryKey: ["factory", "prep-log"] });
    qc.invalidateQueries({ queryKey: ["factory", "warehouse-hub-ops"] });
  };

  const editBasicMut = useMutation({
    mutationFn: () =>
      api<{ ok: boolean; code: string }>(`/api/factory/inv/lots/${lotId}`, {
        method: "PATCH",
        json: {
          code: editForm.code.trim(),
          mfr_lot_no: editForm.mfr_lot_no.trim() || null,
          mfg_date: editForm.mfg_date || null,
          expiry_date: editForm.expiry_date || null,
          received_date: editForm.received_date || null,
          item_name: editForm.item_name.trim(),
          item_type: editForm.item_type,
          base_uom: editForm.base_uom.trim(),
        },
      }),
    onSuccess: (res) => {
      setOpSuccessMsg(`✅ Đã lưu cập nhật thông tin lô ${res.code}.`);
      setMode("VIEW");
      refresh();
    },
  });

  const quickIssueMut = useMutation({
    mutationFn: () =>
      api<{ ok: boolean; document_code: string; issued_qty: number; remaining_qty: number; uom: string }>(
        `/api/factory/inv/lots/${lotId}`,
        {
          method: "POST",
          json: {
            op: "quick_issue",
            location_id: issueLocId,
            qty: Number(issueQty.replace(",", ".")),
            reason_code: issueReason,
            notes: issueNotes.trim() || undefined,
          },
        }
      ),
    onSuccess: (res) => {
      setOpSuccessMsg(
        `✅ Đã lập & ghi sổ Phiếu Xuất ${res.document_code}: xuất ${fmtQty(res.issued_qty)} ${res.uom} (Tồn còn lại: ${fmtQty(res.remaining_qty)} ${res.uom}).`
      );
      setIssueQty("");
      setIssueNotes("");
      setMode("VIEW");
      refresh();
    },
  });

  const quickAdjustMut = useMutation({
    mutationFn: () =>
      api<{ ok: boolean; document_code: string; previous_qty: number; new_qty: number; delta: number; uom: string }>(
        `/api/factory/inv/lots/${lotId}`,
        {
          method: "POST",
          json: {
            op: "quick_adjust",
            location_id: adjustLocId,
            new_qty_on_hand: Number(adjustNewQty.replace(",", ".")),
            reason_code: adjustReason,
            notes: adjustNotes.trim() || undefined,
          },
        }
      ),
    onSuccess: (res) => {
      const sign = res.delta > 0 ? `+${fmtQty(res.delta)}` : fmtQty(res.delta);
      setOpSuccessMsg(
        `✅ Đã ghi sổ Phiếu Cân đối tồn kho ${res.document_code}: ${fmtQty(res.previous_qty)} → ${fmtQty(res.new_qty)} ${res.uom} (Chênh lệch: ${sign} ${res.uom}).`
      );
      setAdjustNotes("");
      setMode("VIEW");
      refresh();
    },
  });

  const prepQcMut = useMutation({
    mutationFn: ({ result, notes }: { result: "PASS" | "FAIL"; notes?: string }) =>
      api(`/api/factory/prep/preparations/${lotId}/qc`, {
        method: "POST",
        json: { result, notes: notes || undefined },
      }),
    onSuccess: () => {
      setPrepQcNote("");
      refresh();
    },
  });

  const canConfirmPrepQc = Boolean(
    me.data?.is_root ||
      me.data?.is_admin ||
      me.data?.permissions.some((p) =>
        ["prep.execute", "prep.formula.manage", "inv.lot.release", "qms.qc.review"].includes(p)
      )
  );

  const selectedIssueBal = l?.balances.find((b) => b.location_id === issueLocId) ?? l?.balances[0];
  const selectedIssueAvail = selectedIssueBal
    ? Math.max(0, Number(selectedIssueBal.qty_on_hand) - Number(selectedIssueBal.qty_reserved))
    : 0;

  const selectedAdjustBal = l?.balances.find((b) => b.location_id === adjustLocId) ?? l?.balances[0];
  const currentAdjustOnHand = selectedAdjustBal ? Number(selectedAdjustBal.qty_on_hand) : 0;
  const parsedNewAdjustQty = Number(String(adjustNewQty).replace(",", "."));
  const adjustDelta = Number.isFinite(parsedNewAdjustQty)
    ? Math.round((parsedNewAdjustQty - currentAdjustOnHand) * 1_000_000) / 1_000_000
    : 0;

  return (
    <Card
      title={l ? `Lô ${l.code} — ${l.item_code} ${l.item_name}` : "Lô"}
      actions={
        <div className="flex flex-wrap items-center gap-1.5">
          {l && (
            <>
              <button
                type="button"
                onClick={() => {
                  setOpSuccessMsg(null);
                  setMode(mode === "EDIT" ? "VIEW" : "EDIT");
                }}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition cursor-pointer ${
                  mode === "EDIT"
                    ? "bg-amber-600 text-white border-amber-600"
                    : "bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border-amber-300 dark:border-amber-800 hover:bg-amber-100"
                }`}
              >
                ✏️ Sửa thông tin
              </button>
              <button
                type="button"
                onClick={() => {
                  setOpSuccessMsg(null);
                  setMode(mode === "ISSUE" ? "VIEW" : "ISSUE");
                }}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition cursor-pointer ${
                  mode === "ISSUE"
                    ? "bg-rose-600 text-white border-rose-600"
                    : "bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-300 border-rose-300 dark:border-rose-800 hover:bg-rose-100"
                }`}
              >
                📤 Xuất kho lô này
              </button>
              <button
                type="button"
                onClick={() => {
                  setOpSuccessMsg(null);
                  setMode(mode === "ADJUST" ? "VIEW" : "ADJUST");
                }}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition cursor-pointer ${
                  mode === "ADJUST"
                    ? "bg-indigo-600 text-white border-indigo-600"
                    : "bg-indigo-50 dark:bg-indigo-950/40 text-indigo-800 dark:text-indigo-300 border-indigo-300 dark:border-indigo-800 hover:bg-indigo-100"
                }`}
              >
                ⚖️ Cân đối tồn kho
              </button>
            </>
          )}
          <Button variant="ghost" onClick={onClose}>
            Đóng
          </Button>
        </div>
      }
    >
      <ErrorNote error={lot.error} />
      {opSuccessMsg && (
        <div className="mb-3 rounded-xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50/80 dark:bg-emerald-950/40 px-3 py-2 text-xs font-semibold text-emerald-800 dark:text-emerald-200 flex items-center justify-between gap-2">
          <span>{opSuccessMsg}</span>
          <button type="button" onClick={() => setOpSuccessMsg(null)} className="text-emerald-600 hover:underline cursor-pointer">
            ✕
          </button>
        </div>
      )}
      {l && (
        <div className="flex flex-col gap-3">
          {mode === "EDIT" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                editBasicMut.mutate();
              }}
              className="rounded-xl border-2 border-amber-300 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20 p-3 space-y-3 text-xs"
            >
              <div className="flex items-center justify-between">
                <b className="text-amber-900 dark:text-amber-200">
                  ✏️ Chỉnh sửa thông tin cơ bản của Lô &amp; Vật tư ({l.item_code})
                </b>
                <button type="button" onClick={() => setMode("VIEW")} className="text-slate-500 hover:underline cursor-pointer">
                  Đóng khung sửa
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
                <label className="space-y-1">
                  <span className="font-semibold text-slate-600 dark:text-slate-300">Tên vật tư / Hóa chất *</span>
                  <input
                    className={`${inputClass} w-full`}
                    value={editForm.item_name}
                    onChange={(e) => setEditForm({ ...editForm, item_name: e.target.value })}
                    required
                  />
                </label>
                <label className="space-y-1">
                  <span className="font-semibold text-slate-600 dark:text-slate-300">Phân loại vật tư</span>
                  <select
                    className={`${inputClass} w-full`}
                    value={editForm.item_type}
                    onChange={(e) => setEditForm({ ...editForm, item_type: e.target.value })}
                  >
                    <option value="REAGENT">🧪 Hóa chất / Thuốc thử / Mồi (REAGENT)</option>
                    <option value="RAW_MATERIAL">🧪 Nguyên liệu gốc (RAW_MATERIAL)</option>
                    <option value="CONSUMABLE">📦 Vật tư tiêu hao / Bao bì (CONSUMABLE)</option>
                    <option value="COMPONENT">🔩 Linh kiện / Phụ kiện (COMPONENT)</option>
                    <option value="SPARE_PART">⚙️ Phụ tùng thay thế (SPARE_PART)</option>
                    <option value="SEMI_FINISHED">⚗️ Bán thành phẩm (SEMI_FINISHED)</option>
                    <option value="FINISHED_KIT">📦 Thành phẩm / Bộ Kit (FINISHED_KIT)</option>
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="font-semibold text-slate-600 dark:text-slate-300">Đơn vị tính (ĐVT) *</span>
                  <input
                    className={`${inputClass} w-full font-mono`}
                    value={editForm.base_uom}
                    onChange={(e) => setEditForm({ ...editForm, base_uom: e.target.value })}
                    required
                  />
                </label>
                <label className="space-y-1">
                  <span className="font-semibold text-slate-600 dark:text-slate-300">Mã lô nội bộ *</span>
                  <input
                    className={`${inputClass} w-full font-mono`}
                    value={editForm.code}
                    onChange={(e) => setEditForm({ ...editForm, code: e.target.value })}
                    required
                  />
                </label>
                <label className="space-y-1">
                  <span className="font-semibold text-slate-600 dark:text-slate-300">Số lô NSX (Mfr Lot)</span>
                  <input
                    className={`${inputClass} w-full font-mono`}
                    value={editForm.mfr_lot_no}
                    onChange={(e) => setEditForm({ ...editForm, mfr_lot_no: e.target.value })}
                    placeholder="VD: 251209"
                  />
                </label>
                <label className="space-y-1">
                  <span className="font-semibold text-slate-600 dark:text-slate-300">Ngày sản xuất</span>
                  <input
                    type="date"
                    className={`${inputClass} w-full`}
                    value={editForm.mfg_date}
                    onChange={(e) => setEditForm({ ...editForm, mfg_date: e.target.value })}
                  />
                </label>
                <label className="space-y-1">
                  <span className="font-semibold text-slate-600 dark:text-slate-300">Hạn dùng (HSD)</span>
                  <input
                    type="date"
                    className={`${inputClass} w-full`}
                    value={editForm.expiry_date}
                    onChange={(e) => setEditForm({ ...editForm, expiry_date: e.target.value })}
                  />
                </label>
                <label className="space-y-1">
                  <span className="font-semibold text-slate-600 dark:text-slate-300">Ngày nhận kho</span>
                  <input
                    type="date"
                    className={`${inputClass} w-full`}
                    value={editForm.received_date}
                    onChange={(e) => setEditForm({ ...editForm, received_date: e.target.value })}
                  />
                </label>
              </div>
              <div className="flex items-center gap-2">
                <Button type="submit" disabled={editBasicMut.isPending}>
                  💾 Lưu thay đổi thông tin
                </Button>
                <Button type="button" variant="ghost" onClick={() => setMode("VIEW")}>
                  Hủy
                </Button>
              </div>
              <ErrorNote error={editBasicMut.error} />
            </form>
          )}

          {mode === "ISSUE" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                quickIssueMut.mutate();
              }}
              className="rounded-xl border-2 border-rose-300 dark:border-rose-800 bg-rose-50/50 dark:bg-rose-950/20 p-3 space-y-3 text-xs"
            >
              <div className="flex items-center justify-between">
                <b className="text-rose-900 dark:text-rose-200">
                  📤 Xuất kho trực tiếp từ Lô {l.code} ({l.item_code} · {l.item_name})
                </b>
                <button type="button" onClick={() => setMode("VIEW")} className="text-slate-500 hover:underline cursor-pointer">
                  Đóng khung xuất
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
                <label className="space-y-1">
                  <span className="font-semibold text-slate-600 dark:text-slate-300">Kho · Vị trí xuất *</span>
                  <select
                    className={`${inputClass} w-full`}
                    value={issueLocId}
                    onChange={(e) => setIssueLocId(e.target.value)}
                    required
                  >
                    {l.balances.map((b) => (
                      <option key={b.location_id} value={b.location_id}>
                        {b.warehouse_code} · {b.location_code} (Khả dụng:{" "}
                        {fmtQty(Math.max(0, Number(b.qty_on_hand) - Number(b.qty_reserved)))} {l.base_uom})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="font-semibold text-slate-600 dark:text-slate-300 flex items-center justify-between">
                    <span>Số lượng xuất ({l.base_uom}) *</span>
                    {selectedIssueAvail > 0 && (
                      <button
                        type="button"
                        onClick={() => setIssueQty(String(selectedIssueAvail))}
                        className="text-[11px] font-bold text-rose-700 dark:text-rose-300 hover:underline cursor-pointer"
                      >
                        Xuất hết ({fmtQty(selectedIssueAvail)})
                      </button>
                    )}
                  </span>
                  <input
                    type="number"
                    step="any"
                    min="0.000001"
                    max={selectedIssueAvail || undefined}
                    className={`${inputClass} w-full font-mono font-bold`}
                    placeholder={`Tối đa ${fmtQty(selectedIssueAvail)} ${l.base_uom}`}
                    value={issueQty}
                    onChange={(e) => setIssueQty(e.target.value)}
                    required
                  />
                </label>
                <label className="space-y-1">
                  <span className="font-semibold text-slate-600 dark:text-slate-300">Nghiệp vụ / Lý do xuất *</span>
                  <select
                    className={`${inputClass} w-full`}
                    value={issueReason}
                    onChange={(e) => setIssueReason(e.target.value)}
                  >
                    <option value="PRODUCTION">🏭 Xuất dùng Sản xuất / Pha chế (PRODUCTION)</option>
                    <option value="RND">🔬 Xuất Nghiên cứu R&amp;D (RND)</option>
                    <option value="QC_SAMPLE">🛡️ Xuất mẫu kiểm nghiệm QC (QC_SAMPLE)</option>
                    <option value="SCRAP">🗑️ Xuất hủy vật tư / hết hạn (SCRAP)</option>
                    <option value="RETURN_TO_SUPPLIER">↩️ Xuất trả nhà cung cấp (RETURN_TO_SUPPLIER)</option>
                    <option value="OTHER">📝 Xuất khác (OTHER)</option>
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="font-semibold text-slate-600 dark:text-slate-300">Ghi chú / Diễn giải</span>
                  <input
                    className={`${inputClass} w-full`}
                    placeholder="VD: Xuất pha hóa chất / chạy mẻ..."
                    value={issueNotes}
                    onChange={(e) => setIssueNotes(e.target.value)}
                  />
                </label>
              </div>
              <div className="flex items-center gap-2">
                <Button type="submit" disabled={quickIssueMut.isPending || !issueLocId}>
                  📤 Xác nhận Xuất kho &amp; Ghi sổ
                </Button>
                <Button type="button" variant="ghost" onClick={() => setMode("VIEW")}>
                  Hủy
                </Button>
              </div>
              <ErrorNote error={quickIssueMut.error} />
            </form>
          )}

          {mode === "ADJUST" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                quickAdjustMut.mutate();
              }}
              className="rounded-xl border-2 border-indigo-300 dark:border-indigo-800 bg-indigo-50/50 dark:bg-indigo-950/20 p-3 space-y-3 text-xs"
            >
              <div className="flex items-center justify-between">
                <b className="text-indigo-900 dark:text-indigo-200">
                  ⚖️ Điều chỉnh / Cân đối tồn kho thực tế cho Lô {l.code} ({l.item_code} · {l.item_name})
                </b>
                <button type="button" onClick={() => setMode("VIEW")} className="text-slate-500 hover:underline cursor-pointer">
                  Đóng khung cân đối
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
                <label className="space-y-1">
                  <span className="font-semibold text-slate-600 dark:text-slate-300">Kho · Vị trí cần cân đối *</span>
                  <select
                    className={`${inputClass} w-full`}
                    value={adjustLocId}
                    onChange={(e) => {
                      const nextLoc = e.target.value;
                      setAdjustLocId(nextLoc);
                      const b = l.balances.find((x) => x.location_id === nextLoc);
                      if (b) setAdjustNewQty(String(Number(b.qty_on_hand)));
                    }}
                    required
                  >
                    {l.balances.map((b) => (
                      <option key={b.location_id} value={b.location_id}>
                        {b.warehouse_code} · {b.location_code} (Tồn sổ sách: {fmtQty(b.qty_on_hand)} {l.base_uom})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="font-semibold text-slate-600 dark:text-slate-300 flex items-center justify-between">
                    <span>Tồn thực tế mới ({l.base_uom}) *</span>
                    <span
                      className={`font-mono font-bold ${
                        adjustDelta > 0
                          ? "text-emerald-700 dark:text-emerald-300"
                          : adjustDelta < 0
                            ? "text-rose-700 dark:text-rose-300"
                            : "text-slate-400"
                      }`}
                    >
                      {adjustDelta > 0
                        ? `Tăng +${fmtQty(adjustDelta)} ${l.base_uom}`
                        : adjustDelta < 0
                          ? `Giảm ${fmtQty(adjustDelta)} ${l.base_uom}`
                          : "Không đổi"}
                    </span>
                  </span>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    className={`${inputClass} w-full font-mono font-bold`}
                    value={adjustNewQty}
                    onChange={(e) => setAdjustNewQty(e.target.value)}
                    required
                  />
                </label>
                <label className="space-y-1">
                  <span className="font-semibold text-slate-600 dark:text-slate-300">Lý do cân đối tồn kho *</span>
                  <select
                    className={`${inputClass} w-full`}
                    value={adjustReason}
                    onChange={(e) => setAdjustReason(e.target.value)}
                  >
                    <option value="COUNT_DIFF">⚖️ Chênh lệch kiểm kê thực tế (COUNT_DIFF)</option>
                    <option value="DAMAGE">⚠️ Hao hụt / Hư hỏng / Đổ vỡ (DAMAGE)</option>
                    <option value="OTHER">📝 Điều chỉnh số liệu tồn kho (OTHER)</option>
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="font-semibold text-slate-600 dark:text-slate-300">Diễn giải / Nguyên nhân *</span>
                  <input
                    className={`${inputClass} w-full`}
                    placeholder="VD: Kiểm kê thực tế cuối tuần / điều chỉnh sai số..."
                    value={adjustNotes}
                    onChange={(e) => setAdjustNotes(e.target.value)}
                  />
                </label>
              </div>
              <div className="flex items-center gap-2">
                <Button type="submit" disabled={quickAdjustMut.isPending || !adjustLocId || Math.abs(adjustDelta) < 1e-7}>
                  ⚖️ Ghi sổ Cân đối tồn kho ({fmtQty(currentAdjustOnHand)} → {Number.isFinite(parsedNewAdjustQty) ? fmtQty(parsedNewAdjustQty) : "—"} {l.base_uom})
                </Button>
                <Button type="button" variant="ghost" onClick={() => setMode("VIEW")}>
                  Hủy
                </Button>
              </div>
              <ErrorNote error={quickAdjustMut.error} />
            </form>
          )}

          <dl className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
            <div><dt className="text-slate-400">Trạng thái</dt><dd><StatusBadge status={l.status} /></dd></div>
            <div><dt className="text-slate-400">Lô NSX</dt><dd className="font-mono">{l.mfr_lot_no ?? "—"}</dd></div>
            <div><dt className="text-slate-400">Ngày SX</dt><dd>{fmtDate(l.mfg_date)}</dd></div>
            <div><dt className="text-slate-400">Hạn dùng</dt><dd>{fmtDate(l.expiry_date)}</dd></div>
            <div><dt className="text-slate-400">Nhận ngày</dt><dd>{fmtDate(l.received_date)}</dd></div>
          </dl>
          <div className="text-xs">
            <b>Tồn theo vị trí:</b>{" "}
            {l.balances.length === 0 ? "không còn tồn" : l.balances.map((b) => `${b.warehouse_code}·${b.location_code}${b.is_quarantine ? " (biệt trữ)" : ""}: ${fmtQty(b.qty_on_hand)}`).join(" · ")}
          </div>
          {l.status === "RELEASED" && me.data?.permissions.includes("inv.document.post") && l.balances.some((b) => b.is_quarantine) && (
            <PutAway lotId={l.id} warehouseId={l.balances.find((b) => b.is_quarantine)!.warehouse_id} onDone={refresh} />
          )}
          <div className="rounded-xl border border-sky-200 dark:border-sky-900/60 bg-sky-50/40 dark:bg-sky-950/20 p-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div>
              <b className="text-sky-900 dark:text-sky-300">❄️ Kiểm soát Chu kỳ Rã đông – Đông lạnh (Bio Freeze-Thaw Guard):</b>{" "}
              <span className="font-mono font-bold">
                {(l as any).freeze_thaw_count ?? 0} / {(l as any).max_freeze_thaw ?? 5} lần
              </span>{" "}
              <span className="text-slate-500">
                (Tự động cảnh báo / khóa ON_HOLD nếu rã đông vượt ngưỡng cho phép của sinh phẩm)
              </span>
            </div>
            <Button
              variant="secondary"
              onClick={async () => {
                await api("/api/factory/analytics", {
                  method: "POST",
                  body: JSON.stringify({ op: "record_freeze_thaw", lot_id: l.id, increment: 1 }),
                });
                refresh();
              }}
            >
              ❄️ +1 Ghi nhận Rã đông
            </Button>
          </div>
          {l.origin === "PREPARATION" && ["QUARANTINE", "PENDING_QC", "ON_HOLD"].includes(l.status) && canConfirmPrepQc && (
            <div className="rounded-xl border-2 border-emerald-400/80 dark:border-emerald-700 bg-emerald-50/70 dark:bg-emerald-950/30 p-3 space-y-2 text-xs">
              <div className="font-bold text-emerald-900 dark:text-emerald-200">
                🧪 Xác nhận Kết quả QC Nội bộ cho Lô Hóa chất Pha chế ({l.code} — {l.item_code} {l.item_name})
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  className={`${inputClass} flex-1 min-w-[220px]`}
                  placeholder="Ghi chú kết quả kiểm tra QC / cảm quan / nồng độ (tùy chọn khi Đạt, bắt buộc khi Không đạt)..."
                  value={prepQcNote}
                  onChange={(e) => setPrepQcNote(e.target.value)}
                />
                <Button
                  type="button"
                  disabled={prepQcMut.isPending}
                  onClick={() =>
                    prepQcMut.mutate({
                      result: "PASS",
                      notes: prepQcNote.trim() || "Đạt kiểm tra QC nội bộ sau pha chế",
                    })
                  }
                >
                  ✅ Đạt QC — Giải phóng &amp; Cất lên kệ A1 sử dụng
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  disabled={prepQcMut.isPending}
                  onClick={() => {
                    const failReason =
                      prepQcNote.trim() ||
                      window.prompt(`Nhập lý do lô ${l.code} không đạt QC:`, "Dung dịch không đạt cảm quan / nồng độ") ||
                      "";
                    if (failReason.trim().length >= 3) {
                      prepQcMut.mutate({ result: "FAIL", notes: failReason.trim() });
                    }
                  }}
                >
                  ❌ Không đạt (Loại lô)
                </Button>
              </div>
              <ErrorNote error={prepQcMut.error} />
            </div>
          )}
          <ActionBar endpoint={`/api/factory/inv/lots/${l.id}/actions`} version={l.version} actions={l.actions} labels={LOT_ACTION_LABEL} onDone={refresh} />
          <div>
            <h3 className="text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">Phiếu QC của lô</h3>
            {l.qc_tests.length === 0 ? (
              <p className="text-xs text-slate-400">Chưa có phiếu QC.</p>
            ) : (
              <ul className="text-xs grid gap-1">
                {l.qc_tests.map((t) => (
                  <li key={t.id} className="flex flex-wrap gap-2 items-center">
                    <span className="font-mono font-semibold">{t.code}</span>
                    <span>{t.test_kind}</span>
                    <span className="text-slate-500">{QC_STATUS[t.status] ?? t.status}</span>
                    {t.overall_result && <StatusBadge status={t.overall_result === "PASS" ? "RELEASED" : "REJECTED"} label={t.overall_result === "PASS" ? "Đạt" : "Không đạt"} />}
                  </li>
                ))}
              </ul>
            )}
          </div>
          {Array.isArray(l.movements) && l.movements.length > 0 && (
            <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
              <h3 className="text-xs font-bold text-slate-700 dark:text-slate-200 mb-1.5">
                📜 Lịch sử Nhập kho – Cấp phát – Xuất dùng của Lô {l.code} ({l.movements.length} giao dịch)
              </h3>
              <Table head={["Ngày giờ", "Mã phiếu", "Nghiệp vụ", "Từ Kho · Vị trí", "Đến Kho · Vị trí", "Số lượng", "Người thực hiện"]}>
                {l.movements.map((mv) => (
                  <tr key={mv.line_id} className="text-xs">
                    <td className="py-1.5 pr-3 whitespace-nowrap text-slate-500">
                      {new Date(mv.occurred_at).toLocaleString("vi-VN", {
                        timeZone: "Asia/Ho_Chi_Minh",
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </td>
                    <td className="py-1.5 pr-3 font-mono font-bold text-sky-700 dark:text-sky-400">{mv.document_code}</td>
                    <td className="py-1.5 pr-3 font-medium">
                      {LOT_MOVEMENT_REASON_LABEL[mv.reason_code] ?? mv.reason_code}
                      {mv.notes && <div className="text-[11px] text-slate-500">{mv.notes}</div>}
                    </td>
                    <td className="py-1.5 pr-3 font-mono">
                      {mv.from_wh_code ? `${mv.from_wh_code} · ${mv.from_loc_code ?? ""}` : "—"}
                    </td>
                    <td className="py-1.5 pr-3 font-mono font-semibold text-emerald-700 dark:text-emerald-400">
                      {mv.to_wh_code ? `${mv.to_wh_code} · ${mv.to_loc_code ?? ""}` : "—"}
                    </td>
                    <td className="py-1.5 pr-3 font-mono font-bold whitespace-nowrap">
                      {fmtQty(mv.qty)} {mv.uom}
                    </td>
                    <td className="py-1.5 pr-3">{mv.performed_by_name ?? "Hệ thống"}</td>
                  </tr>
                ))}
              </Table>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
