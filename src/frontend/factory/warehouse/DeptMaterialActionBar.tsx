"use client";

import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, Boxes, PackagePlus, ShoppingCart } from "lucide-react";
import { api, fmtDate, fmtQty } from "../api";
import { Button, Card, Empty, ErrorNote, Field, inputClass, StatusBadge, Table } from "../ui";

interface WarehouseItem {
  id: string;
  code: string;
  name: string;
  purpose?: string;
  owner_org_unit_id?: string;
  owner_name?: string;
  owner_module_key?: string;
}

interface PrReasonOption {
  id: string;
  category: string;
  label: string;
  value: string;
  entity_type?: string;
  entity_id?: string;
}

interface PrOption {
  id: string;
  code: string;
  name: string;
  module_key?: string;
  warehouses: { id: string; code: string; name: string }[];
  reasons?: PrReasonOption[];
}

interface CatalogMasterItem {
  id: string;
  code: string;
  name: string;
  item_type?: string;
  base_uom: string;
  category_name?: string | null;
}

interface PrDraftLine {
  mode: "CATALOG" | "NEW";
  item_id: string;
  label: string;
  new_item_code: string;
  new_item_name: string;
  item_type: "RAW_MATERIAL" | "REAGENT" | "CONSUMABLE" | "COMPONENT";
  qty: string;
  uom: string;
  est_price: string;
  notes: string;
}

const DEFAULT_UOM_SUGGESTIONS = ["Hộp", "Lọ", "Tube", "Bộ", "Cái", "mL", "L", "g", "kg", "pcs", "Test", "Rxn"];

function createEmptyPrLine(mode: "CATALOG" | "NEW" = "CATALOG"): PrDraftLine {
  return {
    mode,
    item_id: "",
    label: "",
    new_item_code: "",
    new_item_name: "",
    item_type: "RAW_MATERIAL",
    qty: "1",
    uom: "Hộp",
    est_price: "",
    notes: "",
  };
}

interface StockRow {
  id: string;
  item_id: string;
  location_id: string;
  lot_id: string | null;
  item_code: string;
  item_name: string;
  base_uom: string;
  lot_code: string | null;
  lot_status: string | null;
  expiry_date: string | null;
  warehouse_code: string;
  location_code: string;
  qty_on_hand: string;
  qty_available: string;
}

export function DeptMaterialActionBar({
  moduleKey,
  deptLabel,
  defaultReasonPlaceholder,
}: {
  moduleKey: "RD" | "KIT" | "OLIGO" | "DEVICE" | "QMS";
  deptLabel: string;
  defaultReasonPlaceholder?: string;
}) {
  const qc = useQueryClient();
  const [panel, setPanel] = useState<"none" | "stock" | "requisition" | "pr">("none");

  const warehouses = useQuery({
    queryKey: ["factory", "warehouses"],
    queryFn: () => api<WarehouseItem[]>("/api/factory/master/warehouses"),
  });

  const deptWarehouses = (warehouses.data ?? []).filter((w) => {
    if (w.owner_module_key === moduleKey) return true;
    const text = `${w.code} ${w.name} ${w.owner_name ?? ""}`.toUpperCase();
    if (moduleKey === "RD") return text.includes("RD") || text.includes("R&D") || text.includes("NGHIÊN CỨU");
    if (moduleKey === "KIT") return text.includes("KIT");
    if (moduleKey === "OLIGO") return text.includes("OLIGO");
    if (moduleKey === "DEVICE") return text.includes("DEV") || text.includes("THIẾT BỊ") || text.includes("KỸ THUẬT");
    if (moduleKey === "QMS") return text.includes("QC") || text.includes("QA");
    return false;
  });

  const activeDeptWhId = deptWarehouses[0]?.id ?? "";
  const [selectedWhId, setSelectedWhId] = useState("");
  const currentWhId = selectedWhId || activeDeptWhId;

  // Quick Stock View state
  const [stockQ, setStockQ] = useState("");
  const deptStock = useQuery({
    queryKey: ["factory", "dept-quick-stock", currentWhId, stockQ],
    queryFn: () =>
      api<{ rows: StockRow[]; total: number }>(
        `/api/factory/inv/stock?page_size=25${currentWhId ? `&warehouse_id=${currentWhId}` : ""}${stockQ.trim() ? `&q=${encodeURIComponent(stockQ.trim())}` : ""}`
      ),
    enabled: panel === "stock" || panel === "requisition",
  });

  // Quick Issue / Requisition state
  const [issueWhId, setIssueWhId] = useState("");
  const targetIssueWhId = issueWhId || currentWhId || warehouses.data?.[0]?.id || "";
  const [issueReason, setIssueReason] = useState(moduleKey === "RD" ? "RND" : moduleKey === "QMS" ? "QC_SAMPLE" : "PRODUCTION");
  const [issueNotes, setIssueNotes] = useState("");
  const [issuePickQ, setIssuePickQ] = useState("");
  const [issueLines, setIssueLines] = useState<{ row: StockRow; qty: string }[]>([]);

  const issueStockPick = useQuery({
    queryKey: ["factory", "stock", "quick-issue-pick", targetIssueWhId, issuePickQ],
    queryFn: () =>
      api<{ rows: StockRow[] }>(
        `/api/factory/inv/stock?warehouse_id=${targetIssueWhId}&status=RELEASED&page_size=20${issuePickQ ? `&q=${encodeURIComponent(issuePickQ)}` : ""}`
      ),
    enabled: panel === "requisition" && Boolean(targetIssueWhId),
  });

  const postIssueMut = useMutation({
    mutationFn: () =>
      api("/api/factory/inv/documents", {
        method: "POST",
        idempotent: true,
        json: {
          doc_type: "ISSUE",
          reason_code: issueReason,
          warehouse_id: targetIssueWhId,
          notes: issueNotes || `Xuất sử dụng tại ${deptLabel}`,
          post: true,
          lines: issueLines.map((l) => ({
            item_id: l.row.item_id,
            lot_id: l.row.lot_id,
            from_location_id: l.row.location_id,
            qty: Number(l.qty.replace(",", ".")),
            uom: l.row.base_uom,
          })),
        },
      }),
    onSuccess: () => {
      setIssueLines([]);
      setIssueNotes("");
      qc.invalidateQueries({ queryKey: ["factory", "stock"] });
      qc.invalidateQueries({ queryKey: ["factory", "dept-quick-stock"] });
      qc.invalidateQueries({ queryKey: ["factory", "documents"] });
      setPanel("none");
    },
  });

  // Quick PR (Purchase Requisition) state
  const prOptions = useQuery({
    queryKey: ["factory", "pr-options"],
    queryFn: () => api<PrOption[]>("/api/factory/purchase/request-options"),
    enabled: panel === "pr",
  });
  const uoms = useQuery({
    queryKey: ["factory", "uoms"],
    queryFn: () => api<{ code: string }[]>("/api/factory/master/uoms"),
    enabled: panel === "pr",
  });
  const allCatalogItems = useQuery({
    queryKey: ["factory", "items", "pr-catalog-all"],
    queryFn: () =>
      api<{ rows: CatalogMasterItem[] }>("/api/factory/master/items?page_size=200&status=ACTIVE"),
    enabled: panel === "pr",
  });
  const [prOrgUnitId, setPrOrgUnitId] = useState("");
  const [prWhId, setPrWhId] = useState("");
  const [prNeededBy, setPrNeededBy] = useState("");
  const [prReasonPreset, setPrReasonPreset] = useState("");
  const [prReason, setPrReason] = useState("");
  const [prPurposeEntityType, setPrPurposeEntityType] = useState<string | null>(null);
  const [prPurposeEntityId, setPrPurposeEntityId] = useState<string | null>(null);
  const [prItemQ, setPrItemQ] = useState("");
  const [prQuickSelectItemId, setPrQuickSelectItemId] = useState("");
  const [prLines, setPrLines] = useState<PrDraftLine[]>(() => [createEmptyPrLine("CATALOG")]);

  React.useEffect(() => {
    if (!prOptions.data?.length || prOrgUnitId) return;
    const matched = prOptions.data.find((o) => {
      const t = `${o.code} ${o.name} ${o.module_key ?? ""}`.toUpperCase();
      if (moduleKey === "RD") return t.includes("RD") || t.includes("R&D") || t.includes("NGHIÊN CỨU");
      if (moduleKey === "KIT") return t.includes("KIT");
      if (moduleKey === "OLIGO") return t.includes("OLIGO");
      if (moduleKey === "DEVICE") return t.includes("DEV") || t.includes("THIẾT BỊ") || t.includes("KỸ THUẬT");
      if (moduleKey === "QMS") return t.includes("QC") || t.includes("QA") || t.includes("QMS");
      return false;
    }) ?? prOptions.data[0];
    if (matched) {
      setPrOrgUnitId(matched.id);
      if (matched.warehouses[0]) setPrWhId(matched.warehouses[0].id);
      if (!prReason && matched.reasons?.[0]) {
        setPrReasonPreset(matched.reasons[0].id);
        setPrReason(matched.reasons[0].value);
        setPrPurposeEntityType(matched.reasons[0].entity_type ?? null);
        setPrPurposeEntityId(matched.reasons[0].entity_id ?? null);
      }
    }
  }, [prOptions.data, prOrgUnitId, moduleKey, prReason]);

  const prItemsSearch = useQuery({
    queryKey: ["factory", "items", "quick-pr-picker", prItemQ],
    queryFn: () =>
      api<{ rows: CatalogMasterItem[] }>(
        `/api/factory/master/items?page_size=30&q=${encodeURIComponent(prItemQ)}`
      ),
    enabled: panel === "pr" && prItemQ.trim().length >= 1,
  });

  const mergedUomOptions = React.useMemo(() => {
    const fromDb = (uoms.data ?? []).map((u) => u.code);
    return Array.from(new Set([...fromDb, ...DEFAULT_UOM_SUGGESTIONS]));
  }, [uoms.data]);

  const updatePrLine = (idx: number, patch: Partial<PrDraftLine>) => {
    setPrLines((prev) => prev.map((item, j) => (j === idx ? { ...item, ...patch } : item)));
  };

  const addCatalogItemToPrLines = (it: CatalogMasterItem) => {
    setPrLines((prev) => {
      const emptyIdx = prev.findIndex(
        (l) => l.mode === "CATALOG" && !l.item_id && !l.new_item_name.trim()
      );
      const nextLine: PrDraftLine = {
        mode: "CATALOG",
        item_id: it.id,
        label: `${it.code} — ${it.name}`,
        new_item_code: "",
        new_item_name: "",
        item_type: "RAW_MATERIAL",
        qty: "1",
        uom: it.base_uom || "Hộp",
        est_price: "",
        notes: "",
      };
      if (emptyIdx !== -1) {
        return prev.map((item, j) => (j === emptyIdx ? nextLine : item));
      }
      return [...prev, nextLine];
    });
  };

  const validPrLines = prLines.filter((l) => {
    const q = Number(String(l.qty || "").replace(",", "."));
    if (!(q > 0)) return false;
    if (l.mode === "CATALOG") return Boolean(l.item_id);
    return Boolean(l.new_item_name.trim() || l.new_item_code.trim());
  });

  const createPrMut = useMutation({
    mutationFn: () =>
      api<{ id: string; code: string }>("/api/factory/purchase/requests", {
        method: "POST",
        idempotent: true,
        json: {
          org_unit_id: prOrgUnitId,
          target_warehouse_id: prWhId,
          needed_by: prNeededBy || null,
          reason: prReason.trim(),
          purpose_entity_type: prPurposeEntityType,
          purpose_entity_id: prPurposeEntityId,
          auto_submit: true,
          lines: validPrLines.map((l) => ({
            item_id: l.mode === "CATALOG" ? l.item_id : null,
            new_item_code: l.mode === "NEW" ? l.new_item_code.trim() || null : null,
            new_item_name: l.mode === "NEW" ? l.new_item_name.trim() || null : null,
            item_type: l.mode === "NEW" ? l.item_type : null,
            qty: Number(l.qty.replace(",", ".")),
            uom: l.uom || "Hộp",
            est_price: l.est_price ? Number(l.est_price) : null,
            notes: l.notes.trim() || null,
          })),
        },
      }),
    onSuccess: () => {
      setPrLines([createEmptyPrLine("CATALOG")]);
      qc.invalidateQueries({ queryKey: ["factory", "prs"] });
      qc.invalidateQueries({ queryKey: ["factory", "items"] });
      setPanel("none");
    },
  });

  const selectedPrUnit = prOptions.data?.find((o) => o.id === prOrgUnitId);
  const groupedReasons = React.useMemo(() => {
    const groups = new Map<string, PrReasonOption[]>();
    for (const r of selectedPrUnit?.reasons ?? []) {
      const list = groups.get(r.category) ?? [];
      list.push(r);
      groups.set(r.category, list);
    }
    return Array.from(groups.entries());
  }, [selectedPrUnit]);

  const navigateToHub = (tab: "factory-warehouse" | "factory-purchase" | "factory-import") => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("tbr-navigate", { detail: { tab } }));
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/90 dark:bg-slate-900/70 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
            <Boxes className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
            Kho nhánh &amp; Vật tư {deptLabel}:
          </span>
          {deptWarehouses.length > 0 ? (
            deptWarehouses.map((w) => (
              <span
                key={w.id}
                className="px-2 py-0.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono text-[11px] font-semibold text-slate-700 dark:text-slate-300"
              >
                {w.code} ({w.name})
              </span>
            ))
          ) : (
            <span className="text-slate-500">Dùng chung Kho Nhà Máy</span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setPanel(panel === "stock" ? "none" : "stock")}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl font-bold transition-colors cursor-pointer ${
              panel === "stock"
                ? "bg-sky-700 text-white"
                : "bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 hover:bg-slate-100"
            }`}
          >
            <Boxes className="w-3.5 h-3.5" />
            Tra nhanh tồn kho phòng
          </button>

          <button
            type="button"
            onClick={() => setPanel(panel === "requisition" ? "none" : "requisition")}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl font-bold transition-colors cursor-pointer ${
              panel === "requisition"
                ? "bg-emerald-700 text-white"
                : "bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100"
            }`}
          >
            <PackagePlus className="w-3.5 h-3.5" />
            + Xuất / Lĩnh NVL tại kho
          </button>

          <button
            type="button"
            onClick={() => setPanel(panel === "pr" ? "none" : "pr")}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl font-bold transition-colors cursor-pointer ${
              panel === "pr"
                ? "bg-amber-600 text-white"
                : "bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800 hover:bg-amber-100"
            }`}
          >
            <ShoppingCart className="w-3.5 h-3.5" />
            + Báo thiếu / Đề nghị mua (PR)
          </button>

          <button
            type="button"
            onClick={() => navigateToHub("factory-warehouse")}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800 cursor-pointer"
            title="Mở phân hệ Kho Nhà Máy tập trung"
          >
            Kho Nhà Máy <ArrowUpRight className="w-3 h-3" />
          </button>

          <button
            type="button"
            onClick={() => navigateToHub("factory-purchase")}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800 cursor-pointer"
            title="Mở phân hệ Cung Ứng NVL tập trung"
          >
            Cung Ứng NVL <ArrowUpRight className="w-3 h-3" />
          </button>

          <button
            type="button"
            onClick={() => navigateToHub("factory-import")}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl font-bold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/50 border border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100 cursor-pointer"
            title="Mở Trung tâm Nhập liệu Excel kéo-thả & Tải biểu mẫu chuẩn cho phòng ban"
          >
            📥 Nhập Excel &amp; Biểu mẫu <ArrowUpRight className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* 1. Quick Department Stock Lookup Drawer */}
      {panel === "stock" && (
        <Card
          title={`Tồn kho khả dụng — ${deptLabel}`}
          actions={<Button variant="ghost" onClick={() => setPanel("none")}>Đóng</Button>}
        >
          <div className="grid gap-2 sm:grid-cols-2 mb-3">
            <select
              className={inputClass}
              value={currentWhId}
              onChange={(e) => setSelectedWhId(e.target.value)}
            >
              <option value="">Tất cả kho được phép xem</option>
              {(warehouses.data ?? []).map((w) => (
                <option key={w.id} value={w.id}>
                  {w.code} — {w.name}
                </option>
              ))}
            </select>
            <input
              className={inputClass}
              placeholder="Gõ tìm nhanh tên hóa chất, mã vật tư, số lô..."
              value={stockQ}
              onChange={(e) => setStockQ(e.target.value)}
            />
          </div>
          <ErrorNote error={deptStock.error} />
          {deptStock.data?.rows.length === 0 && <Empty>Không có lô tồn kho nào khớp bộ lọc.</Empty>}
          {deptStock.data && deptStock.data.rows.length > 0 && (
            <Table head={["Vật tư", "Số lô", "Trạng thái", "Hạn dùng", "Kho · Vị trí", "Tồn", "Khả dụng"]}>
              {deptStock.data.rows.map((r) => (
                <tr key={r.id}>
                  <td className="py-1.5 pr-3 text-xs">
                    <b>{r.item_code}</b> — {r.item_name}
                  </td>
                  <td className="py-1.5 pr-3 font-mono text-xs">{r.lot_code ?? "—"}</td>
                  <td className="py-1.5 pr-3">{r.lot_status ? <StatusBadge status={r.lot_status} /> : "—"}</td>
                  <td className="py-1.5 pr-3 text-xs whitespace-nowrap">{fmtDate(r.expiry_date)}</td>
                  <td className="py-1.5 pr-3 text-xs whitespace-nowrap">{r.warehouse_code} · {r.location_code}</td>
                  <td className="py-1.5 pr-3 text-right text-xs">{fmtQty(r.qty_on_hand)} {r.base_uom}</td>
                  <td className="py-1.5 pr-3 text-right text-xs font-bold text-emerald-700 dark:text-emerald-400">
                    {fmtQty(r.qty_available)} {r.base_uom}
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      {/* 2. Quick Material Issue / Consumption Drawer */}
      {panel === "requisition" && (
        <Card
          title={`Lập phiếu xuất / lĩnh vật tư nhanh (${deptLabel})`}
          actions={<Button variant="ghost" onClick={() => setPanel("none")}>Đóng</Button>}
        >
          <form
            className="flex flex-col gap-3 text-xs"
            onSubmit={(e) => {
              e.preventDefault();
              postIssueMut.mutate();
            }}
          >
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Kho xuất *">
                <select className={inputClass} value={targetIssueWhId} onChange={(e) => { setIssueWhId(e.target.value); setIssueLines([]); }}>
                  {(warehouses.data ?? []).map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.code} — {w.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Mục đích xuất *">
                <select className={inputClass} value={issueReason} onChange={(e) => setIssueReason(e.target.value)}>
                  <option value="PRODUCTION">Xuất cho sản xuất / chạy mẻ</option>
                  <option value="RND">Xuất cho nghiên cứu R&amp;D</option>
                  <option value="QC_SAMPLE">Xuất mẫu kiểm nghiệm QC/QA</option>
                  <option value="OTHER">Mục đích khác</option>
                </select>
              </Field>
              <Field label="Mã lệnh SX / Mẻ / Thí nghiệm tham chiếu *">
                <input
                  className={inputClass}
                  value={issueNotes}
                  onChange={(e) => setIssueNotes(e.target.value)}
                  placeholder={defaultReasonPlaceholder ?? `VD: Xuất cho ${deptLabel}...`}
                  required
                />
              </Field>
            </div>

            <div>
              <input
                className={inputClass}
                placeholder="Tìm lô đã duyệt (RELEASED) trong kho rồi bấm để chọn xuất..."
                value={issuePickQ}
                onChange={(e) => setIssuePickQ(e.target.value)}
              />
              <ul className="mt-1 max-h-40 overflow-auto rounded-xl border border-slate-200 dark:border-slate-800 text-xs">
                {issueStockPick.data?.rows.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      className="w-full text-left px-3 py-1.5 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 cursor-pointer"
                      onClick={() => setIssueLines([...issueLines, { row: r, qty: "" }])}
                    >
                      <b>{r.item_code}</b> — {r.item_name} · Lô <span className="font-mono">{r.lot_code ?? "—"}</span> ({r.location_code}) · Khả dụng: <b>{fmtQty(r.qty_available)} {r.base_uom}</b>
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            {issueLines.length > 0 && (
              <Table head={["Vật tư · Lô · Vị trí", "Số lượng xuất", ""]}>
                {issueLines.map((l, idx) => (
                  <tr key={idx}>
                    <td className="py-1.5 pr-3">
                      <b>{l.row.item_code}</b> — {l.row.item_name} · Lô <span className="font-mono">{l.row.lot_code ?? "—"}</span> ({l.row.location_code})
                    </td>
                    <td className="py-1.5 pr-3 w-40">
                      <input
                        className={inputClass}
                        inputMode="decimal"
                        placeholder={`Tối đa ${fmtQty(l.row.qty_available)} ${l.row.base_uom}`}
                        value={l.qty}
                        onChange={(e) =>
                          setIssueLines(issueLines.map((item, j) => (j === idx ? { ...item, qty: e.target.value } : item)))
                        }
                        required
                      />
                    </td>
                    <td className="py-1.5 pr-3 text-right">
                      <button
                        type="button"
                        className="text-rose-600 cursor-pointer"
                        onClick={() => setIssueLines(issueLines.filter((_, j) => j !== idx))}
                      >
                        Xóa
                      </button>
                    </td>
                  </tr>
                ))}
              </Table>
            )}

            <ErrorNote error={postIssueMut.error} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setPanel("none")}>Hủy</Button>
              <Button type="submit" disabled={postIssueMut.isPending || issueLines.length === 0}>
                {postIssueMut.isPending ? "Đang ghi sổ…" : "Ghi sổ phiếu xuất"}
              </Button>
            </div>
          </form>
        </Card>
      )}

      {/* 3. Contextual Quick Purchase Requisition (PR) Drawer */}
      {panel === "pr" && (
        <Card
          title={`Báo thiếu / Đề nghị mua nguyên vật liệu (PR) — ${deptLabel}`}
          actions={<Button variant="ghost" onClick={() => setPanel("none")}>Đóng</Button>}
        >
          <form
            className="flex flex-col gap-3.5 text-xs"
            onSubmit={(e) => {
              e.preventDefault();
              createPrMut.mutate();
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-12">
              <div className="lg:col-span-3">
                <Field label="Phòng đề nghị *">
                  <select
                    className={inputClass}
                    value={prOrgUnitId}
                    onChange={(e) => {
                      const nextId = e.target.value;
                      setPrOrgUnitId(nextId);
                      const u = prOptions.data?.find((o) => o.id === nextId);
                      setPrWhId(u?.warehouses[0]?.id ?? "");
                      if (u?.reasons?.[0]) {
                        setPrReasonPreset(u.reasons[0].id);
                        setPrReason(u.reasons[0].value);
                        setPrPurposeEntityType(u.reasons[0].entity_type ?? null);
                        setPrPurposeEntityId(u.reasons[0].entity_id ?? null);
                      }
                    }}
                    required
                  >
                    <option value="">Chọn phòng</option>
                    {prOptions.data?.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.code} — {o.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <div className="lg:col-span-3">
                <Field label="Kho nhánh nhận hàng *">
                  <select className={inputClass} value={prWhId} onChange={(e) => setPrWhId(e.target.value)} required>
                    <option value="">Chọn kho nhận</option>
                    {selectedPrUnit?.warehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.code} — {w.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <div className="lg:col-span-2">
                <Field label="Cần trước ngày">
                  <input className={inputClass} type="date" value={prNeededBy} onChange={(e) => setPrNeededBy(e.target.value)} />
                </Field>
              </div>
              <div className="lg:col-span-4">
                <Field label="Chọn Lý do / Mã Lệnh SX / Dự án từ danh mục *">
                  <select
                    className={inputClass}
                    value={prReasonPreset}
                    onChange={(e) => {
                      const valId = e.target.value;
                      setPrReasonPreset(valId);
                      if (valId === "__CUSTOM__") {
                        setPrPurposeEntityType(null);
                        setPrPurposeEntityId(null);
                        return;
                      }
                      const found = selectedPrUnit?.reasons?.find((r) => r.id === valId);
                      if (found) {
                        setPrReason(found.value);
                        setPrPurposeEntityType(found.entity_type ?? null);
                        setPrPurposeEntityId(found.entity_id ?? null);
                      }
                    }}
                  >
                    <option value="">-- Chọn từ danh mục Lý do / Dự án / Lệnh SX có sẵn --</option>
                    {groupedReasons.map(([cat, items]) => (
                      <optgroup key={cat} label={cat}>
                        {items.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.label}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                    <option value="__CUSTOM__">✍️ Tự nhập lý do / mã tham chiếu khác...</option>
                  </select>
                </Field>
              </div>
            </div>

            <div>
              <Field label="Chi tiết Lý do / Mã Lệnh SX / Dự án / Ghi chú mục đích mua * (Có thể chọn ở trên hoặc gõ bổ sung)">
                <input
                  className={inputClass}
                  value={prReason}
                  onChange={(e) => setPrReason(e.target.value)}
                  placeholder={defaultReasonPlaceholder ?? `VD: Phục vụ dự án ${deptLabel} / Thí nghiệm ELN / Bổ sung định mức kho...`}
                  required
                />
              </Field>
            </div>

            {/* Thanh công cụ thêm nguyên vật liệu: Chọn từ danh sách có sẵn HOẶC Gõ mã mới, tên mới */}
            <div className="p-3 rounded-2xl border border-amber-200 dark:border-amber-800/70 bg-amber-50/50 dark:bg-amber-950/20 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                  🧪 Danh sách Nguyên vật liệu / Hóa chất đề nghị mua ({prLines.length} dòng)
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPrLines((prev) => [...prev, createEmptyPrLine("CATALOG")])}
                    className="px-3 py-1.5 rounded-xl text-xs font-bold bg-sky-600 hover:bg-sky-700 text-white shadow-2xs cursor-pointer transition-colors"
                  >
                    + Thêm dòng chọn từ DS có sẵn
                  </button>
                  <button
                    type="button"
                    onClick={() => setPrLines((prev) => [...prev, createEmptyPrLine("NEW")])}
                    className="px-3 py-1.5 rounded-xl text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white shadow-2xs cursor-pointer transition-colors"
                  >
                    ✨ + Gõ mã mới / Tên nguyên liệu mới
                  </button>
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <select
                    className={inputClass}
                    value={prQuickSelectItemId}
                    onChange={(e) => {
                      const id = e.target.value;
                      setPrQuickSelectItemId("");
                      if (!id) return;
                      const found = (allCatalogItems.data?.rows ?? []).find((x) => x.id === id);
                      if (found) addCatalogItemToPrLines(found);
                    }}
                  >
                    <option value="">
                      📚 Chọn nhanh nguyên vật liệu từ danh mục có sẵn ({allCatalogItems.data?.rows.length ?? 0} mã)...
                    </option>
                    {(allCatalogItems.data?.rows ?? []).map((it) => (
                      <option key={it.id} value={it.id}>
                        {it.code} — {it.name} ({it.base_uom})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="relative">
                  <input
                    className={inputClass}
                    placeholder="🔍 Hoặc gõ tìm nhanh theo mã / tên vật tư (hoặc gõ tên mới để thêm ngay)..."
                    value={prItemQ}
                    onChange={(e) => setPrItemQ(e.target.value)}
                  />
                  {prItemQ.trim().length >= 1 && (
                    <ul className="absolute z-20 mt-1 w-full max-h-56 overflow-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl text-xs divide-y divide-slate-100 dark:divide-slate-800">
                      {(prItemsSearch.data?.rows ?? []).map((it) => (
                        <li key={it.id}>
                          <button
                            type="button"
                            className="w-full text-left px-3 py-2 hover:bg-amber-50 dark:hover:bg-amber-950/40 cursor-pointer flex items-center justify-between gap-2"
                            onClick={() => {
                              addCatalogItemToPrLines(it);
                              setPrItemQ("");
                            }}
                          >
                            <span>
                              <span className="font-mono font-bold text-sky-700 dark:text-sky-400">{it.code}</span> — {it.name}
                            </span>
                            <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono text-[11px] shrink-0">
                              {it.base_uom}
                            </span>
                          </button>
                        </li>
                      ))}
                      <li>
                        <button
                          type="button"
                          className="w-full text-left px-3 py-2 bg-amber-50/80 dark:bg-amber-950/50 hover:bg-amber-100 dark:hover:bg-amber-900/60 text-amber-800 dark:text-amber-300 font-bold cursor-pointer"
                          onClick={() => {
                            const typed = prItemQ.trim();
                            setPrLines((prev) => [
                              ...prev,
                              {
                                mode: "NEW",
                                item_id: "",
                                label: "",
                                new_item_code: "",
                                new_item_name: typed,
                                item_type: "RAW_MATERIAL",
                                qty: "1",
                                uom: "Hộp",
                                est_price: "",
                                notes: "",
                              },
                            ]);
                            setPrItemQ("");
                          }}
                        >
                          ✨ + Thêm mới nguyên vật liệu: &ldquo;{prItemQ.trim()}&rdquo; (Tự gõ mã mới &amp; tên mới)
                        </button>
                      </li>
                    </ul>
                  )}
                </div>
              </div>
            </div>

            {prLines.length > 0 && (
              <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-slate-100 dark:bg-slate-800/80 text-slate-700 dark:text-slate-200 font-bold border-b border-slate-200 dark:border-slate-700">
                      <th className="py-2 px-2.5 w-8 text-center">#</th>
                      <th className="py-2 px-2.5 w-36">Nguồn chọn</th>
                      <th className="py-2 px-2.5 min-w-[280px]">Mã &amp; Tên Nguyên vật liệu / Hóa chất *</th>
                      <th className="py-2 px-2.5 w-24 text-center">Số lượng *</th>
                      <th className="py-2 px-2.5 w-28 text-center">ĐVT *</th>
                      <th className="py-2 px-2.5 w-36 text-right">Đơn giá dự kiến</th>
                      <th className="py-2 px-2.5 w-44">Quy cách / Ghi chú dòng</th>
                      <th className="py-2 px-2 w-12 text-center"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {prLines.map((l, idx) => (
                      <tr key={idx} className="align-top hover:bg-slate-50/70 dark:hover:bg-slate-800/30">
                        <td className="py-2 px-2.5 text-center font-mono text-slate-400 pt-3">{idx + 1}</td>
                        <td className="py-2 px-2.5">
                          <select
                            className={inputClass}
                            value={l.mode}
                            onChange={(e) => {
                              const mode = e.target.value as "CATALOG" | "NEW";
                              updatePrLine(idx, { mode });
                            }}
                          >
                            <option value="CATALOG">📚 DS có sẵn</option>
                            <option value="NEW">✨ Gõ mã/tên mới</option>
                          </select>
                        </td>
                        <td className="py-2 px-2.5">
                          {l.mode === "CATALOG" ? (
                            <select
                              className={inputClass}
                              value={l.item_id}
                              onChange={(e) => {
                                const val = e.target.value;
                                if (val === "__SWITCH_NEW__") {
                                  updatePrLine(idx, { mode: "NEW", item_id: "", label: "" });
                                  return;
                                }
                                const found = (allCatalogItems.data?.rows ?? []).find((x) => x.id === val);
                                updatePrLine(idx, {
                                  item_id: val,
                                  label: found ? `${found.code} — ${found.name}` : "",
                                  uom: found?.base_uom || l.uom || "Hộp",
                                });
                              }}
                            >
                              <option value="">-- Chọn nguyên vật liệu từ danh sách có sẵn --</option>
                              {(allCatalogItems.data?.rows ?? []).map((it) => (
                                <option key={it.id} value={it.id}>
                                  {it.code} — {it.name} ({it.base_uom})
                                </option>
                              ))}
                              <option value="__SWITCH_NEW__">✨ Không có trong DS → Chuyển sang Gõ mã mới / Tên mới...</option>
                            </select>
                          ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-12 gap-1.5">
                              <div className="sm:col-span-4">
                                <input
                                  className={inputClass}
                                  placeholder="Mã mới (VD: NVL-RD-01)"
                                  value={l.new_item_code}
                                  onChange={(e) => updatePrLine(idx, { new_item_code: e.target.value.toUpperCase() })}
                                  title="Nhập mã nguyên vật liệu mới (hoặc để trống hệ thống tự cấp mã)"
                                />
                              </div>
                              <div className="sm:col-span-5">
                                <input
                                  className={inputClass}
                                  placeholder="Tên nguyên liệu / hóa chất mới *"
                                  value={l.new_item_name}
                                  onChange={(e) => updatePrLine(idx, { new_item_name: e.target.value })}
                                  required={l.mode === "NEW"}
                                />
                              </div>
                              <div className="sm:col-span-3">
                                <select
                                  className={inputClass}
                                  value={l.item_type}
                                  onChange={(e) =>
                                    updatePrLine(idx, {
                                      item_type: e.target.value as PrDraftLine["item_type"],
                                    })
                                  }
                                  title="Phân loại vật tư mới"
                                >
                                  <option value="RAW_MATERIAL">Nguyên liệu</option>
                                  <option value="REAGENT">Hóa chất/Thuốc thử</option>
                                  <option value="CONSUMABLE">Vật tư tiêu hao</option>
                                  <option value="COMPONENT">Linh kiện</option>
                                </select>
                              </div>
                            </div>
                          )}
                        </td>
                        <td className="py-2 px-2.5">
                          <input
                            className={`${inputClass} text-center font-bold`}
                            inputMode="decimal"
                            placeholder="SL"
                            value={l.qty}
                            onChange={(e) => updatePrLine(idx, { qty: e.target.value })}
                            required
                          />
                        </td>
                        <td className="py-2 px-2.5">
                          <input
                            className={`${inputClass} text-center`}
                            list={`pr-uom-list-${moduleKey}`}
                            placeholder="ĐVT"
                            value={l.uom}
                            onChange={(e) => updatePrLine(idx, { uom: e.target.value })}
                            required
                          />
                        </td>
                        <td className="py-2 px-2.5">
                          <input
                            className={`${inputClass} text-right font-mono`}
                            inputMode="numeric"
                            placeholder="0"
                            value={l.est_price}
                            onChange={(e) => updatePrLine(idx, { est_price: e.target.value.replace(/\D/g, "") })}
                          />
                        </td>
                        <td className="py-2 px-2.5">
                          <input
                            className={inputClass}
                            placeholder="Quy cách, hãng, CAS..."
                            value={l.notes}
                            onChange={(e) => updatePrLine(idx, { notes: e.target.value })}
                          />
                        </td>
                        <td className="py-2 px-2 text-center pt-3">
                          <button
                            type="button"
                            className="text-rose-600 hover:text-rose-700 font-bold cursor-pointer"
                            onClick={() =>
                              setPrLines((prev) =>
                                prev.length > 1 ? prev.filter((_, j) => j !== idx) : [createEmptyPrLine("CATALOG")]
                              )
                            }
                            title="Xóa dòng này"
                          >
                            Xóa
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <datalist id={`pr-uom-list-${moduleKey}`}>
                  {mergedUomOptions.map((code) => (
                    <option key={code} value={code} />
                  ))}
                </datalist>
              </div>
            )}

            <ErrorNote error={createPrMut.error ?? prOptions.error} />
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <span className="text-[11px] text-slate-500">
                💡 Bạn có thể chọn vật tư có sẵn trong kho hoặc chuyển cột <b>Nguồn chọn</b> sang <b>✨ Gõ mã/tên mới</b> để đề nghị mua vật tư mới chưa có trong danh mục.
              </span>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setPanel("none")}>Hủy</Button>
                <Button type="submit" disabled={createPrMut.isPending || validPrLines.length === 0 || !prReason.trim()}>
                  {createPrMut.isPending ? "Đang gửi…" : `Lưu đề nghị mua (${validPrLines.length} mục → Chuyển sang Cung Ứng NVL)`}
                </Button>
              </div>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}
