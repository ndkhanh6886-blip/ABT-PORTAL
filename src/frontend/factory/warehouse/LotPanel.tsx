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
  item_code: string;
  item_name: string;
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

/** Lot detail: quality status, QC history and the quality actions the user may run (signed where required). */
export function LotPanel({ lotId, onClose }: { lotId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const me = useFactoryMe();
  const [prepQcNote, setPrepQcNote] = useState("");
  const lot = useQuery({ queryKey: ["factory", "lot", lotId], queryFn: () => api<LotDetail>(`/api/factory/inv/lots/${lotId}`) });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["factory", "lot", lotId] });
    qc.invalidateQueries({ queryKey: ["factory", "stock"] });
    qc.invalidateQueries({ queryKey: ["factory", "qc-tests"] });
    qc.invalidateQueries({ queryKey: ["factory", "prep-log"] });
    qc.invalidateQueries({ queryKey: ["factory", "warehouse-hub-ops"] });
  };
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
  const l = lot.data;
  const canConfirmPrepQc = Boolean(
    me.data?.is_root ||
      me.data?.is_admin ||
      me.data?.permissions.some((p) =>
        ["prep.execute", "prep.formula.manage", "inv.lot.release", "qms.qc.review"].includes(p)
      )
  );

  return (
    <Card title={l ? `Lô ${l.code} — ${l.item_code} ${l.item_name}` : "Lô"} actions={<Button variant="ghost" onClick={onClose}>Đóng</Button>}>
      <ErrorNote error={lot.error} />
      {l && (
        <div className="flex flex-col gap-3">
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
