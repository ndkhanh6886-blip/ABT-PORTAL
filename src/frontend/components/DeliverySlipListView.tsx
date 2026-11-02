"use client";

import React, { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import {
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  FileSpreadsheet,
  Layers,
  List,
  Package,
  Plus,
  RotateCcw,
  Search,
  Truck,
  Eye,
} from "lucide-react";
import { todayVN, toVNDateString } from "@/backend/services/dates";
import { DateInputVN } from "@/frontend/components/DateInputVN";
import { Pager, usePaged } from "@/frontend/components/Pager";

type SlipStatus = "PENDING" | "DELIVERED" | "CANCELLED";

/** Ngày giao của phiếu về dạng "YYYY-MM-DD" (phiếu lưu ngày kiểu "16/10/2026" hoặc ISO). */
export function slipDateISO(slip: any): string {
  const raw = String(slip?.deliveryDate || slip?.delivery_date || "").trim();
  const vi = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (vi) return `${vi[3]}-${vi[2].padStart(2, "0")}-${vi[1].padStart(2, "0")}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  if (raw) {
    const d = toVNDateString(raw);
    if (d) return d;
  }
  return slip?.createdAt ? toVNDateString(slip.createdAt) : "";
}

const fmtVN = (iso: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "—");

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const getItemCode = (it: any) => String(it?.productCode || it?.product_code || it?.code || "").trim();
const getItemName = (it: any) => String(it?.productName || it?.product_name || it?.name || "").trim();
const getItemUnit = (it: any) => String(it?.unit || it?.uom || "").trim();

const STATUS_META: Record<SlipStatus, { label: string; cls: string }> = {
  PENDING: { label: "⏳ Chờ giao", cls: "bg-amber-950/60 text-amber-300 border-amber-600/50" },
  DELIVERED: { label: "✅ Đã giao", cls: "bg-emerald-950/60 text-emerald-300 border-emerald-600/50" },
  CANCELLED: { label: "✖ Đã huỷ", cls: "bg-slate-800 text-slate-400 border-slate-600" },
};

interface SOItemBreakdown {
  code: string;
  name: string;
  unit: string;
  orderedQty: number;
  deliveredQty: number;
  pendingQty: number;
  allocatedQty: number;
  remainingQty: number;
  batchQuantities: Record<string, { qty: number; status: SlipStatus; batchNo: number; date: string; lotNo?: string }>;
}

interface SOGroupSummary {
  orderCode: string;
  orderId: string;
  customerName: string;
  rawOrder: any | null;
  allSlips: { slip: any; date: string; status: SlipStatus; batchNo: number }[];
  activeSlips: { slip: any; date: string; status: SlipStatus; batchNo: number }[];
  itemsBreakdown: SOItemBreakdown[];
  totalOrdered: number;
  totalDelivered: number;
  totalPending: number;
  totalRemaining: number;
  latestDate: string;
  isFullyDelivered: boolean;
}

/**
 * Danh sách tất cả phiếu giao hàng:
 * - Hỗ trợ 2 chế độ xem:
 *   1. "flat": Xem theo từng phiếu giao hàng (PX26-...)
 *   2. "by_so": Xem nhóm theo từng Mã đơn SO (SO26-...) để theo dõi có những đợt giao nào,
 *      số lượng giao mỗi đợt, tổng đã giao, đang chờ giao và số lượng còn lại chưa giao.
 * - Hỗ trợ chọn lọc nhanh 1 Mã SO cụ thể từ dropdown.
 */
export function DeliverySlipListView({
  slips,
  orders = [],
  getStatus,
  resolveOrder,
  getOrderQtyProgress,
  onView,
  onCreateSlip,
  onConfirmSlip,
  onEditSlip,
  onCancelSlip,
  canConfirmForOrder,
  canEditSlip,
  getFinance,
  rmaList = [],
  onCreateRma,
  onOpenRmaList,
}: {
  slips: any[];
  orders?: any[];
  getStatus: (slip: any) => SlipStatus;
  resolveOrder?: (slip: any) => any;
  getOrderQtyProgress?: (ord: any, excludeSlipId?: string) => Record<string, { ordered: number; allocated: number; delivered: number; remaining: number }>;
  onView: (slip: any) => void;
  onCreateSlip?: (ord: any) => void;
  onConfirmSlip?: (slip: any) => void;
  onEditSlip?: (slip: any) => void;
  onCancelSlip?: (slip: any) => void;
  canConfirmForOrder?: (ord: any) => boolean;
  canEditSlip?: (slip: any) => boolean;
  /** Thành tiền phiếu (gồm VAT), số HĐ (từ Quản lý hóa đơn), số đã thu theo phiếu */
  getFinance?: (slip: any) => { amount: number; invoiceNo: string; invoiceDate?: string; paid: number };
  /** Danh sách phiếu trả hàng (RMA) & các hàm thao tác trả hàng ngay tại Phiếu giao hàng */
  rmaList?: any[];
  onCreateRma?: (ord: any, slip?: any) => void;
  onOpenRmaList?: (orderCode?: string) => void;
}) {
  const today = todayVN();
  const [from, setFrom] = useState(addDays(today, -30));
  const [to, setTo] = useState(addDays(today, 14));
  const [status, setStatus] = useState<"all" | SlipStatus>("all");
  const [payFilter, setPayFilter] = useState<"all" | "paid" | "unpaid">("all");
  const isSlipPaid = (slip: any) => {
    if (!getFinance) return false;
    const f = getFinance(slip);
    return f.amount > 0 && f.paid >= f.amount - 0.5;
  };
  const [q, setQ] = useState("");
  const [viewMode, setViewMode] = useState<"flat" | "by_so">("flat");
  const [selectedSOCode, setSelectedSOCode] = useState<string>("all");
  const [expandedSOs, setExpandedSOs] = useState<Record<string, boolean>>({});

  // Danh sách toàn bộ phiếu hợp lệ (không phải bản nháp xem trước)
  const allValidSlips = useMemo(() => {
    return (slips || [])
      .filter((s) => s && !s.isDraftPreview)
      .map((s) => ({
        slip: s,
        date: slipDateISO(s),
        status: getStatus(s),
      }));
  }, [slips, getStatus]);

  // Danh sách tất cả các Mã đơn SO có phiếu giao để hiển thị trong Dropdown chọn nhanh Mã SO
  const allSOCodes = useMemo(() => {
    const map = new Map<string, { code: string; customerName: string; slipCount: number }>();
    allValidSlips.forEach(({ slip }) => {
      const code = String(slip.orderCode || slip.orderId || "").trim();
      if (!code) return;
      const existing = map.get(code);
      if (existing) {
        existing.slipCount += 1;
      } else {
        map.set(code, {
          code,
          customerName: String(slip.customerName || ""),
          slipCount: 1,
        });
      }
    });
    return Array.from(map.values()).sort((a, b) => b.code.localeCompare(a.code));
  }, [allValidSlips]);

  // Dữ liệu lọc theo điều kiện (Khi đã chọn 1 Mã SO cụ thể, tự động lấy tất cả các đợt của SO đó để không bị sót đợt cũ ngoài khoảng ngày)
  const rows = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return allValidSlips
      .filter((r) => {
        if (selectedSOCode !== "all") {
          return String(r.slip.orderCode || r.slip.orderId || "").trim() === selectedSOCode;
        }
        return (!from || r.date >= from) && (!to || r.date <= to);
      })
      .filter((r) => status === "all" || r.status === status)
      .filter((r) => {
        if (payFilter === "all" || !getFinance) return true;
        if (r.status === "CANCELLED") return false;
        return (payFilter === "paid") === isSlipPaid(r.slip);
      })
      .filter((r) => {
        if (!kw) return true;
        const s = r.slip;
        return [
          s.id,
          s.orderCode,
          s.customerName,
          s.creatorName,
          s.dispatcherName,
          ...(s.items || []).map((it: any) => `${it.productCode} ${it.productName} ${it.lotNo}`),
        ].some((v) => String(v || "").toLowerCase().includes(kw));
      })
      .sort((a, b) =>
        a.date === b.date ? String(b.slip.id).localeCompare(String(a.slip.id)) : b.date.localeCompare(a.date)
      );
  }, [allValidSlips, from, to, status, q, selectedSOCode, payFilter, getFinance]);

  const counts = useMemo(() => {
    const c = { all: rows.length, PENDING: 0, DELIVERED: 0, CANCELLED: 0 } as Record<string, number>;
    rows.forEach((r) => (c[r.status] = (c[r.status] || 0) + 1));
    return c;
  }, [rows]);

  // Tổng hợp dữ liệu nhóm theo từng Mã đơn SO (bao gồm Đợt 1, Đợt 2..., SL giao mỗi đợt, và SL còn lại chưa giao)
  const soGroups = useMemo<SOGroupSummary[]>(() => {
    // Tìm các mã SO xuất hiện trong danh sách đang lọc
    const matchedOrderCodes = Array.from(
      new Set(rows.map((r) => String(r.slip.orderCode || r.slip.orderId || "").trim()).filter(Boolean))
    );

    return matchedOrderCodes.map((orderCode) => {
      // Lấy TẤT CẢ các phiếu giao của SO này (để tính đúng luỹ kế các đợt 1, 2, 3... và SL còn lại)
      const soSlipsRaw = allValidSlips
        .filter((r) => String(r.slip.orderCode || r.slip.orderId || "").trim() === orderCode)
        .sort(
          (a, b) =>
            (Number(a.slip.batchNumber) || 0) - (Number(b.slip.batchNumber) || 0) ||
            a.date.localeCompare(b.date) ||
            String(a.slip.id).localeCompare(String(b.slip.id))
        );

      const allSlips = soSlipsRaw.map((r, idx) => ({
        ...r,
        batchNo: Number(r.slip.batchNumber) || idx + 1,
      }));
      const activeSlips = allSlips.filter((r) => r.status !== "CANCELLED");

      const sampleSlip = allSlips[0]?.slip;
      const rawOrder =
        (resolveOrder ? resolveOrder(sampleSlip) : null) ||
        (orders || []).find(
          (fo: any) =>
            String(fo.linkedSalesOrderId || "") === orderCode ||
            String(fo.id || "") === orderCode ||
            String(fo.id || "") === String(sampleSlip?.orderId || "")
        ) ||
        null;

      const progressMap = rawOrder && getOrderQtyProgress ? getOrderQtyProgress(rawOrder) : null;

      // Tập hợp danh mục mặt hàng từ đơn gốc SO (nếu có) + từ tất cả các phiếu giao của SO
      const itemMap = new Map<string, SOItemBreakdown>();

      if (rawOrder && Array.isArray(rawOrder.items)) {
        rawOrder.items.forEach((it: any) => {
          const code = getItemCode(it);
          if (!code) return;
          const ordered = Number(it.quantity) || 0;
          const existing = itemMap.get(code);
          if (existing) {
            existing.orderedQty += ordered;
          } else {
            itemMap.set(code, {
              code,
              name: getItemName(it) || code,
              unit: getItemUnit(it) || "Hộp",
              orderedQty: ordered,
              deliveredQty: 0,
              pendingQty: 0,
              allocatedQty: 0,
              remainingQty: ordered,
              batchQuantities: {},
            });
          }
        });
      }

      // Điền số lượng giao của từng đợt (từng phiếu giao)
      allSlips.forEach(({ slip, status: st, batchNo, date }) => {
        (slip.items || []).forEach((it: any) => {
          const code = getItemCode(it);
          if (!code) return;
          const qty = Number(it.quantity) || 0;
          let entry = itemMap.get(code);
          if (!entry) {
            entry = {
              code,
              name: getItemName(it) || code,
              unit: getItemUnit(it) || "Hộp",
              orderedQty: Number(it.orderedQty || it.orderQuantity || qty) || qty,
              deliveredQty: 0,
              pendingQty: 0,
              allocatedQty: 0,
              remainingQty: 0,
              batchQuantities: {},
            };
            itemMap.set(code, entry);
          }

          const prevSlipQty = entry.batchQuantities[slip.id]?.qty || 0;
          entry.batchQuantities[slip.id] = {
            qty: prevSlipQty + qty,
            status: st,
            batchNo,
            date,
            lotNo: it.lotNo,
          };

          if (st === "DELIVERED") {
            entry.deliveredQty += qty;
            entry.allocatedQty += qty;
          } else if (st === "PENDING") {
            entry.pendingQty += qty;
            entry.allocatedQty += qty;
          }
        });
      });

      // Đồng bộ với progressMap từ đơn gốc SO để số lượng Đặt & Còn lại chưa giao chuẩn xác 100%
      const itemsBreakdown: SOItemBreakdown[] = Array.from(itemMap.values()).map((item) => {
        const p = progressMap?.[item.code];
        const orderedQty = p ? p.ordered : Math.max(item.orderedQty, item.allocatedQty);
        const allocatedQty = p ? Math.max(p.allocated, item.allocatedQty) : item.allocatedQty;
        const isOrderDone =
          rawOrder &&
          (rawOrder.status === "Delivered" || rawOrder.status === "Completed" || rawOrder.status === "COMPLETED");
        // Số lượng còn lại chưa giao (chưa lập phiếu xuất) = SL đặt - SL đã phân bổ vào các đợt phiếu giao
        const remainingQty = isOrderDone ? 0 : Math.max(0, orderedQty - allocatedQty);
        return {
          ...item,
          orderedQty,
          allocatedQty,
          remainingQty,
        };
      });

      const totalOrdered = itemsBreakdown.reduce((s, it) => s + it.orderedQty, 0);
      const totalDelivered = itemsBreakdown.reduce((s, it) => s + it.deliveredQty, 0);
      const totalPending = itemsBreakdown.reduce((s, it) => s + it.pendingQty, 0);
      const totalRemaining = itemsBreakdown.reduce((s, it) => s + it.remainingQty, 0);
      const latestDate = allSlips.reduce((max, r) => (r.date > max ? r.date : max), "");
      const isFullyDelivered = totalRemaining === 0 && totalPending === 0 && totalDelivered >= totalOrdered && totalOrdered > 0;

      return {
        orderCode,
        orderId: String(rawOrder?.id || sampleSlip?.orderId || orderCode),
        customerName: String(sampleSlip?.customerName || rawOrder?.customerName || ""),
        rawOrder,
        allSlips,
        activeSlips,
        itemsBreakdown,
        totalOrdered,
        totalDelivered,
        totalPending,
        totalRemaining,
        latestDate,
        isFullyDelivered,
      };
    });
  }, [rows, allValidSlips, orders, resolveOrder, getOrderQtyProgress]);

  const setRange = (kind: "today" | "week" | "next_week" | "month" | "all_time") => {
    if (kind === "all_time") {
      setFrom("");
      setTo("");
      return;
    }
    const d = new Date(`${today}T00:00:00Z`);
    const dow = (d.getUTCDay() + 6) % 7; // Mon = 0
    if (kind === "today") {
      setFrom(today);
      setTo(today);
    }
    if (kind === "week") {
      setFrom(addDays(today, -dow));
      setTo(addDays(today, 6 - dow));
    }
    if (kind === "next_week") {
      setFrom(addDays(today, 7 - dow));
      setTo(addDays(today, 13 - dow));
    }
    if (kind === "month") {
      const y = Number(today.slice(0, 4));
      const m = Number(today.slice(5, 7));
      setFrom(`${today.slice(0, 7)}-01`);
      setTo(new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10));
    }
  };

  const toggleSOExpand = (orderCode: string) => {
    setExpandedSOs((prev) => ({
      ...prev,
      [orderCode]: prev[orderCode] === undefined ? false : !prev[orderCode],
    }));
  };

  const isSOExpanded = (orderCode: string) => {
    return expandedSOs[orderCode] !== false; // Mặc định mở sẵn để nhìn thấy ngay các đợt giao & SL còn lại
  };

  const filterResetKey = `${from}|${to}|${status}|${payFilter}|${q}|${selectedSOCode}|${viewMode}`;
  const soGroupsPage = usePaged(soGroups, 20, filterResetKey);
  const rowsPage = usePaged(rows, 20, filterResetKey);

  const exportExcel = () => {
    const wb = XLSX.utils.book_new();

    // Sheet 0: Mỗi phiếu một dòng (tổng tiền, số hóa đơn, thu tiền) — dùng cho Kế toán đối soát
    const outSum: any[][] = [[
      "Mã phiếu", "Ngày giao", "Trạng thái", "Đợt", "Mã đơn SO", "Khách hàng", "Số mặt hàng", "Tổng SL",
      "Thành tiền (gồm VAT)", "Số hóa đơn", "Ngày hóa đơn", "Đã thu", "Còn phải thu", "Người lập", "Người giao",
    ]];
    rows.forEach(({ slip, date, status: st }) => {
      const items: any[] = slip.items || [];
      const f = getFinance ? getFinance(slip) : { amount: 0, invoiceNo: "", invoiceDate: "", paid: 0 };
      outSum.push([
        slip.id, fmtVN(date), STATUS_META[st].label.replace(/^[^ ]+ /, ""), slip.batchNumber || "", slip.orderCode || "",
        slip.customerName || "", items.length, items.reduce((a, it) => a + (Number(it.quantity) || 0), 0),
        Math.round(f.amount || 0), f.invoiceNo || "", f.invoiceDate || "", Math.round(f.paid || 0),
        st === "CANCELLED" ? 0 : Math.max(0, Math.round((f.amount || 0) - (f.paid || 0))),
        slip.creatorName || "", slip.dispatcherName || "",
      ]);
    });
    const wsSum = XLSX.utils.aoa_to_sheet(outSum);
    wsSum["!cols"] = [{ wch: 15 }, { wch: 12 }, { wch: 12 }, { wch: 6 }, { wch: 18 }, { wch: 34 }, { wch: 10 }, { wch: 9 }, { wch: 16 }, { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 18 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, wsSum, "Tổng hợp phiếu");

    // Sheet 1: Danh sách chi tiết phiếu giao hàng
    const outSlips: any[][] = [
      [
        "Mã phiếu",
        "Ngày giao",
        "Trạng thái",
        "Đợt",
        "Mã đơn SO",
        "Khách hàng",
        "Mã hàng",
        "Tên hàng",
        "ĐVT",
        "Số lô",
        "Hạn dùng",
        "SL giao đợt này",
        "Người lập",
        "Người giao",
        "Ghi chú phiếu",
      ],
    ];
    rows.forEach(({ slip, date, status: st }) => {
      const items: any[] = slip.items || [];
      (items.length ? items : [{}]).forEach((it: any) => {
        outSlips.push([
          slip.id,
          fmtVN(date),
          STATUS_META[st].label.replace(/^[^ ]+ /, ""),
          slip.batchNumber || "",
          slip.orderCode || "",
          slip.customerName || "",
          it.productCode || "",
          it.productName || "",
          it.unit || "",
          String(it.lotNo || "").replace(/\s*\(\s*Tồn[^)]*\)/gi, "").trim(),
          it.expDate || "",
          Number(it.quantity) || 0,
          slip.creatorName || "",
          slip.dispatcherName || "",
          slip.notes || "",
        ]);
      });
    });
    const wsSlips = XLSX.utils.aoa_to_sheet(outSlips);
    wsSlips["!cols"] = [
      { wch: 15 },
      { wch: 12 },
      { wch: 12 },
      { wch: 6 },
      { wch: 18 },
      { wch: 34 },
      { wch: 14 },
      { wch: 40 },
      { wch: 8 },
      { wch: 14 },
      { wch: 12 },
      { wch: 14 },
      { wch: 18 },
      { wch: 18 },
      { wch: 30 },
    ];
    XLSX.utils.book_append_sheet(wb, wsSlips, "Chi tiết mặt hàng");

    // Sheet 2: Tổng hợp theo Mã đơn SO & Số lượng còn lại chưa giao
    const outSO: any[][] = [
      [
        "Mã đơn SO",
        "Khách hàng",
        "Số đợt giao",
        "Mã hàng",
        "Tên mặt hàng",
        "ĐVT",
        "SL Đặt (SO)",
        "Chi tiết các đợt giao",
        "SL Đã giao",
        "SL Chờ giao",
        "SL Còn lại chưa lập phiếu",
        "Tổng chưa hoàn tất giao",
      ],
    ];
    soGroups.forEach((group) => {
      group.itemsBreakdown.forEach((it) => {
        const batchDesc = group.activeSlips
          .map((s) => {
            const bq = it.batchQuantities[s.slip.id];
            if (!bq || !bq.qty) return null;
            return `Đợt ${s.batchNo} (${s.slip.id} - ${fmtVN(s.date)}): ${bq.qty}`;
          })
          .filter(Boolean)
          .join(" | ");
        outSO.push([
          group.orderCode,
          group.customerName,
          group.activeSlips.length,
          it.code,
          it.name,
          it.unit,
          it.orderedQty,
          batchDesc || "Chưa có đợt giao",
          it.deliveredQty,
          it.pendingQty,
          it.remainingQty,
          it.remainingQty + it.pendingQty,
        ]);
      });
    });
    const wsSO = XLSX.utils.aoa_to_sheet(outSO);
    wsSO["!cols"] = [
      { wch: 18 },
      { wch: 34 },
      { wch: 12 },
      { wch: 14 },
      { wch: 38 },
      { wch: 8 },
      { wch: 12 },
      { wch: 48 },
      { wch: 12 },
      { wch: 12 },
      { wch: 22 },
      { wch: 20 },
    ];
    XLSX.utils.book_append_sheet(wb, wsSO, "Tiến độ giao theo SO");

    XLSX.writeFile(wb, `Phieu_giao_hang_${from || "all"}_${to || "all"}.xlsx`);
  };

  return (
    <div className="space-y-4">
      {/* Top Bar: Title + View Mode Switcher + Export Excel */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-white font-bold">
            <Truck className="w-5 h-5 text-emerald-400" />
            <span>Danh sách phiếu giao hàng</span>
            <span className="text-xs text-slate-400 font-normal">
              ({rows.length} phiếu • {soGroups.length} đơn SO)
            </span>
          </div>

          {/* Nút chuyển đổi chế độ hiển thị: Theo từng phiếu vs Nhóm theo Mã đơn SO */}
          <div className="flex items-center bg-slate-900 p-1 rounded-xl border border-slate-800 gap-1">
            <button
              type="button"
              onClick={() => setViewMode("flat")}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                viewMode === "flat"
                  ? "bg-indigo-600 text-white shadow-xs"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
              }`}
            >
              <List className="w-3.5 h-3.5" />
              <span>Theo từng phiếu ({rows.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode("by_so")}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                viewMode === "by_so"
                  ? "bg-indigo-600 text-white shadow-xs"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Theo từng Mã SO &amp; Đợt giao ({soGroups.length} SO)</span>
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {onOpenRmaList && (
            <button
              type="button"
              onClick={() => onOpenRmaList("")}
              className="px-3 py-2 rounded-lg text-xs font-bold bg-amber-600 hover:bg-amber-500 text-white flex items-center gap-1.5 cursor-pointer shadow-xs"
              title="Quản lý danh sách Đơn Hàng Trả Bán (RMA) hoặc bấm nút ↩ Trả hàng trên từng phiếu giao hàng bên dưới"
            >
              <RotateCcw className="w-4 h-4" />
              <span>↩ Đơn Hàng Trả Bán / RMA ({(rmaList || []).length})</span>
              {(rmaList || []).some((r: any) => r.status === "PENDING" || r.status === "PENDING_APPROVAL") && (
                <span className="ml-0.5 px-1.5 py-0.5 rounded-full bg-white text-amber-800 text-[10px] font-black animate-pulse">
                  {(rmaList || []).filter((r: any) => r.status === "PENDING" || r.status === "PENDING_APPROVAL").length} chờ duyệt
                </span>
              )}
            </button>
          )}
          <button
            type="button"
            onClick={exportExcel}
            className="px-3 py-2 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white flex items-center gap-1.5 cursor-pointer shadow-xs"
          >
            <FileSpreadsheet className="w-4 h-4" /> Xuất Excel
          </button>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="flex flex-wrap items-end gap-3 p-3 rounded-xl border border-slate-800 bg-slate-900/60 text-xs">
        {/* Dropdown chọn nhanh theo từng Mã SO */}
        <div className="min-w-[210px]">
          <label className="block text-[10px] font-bold uppercase text-indigo-300 mb-1">
            Lọc theo Mã đơn (SO)
          </label>
          <select
            value={selectedSOCode}
            onChange={(e) => {
              const val = e.target.value;
              setSelectedSOCode(val);
              if (val !== "all") {
                setViewMode("by_so");
              }
            }}
            className="w-full bg-slate-950 border border-slate-700 hover:border-indigo-500/60 rounded-lg px-2.5 py-1.5 text-white font-mono font-bold cursor-pointer outline-none"
          >
            <option value="all">-- Tất cả mã SO ({allSOCodes.length} đơn) --</option>
            {allSOCodes.map((so) => (
              <option key={so.code} value={so.code}>
                {so.code} ({so.slipCount} đợt) — {so.customerName}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">Từ ngày giao</label>
          <DateInputVN
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            disabled={selectedSOCode !== "all"}
            className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-white font-mono disabled:opacity-50"
          />
        </div>
        <div>
          <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">Đến ngày giao</label>
          <DateInputVN
            value={to}
            onChange={(e) => setTo(e.target.value)}
            disabled={selectedSOCode !== "all"}
            className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-white font-mono disabled:opacity-50"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {(
            [
              ["today", "Hôm nay"],
              ["week", "Tuần này"],
              ["next_week", "Tuần sau"],
              ["month", "Tháng này"],
              ["all_time", "Tất cả ngày"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => {
                setSelectedSOCode("all");
                setRange(k);
              }}
              className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold cursor-pointer flex items-center gap-1"
            >
              <CalendarDays className="w-3 h-3" /> {label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {(["all", "PENDING", "DELIVERED", "CANCELLED"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setStatus(k)}
              className={`px-2.5 py-1.5 rounded-lg font-semibold cursor-pointer ${
                status === k ? "bg-indigo-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"
              }`}
            >
              {k === "all" ? "Tất cả" : STATUS_META[k].label} ({k === "all" ? counts.all : counts[k] || 0})
            </button>
          ))}
        </div>
        {getFinance && (
          <div className="flex flex-wrap items-center gap-1">
            {([["all", "Thu tiền: tất cả"], ["unpaid", "💰 Chưa thu đủ"], ["paid", "✓ Đã thu đủ"]] as const).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setPayFilter(k)}
                className={`px-2.5 py-1.5 rounded-lg font-semibold cursor-pointer ${
                  payFilter === k ? "bg-emerald-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-500" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Mã phiếu, mã đơn SO, khách hàng, mã hàng, số lô..."
            className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-2 py-1.5 text-white"
          />
        </div>
      </div>

      {/* =====================================================================
          CHẾ ĐỘ 1: HIỂN THỊ THEO TỪNG MÃ ĐƠN SO (ĐỢT GIAO & SL CÒN LẠI CHƯA GIAO)
         ===================================================================== */}
      {viewMode === "by_so" ? (
        <div className="space-y-2">
          {soGroups.length === 0 ? (
            <div className="p-8 text-center text-slate-500 rounded-xl border border-slate-800 bg-slate-900/40 text-xs">
              Không có đơn hàng SO / phiếu giao nào phù hợp với bộ lọc hiện tại.
            </div>
          ) : (
            soGroupsPage.items.map((group) => {
              const expanded = isSOExpanded(group.orderCode);
              const totalNotYetDelivered = group.totalRemaining + group.totalPending;
              const canConfirm =
                group.rawOrder && canConfirmForOrder ? canConfirmForOrder(group.rawOrder) : true;
              // "LOT01 (Tồn: 1)" -> "LOT01": số tồn lúc chọn lô không có nghĩa trên bảng theo dõi
              const cleanLot = (v: any) => String(v || "").replace(/\s*\(\s*Tồn[^)]*\)/gi, "").trim();
              const shortDate = (d: string) => (fmtVN(d) || "").replace(/\/\d{4}$/, "");

              return (
                <div
                  key={group.orderCode}
                  className="rounded-xl border border-slate-800 bg-slate-900/50 overflow-hidden"
                >
                  {/* Một dòng tiêu đề: mã SO, khách hàng, số đợt + chỉ số giao */}
                  <div
                    onClick={() => toggleSOExpand(group.orderCode)}
                    className="px-3 py-2 bg-slate-900/90 flex flex-wrap items-center gap-x-3 gap-y-1.5 cursor-pointer hover:bg-slate-800/60 transition-colors"
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1 basis-64">
                      {expanded ? (
                        <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                      )}
                      <span className="font-mono text-xs font-black text-indigo-300 shrink-0">
                        {group.orderCode}
                      </span>
                      <span className="font-bold text-white text-xs truncate" title={group.customerName || ""}>
                        {group.customerName || "Khách hàng"}
                      </span>
                      <span className="text-[10px] text-slate-400 shrink-0 whitespace-nowrap">
                        {group.activeSlips.length} đợt · {group.itemsBreakdown.length} mã
                        {group.latestDate ? ` · ${fmtVN(group.latestDate)}` : ""}
                      </span>
                    </div>

                    <div
                      className="flex flex-wrap items-center gap-1.5 text-[10px] font-mono"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span className="px-1.5 py-0.5 rounded bg-slate-950 border border-slate-800 text-slate-300">
                        Đặt <b className="text-white">{group.totalOrdered}</b>
                      </span>
                      <span className="px-1.5 py-0.5 rounded bg-emerald-950/40 border border-emerald-800/50 text-emerald-300">
                        Đã giao <b>{group.totalDelivered}</b>
                      </span>
                      {group.totalPending > 0 && (
                        <span className="px-1.5 py-0.5 rounded bg-amber-950/40 border border-amber-800/50 text-amber-300">
                          Chờ giao <b>{group.totalPending}</b>
                        </span>
                      )}
                      {group.totalRemaining > 0 ? (
                        <span
                          className="px-1.5 py-0.5 rounded bg-orange-950/60 border border-orange-600/60 text-orange-300"
                          title="Số lượng chưa lập phiếu giao"
                        >
                          Chưa lập phiếu <b>{group.totalRemaining}</b>
                        </span>
                      ) : totalNotYetDelivered === 0 ? (
                        <span className="px-1.5 py-0.5 rounded bg-emerald-950/50 border border-emerald-700/50 text-emerald-300 font-sans font-bold">
                          ✓ Giao đủ
                        </span>
                      ) : null}
                      {group.totalRemaining > 0 && onCreateSlip && group.rawOrder && (
                        <button
                          type="button"
                          onClick={() => onCreateSlip(group.rawOrder)}
                          className="px-2 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-sans font-bold text-[10px] flex items-center gap-1 cursor-pointer"
                          title="Lập phiếu giao hàng đợt tiếp theo cho số lượng còn lại"
                        >
                          <Plus className="w-3 h-3" />
                          <span>Đợt {group.activeSlips.length + 1}</span>
                        </button>
                      )}
                      {(() => {
                        const soRmas = (rmaList || []).filter(
                          (r: any) => String(r.order_code || "").trim() === group.orderCode
                        );
                        return (
                          <>
                            {soRmas.length > 0 && onOpenRmaList && (
                              <button
                                type="button"
                                onClick={() => onOpenRmaList(group.orderCode)}
                                className="px-2 py-1 rounded-lg bg-amber-950/80 hover:bg-amber-900 border border-amber-600/60 text-amber-300 font-sans font-bold text-[10px] flex items-center gap-1 cursor-pointer"
                                title="Xem danh sách phiếu trả hàng (RMA) của đơn SO này"
                              >
                                <span>📋 {soRmas.length} phiếu trả</span>
                              </button>
                            )}
                            {onCreateRma && group.activeSlips.length > 0 && (
                              <button
                                type="button"
                                onClick={() =>
                                  onCreateRma(
                                    group.rawOrder,
                                    group.activeSlips.length === 1 ? group.activeSlips[0].slip : undefined
                                  )
                                }
                                className="px-2 py-1 rounded-lg bg-amber-700 hover:bg-amber-600 text-white font-sans font-bold text-[10px] flex items-center gap-1 cursor-pointer"
                                title="Tạo phiếu trả hàng (RMA) cho đơn hàng này"
                              >
                                <span>↩ Trả hàng</span>
                              </button>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  </div>

                  {expanded && (
                    <div className="p-2 space-y-2 bg-slate-950/40 border-t border-slate-800/80">
                      {/* Số lượng theo mặt hàng qua từng đợt */}
                      <div className="overflow-x-auto rounded-lg border border-slate-800">
                        <table className="w-full text-left text-[11px]">
                          <thead>
                            <tr className="bg-slate-900/90 text-slate-400 font-bold text-[10px] border-b border-slate-800">
                              <th className="px-2 py-1">Mặt hàng</th>
                              <th className="px-2 py-1 text-center">ĐVT</th>
                              <th className="px-2 py-1 text-center">Đặt</th>
                              {group.activeSlips.map((s) => (
                                <th
                                  key={s.slip.id}
                                  className="px-2 py-1 text-center bg-indigo-950/30 whitespace-nowrap"
                                  title={`${s.slip.id} — ${fmtVN(s.date)}`}
                                >
                                  <span className="text-indigo-300">Đợt {s.batchNo}</span>
                                  <span className="font-normal text-slate-500"> {shortDate(s.date)}</span>
                                </th>
                              ))}
                              <th className="px-2 py-1 text-center text-emerald-400">Đã giao</th>
                              <th className="px-2 py-1 text-center text-orange-400">Còn</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800/80">
                            {group.itemsBreakdown.map((item) => (
                              <tr key={item.code} className="hover:bg-slate-900/40">
                                <td className="px-2 py-1 max-w-[320px]">
                                  <div className="flex items-baseline gap-1.5 min-w-0" title={`${item.code} — ${item.name}`}>
                                    <span className="font-mono font-bold text-indigo-300 shrink-0">{item.code}</span>
                                    <span className="text-slate-200 truncate">{item.name}</span>
                                  </div>
                                </td>
                                <td className="px-2 py-1 text-center text-slate-400">{item.unit}</td>
                                <td className="px-2 py-1 text-center font-mono font-bold text-white">
                                  {item.orderedQty}
                                </td>
                                {group.activeSlips.map((s) => {
                                  const bq = item.batchQuantities[s.slip.id];
                                  const lot = bq ? cleanLot(bq.lotNo) : "";
                                  return (
                                    <td
                                      key={s.slip.id}
                                      className="px-2 py-1 text-center font-mono bg-indigo-950/10 whitespace-nowrap"
                                      title={lot ? `Lô: ${lot}` : undefined}
                                    >
                                      {bq && bq.qty > 0 ? (
                                        <>
                                          <b className={bq.status === "DELIVERED" ? "text-emerald-300" : "text-amber-300"}>
                                            {bq.qty}
                                          </b>
                                          {lot && <span className="text-[9px] text-slate-500"> · {lot}</span>}
                                        </>
                                      ) : (
                                        <span className="text-slate-600">—</span>
                                      )}
                                    </td>
                                  );
                                })}
                                <td className="px-2 py-1 text-center font-mono font-bold text-emerald-400">
                                  {item.deliveredQty}
                                  {item.pendingQty > 0 && (
                                    <span className="text-amber-400 font-normal" title="Đang chờ giao">
                                      {" "}+{item.pendingQty}
                                    </span>
                                  )}
                                </td>
                                <td className="px-2 py-1 text-center font-mono font-bold">
                                  {item.remainingQty > 0 ? (
                                    <span className="text-orange-300" title="Chưa lập phiếu">{item.remainingQty}</span>
                                  ) : item.pendingQty > 0 ? (
                                    <span className="text-amber-300" title="Đã lập phiếu, đang chờ giao">0</span>
                                  ) : (
                                    <span className="text-emerald-400">✓</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      {/* Các phiếu giao của đơn: mỗi phiếu một dòng */}
                      <div className="rounded-lg border border-slate-800 divide-y divide-slate-800/80">
                        {group.allSlips.map(({ slip, date, status: st, batchNo }) => {
                          const items: any[] = slip.items || [];
                          const totalSlipQty = items.reduce((sum, it) => sum + (Number(it.quantity) || 0), 0);
                          const isFuture = st === "PENDING" && date > today;
                          const itemsTip = items
                            .map((it: any) => {
                              const lot = cleanLot(it.lotNo);
                              return `${getItemCode(it)} — ${getItemName(it)}: ${Number(it.quantity) || 0} ${getItemUnit(it)}${lot ? ` (Lô ${lot})` : ""}`;
                            })
                            .join("\n");
                          return (
                            <div
                              key={slip.id}
                              onClick={() => onView(slip)}
                              title={itemsTip}
                              className="px-2 py-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] hover:bg-slate-900/60 cursor-pointer"
                            >
                              <span className="text-[10px] font-bold text-indigo-300 shrink-0">Đợt {batchNo}</span>
                              <span className="font-mono font-bold text-white shrink-0">{slip.id}</span>
                              <span className="font-mono text-slate-400 shrink-0">{fmtVN(date)}</span>
                              {isFuture && (
                                <span className="text-[9px] px-1 rounded bg-sky-950 text-sky-300 border border-sky-700/60">
                                  Lịch giao
                                </span>
                              )}
                              <span className={`text-[9px] px-1.5 py-0.5 rounded-full border font-bold shrink-0 ${STATUS_META[st].cls}`}>
                                {STATUS_META[st].label}
                              </span>
                              <span className="text-slate-400 truncate min-w-0 flex-1">
                                {items.length} mã · SL <b className="text-emerald-300 font-mono">{totalSlipQty}</b>
                                {slip.dispatcherName ? ` · Giao: ${slip.dispatcherName}` : ""}
                              </span>
                              <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                                <button
                                  type="button"
                                  onClick={() => onView(slip)}
                                  className="text-[10px] font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 px-1.5 py-0.5 rounded cursor-pointer flex items-center gap-1"
                                >
                                  <Eye className="w-3 h-3" /> Xem
                                </button>
                                {st === "PENDING" && canConfirm && onConfirmSlip && (
                                  <button
                                    type="button"
                                    onClick={() => onConfirmSlip(slip)}
                                    className="text-[10px] font-bold bg-emerald-700 hover:bg-emerald-600 text-white px-1.5 py-0.5 rounded cursor-pointer"
                                  >
                                    ✅ Đã giao
                                  </button>
                                )}
                                {st !== "CANCELLED" && onEditSlip && (!canEditSlip || canEditSlip(slip)) && (
                                  <button
                                    type="button"
                                    onClick={() => onEditSlip(slip)}
                                    className="text-[10px] font-bold bg-sky-800 hover:bg-sky-700 text-white px-1.5 py-0.5 rounded cursor-pointer"
                                    title="Sửa ngày giao / thông tin phiếu giao hàng"
                                  >
                                    ✏️ Sửa
                                  </button>
                                )}
                                {st !== "CANCELLED" && onCreateRma && (
                                  <button
                                    type="button"
                                    onClick={() => onCreateRma(group.rawOrder, slip)}
                                    className="text-[10px] font-bold bg-amber-800/90 hover:bg-amber-700 text-amber-100 border border-amber-600/50 px-1.5 py-0.5 rounded cursor-pointer flex items-center gap-1"
                                    title={`Lập phiếu trả hàng (RMA) từ Phiếu giao hàng ${slip.id} (Đợt ${batchNo})`}
                                  >
                                    ↩ Trả hàng
                                  </button>
                                )}
                                {st === "PENDING" && onCancelSlip && (!canEditSlip || canEditSlip(slip)) && (
                                  <button
                                    type="button"
                                    onClick={() => onCancelSlip(slip)}
                                    className="text-[10px] font-bold bg-rose-800 hover:bg-rose-700 text-white px-1.5 py-0.5 rounded cursor-pointer"
                                    title="Huỷ phiếu"
                                  >
                                    🗑
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
          <Pager p={soGroupsPage} unit="đơn SO" />
        </div>
      ) : (
        /* =====================================================================
           CHẾ ĐỘ 2: HIỂN THỊ BẢNG PHẲNG THEO TỪNG PHIẾU GIAO HÀNG (MẶC ĐỊNH)
           ===================================================================== */
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full text-left text-xs min-w-[1200px]">
            <thead>
              <tr className="bg-slate-900 text-slate-400 font-bold text-[11px]">
                <th className="p-2.5">Mã phiếu</th>
                <th className="p-2.5">Ngày giao</th>
                <th className="p-2.5">Khách hàng</th>
                <th className="p-2.5">Mã đơn SO</th>
                <th className="p-2.5 text-center">Đợt</th>
                <th className="p-2.5 text-center">Số mặt hàng</th>
                <th className="p-2.5 text-center">SL giao đợt này</th>
                {getFinance && (
                  <>
                    <th className="p-2.5 text-right">Thành tiền</th>
                    <th className="p-2.5">Số HĐ</th>
                    <th className="p-2.5 text-center">Thu tiền</th>
                  </>
                )}
                <th className="p-2.5 text-center">Còn lại của SO</th>
                <th className="p-2.5">Người lập</th>
                <th className="p-2.5 text-center">Trạng thái</th>
                <th className="p-2.5 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={getFinance ? 14 : 11} className="p-6 text-center text-slate-500">
                    Không có phiếu giao nào trong khoảng đã chọn.
                  </td>
                </tr>
              ) : (
                rowsPage.items.map(({ slip, date, status: st }) => {
                  const items: any[] = slip.items || [];
                  const isFuture = st === "PENDING" && date > today;
                  const soGroup = soGroups.find(
                    (g) => g.orderCode === String(slip.orderCode || slip.orderId || "").trim()
                  );
                  return (
                    <tr
                      key={slip.id}
                      className="hover:bg-slate-900/50 cursor-pointer"
                      onClick={() => onView(slip)}
                      title="Bấm để xem / in phiếu"
                    >
                      <td className="p-2.5 font-mono font-bold text-indigo-300">{slip.id}</td>
                      <td className="p-2.5 font-mono text-slate-200">
                        {fmtVN(date)}
                        {isFuture && (
                          <span className="ml-1.5 text-[9px] px-1.5 py-0.5 rounded bg-sky-950 text-sky-300 border border-sky-700/60">
                            Lịch giao
                          </span>
                        )}
                      </td>
                      <td className="p-2.5 text-white font-semibold">{slip.customerName}</td>
                      <td
                        className="p-2.5 font-mono text-indigo-300 hover:underline"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (slip.orderCode) {
                            setSelectedSOCode(String(slip.orderCode));
                            setViewMode("by_so");
                          }
                        }}
                        title="Bấm vào Mã đơn SO để xem chi tiết tất cả các đợt giao & số lượng còn lại của đơn này"
                      >
                        {slip.orderCode}
                      </td>
                      <td className="p-2.5 text-center text-slate-300">
                        <span className="px-1.5 py-0.5 rounded bg-slate-800 font-mono text-[11px]">
                          Đợt {slip.batchNumber || 1}/{soGroup ? soGroup.activeSlips.length : 1}
                        </span>
                      </td>
                      <td className="p-2.5 text-center text-slate-300">{items.length}</td>
                      <td className="p-2.5 text-center font-mono text-emerald-300 font-bold">
                        {items.reduce((a, it) => a + (Number(it.quantity) || 0), 0)}
                      </td>
                      {getFinance && (() => {
                        const f = getFinance(slip);
                        const fmt = (n: number) => new Intl.NumberFormat("vi-VN").format(Math.round(n || 0));
                        const paidFull = f.amount > 0 && f.paid >= f.amount - 0.5;
                        return (
                          <>
                            <td className="p-2.5 text-right font-mono font-bold text-white">{f.amount > 0 ? fmt(f.amount) : "—"}</td>
                            <td className="p-2.5 font-mono text-slate-200" title={f.invoiceDate ? `Ngày HĐ: ${f.invoiceDate}` : undefined}>
                              {f.invoiceNo || <span className="text-slate-600">Chưa xuất</span>}
                            </td>
                            <td className="p-2.5 text-center">
                              {st === "CANCELLED" ? (
                                <span className="text-slate-600">—</span>
                              ) : paidFull ? (
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-950/70 text-emerald-300 border border-emerald-700/60 font-bold">✓ Đã thu</span>
                              ) : f.paid > 0 ? (
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-950/60 text-amber-300 border border-amber-700/50 font-bold" title={`Đã thu ${fmt(f.paid)} / ${fmt(f.amount)}`}>
                                  Thu {fmt(f.paid)}
                                </span>
                              ) : (
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700 font-bold">Chưa thu</span>
                              )}
                            </td>
                          </>
                        );
                      })()}
                      <td className="p-2.5 text-center font-mono">
                        {soGroup ? (
                          soGroup.totalRemaining > 0 ? (
                            <span
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedSOCode(soGroup.orderCode);
                                setViewMode("by_so");
                              }}
                              className="text-[10px] px-2 py-0.5 rounded-full bg-orange-950/70 text-orange-300 border border-orange-700/60 font-bold hover:bg-orange-900/70"
                              title="Bấm để xem chi tiết mặt hàng còn lại chưa giao của SO này"
                            >
                              Còn {soGroup.totalRemaining} chưa lập phiếu
                            </span>
                          ) : soGroup.totalPending > 0 ? (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-950/60 text-amber-300 border border-amber-700/50 font-bold">
                              Chờ giao {soGroup.totalPending}
                            </span>
                          ) : (
                            <span className="text-[10px] text-emerald-400 font-bold">✓ Đã giao đủ</span>
                          )
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="p-2.5 text-slate-300">{slip.creatorName || slip.createdBy || ""}</td>
                      <td className="p-2.5 text-center">
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-full border font-bold ${STATUS_META[st].cls}`}
                        >
                          {STATUS_META[st].label}
                        </span>
                      </td>
                      <td className="p-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1 flex-wrap">
                          <button
                            type="button"
                            onClick={() => onView(slip)}
                            className="text-[10px] font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 px-2 py-1 rounded cursor-pointer flex items-center gap-1"
                            title="Xem chi tiết / In phiếu giao hàng"
                          >
                            <Eye className="w-3 h-3" /> Xem
                          </button>
                          {st !== "CANCELLED" && onEditSlip && (!canEditSlip || canEditSlip(slip)) && (
                            <button
                              type="button"
                              onClick={() => onEditSlip(slip)}
                              className="text-[10px] font-bold bg-sky-800 hover:bg-sky-700 text-white px-2 py-1 rounded cursor-pointer flex items-center gap-1"
                              title="Sửa ngày giao / số lượng / số lô / thông tin phiếu giao hàng"
                            >
                              ✏️ Sửa
                            </button>
                          )}
                          {st !== "CANCELLED" && onCreateRma && (
                            <button
                              type="button"
                              onClick={() =>
                                onCreateRma(
                                  soGroup?.rawOrder || (resolveOrder ? resolveOrder(slip) : null),
                                  slip
                                )
                              }
                              className="text-[10px] font-bold bg-amber-800/90 hover:bg-amber-700 text-amber-100 border border-amber-600/50 px-2 py-1 rounded cursor-pointer flex items-center gap-1"
                              title={`Lập phiếu trả hàng (RMA) theo Phiếu giao hàng ${slip.id}`}
                            >
                              ↩ Trả hàng
                            </button>
                          )}
                          {(() => {
                            const oc = String(slip.orderCode || slip.orderId || "").trim();
                            const soRmas = oc
                              ? (rmaList || []).filter((r: any) => String(r.order_code || "").trim() === oc)
                              : [];
                            if (soRmas.length === 0 || !onOpenRmaList) return null;
                            return (
                              <button
                                type="button"
                                onClick={() => onOpenRmaList(oc)}
                                className="text-[10px] font-bold bg-amber-950/80 hover:bg-amber-900 border border-amber-600/60 text-amber-300 px-1.5 py-1 rounded cursor-pointer"
                                title={`Xem ${soRmas.length} phiếu trả hàng của đơn ${oc}`}
                              >
                                📋 {soRmas.length}
                              </button>
                            );
                          })()}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
          <Pager p={rowsPage} unit="phiếu giao" />
        </div>
      )}
    </div>
  );
}
