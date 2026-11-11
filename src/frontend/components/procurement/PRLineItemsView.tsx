"use client";

/**
 * Đề xuất mua hàng xem theo MẶT HÀNG: mỗi dòng hàng của mọi PR là một dòng, tick chọn để lập PO.
 *
 * Quy tắc nghiệp vụ:
 *  - Nhà cung cấp gợi ý = NCC đã MUA mã đó GẦN NHẤT (theo các PO đã lập). Chưa mua lần nào: NCC có mã đó trong bảng
 *    giá NCC (nhiều NCC thì giá thấp nhất). Không có: "Chưa có NCC". Các NCC khác có mã đó vẫn xem / đổi được trên dòng.
 *  - Một PO chỉ gửi một NCC. Nhân viên chọn các dòng cùng NCC; chọn dòng của NCC khác thì hỏi lại, đồng ý thì dòng đó
 *    được đặt theo NCC của PO đang lập.
 *  - Cùng mã hàng (cùng ĐVT) từ nhiều PR được gộp một dòng PO, cộng số lượng, vẫn lưu danh sách PR nguồn.
 *  - Dòng đã có PO ẩn mặc định; bật công tắc thì hiện kèm mã PO.
 */

import React, { useMemo, useState } from "react";
import { CheckSquare, Square, PackageCheck, Eye, AlertTriangle, FileSpreadsheet } from "lucide-react";
import * as XLSX from "xlsx";
import { Pager, usePaged, useDebouncedValue } from "@/frontend/components/Pager";
import { DateInputVN } from "@/frontend/components/DateInputVN";
import { toVNDateString, formatVNDate } from "@/backend/services/dates";
import { ItemStockHover, type ItemDemandInfo } from "@/frontend/components/procurement/ItemStockHover";

type POInfo = { hasPO: boolean; poCode?: string; linkedPO?: any };

interface PRLineItemsViewProps {
  purchaseRequests: any[];
  orders: any[];
  suppliers: any[];
  supplierProducts: any[];
  getPRItems: (pr: any) => any[];
  getItemPOInfo: (pr: any, it: any, idx?: number) => POInfo;
  /** Thẻ tồn kho & nhu cầu khi rê chuột vào mã hàng */
  getItemInfo?: (code: string) => ItemDemandInfo | null;
  onOpenPO: (po: any) => void;
  onCreated: () => void | Promise<void>;
  actorName: string;
}

type Offer = { supplier: any; price: number; source: "LAST_PURCHASE" | "PRICE_LIST"; date?: string; poCode?: string };

type Line = {
  key: string;
  pr: any;
  prKey: string;
  idx: number;
  item: any;
  code: string;
  name: string;
  unit: string;
  spec: string;
  qty: number;
  requester: string;
  dept: string;
  dueDate: string;
  priority: string;
  poInfo: POInfo;
  selectable: boolean;
  blockedReason?: string;
  suggested: Offer | null;
  offers: Offer[];
};

const supShort = (s: any): string => String(s?.short_name || "").trim() || String(s?.name || s?.supplier_name || "").trim() || "—";
const fmtMoney = (n: number) => new Intl.NumberFormat("vi-VN").format(Math.round(Number(n) || 0));
const codeKey = (v: any) => String(v || "").trim().toUpperCase();
const PRIORITY_LABEL: Record<string, string> = { URGENT: "Khẩn", HIGH: "Cao", MEDIUM: "Trung bình", LOW: "Thấp" };

export function PRLineItemsView(props: PRLineItemsViewProps) {
  const { purchaseRequests, orders, suppliers, supplierProducts, getPRItems, getItemPOInfo, getItemInfo, onOpenPO, onCreated, actorName } = props;

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 250);
  const [supplierFilter, setSupplierFilter] = useState<string>("all");
  const [showConverted, setShowConverted] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [poSupplierId, setPoSupplierId] = useState<string>("");
  // NCC người dùng đổi trên từng dòng (key dòng -> id NCC)
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [expectedDelivery, setExpectedDelivery] = useState(toVNDateString(new Date(Date.now() + 14 * 86400000)));
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const supplierById = useMemo(() => new Map(suppliers.map((s: any) => [String(s.id), s])), [suppliers]);

  // Bảng giá NCC: mã hàng -> các NCC có giá
  const priceListByCode = useMemo(() => {
    const m = new Map<string, Offer[]>();
    for (const sp of supplierProducts || []) {
      const sup = supplierById.get(String(sp.supplier_id));
      if (!sup) continue;
      const k = codeKey(sp.product_code);
      const list = m.get(k) || [];
      list.push({ supplier: sup, price: Math.round(Number(sp.purchase_price) || 0), source: "PRICE_LIST" });
      m.set(k, list);
    }
    return m;
  }, [supplierProducts, supplierById]);

  // Lần mua gần nhất: mã hàng -> (NCC -> PO mới nhất) theo các PO chưa hủy
  const purchasesByCode = useMemo(() => {
    const m = new Map<string, Map<string, Offer>>();
    const sorted = [...(orders || [])]
      .filter(o => String(o?.status || "").toUpperCase() !== "CANCELLED")
      .sort((a, b) => String(b.order_date || "").localeCompare(String(a.order_date || "")) || (Number(b.id) || 0) - (Number(a.id) || 0));
    for (const o of sorted) {
      const sup = supplierById.get(String(o.supplier_id))
        || suppliers.find((s: any) => [s.name, s.short_name].some(n => n && String(n).trim().toLowerCase() === String(o.supplier_name || "").trim().toLowerCase()));
      if (!sup) continue;
      const items = Array.isArray(o.items) ? o.items : [];
      for (const it of items) {
        const k = codeKey(it?.product_code);
        if (!k) continue;
        const bySup = m.get(k) || new Map<string, Offer>();
        if (!bySup.has(String(sup.id))) {
          bySup.set(String(sup.id), { supplier: sup, price: Math.round(Number(it.unit_price) || 0), source: "LAST_PURCHASE", date: o.order_date, poCode: o.po_code });
        }
        m.set(k, bySup);
      }
    }
    return m;
  }, [orders, suppliers, supplierById]);

  /** Các NCC có thể mua mã này: NCC đã mua (gần nhất trước) rồi các NCC trong bảng giá; giá ưu tiên bảng giá NCC */
  const offersFor = (code: string): Offer[] => {
    const k = codeKey(code);
    const out: Offer[] = [];
    const seen = new Set<string>();
    const priceOf = (supId: string) => (priceListByCode.get(k) || []).find(o => String(o.supplier.id) === supId)?.price;
    for (const p of purchasesByCode.get(k)?.values() || []) {
      const id = String(p.supplier.id);
      seen.add(id);
      out.push({ ...p, price: priceOf(id) ?? p.price });
    }
    const listed = [...(priceListByCode.get(k) || [])].sort((a, b) => (a.price || Infinity) - (b.price || Infinity));
    for (const o of listed) {
      if (!seen.has(String(o.supplier.id))) { seen.add(String(o.supplier.id)); out.push(o); }
    }
    return out;
  };

  /** Giá mua của mã hàng theo một NCC: bảng giá NCC, nếu không có thì giá lần mua gần nhất từ NCC đó */
  const priceFrom = (code: string, supId: string): number => {
    const k = codeKey(code);
    const listed = (priceListByCode.get(k) || []).find(o => String(o.supplier.id) === supId);
    if (listed && listed.price > 0) return listed.price;
    return purchasesByCode.get(k)?.get(supId)?.price || 0;
  };

  const lines: Line[] = useMemo(() => {
    const out: Line[] = [];
    for (const pr of purchaseRequests || []) {
      const st = String(pr?.status || "").toUpperCase();
      if (st === "CANCELLED" || st === "REJECTED") continue;
      const prKey = pr.workflow_code || String(pr.id);
      getPRItems(pr).forEach((it: any, idx: number) => {
        const code = String(it?.product_code || "").trim();
        const missing = it?.is_missing_catalog_product || !code || code === "TBR-ITEM";
        const poInfo = getItemPOInfo(pr, it, idx);
        const offers = missing ? [] : offersFor(code);
        out.push({
          key: `${prKey}___${idx}`,
          pr, prKey, idx, item: it, code,
          name: it?.product_name || it?.name || code,
          unit: it?.unit || "",
          spec: it?.specification || "",
          qty: Number(it?.quantity) || 0,
          requester: pr.requester_name || "",
          dept: pr.requester_dept || "",
          dueDate: pr.due_date || "",
          priority: String(pr.priority || "").toUpperCase(),
          poInfo,
          selectable: !missing && !poInfo.hasPO && (Number(it?.quantity) || 0) > 0,
          blockedReason: missing ? "Chưa có mã hàng chuẩn trong danh mục" : (Number(it?.quantity) || 0) <= 0 ? "Số lượng bằng 0" : undefined,
          suggested: offers[0] || null,
          offers,
        });
      });
    }
    return out;
    // offersFor dùng purchasesByCode / priceListByCode
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [purchaseRequests, getPRItems, getItemPOInfo, purchasesByCode, priceListByCode]);

  const effectiveSupplierId = (l: Line): string => overrides[l.key] || (l.suggested ? String(l.suggested.supplier.id) : "");

  const visible = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    return lines
      .filter(l => showConverted || !l.poInfo.hasPO)
      .filter(l => {
        if (supplierFilter === "all") return true;
        const sid = effectiveSupplierId(l);
        return supplierFilter === "none" ? !sid : sid === supplierFilter;
      })
      .filter(l => !q || [l.code, l.name, l.prKey, l.requester, l.dept, l.poInfo.poCode].some(v => String(v || "").toLowerCase().includes(q)))
      .sort((a, b) => Number(a.poInfo.hasPO) - Number(b.poInfo.hasPO) || String(a.dueDate).localeCompare(String(b.dueDate)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, debouncedSearch, supplierFilter, showConverted, overrides]);

  const page = usePaged(visible, 50, `${debouncedSearch}|${supplierFilter}|${showConverted}`);
  const lineByKey = useMemo(() => new Map(lines.map(l => [l.key, l])), [lines]);
  const selectedLines = selected.map(k => lineByKey.get(k)).filter((l): l is Line => Boolean(l && l.selectable));
  const poSupplier = supplierById.get(poSupplierId);

  const supplierOptions = useMemo(() => {
    const ids = new Set<string>();
    for (const l of lines) { const sid = effectiveSupplierId(l); if (sid) ids.add(sid); }
    return Array.from(ids).map(id => supplierById.get(id)).filter(Boolean).sort((a: any, b: any) => supShort(a).localeCompare(supShort(b)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, overrides, supplierById]);

  const clearSelection = () => { setSelected([]); setPoSupplierId(""); };

  const toggleLine = (l: Line) => {
    if (!l.selectable) return;
    if (selected.includes(l.key)) {
      const next = selected.filter(k => k !== l.key);
      setSelected(next);
      if (next.length === 0) setPoSupplierId("");
      return;
    }
    const sid = effectiveSupplierId(l);
    if (selected.length === 0) {
      if (!sid) {
        alert(`Mã ${l.code} chưa có nhà cung cấp gợi ý. Hãy chọn NCC cho dòng này trước (cột "NCC").`);
        return;
      }
      setPoSupplierId(sid);
      setSelected([l.key]);
      return;
    }
    if (sid !== poSupplierId) {
      const price = priceFrom(l.code, poSupplierId);
      const ok = window.confirm(
        `Mã ${l.code} ${sid ? `đang gợi ý NCC "${supShort(supplierById.get(sid))}"` : "chưa có NCC gợi ý"}, khác NCC "${supShort(poSupplier)}" của các dòng đã chọn.\n\n` +
        `Tiếp tục thì mã này sẽ được đặt từ "${supShort(poSupplier)}"` +
        (price > 0 ? ` (giá mua ${fmtMoney(price)} đ).` : ` — NCC này CHƯA có giá cho mã này, PO sẽ ghi giá 0 đ để bạn cập nhật sau.`) +
        `\n\nTiếp tục?`
      );
      if (!ok) return;
      setOverrides(prev => ({ ...prev, [l.key]: poSupplierId }));
    }
    setSelected(prev => [...prev, l.key]);
  };

  // Chọn tất cả: chỉ khi đang lọc theo một NCC (một PO chỉ gửi một NCC)
  const selectableInFilter = supplierFilter !== "all" && supplierFilter !== "none"
    ? visible.filter(l => l.selectable && effectiveSupplierId(l) === supplierFilter)
    : [];
  const allFilterSelected = selectableInFilter.length > 0 && selectableInFilter.every(l => selected.includes(l.key));
  const toggleAllInFilter = () => {
    if (selectableInFilter.length === 0) return;
    if (allFilterSelected) { clearSelection(); return; }
    if (selected.length > 0 && poSupplierId !== supplierFilter) {
      if (!window.confirm(`Đang chọn hàng của NCC "${supShort(poSupplier)}". Bỏ các dòng đó và chọn tất cả hàng của "${supShort(supplierById.get(supplierFilter))}"?`)) return;
    }
    setPoSupplierId(supplierFilter);
    setSelected(selectableInFilter.map(l => l.key));
  };

  /** Dòng PO: gộp cùng mã + ĐVT, cộng số lượng, giữ danh sách PR nguồn */
  const poItems = useMemo(() => {
    const groups = new Map<string, any>();
    for (const l of selectedLines) {
      // khác quy cách / trình tự (primer, probe) là mặt hàng khác: không gộp
      const gk = `${codeKey(l.code)}|${String(l.unit).trim().toLowerCase()}|${String(l.spec || "").trim().toLowerCase()}`;
      const g = groups.get(gk);
      if (g) {
        g.quantity += l.qty;
        if (!g.source_pr_codes.includes(l.prKey)) g.source_pr_codes.push(l.prKey);
        g.source_item_keys.push(l.key);
      } else {
        groups.set(gk, {
          product_code: l.code,
          product_name: l.name,
          specification: l.spec,
          unit: l.unit || "Hộp",
          quantity: l.qty,
          unit_price: priceFrom(l.code, poSupplierId),
          source_pr_codes: [l.prKey],
          source_item_keys: [l.key],
        });
      }
    }
    return Array.from(groups.values()).map(g => ({ ...g, source_pr_code: g.source_pr_codes.join(", ") }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLines.map(l => l.key).join(","), poSupplierId, purchasesByCode, priceListByCode]);

  const poTotal = poItems.reduce((s, it) => s + it.quantity * (Number(it.unit_price) || 0), 0);
  const zeroPriceItems = poItems.filter(it => !(Number(it.unit_price) > 0));

  const createPO = async () => {
    if (submitting || selectedLines.length === 0 || !poSupplier) return;
    const prCodes = Array.from(new Set(selectedLines.map(l => l.prKey)));
    const summary =
      `Tạo PO gửi NCC "${supShort(poSupplier)}" (${poSupplier.name}):\n` +
      `• ${poItems.length} dòng hàng (gộp từ ${selectedLines.length} dòng của ${prCodes.length} PR)\n` +
      `• Tổng tiền dự kiến: ${fmtMoney(poTotal)} đ\n` +
      `• Ngày giao dự kiến: ${expectedDelivery}` +
      (zeroPriceItems.length ? `\n\n⚠️ ${zeroPriceItems.length} mã chưa có giá mua từ NCC này (ghi 0 đ): ${zeroPriceItems.map(i => i.product_code).join(", ")}` : "") +
      `\n\nXác nhận tạo PO?`;
    if (!window.confirm(summary)) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/procurement?action=consolidate_prs_to_po", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplier_id: poSupplier.id,
          supplier_name: poSupplier.name,
          pr_ids: prCodes,
          selected_item_keys: selectedLines.map(l => l.key),
          items: poItems,
          expected_delivery_date: expectedDelivery,
          notes: notes.trim() || `Lập từ danh sách mặt hàng đề xuất: ${prCodes.join(", ")}`,
          created_by: actorName,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        alert(`❌ Không tạo được PO: ${data.error || `Lỗi ${res.status}`}`);
        return;
      }
      alert(`✅ Đã tạo PO ${data.po_code} gửi ${supShort(poSupplier)} (${poItems.length} dòng hàng).`);
      clearSelection();
      setNotes("");
      await onCreated();
    } catch {
      alert("❌ Không kết nối được máy chủ, PO chưa được tạo.");
    } finally {
      setSubmitting(false);
    }
  };

  // PO sẵn có của cùng NCC, chưa đặt hàng (Chờ xác nhận / Đã xác nhận): có thể bổ sung dòng vào
  const APPENDABLE_PO = ["DRAFT", "PENDING", "APPROVED", "CONFIRMED"];
  const appendTargets = useMemo(
    () => (orders || []).filter((po: any) =>
      poSupplier && String(po.supplier_id) === String(poSupplier.id) && APPENDABLE_PO.includes(String(po.status || "").toUpperCase())
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [orders, poSupplier?.id]
  );
  const [appendPoId, setAppendPoId] = useState("");
  const appendPO = appendTargets.find((po: any) => String(po.id) === appendPoId) || null;

  const appendToPO = async () => {
    if (submitting || selectedLines.length === 0 || !poSupplier || !appendPO) return;
    const prCodes = Array.from(new Set(selectedLines.map(l => l.prKey)));
    const summary =
      `Bổ sung vào PO ${appendPO.po_code} (${supShort(poSupplier)}):\n` +
      `• ${poItems.length} dòng hàng từ ${prCodes.length} PR (${prCodes.join(", ")})\n` +
      `• Mã đã có trong PO (cùng ĐVT, quy cách) được cộng thêm số lượng; mã mới thêm dòng mới\n` +
      `• Tiền hàng bổ sung dự kiến: ${fmtMoney(poTotal)} đ` +
      (zeroPriceItems.length ? `\n\n⚠️ ${zeroPriceItems.length} mã chưa có giá mua từ NCC này (ghi 0 đ): ${zeroPriceItems.map(i => i.product_code).join(", ")}` : "") +
      `\n\nXác nhận bổ sung?`;
    if (!window.confirm(summary)) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/procurement?action=append_prs_to_po", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          po_id: appendPO.id,
          supplier_id: poSupplier.id,
          pr_ids: prCodes,
          selected_item_keys: selectedLines.map(l => l.key),
          items: poItems,
          created_by: actorName,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        alert(`❌ Không bổ sung được vào PO: ${data.error || `Lỗi ${res.status}`}`);
        return;
      }
      alert(`✅ Đã bổ sung vào PO ${data.po_code}: cộng dồn ${data.merged} dòng, thêm mới ${data.added} dòng.`);
      clearSelection();
      setAppendPoId("");
      await onCreated();
    } catch {
      alert("❌ Không kết nối được máy chủ, PO chưa được bổ sung.");
    } finally {
      setSubmitting(false);
    }
  };

  const pendingCount = lines.filter(l => !l.poInfo.hasPO).length;

  // Xuất Excel danh sách dòng PR theo phân loại: Chưa tạo PO / Đã chuyển PO / Tất cả (Tách Sheet)
  const exportLinesExcel = (mode: "unconverted" | "converted" | "all") => {
    const q = debouncedSearch.trim().toLowerCase();
    const baseLines = lines
      .filter(l => {
        if (supplierFilter === "all") return true;
        const sid = effectiveSupplierId(l);
        return supplierFilter === "none" ? !sid : sid === supplierFilter;
      })
      .filter(l => !q || [l.code, l.name, l.prKey, l.requester, l.dept, l.poInfo.poCode].some(v => String(v || "").toLowerCase().includes(q)));

    const header = [
      "STT",
      "Mã PR",
      "Người đề xuất",
      "Bộ phận",
      "Ưu tiên",
      "Hạn cần",
      "Mã hàng (SKU)",
      "Tên hàng",
      "Quy cách",
      "ĐVT",
      "SL đề xuất",
      "NCC gợi ý / PO",
      "Giá mua dự kiến",
      "Thành tiền",
      "Phân loại PO",
      "Mã PO liên kết",
      "Lý do / Ghi chú PR",
    ];
    const colsWidth = [
      { wch: 6 }, { wch: 15 }, { wch: 20 }, { wch: 16 }, { wch: 12 }, { wch: 12 },
      { wch: 16 }, { wch: 42 }, { wch: 22 }, { wch: 9 }, { wch: 11 }, { wch: 24 },
      { wch: 15 }, { wch: 18 }, { wch: 18 }, { wch: 16 }, { wch: 36 },
    ];

    const toRow = (l: Line, stt: number) => {
      const sid = effectiveSupplierId(l);
      const supName = l.poInfo.hasPO
        ? (l.poInfo.linkedPO ? supShort(supplierById.get(String(l.poInfo.linkedPO.supplier_id)) || { name: l.poInfo.linkedPO.supplier_name }) : "—")
        : (sid ? supShort(supplierById.get(sid)) : "Chưa có NCC");
      const price = sid ? priceFrom(l.code, sid) : 0;
      const total = price > 0 ? price * l.qty : 0;
      return [
        stt,
        l.prKey,
        l.requester,
        l.dept,
        PRIORITY_LABEL[l.priority] || l.priority || "Bình thường",
        formatVNDate(l.dueDate, ""),
        l.code,
        l.name,
        l.spec,
        l.unit,
        l.qty,
        supName,
        price,
        total,
        l.poInfo.hasPO ? "Đã chuyển thành PO" : "Chưa tạo PO",
        l.poInfo.poCode || "",
        l.pr?.description || l.pr?.title || "",
      ];
    };

    const unRows = [header, ...baseLines.filter(l => !l.poInfo.hasPO).map((l, i) => toRow(l, i + 1))];
    const convRows = [header, ...baseLines.filter(l => l.poInfo.hasPO).map((l, i) => toRow(l, i + 1))];
    const allRows = [header, ...baseLines.map((l, i) => toRow(l, i + 1))];

    const wb = XLSX.utils.book_new();
    const todayStr = toVNDateString(new Date());
    if (mode === "unconverted") {
      const ws = XLSX.utils.aoa_to_sheet(unRows);
      ws["!cols"] = colsWidth;
      XLSX.utils.book_append_sheet(wb, ws, "PR Chưa tạo PO");
      XLSX.writeFile(wb, `PR_Mat_Hang_Chua_Tao_PO_${todayStr}.xlsx`);
      return;
    }
    if (mode === "converted") {
      const ws = XLSX.utils.aoa_to_sheet(convRows);
      ws["!cols"] = colsWidth;
      XLSX.utils.book_append_sheet(wb, ws, "PR Đã chuyển PO");
      XLSX.writeFile(wb, `PR_Mat_Hang_Da_Chuyen_PO_${todayStr}.xlsx`);
      return;
    }
    const wsUn = XLSX.utils.aoa_to_sheet(unRows);
    wsUn["!cols"] = colsWidth;
    const wsConv = XLSX.utils.aoa_to_sheet(convRows);
    wsConv["!cols"] = colsWidth;
    const wsAll = XLSX.utils.aoa_to_sheet(allRows);
    wsAll["!cols"] = colsWidth;
    XLSX.utils.book_append_sheet(wb, wsUn, "1. Chưa tạo PO");
    XLSX.utils.book_append_sheet(wb, wsConv, "2. Đã chuyển PO");
    XLSX.utils.book_append_sheet(wb, wsAll, "3. Tất cả dòng PR");
    XLSX.writeFile(wb, `PR_Theo_Mat_Hang_Phan_Loai_${todayStr}.xlsx`);
  };

  // Xuất PO Nháp & Chi tiết PR (Không gộp) cho các dòng đang tick chọn mà KHÔNG tạo PO trên hệ thống
  const exportSelectedDraftPOExcel = () => {
    if (selectedLines.length === 0) return;
    const wb = XLSX.utils.book_new();
    const todayStr = toVNDateString(new Date());
    const supLabel = poSupplier ? supShort(poSupplier) : "NCC";

    const prHeader = [
      "STT",
      "Mã PR Nguồn",
      "Người đề xuất",
      "Bộ phận",
      "Hạn cần hàng",
      "Mã hàng (SKU)",
      "Tên sản phẩm",
      "Quy cách",
      "ĐVT",
      "SL cần",
      "Đơn giá dự kiến",
      "Thành tiền",
      "NCC dự kiến",
      "Ghi chú PR",
    ];
    const prRows: any[][] = [prHeader];
    let totalRaw = 0;
    selectedLines.forEach((l, i) => {
      const price = poSupplierId ? priceFrom(l.code, poSupplierId) : 0;
      const lineTotal = l.qty * price;
      totalRaw += lineTotal;
      prRows.push([
        i + 1,
        l.prKey,
        l.requester,
        l.dept,
        formatVNDate(l.dueDate, ""),
        l.code,
        l.name,
        l.spec,
        l.unit,
        l.qty,
        price,
        lineTotal,
        poSupplier ? poSupplier.name : supLabel,
        l.pr?.description || l.pr?.title || "",
      ]);
    });
    prRows.push(["", "", "", "", "", "", "TỔNG CỘNG (CHI TIẾT PR KHÔNG GỘP)", "", "", selectedLines.reduce((s, x) => s + x.qty, 0), "", totalRaw, "", ""]);
    const wsPR = XLSX.utils.aoa_to_sheet(prRows);
    wsPR["!cols"] = [
      { wch: 6 }, { wch: 15 }, { wch: 20 }, { wch: 16 }, { wch: 12 }, { wch: 16 },
      { wch: 42 }, { wch: 22 }, { wch: 9 }, { wch: 11 }, { wch: 15 }, { wch: 18 }, { wch: 26 }, { wch: 34 },
    ];
    XLSX.utils.book_append_sheet(wb, wsPR, "Chi tiết PR (Không gộp)");

    const draftRows: any[][] = [
      ["ĐƠN ĐẶT MUA HÀNG NHÁP (DRAFT PO - CHƯA LẬP PO TRÊN HỆ THỐNG)"],
      ["Nhà cung cấp:", poSupplier?.name || supLabel, "", "Ngày xuất nháp:", formatVNDate(todayStr, todayStr)],
      ["Hạn giao dự kiến:", formatVNDate(expectedDelivery, expectedDelivery), "", "Người lập:", actorName],
      ["Ghi chú:", notes || "Xuất nháp từ danh sách đề xuất mua hàng (PR)"],
      [],
      ["STT", "Mã hàng (SKU)", "Tên sản phẩm", "Quy cách", "ĐVT", "Tổng SL đặt", "Đơn giá dự kiến", "Thành tiền", "Danh sách PR nguồn"],
    ];
    poItems.forEach((it, idx) => {
      const price = Number(it.unit_price) || 0;
      const lineTotal = (Number(it.quantity) || 0) * price;
      draftRows.push([
        idx + 1,
        it.product_code,
        it.product_name,
        it.specification || "",
        it.unit,
        it.quantity,
        price,
        lineTotal,
        it.source_pr_code,
      ]);
    });
    draftRows.push(["", "", "TỔNG CỘNG PO NHÁP", "", "", poItems.reduce((s, x) => s + (Number(x.quantity) || 0), 0), "", poTotal, ""]);
    const wsDraft = XLSX.utils.aoa_to_sheet(draftRows);
    wsDraft["!cols"] = [
      { wch: 6 }, { wch: 18 }, { wch: 44 }, { wch: 24 }, { wch: 10 }, { wch: 13 }, { wch: 16 }, { wch: 18 }, { wch: 32 },
    ];
    XLSX.utils.book_append_sheet(wb, wsDraft, "PO Nháp (Theo mã hàng)");

    const safeSup = supLabel.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 20);
    XLSX.writeFile(wb, `PO_Nhap_Va_Chi_Tiet_PR_${safeSup}_${todayStr}.xlsx`);
  };

  return (
    <div className="space-y-3">
      {/* Bộ lọc */}
      <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-100 dark:border-slate-800">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Tìm mã / tên hàng, mã PR, người đề xuất, mã PO..."
          className="px-3 py-1.5 rounded-xl text-xs border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white w-72"
        />
        <select
          value={supplierFilter}
          onChange={(e) => setSupplierFilter(e.target.value)}
          className="px-3 py-1.5 rounded-xl text-xs border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
        >
          <option value="all">Tất cả NCC gợi ý</option>
          {supplierOptions.map((s: any) => <option key={s.id} value={String(s.id)}>{supShort(s)}</option>)}
          <option value="none">Chưa có NCC</option>
        </select>
        <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300 cursor-pointer select-none">
          <input type="checkbox" checked={showConverted} onChange={(e) => setShowConverted(e.target.checked)} />
          Hiện dòng đã lập PO
        </label>
        <span className="text-xs text-slate-500 dark:text-slate-400 ml-auto">
          {pendingCount} dòng chờ lập PO • đang hiển thị {visible.length}
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => exportLinesExcel("unconverted")}
            title="Xuất Excel các dòng mặt hàng PR CHƯA tạo PO"
            className="px-2.5 py-1.5 rounded-xl text-xs font-bold bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-700 flex items-center gap-1 cursor-pointer"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-amber-600" />
            <span>Chưa tạo PO</span>
          </button>
          <button
            type="button"
            onClick={() => exportLinesExcel("converted")}
            title="Xuất Excel các dòng mặt hàng PR ĐÃ chuyển thành PO"
            className="px-2.5 py-1.5 rounded-xl text-xs font-bold bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700 flex items-center gap-1 cursor-pointer"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
            <span>Đã chuyển PO</span>
          </button>
          <button
            type="button"
            onClick={() => exportLinesExcel("all")}
            title="Xuất Excel toàn bộ dòng mặt hàng PR tách 3 Sheet (Chưa tạo PO / Đã chuyển PO / Tất cả)"
            className="px-2.5 py-1.5 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white flex items-center gap-1 cursor-pointer"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>Tất cả (Tách Sheet)</span>
          </button>
        </div>
        <span className="hidden">
        </span>
      </div>

      <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-xl">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 font-bold">
            <tr>
              <th className="py-2 px-2 w-8">
                <button
                  type="button"
                  onClick={toggleAllInFilter}
                  disabled={selectableInFilter.length === 0}
                  title={selectableInFilter.length === 0 ? "Lọc theo một NCC để chọn tất cả hàng của NCC đó" : "Chọn tất cả hàng chờ lập PO của NCC đang lọc"}
                  className="disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
                >
                  {allFilterSelected ? <CheckSquare className="w-4 h-4 text-indigo-600" /> : <Square className="w-4 h-4" />}
                </button>
              </th>
              <th className="py-2 px-2 w-28 whitespace-nowrap">Mã PR</th>
              <th className="py-2 px-2 min-w-[155px] w-44 whitespace-nowrap">Đề xuất</th>
              <th className="py-2 px-2 min-w-[115px] w-32 whitespace-nowrap">Mã hàng</th>
              <th className="py-2 px-2 min-w-[190px] w-[20%]">Tên hàng &amp; Quy cách</th>
              <th className="py-2 px-2 w-14 text-center">ĐVT</th>
              <th className="py-2 px-2 text-right">SL</th>
              <th className="py-2 px-2">Hạn cần</th>
              <th className="py-2 px-2 w-48 max-w-[200px] whitespace-nowrap">NCC gợi ý</th>
              <th className="py-2 px-2 text-right">Giá mua</th>
              <th className="py-2 px-2 text-right">Thành tiền</th>
              <th className="py-2 px-2">Trạng thái</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {page.items.length === 0 ? (
              <tr><td colSpan={12} className="py-8 text-center text-slate-400">Không có mặt hàng đề xuất nào phù hợp.</td></tr>
            ) : page.items.map((l) => {
              const isSel = selected.includes(l.key);
              const sid = effectiveSupplierId(l);
              const price = sid ? priceFrom(l.code, sid) : 0;
              const lineOffer = l.offers.find(o => String(o.supplier.id) === sid);
              return (
                <tr key={l.key} className={`${isSel ? "bg-indigo-50/60 dark:bg-indigo-950/30" : ""} ${l.poInfo.hasPO ? "opacity-70" : ""}`}>
                  <td className="py-2 px-2">
                    <button type="button" onClick={() => toggleLine(l)} disabled={!l.selectable} title={l.blockedReason || (l.poInfo.hasPO ? `Đã thuộc PO ${l.poInfo.poCode}` : "")} className="disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed">
                      {isSel ? <CheckSquare className="w-4 h-4 text-indigo-600" /> : <Square className="w-4 h-4" />}
                    </button>
                  </td>
                  <td className="py-2 px-2 font-mono font-bold text-slate-800 dark:text-slate-200 whitespace-nowrap">{l.prKey}</td>
                  <td className="py-2 px-2">
                    <div className="text-slate-800 dark:text-slate-200 font-medium min-w-[145px] whitespace-nowrap">{l.requester}</div>
                    <div className="text-[10px] text-slate-400 whitespace-nowrap">{l.dept}{l.priority ? ` • ${PRIORITY_LABEL[l.priority] || l.priority}` : ""}</div>
                  </td>
                  <td className="py-2 px-2 font-mono font-bold text-indigo-700 dark:text-indigo-300 min-w-[115px] w-32 whitespace-nowrap">
                    {l.code && getItemInfo ? <ItemStockHover code={l.code} getInfo={getItemInfo}>{l.code}</ItemStockHover> : (l.code || "—")}
                  </td>
                  <td className="py-2 px-2 text-slate-800 dark:text-slate-200 min-w-[190px] w-[20%]">
                    <span className="font-semibold">{l.name}</span>
                    {l.spec && <span className="text-[11px] text-slate-500 dark:text-slate-400"> ({l.spec})</span>}
                    {l.blockedReason && <div className="text-[10px] text-amber-600 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{l.blockedReason}</div>}
                  </td>
                  <td className="py-2 px-2 text-center whitespace-nowrap">{l.unit}</td>
                  <td className="py-2 px-2 text-right font-mono font-bold">{l.qty}</td>
                  <td className="py-2 px-2 whitespace-nowrap">{formatVNDate(l.dueDate, "—")}</td>
                  <td className="py-2 px-2">
                    {l.poInfo.hasPO ? (
                      <span className="text-slate-500">{l.poInfo.linkedPO ? supShort(supplierById.get(String(l.poInfo.linkedPO.supplier_id)) || { name: l.poInfo.linkedPO.supplier_name }) : "—"}</span>
                    ) : (
                      <div>
                        <select
                          value={sid}
                          disabled={isSel}
                          title={isSel ? "Bỏ chọn dòng để đổi NCC" : "Đổi nhà cung cấp cho dòng này"}
                          onChange={(e) => setOverrides(prev => ({ ...prev, [l.key]: e.target.value }))}
                          style={{ maxWidth: "185px" }}
                          className="w-full max-w-[185px] px-1.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs truncate"
                        >
                          {!sid && <option value="">Chưa có NCC</option>}
                          {l.offers.map(o => (
                            <option key={o.supplier.id} value={String(o.supplier.id)}>
                              {supShort(o.supplier)}{o.price > 0 ? ` – ${fmtMoney(o.price)}đ` : ""}{o.source === "LAST_PURCHASE" ? " (đã mua)" : ""}
                            </option>
                          ))}
                          {sid && !l.offers.some(o => String(o.supplier.id) === sid) && (
                            <option value={sid}>{supShort(supplierById.get(sid))}</option>
                          )}
                          <optgroup label="NCC khác">
                            {suppliers.filter((s: any) => !l.offers.some(o => String(o.supplier.id) === String(s.id))).map((s: any) => (
                              <option key={`all-${s.id}`} value={String(s.id)}>{supShort(s)}</option>
                            ))}
                          </optgroup>
                        </select>
                        <div className="text-[10px] text-slate-400 mt-0.5">
                          {lineOffer?.source === "LAST_PURCHASE"
                            ? `Mua gần nhất ${formatVNDate(lineOffer.date, String(lineOffer.date || "").slice(0, 10))}${lineOffer.poCode ? ` (${lineOffer.poCode})` : ""}`
                            : lineOffer?.source === "PRICE_LIST" ? "Theo bảng giá NCC (chưa mua lần nào)" : sid ? "Chọn tay" : ""}
                          {l.offers.length > 1 ? ` • ${l.offers.length} NCC có mã này` : ""}
                        </div>
                      </div>
                    )}
                  </td>
                  <td className="py-2 px-2 text-right font-mono">{l.poInfo.hasPO ? "—" : price > 0 ? fmtMoney(price) : <span className="text-amber-600">Chưa có giá</span>}</td>
                  <td className="py-2 px-2 text-right font-mono font-bold">{l.poInfo.hasPO || !(price > 0) ? "—" : fmtMoney(price * l.qty)}</td>
                  <td className="py-2 px-2 whitespace-nowrap">
                    {l.poInfo.hasPO ? (
                      <button
                        type="button"
                        onClick={() => l.poInfo.linkedPO && onOpenPO(l.poInfo.linkedPO)}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 font-bold cursor-pointer"
                      >
                        <Eye className="w-3 h-3" /> {l.poInfo.poCode}
                      </button>
                    ) : (
                      <span className="px-2 py-0.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 font-semibold">Chờ lập PO</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Pager p={page} unit="dòng hàng đề xuất" />

      {/* Thanh lập PO */}
      {selectedLines.length > 0 && poSupplier && (
        <div className="sticky bottom-2 z-10 flex flex-wrap items-center gap-3 p-3 rounded-2xl border border-indigo-200 dark:border-indigo-800 bg-white dark:bg-slate-900 shadow-lg">
          <div className="text-xs">
            <div className="font-bold text-slate-900 dark:text-white">
              NCC: {supShort(poSupplier)} • {selectedLines.length} dòng → {poItems.length} dòng PO (gộp cùng mã)
            </div>
            <div className="text-slate-500">
              Tổng tiền dự kiến: <strong className="text-emerald-600">{fmtMoney(poTotal)} đ</strong>
              {zeroPriceItems.length > 0 && <span className="text-amber-600"> • {zeroPriceItems.length} mã chưa có giá</span>}
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-slate-500">Ngày giao dự kiến</span>
            <DateInputVN value={expectedDelivery} onChange={(e) => setExpectedDelivery(e.target.value)} />
          </div>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Ghi chú PO (không bắt buộc)"
            className="flex-1 min-w-[180px] px-3 py-1.5 rounded-xl text-xs border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
          />
          <button type="button" onClick={clearSelection} className="px-3 py-1.5 rounded-xl text-xs font-semibold border border-slate-200 dark:border-slate-700 cursor-pointer">
            Bỏ chọn
          </button>
          <button
            type="button"
            onClick={exportSelectedDraftPOExcel}
            title="Xuất các dòng đã chọn ra file Excel (Sheet 1: Chi tiết PR không gộp + Sheet 2: PO Nháp) mà KHÔNG tạo PO trên hệ thống"
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>Xuất Excel PO Nháp / PR (Không tạo PO)</span>
          </button>
          <button type="button" className="hidden">
          </button>
          <button
            type="button"
            onClick={createPO}
            disabled={submitting}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50 cursor-pointer"
          >
            <PackageCheck className="w-3.5 h-3.5" />
            {submitting ? "Đang tạo PO..." : `Tạo PO cho ${supShort(poSupplier)}`}
          </button>
          {appendTargets.length > 0 && (
            <div className="flex items-center gap-1.5 pl-3 border-l border-slate-200 dark:border-slate-700">
              <select
                value={appendPoId}
                onChange={(e) => setAppendPoId(e.target.value)}
                className="px-2 py-1.5 rounded-xl text-xs border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                title="PO cùng NCC chưa đặt hàng (Chờ xác nhận / Đã xác nhận)"
              >
                <option value="">Hoặc thêm vào PO sẵn có…</option>
                {appendTargets.map((po: any) => (
                  <option key={po.id} value={String(po.id)}>
                    {po.po_code} • {(Array.isArray(po.items) ? po.items.length : 0)} dòng • {fmtMoney(Number(po.total_amount) || 0)} đ
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={appendToPO}
                disabled={submitting || !appendPO}
                className="px-3 py-1.5 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
              >
                {submitting ? "Đang bổ sung..." : "Thêm vào PO"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
