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

interface PrOption {
  id: string;
  code: string;
  name: string;
  warehouses: { id: string; code: string; name: string }[];
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

interface PrDraftLine {
  item_id: string;
  label: string;
  qty: string;
  uom: string;
  est_price: string;
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
  const [prOrgUnitId, setPrOrgUnitId] = useState("");
  const [prWhId, setPrWhId] = useState("");
  const [prNeededBy, setPrNeededBy] = useState("");
  const [prReason, setPrReason] = useState("");
  const [prItemQ, setPrItemQ] = useState("");
  const [prLines, setPrLines] = useState<PrDraftLine[]>([]);

  React.useEffect(() => {
    if (!prOptions.data?.length || prOrgUnitId) return;
    const matched = prOptions.data.find((o) => {
      const t = `${o.code} ${o.name}`.toUpperCase();
      if (moduleKey === "RD") return t.includes("RD") || t.includes("R&D") || t.includes("NGHIÊN CỨU");
      if (moduleKey === "KIT") return t.includes("KIT");
      if (moduleKey === "OLIGO") return t.includes("OLIGO");
      if (moduleKey === "DEVICE") return t.includes("DEV") || t.includes("THIẾT BỊ") || t.includes("KỸ THUẬT");
      if (moduleKey === "QMS") return t.includes("QC") || t.includes("QA");
      return false;
    }) ?? prOptions.data[0];
    if (matched) {
      setPrOrgUnitId(matched.id);
      if (matched.warehouses[0]) setPrWhId(matched.warehouses[0].id);
    }
  }, [prOptions.data, prOrgUnitId, moduleKey]);

  const prItemsSearch = useQuery({
    queryKey: ["factory", "items", "quick-pr-picker", prItemQ],
    queryFn: () =>
      api<{ rows: { id: string; code: string; name: string; base_uom: string }[] }>(
        `/api/factory/master/items?page_size=20&q=${encodeURIComponent(prItemQ)}`
      ),
    enabled: panel === "pr" && prItemQ.trim().length >= 2,
  });

  const createPrMut = useMutation({
    mutationFn: () =>
      api("/api/factory/purchase/requests", {
        method: "POST",
        idempotent: true,
        json: {
          org_unit_id: prOrgUnitId,
          target_warehouse_id: prWhId,
          needed_by: prNeededBy || null,
          reason: prReason,
          lines: prLines.map((l) => ({
            item_id: l.item_id,
            qty: Number(l.qty.replace(",", ".")),
            uom: l.uom,
            est_price: l.est_price ? Number(l.est_price) : null,
          })),
        },
      }),
    onSuccess: () => {
      setPrLines([]);
      setPrReason("");
      qc.invalidateQueries({ queryKey: ["factory", "prs"] });
      setPanel("none");
    },
  });

  const selectedPrUnit = prOptions.data?.find((o) => o.id === prOrgUnitId);

  const navigateToHub = (tab: "factory-warehouse" | "factory-purchase") => {
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
            className="flex flex-col gap-3 text-xs"
            onSubmit={(e) => {
              e.preventDefault();
              createPrMut.mutate();
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Phòng đề nghị *">
                <select
                  className={inputClass}
                  value={prOrgUnitId}
                  onChange={(e) => {
                    const nextId = e.target.value;
                    setPrOrgUnitId(nextId);
                    const u = prOptions.data?.find((o) => o.id === nextId);
                    setPrWhId(u?.warehouses[0]?.id ?? "");
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
              <Field label="Cần trước ngày">
                <input className={inputClass} type="date" value={prNeededBy} onChange={(e) => setPrNeededBy(e.target.value)} />
              </Field>
              <Field label="Lý do / Mã Lệnh SX / Dự án *">
                <input
                  className={inputClass}
                  value={prReason}
                  onChange={(e) => setPrReason(e.target.value)}
                  placeholder={defaultReasonPlaceholder ?? `Phục vụ kế hoạch ${deptLabel}`}
                  required
                />
              </Field>
            </div>

            <div className="relative">
              <input
                className={inputClass}
                placeholder="Gõ ≥ 2 ký tự để tìm vật tư / hóa chất cần đặt mua..."
                value={prItemQ}
                onChange={(e) => setPrItemQ(e.target.value)}
              />
              {prItemsSearch.data && prItemQ.trim().length >= 2 && (
                <ul className="mt-1 max-h-48 overflow-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg text-xs">
                  {prItemsSearch.data.rows.map((it) => (
                    <li key={it.id}>
                      <button
                        type="button"
                        className="w-full text-left px-3 py-2 hover:bg-amber-50 dark:hover:bg-amber-950/40 cursor-pointer"
                        onClick={() => {
                          setPrLines([...prLines, { item_id: it.id, label: `${it.code} — ${it.name}`, qty: "", uom: it.base_uom, est_price: "" }]);
                          setPrItemQ("");
                        }}
                      >
                        <span className="font-mono font-semibold">{it.code}</span> — {it.name} ({it.base_uom})
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {prLines.length > 0 && (
              <Table head={["Vật tư cần mua", "Số lượng", "ĐVT", "Đơn giá dự kiến (VND)", ""]}>
                {prLines.map((l, idx) => (
                  <tr key={idx}>
                    <td className="py-1.5 pr-3">{l.label}</td>
                    <td className="py-1.5 pr-3 w-32">
                      <input
                        className={inputClass}
                        inputMode="decimal"
                        value={l.qty}
                        onChange={(e) => setPrLines(prLines.map((item, j) => (j === idx ? { ...item, qty: e.target.value } : item)))}
                        required
                      />
                    </td>
                    <td className="py-1.5 pr-3 w-28">
                      <select
                        className={inputClass}
                        value={l.uom}
                        onChange={(e) => setPrLines(prLines.map((item, j) => (j === idx ? { ...item, uom: e.target.value } : item)))}
                      >
                        {uoms.data?.map((u) => (
                          <option key={u.code} value={u.code}>
                            {u.code}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-1.5 pr-3 w-40">
                      <input
                        className={inputClass}
                        inputMode="numeric"
                        value={l.est_price}
                        onChange={(e) =>
                          setPrLines(prLines.map((item, j) => (j === idx ? { ...item, est_price: e.target.value.replace(/\D/g, "") } : item)))
                        }
                      />
                    </td>
                    <td className="py-1.5 pr-3 text-right">
                      <button
                        type="button"
                        className="text-rose-600 cursor-pointer"
                        onClick={() => setPrLines(prLines.filter((_, j) => j !== idx))}
                      >
                        Xóa
                      </button>
                    </td>
                  </tr>
                ))}
              </Table>
            )}

            <ErrorNote error={createPrMut.error ?? prOptions.error} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setPanel("none")}>Hủy</Button>
              <Button type="submit" disabled={createPrMut.isPending || prLines.length === 0}>
                {createPrMut.isPending ? "Đang gửi…" : "Lưu đề nghị mua (Chuyển sang Cung Ứng NVL)"}
              </Button>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}
