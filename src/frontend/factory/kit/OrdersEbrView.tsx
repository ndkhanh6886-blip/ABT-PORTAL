"use client";

import React, { useCallback, useEffect, useState } from "react";
import { ActionBar } from "../actions";
import { api, fmtDate, fmtDateTime, fmtQty } from "../api";
import { Button, Card, Empty, ErrorNote, Field, inputClass, StatusBadge, Table } from "../ui";
import { ACTION_LABELS, type KitOptions, ROLE_LABELS, STEP_CATEGORY_LABELS } from "./shared";
import { ProductionPlanView } from "./ProductionPlanView";

const SHIFT_LABELS: Record<string, string> = {
  CA_SANG: "🌅 Ca sáng (07:30–16:30)",
  CA_CHIEU: "🌇 Ca chiều (13:30–21:30)",
  CA_TOI: "🌙 Ca tối / Tăng ca",
};

const PRESET_OPERATORS = [
  "Nguyễn Thị Lan (Tổ Pha chế MasterMix)",
  "Trần Minh Đức (Tổ Chia lẻ Aliquot)",
  "Phạm Thanh Hà (Kỹ thuật viên IPQC)",
  "Lê Hoàng Yến (Tổ Dán nhãn & Đóng gói)",
  "Vũ Quốc Tuấn (Trưởng ca Sản xuất Kit)",
];

export function OrdersEbrView({ options, onRefreshOptions }: { options: KitOptions; onRefreshOptions: () => void }) {
  const [viewMode, setViewMode] = useState<"EBR" | "DAILY_TRACKER" | "PLAN">("PLAN");
  const [orders, setOrders] = useState<any[]>([]);
  const [dailySteps, setDailySteps] = useState<any[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState<string>("");
  const [detail, setDetail] = useState<any | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [showCreateOrder, setShowCreateOrder] = useState(false);
  const [showSplitForm, setShowSplitForm] = useState(false);
  const [showReworkForm, setShowReworkForm] = useState(false);
  const [dailyShiftFilter, setDailyShiftFilter] = useState<string>("ALL");
  const [dailyStatusFilter, setDailyStatusFilter] = useState<string>("ALL");
  const [dailySearch, setDailySearch] = useState<string>("");
  const [qcGateNotes, setQcGateNotes] = useState<Record<string, string>>({});
  const [operatorEdits, setOperatorEdits] = useState<Record<string, { assigned_to_name: string; shift_code: string; planned_date: string }>>({});

  const [orderForm, setOrderForm] = useState({
    org_unit_id: options.units[0]?.id ?? "",
    internal_order_line_id: "",
    product_item_id: "",
    warehouse_id: options.warehouses[0]?.id ?? "",
    planned_qty: "100",
    order_mode: "STANDARD" as "STANDARD" | "ALIQUOTED" | "DEMO",
    demo_specification: "25 test",
    qc_retention_qty: "2",
    no_retention: false,
    lot_code: "",
    mfg_date: new Date().toISOString().slice(0, 10),
    priority: "NORMAL",
    notes: "",
  });

  const [lotEditForm, setLotEditForm] = useState({
    lot_code: "",
    mfg_date: "",
  });

  const [splitForm, setSplitForm] = useState({
    child_lot_code: "",
    split_qty: "10",
    mfg_date: "",
    reason: "Tách lô thành phẩm giao đơn hàng lẻ / mẫu đối chứng",
  });
  const [showBomExplosion, setShowBomExplosion] = useState(false);
  const [showLabelSheet, setShowLabelSheet] = useState(false);

  const [stepParams, setStepParams] = useState<Record<string, Record<string, string>>>({});
  const [reconciliationNote, setReconciliationNote] = useState("");
  const [qcForm, setQcForm] = useState({
    good_qty: "",
    scrap_qty: "0",
    sample_qty: "2",
    retain_qty: "2",
    qc_summary: "Đạt các chỉ tiêu QC độ nhạy & độ đặc hiệu",
  });

  const [rwForm, setRwForm] = useState({
    scope: "PARTIAL",
    box_no: "1",
    component_item_id: "",
    qty_to_rework: "10",
    uom: "",
    instructions: "Thay thế lô ống thành phần trong Hộp bị lỗi và kiểm tra lại QC.",
  });

  const loadOrders = useCallback(async () => {
    setError(null);
    try {
      const res = await api<{ orders: any[]; daily_steps?: any[] }>("/api/factory/kit/orders");
      setOrders(res.orders);
      setDailySteps(res.daily_steps ?? []);
      if (!selectedOrderId && res.orders[0]?.id) setSelectedOrderId(res.orders[0].id);
    } catch (e) {
      setError(e);
    }
  }, [selectedOrderId]);

  const loadDetail = useCallback(async (id: string) => {
    if (!id) return;
    try {
      const d = await api<any>(`/api/factory/kit/orders/${id}`);
      setDetail(d);
      setReconciliationNote(d.order.reconciliation_note ?? "");
      setLotEditForm({
        lot_code: d.order.lot_code ?? "",
        mfg_date: d.order.mfg_date ? String(d.order.mfg_date).slice(0, 10) : new Date().toISOString().slice(0, 10),
      });
      setQcForm((p) => ({ ...p, good_qty: String(d.order.good_qty ?? d.order.planned_qty) }));
    } catch (e) {
      setError(e);
    }
  }, []);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  useEffect(() => {
    if (selectedOrderId) loadDetail(selectedOrderId);
  }, [selectedOrderId, loadDetail]);

  const kitProducts = options.items.filter((i) => ["FINISHED_KIT", "SEMI_FINISHED"].includes(i.item_type));
  const deptOperatorOptions = React.useMemo(() => {
    const kitList = (options.kit_staff ?? []).map((s) => s.label);
    const qaList = (options.qa_staff ?? []).map((s) => s.label);
    const merged = Array.from(new Set([...kitList, ...qaList]));
    return merged.length > 0 ? merged : PRESET_OPERATORS;
  }, [options.kit_staff, options.qa_staff]);

  /** Điền sẵn form Phát hành Lệnh sản xuất theo dòng PO (dùng cho chọn PO và nút "Lập kế hoạch" từ Bảng kế hoạch). */
  const prefillFromPoLine = (lineId: string) => {
    const poLine = (options.po_lines ?? []).find((p) => p.line_id === lineId);
    setOrderForm((prev) => {
      if (!poLine) return { ...prev, internal_order_line_id: "" };
      const matchedItem =
        kitProducts.find((x) => x.id === poLine.item_id) ?? kitProducts.find((x) => x.code === poLine.item_code);
      const autoAliq = Boolean(poLine.item_code?.toUpperCase().includes(".D.IC"));
      const remQty = Math.max(1, Number(poLine.qty_ordered || 100) - Number(poLine.qty_delivered || 0));
      return {
        ...prev,
        internal_order_line_id: lineId,
        product_item_id: matchedItem?.id ?? prev.product_item_id,
        planned_qty: String(remQty),
        order_mode: autoAliq ? "ALIQUOTED" : "STANDARD",
        notes: `Sản xuất theo PO ${poLine.kd_po_code} (Đơn nội bộ ${poLine.internal_order_code})`,
      };
    });
  };

  const handleCreateOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const res = await api<{ order: any }>("/api/factory/kit/orders", {
        method: "POST",
        idempotent: true,
        json: {
          org_unit_id: orderForm.org_unit_id || options.units[0]?.id,
          product_item_id: orderForm.product_item_id,
          warehouse_id: orderForm.warehouse_id || options.warehouses[0]?.id,
          planned_qty: Number(orderForm.planned_qty),
          order_mode: orderForm.order_mode,
          is_aliquoted: orderForm.order_mode === "ALIQUOTED",
          is_demo: orderForm.order_mode === "DEMO",
          demo_specification: orderForm.order_mode === "DEMO" ? orderForm.demo_specification : null,
          qc_retention_qty: orderForm.no_retention ? 0 : Number(orderForm.qc_retention_qty || 0),
          no_retention: orderForm.no_retention,
          lot_code: orderForm.lot_code.trim() || null,
          mfg_date: orderForm.mfg_date || null,
          priority: orderForm.priority,
          internal_order_line_id: orderForm.internal_order_line_id || null,
          notes: orderForm.notes || null,
        },
      });
      setOrderForm((p) => ({ ...p, lot_code: "" }));
      setShowCreateOrder(false);
      setSelectedOrderId(res.order.id);
      await loadOrders();
      await loadDetail(res.order.id);
      onRefreshOptions();
    } catch (err) {
      setError(err);
    }
  };

  const handleSplitLot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOrderId) return;
    setError(null);
    try {
      await api(`/api/factory/kit/orders/${selectedOrderId}`, {
        method: "POST",
        json: {
          operation: "split_lot",
          child_lot_code: splitForm.child_lot_code.trim() || null,
          split_qty: Number(splitForm.split_qty),
          mfg_date: splitForm.mfg_date || null,
          reason: splitForm.reason || null,
        },
      });
      setSplitForm((p) => ({ ...p, child_lot_code: "" }));
      setShowSplitForm(false);
      await loadDetail(selectedOrderId);
      await loadOrders();
      onRefreshOptions();
    } catch (err) {
      setError(err);
    }
  };

  const handleIssueMaterials = async () => {
    if (!selectedOrderId) return;
    setError(null);
    try {
      await api(`/api/factory/kit/orders/${selectedOrderId}`, {
        method: "POST",
        json: { operation: "issue_materials" },
      });
      await loadDetail(selectedOrderId);
      await loadOrders();
      onRefreshOptions();
    } catch (err) {
      setError(err);
    }
  };

  const handlePrintLabel = async () => {
    if (!selectedOrderId) return;
    setError(null);
    try {
      await api(`/api/factory/kit/orders/${selectedOrderId}`, {
        method: "POST",
        json: { operation: "print_label" },
      });
      await loadDetail(selectedOrderId);
    } catch (err) {
      setError(err);
    }
  };

  const handleUpdateOrderLot = async (regenerate = false) => {
    if (!selectedOrderId) return;
    setError(null);
    try {
      await api(`/api/factory/kit/orders/${selectedOrderId}`, {
        method: "POST",
        json: {
          operation: "update_lot",
          lot_code: regenerate ? null : lotEditForm.lot_code.trim() || null,
          mfg_date: lotEditForm.mfg_date || null,
          regenerate_lot_code: regenerate,
        },
      });
      await loadDetail(selectedOrderId);
      await loadOrders();
      onRefreshOptions();
    } catch (err) {
      setError(err);
    }
  };

  const handleLineClearance = async () => {
    if (!selectedOrderId) return;
    setError(null);
    try {
      await api(`/api/factory/kit/orders/${selectedOrderId}`, {
        method: "POST",
        json: {
          operation: "line_clearance",
          previous_lot_removed: true,
          previous_labels_destroyed: true,
          workstation_sanitized_uv: true,
          environmental_temp_humidity_ok: true,
          notes: "Đã kiểm tra dọn sạch dây chuyền, khử trùng UV và loại bỏ toàn bộ nhãn/ống của lô trước.",
        },
      });
      await loadDetail(selectedOrderId);
    } catch (err) {
      setError(err);
    }
  };

  const handleReconcile = async (c: any, actualQty: string, varianceReason: string) => {
    if (!selectedOrderId) return;
    setError(null);
    try {
      await api(`/api/factory/kit/orders/${selectedOrderId}`, {
        method: "POST",
        json: {
          operation: "reconcile_material",
          consumption_id: c.id,
          actual_qty: Number(actualQty),
          returned_qty: 0,
          variance_reason: varianceReason || null,
        },
      });
      await loadDetail(selectedOrderId);
    } catch (err) {
      setError(err);
    }
  };

  const handleCreateRework = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detail) return;
    setError(null);
    try {
      const compItem = options.items.find((i) => i.id === rwForm.component_item_id);
      await api("/api/factory/kit/reworks", {
        method: "POST",
        idempotent: true,
        json: {
          org_unit_id: detail.order.org_unit_id,
          production_order_id: detail.order.id,
          scope: rwForm.scope,
          box_no: rwForm.scope === "PARTIAL" ? Number(rwForm.box_no) : null,
          component_item_id: rwForm.component_item_id || null,
          qty_to_rework: Number(rwForm.qty_to_rework),
          uom: rwForm.uom || compItem?.base_uom || detail.order.uom,
          warehouse_id: detail.order.warehouse_id,
          instructions: rwForm.instructions,
        },
      });
      setShowReworkForm(false);
      await loadDetail(detail.order.id);
    } catch (err) {
      setError(err);
    }
  };

  const handleAssignOperator = async (orderId: string, step: any) => {
    setError(null);
    const edit = operatorEdits[step.id] ?? {
      assigned_to_name: step.assigned_to_name ?? PRESET_OPERATORS[0],
      shift_code: step.shift_code ?? "CA_SANG",
      planned_date: step.planned_date ? String(step.planned_date).slice(0, 10) : new Date().toISOString().slice(0, 10),
    };
    try {
      await api(`/api/factory/kit/orders/${orderId}`, {
        method: "POST",
        json: {
          operation: "assign_operator",
          step_id: step.id,
          assigned_to_name: edit.assigned_to_name,
          shift_code: edit.shift_code,
          planned_date: edit.planned_date,
        },
      });
      await loadOrders();
      if (selectedOrderId === orderId) await loadDetail(orderId);
    } catch (err) {
      setError(err);
    }
  };

  const handleVerifyQcGate = async (
    orderId: string,
    step: any,
    decision: "REQUEST_QC" | "PASS" | "REJECT",
    customParams?: Record<string, string>
  ) => {
    setError(null);
    try {
      await api(`/api/factory/kit/orders/${orderId}`, {
        method: "POST",
        json: {
          operation: "verify_qc_gate",
          step_id: step.id,
          decision,
          note: qcGateNotes[step.id] ?? step.qc_gate_note ?? "",
          param_values: customParams ?? stepParams[step.id] ?? step.param_values ?? {},
        },
      });
      await loadOrders();
      if (selectedOrderId === orderId) await loadDetail(orderId);
    } catch (err) {
      setError(err);
    }
  };

  const waitingQcCount = dailySteps.filter((s) => s.is_qc && s.qc_gate_status === "WAITING_QC" && s.status !== "DONE").length;
  const inProgressCount = dailySteps.filter((s) => s.status === "IN_PROGRESS" || s.status === "AWAITING_CHECK").length;

  return (
    <div className="space-y-4">
      <ErrorNote error={error} />

      {/* Thanh chuyển đổi chế độ: Điều hành Lệnh EBR vs Giám sát Nhân viên & Kế hoạch PO Hằng ngày */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-2.5 flex flex-wrap items-center justify-between gap-2 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={viewMode === "PLAN" ? "primary" : "ghost"}
            title="Trưởng nhóm lập kế hoạch sản xuất dựa trên PO đang có, theo dõi kế hoạch, QA phụ trách và tiến độ theo từng công đoạn của quy trình"
            onClick={() => setViewMode("PLAN")}
          >
            🗓️ Kế hoạch SX theo PO &amp; Tiến độ công đoạn
          </Button>
          <Button
            variant={viewMode === "EBR" ? "primary" : "ghost"}
            title="Màn hình điều hành chi tiết từng Lệnh sản xuất, Hồ sơ lô điện tử (EBR - Electronic Batch Record), Cấp phát vật tư FEFO và In nhãn theo PO"
            onClick={() => setViewMode("EBR")}
          >
            📋 Điều hành Lệnh Sản Xuất &amp; Hồ sơ Lô (EBR) ({orders.length})
          </Button>
          <Button
            variant={viewMode === "DAILY_TRACKER" ? "primary" : "ghost"}
            title="Bảng điều độ ca sản xuất, phân công nhân viên phụ trách từng bước công đoạn và theo dõi tiến độ triển khai kế hoạch PO hằng ngày"
            onClick={() => setViewMode("DAILY_TRACKER")}
          >
            👨‍🔬 Giám sát Nhân viên &amp; Tiến độ PO Hằng ngày ({dailySteps.length} công đoạn)
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {waitingQcCount > 0 && (
            <span
              title="Số bước kiểm soát chất lượng bán thành phẩm xen kẽ (IPQC - In-Process Quality Control) đang chờ bộ phận QA/QC xác nhận thông qua để mở khóa bước tiếp theo"
              className="px-2.5 py-1 rounded-full bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-300 font-bold border border-amber-300 dark:border-amber-800"
            >
              🛡️ {waitingQcCount} bước QC xen kẽ chờ xác nhận thông qua
            </span>
          )}
          <span className="px-2.5 py-1 rounded-full bg-sky-50 text-sky-800 dark:bg-sky-950/50 dark:text-sky-300 font-semibold border border-sky-200 dark:border-sky-800">
            ⚡ {inProgressCount} công đoạn đang chạy trên dây chuyền
          </span>
        </div>
      </div>

      {viewMode === "PLAN" && (
        <ProductionPlanView
          mode="LEAD"
          onOpenOrder={(orderId) => {
            setSelectedOrderId(orderId);
            setViewMode("EBR");
          }}
          onPlanFromPo={(lineId) => {
            prefillFromPoLine(lineId);
            setShowCreateOrder(true);
            setViewMode("EBR");
          }}
          onCreateOrder={() => {
            setShowCreateOrder(true);
            setViewMode("EBR");
          }}
        />
      )}

      {viewMode === "DAILY_TRACKER" && (
        <DailyOperatorTrackerSection
          dailySteps={dailySteps}
          operatorOptions={deptOperatorOptions}
          dailyShiftFilter={dailyShiftFilter}
          setDailyShiftFilter={setDailyShiftFilter}
          dailyStatusFilter={dailyStatusFilter}
          setDailyStatusFilter={setDailyStatusFilter}
          dailySearch={dailySearch}
          setDailySearch={setDailySearch}
          operatorEdits={operatorEdits}
          setOperatorEdits={setOperatorEdits}
          qcGateNotes={qcGateNotes}
          setQcGateNotes={setQcGateNotes}
          onAssignOperator={handleAssignOperator}
          onVerifyQcGate={handleVerifyQcGate}
          onOpenOrderEbr={(orderId) => {
            setSelectedOrderId(orderId);
            setViewMode("EBR");
          }}
        />
      )}

      {viewMode === "EBR" && (
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className={detail ? "lg:col-span-4 space-y-4" : "lg:col-span-12 space-y-4"}>
          <Card
            title={`Danh sách Lệnh sản xuất (${orders.length})`}
            actions={
              <Button onClick={() => setShowCreateOrder((v) => !v)}>
                {showCreateOrder ? "Đóng form" : "+ Phát hành Lệnh sản xuất Kit"}
              </Button>
            }
          >
            {showCreateOrder && (
              <form
                onSubmit={handleCreateOrder}
                className="mb-4 p-3.5 rounded-xl border border-sky-200 dark:border-sky-900/60 bg-sky-50/40 dark:bg-sky-950/20 space-y-3"
              >
                <div className="flex items-center justify-between border-b border-sky-200/70 dark:border-sky-900/50 pb-2">
                  <div className="text-xs font-bold text-sky-900 dark:text-sky-300">
                    Phát hành Lệnh sản xuất Kit mới
                  </div>
                  <Button type="button" variant="ghost" onClick={() => setShowCreateOrder(false)}>
                    Hủy
                  </Button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <Field label="Phòng Sản xuất Kit">
                    <select
                      className={inputClass}
                      value={orderForm.org_unit_id}
                      onChange={(e) => setOrderForm({ ...orderForm, org_unit_id: e.target.value })}
                      required
                    >
                      <option value="">-- Chọn đơn vị --</option>
                      {options.units.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.code} — {u.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Kho xuất VT & nhập TP">
                    <select
                      className={inputClass}
                      value={orderForm.warehouse_id}
                      onChange={(e) => setOrderForm({ ...orderForm, warehouse_id: e.target.value })}
                      required
                    >
                      <option value="">-- Chọn kho --</option>
                      {options.warehouses.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.code} — {w.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <Field label="Liên kết Đơn nội bộ (PO Kinh doanh) — Tự động nạp Mã Kit & Số lượng PO">
                  <select
                    className={inputClass}
                    value={orderForm.internal_order_line_id}
                    onChange={(e) => prefillFromPoLine(e.target.value)}
                  >
                    <option value="">-- Lệnh sản xuất độc lập (Hoặc chọn PO Kinh doanh bên dưới) --</option>
                    {(options.po_lines ?? []).map((p) => (
                      <option key={p.line_id} value={p.line_id}>
                        {p.kd_po_code} ({p.internal_order_code}) — {p.item_code}: Cần {p.qty_ordered} {p.uom}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Sản phẩm Kit / Bán TP (lấy BOM & Routing EFFECTIVE)">
                  <select
                    className={inputClass}
                    value={orderForm.product_item_id}
                    onChange={(e) => {
                      const it = kitProducts.find((x) => x.id === e.target.value);
                      const autoAliq = Boolean(it?.code?.toUpperCase().includes(".D.IC"));
                      setOrderForm({
                        ...orderForm,
                        product_item_id: e.target.value,
                        order_mode: autoAliq ? "ALIQUOTED" : orderForm.order_mode,
                      });
                    }}
                    required
                  >
                    <option value="">-- Chọn sản phẩm --</option>
                    {kitProducts.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.code} — {i.name} ({i.base_uom})
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <Field label="Chế độ Lệnh sản xuất (Chuẩn ABT)">
                    <select
                      className={inputClass}
                      value={orderForm.order_mode}
                      onChange={(e) =>
                        setOrderForm({ ...orderForm, order_mode: e.target.value as "STANDARD" | "ALIQUOTED" | "DEMO" })
                      }
                    >
                      <option value="STANDARD">Lệnh thường (STANDARD)</option>
                      <option value="ALIQUOTED">Lệnh Chia sẵn (.D.IC / ALIQUOTED)</option>
                      <option value="DEMO">Lệnh Kit Demo (Co giãn Mix)</option>
                    </select>
                  </Field>
                  {orderForm.order_mode === "DEMO" ? (
                    <Field label="Quy cách Kit Demo">
                      <select
                        className={inputClass}
                        value={orderForm.demo_specification}
                        onChange={(e) => setOrderForm({ ...orderForm, demo_specification: e.target.value })}
                      >
                        <option value="25 test">25 test (1/2 bộ chuẩn 50T)</option>
                        <option value="24 test">24 test (1/2 bộ chia sẵn 48T)</option>
                        <option value="1/2 bộ">1/2 bộ (50% Mix, giữ 1 vỏ hộp)</option>
                        <option value="10 test">10 test (20% Mix, giữ 1 vỏ hộp)</option>
                      </select>
                    </Field>
                  ) : (
                    <Field label="Mẫu lưu QC (Bộ/ĐVT)">
                      <div className="flex items-center gap-1.5">
                        <input
                          type="number"
                          step="any"
                          disabled={orderForm.no_retention}
                          className={inputClass}
                          value={orderForm.qc_retention_qty}
                          onChange={(e) => setOrderForm({ ...orderForm, qc_retention_qty: e.target.value })}
                        />
                        <label className="flex items-center gap-1 text-[11px] whitespace-nowrap text-stone-600">
                          <input
                            type="checkbox"
                            checked={orderForm.no_retention}
                            onChange={(e) => setOrderForm({ ...orderForm, no_retention: e.target.checked })}
                          />
                          Không lưu
                        </label>
                      </div>
                    </Field>
                  )}
                </div>
                <Field label="Số Lô thành phẩm (Lot No.) — Để trống hệ thống tự sinh ngay">
                  <input
                    className={`${inputClass} font-mono`}
                    placeholder="VD: 010326 (để trống hệ thống tự cấp ngay)"
                    value={orderForm.lot_code}
                    onChange={(e) => setOrderForm({ ...orderForm, lot_code: e.target.value })}
                  />
                </Field>
                <div className="grid grid-cols-3 gap-2">
                  <Field label="SL kế hoạch">
                    <input
                      type="number"
                      step="any"
                      className={inputClass}
                      value={orderForm.planned_qty}
                      onChange={(e) => setOrderForm({ ...orderForm, planned_qty: e.target.value })}
                      required
                    />
                  </Field>
                  <Field label="Ngày SX">
                    <input
                      type="date"
                      className={inputClass}
                      value={orderForm.mfg_date}
                      onChange={(e) => setOrderForm({ ...orderForm, mfg_date: e.target.value })}
                      required
                    />
                  </Field>
                  <Field label="Ưu tiên">
                    <select
                      className={inputClass}
                      value={orderForm.priority}
                      onChange={(e) => setOrderForm({ ...orderForm, priority: e.target.value })}
                    >
                      <option value="LOW">Thấp</option>
                      <option value="NORMAL">Thường</option>
                      <option value="HIGH">Cao</option>
                      <option value="URGENT">Khẩn</option>
                    </select>
                  </Field>
                </div>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="ghost" onClick={() => setShowCreateOrder(false)}>
                    Hủy
                  </Button>
                  <Button type="submit">Tạo lệnh sản xuất &amp; Cấp Số Lô ngay</Button>
                </div>
              </form>
            )}

            {orders.length === 0 ? (
              <Empty>Chưa có lệnh sản xuất Kit nào. Bấm &ldquo;+ Phát hành Lệnh sản xuất Kit&rdquo; ở góc phải để tạo mới.</Empty>
            ) : (
              <Table head={["Mã lệnh", "Sản phẩm / Số Lô", "Tiến độ EBR", "Trạng thái"]}>
                {orders.map((o) => (
                  <tr
                    key={o.id}
                    onClick={() => setSelectedOrderId(o.id)}
                    className={`cursor-pointer hover:bg-amber-50/60 dark:hover:bg-slate-800/60 ${selectedOrderId === o.id ? "bg-amber-50 dark:bg-sky-950/30" : ""}`}
                  >
                    <td className="px-3 py-2 font-mono text-xs font-semibold text-sky-700 dark:text-sky-400">{o.code}</td>
                    <td className="px-3 py-2 text-xs">
                      <div className="font-medium text-stone-800 dark:text-slate-200">
                        {o.product_code} ({fmtQty(o.planned_qty)} {o.uom})
                      </div>
                      <div className="text-sky-700 dark:text-sky-400 font-mono font-semibold">
                        {o.lot_code ? `Lô: ${o.lot_code}` : "Chưa cấp lô"}
                        {o.expiry_date ? ` · HSD: ${fmtDate(o.expiry_date)}` : ""}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {o.done_steps}/{o.total_steps} bước
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={o.status} />
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        </div>

        {detail && (
          <div className="lg:col-span-8 space-y-4">
            <Card
              title={`Lệnh ${detail.order.code} — ${detail.order.product_code} ${detail.order.product_name}`}
              actions={
                <div className="flex items-center gap-2">
                  <StatusBadge status={detail.order.status} />
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setSelectedOrderId("");
                      setDetail(null);
                    }}
                  >
                    Đóng chi tiết
                  </Button>
                </div>
              }
            >
                {/* Review-by-Exception (RbE) & Actual Batch Costing Banner */}
                {(() => {
                  const steps = detail.steps ?? [];
                  const failedSteps = steps.filter((s: any) => s.status === "FAILED").length;
                  const missingDualSign = steps.filter((s: any) => s.requires_check_signature && !s.checked_by && s.status === "DONE").length;
                  const maxVar = Math.max(0, ...(detail.consumptions ?? []).map((c: any) => Math.abs(Number(c.variance_pct ?? 0))));
                  const hasException = failedSteps > 0 || missingDualSign > 0 || maxVar > 5 || !detail.order.line_clearance_passed;
                  const plannedQty = Math.max(1, Number(detail.order.planned_qty || 1));
                  const goodQty = Math.max(1, Number(detail.order.good_qty || plannedQty));
                  const stdUnitCost = 320000;
                  const actualTotalCost = Math.round(plannedQty * stdUnitCost * (1 + maxVar / 100));
                  const actualUnitCost = Math.round(actualTotalCost / goodQty);
                  return (
                    <div
                      className={`mb-3 rounded-xl border p-2.5 flex flex-wrap items-center justify-between gap-2 text-xs ${
                        !hasException
                          ? "border-emerald-300 bg-emerald-50/70 dark:bg-emerald-950/30 dark:border-emerald-800"
                          : "border-amber-300 bg-amber-50/70 dark:bg-amber-950/30 dark:border-amber-800"
                      }`}
                    >
                      <div className="space-y-0.5">
                        <div className="font-bold flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-white dark:bg-slate-900">
                            {!hasException ? "🟢 ZERO-EXCEPTION (RbE)" : "⚠️ REVIEW-BY-EXCEPTION"}
                          </span>
                          <span>
                            {!hasException
                              ? "Mọi bước EBR, Line Clearance & tiêu hao BOM nằm trong ngưỡng chuẩn — Đủ điều kiện duyệt xuất xưởng nhanh"
                              : `Cảnh báo thẩm định: Lệch BOM tối đa ${maxVar.toFixed(1)}% · Bước lỗi: ${failedSteps} · Thiếu chữ ký kép: ${missingDualSign}`}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-600 dark:text-slate-300 font-mono">
                          💰 Giá thành lô thực tế (Actual Batch Costing): Chuẩn <b>{stdUnitCost.toLocaleString("vi-VN")} đ/ĐV</b> ➔ Thực tế{" "}
                          <b>{actualUnitCost.toLocaleString("vi-VN")} đ/ĐV</b> (Tổng lô: <b>{actualTotalCost.toLocaleString("vi-VN")} đ</b>)
                        </div>
                      </div>
                    </div>
                  );
                })()}

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs text-stone-600 mb-3">
                  <div>
                    Mã lô Kit:{" "}
                    <strong className="font-mono text-sky-700">{detail.order.lot_code ?? "Chưa cấp"}</strong>{" "}
                    {detail.order.lot_status && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-stone-100 text-stone-600 font-mono">
                        {detail.order.lot_status}
                      </span>
                    )}
                  </div>
                  <div>
                    SL Kế hoạch / Đạt:{" "}
                    <strong className="text-stone-900">
                      {fmtQty(detail.order.planned_qty)} / {fmtQty(detail.order.good_qty)} {detail.order.uom}
                    </strong>
                  </div>
                  <div>
                    NSX / HSD cố định:{" "}
                    <strong className="text-stone-900">
                      {fmtDate(detail.order.mfg_date)} → {fmtDate(detail.order.expiry_date)}
                    </strong>
                  </div>
                  <div>
                    Nhãn lô:{" "}
                    <strong className="text-stone-900">
                      {detail.order.label_printed_at
                        ? `Đã in & Khóa HSD (${fmtDateTime(detail.order.label_printed_at)})`
                        : "Chưa in nhãn"}
                    </strong>
                  </div>
                  <div>
                    Dọn dây chuyền (GMP):{" "}
                    <strong className={detail.order.line_clearance_passed ? "text-emerald-700" : "text-amber-700"}>
                      {detail.order.line_clearance_passed ? "ĐÃ ĐẠT LINE CLEARANCE" : "Chưa xác nhận"}
                    </strong>
                  </div>
                  <div>
                    Hiệu suất mẻ (Batch Yield):{" "}
                    <strong className="font-mono text-stone-900">
                      {detail.order.yield_pct != null ? `${fmtQty(detail.order.yield_pct)}%` : "Chưa tính"}
                    </strong>
                  </div>
                  <div>
                    Mẫu QC / Mẫu lưu:{" "}
                    <strong className="font-mono text-stone-900">
                      {fmtQty(detail.order.sample_qty ?? 0)} /{" "}
                      {detail.order.no_retention ? "Không lưu" : `${fmtQty(detail.order.qc_retention_qty ?? detail.order.retain_qty ?? 0)} ${detail.order.uom}`}
                    </strong>
                  </div>
                  <div>
                    Chế độ Lệnh &amp; Độ pH thực tế:{" "}
                    <strong className="font-mono text-sky-700">
                      {detail.order.order_mode === "DEMO"
                        ? `KIT DEMO (${detail.order.demo_specification || "1/2 bộ"})`
                        : detail.order.order_mode === "ALIQUOTED" || detail.order.is_aliquoted
                          ? "CHIA SẴN (.D.IC)"
                          : "THƯỜNG"}
                    </strong>
                    {detail.order.actual_ph && (
                      <span className="ml-1.5 px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 font-mono">
                        pH: {detail.order.actual_ph}
                      </span>
                    )}
                  </div>
                </div>

                {!detail.order.label_printed_at && !["COMPLETED", "CANCELLED"].includes(detail.order.status) && (
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-2 items-end mb-3 p-2.5 bg-sky-50/70 rounded-lg border border-sky-200">
                    <div className="md:col-span-5">
                      <Field label="Số Lô trên Lệnh sản xuất (Lot Code — Mở khóa cho tới khi In nhãn)">
                        <input
                          className={`${inputClass} font-mono font-semibold`}
                          placeholder="Nhập mã lô hoặc bấm Cấp tự động..."
                          value={lotEditForm.lot_code}
                          onChange={(e) => setLotEditForm({ ...lotEditForm, lot_code: e.target.value })}
                        />
                      </Field>
                    </div>
                    <div className="md:col-span-3">
                      <Field label="Ngày sản xuất (Tự tính HSD)">
                        <input
                          type="date"
                          className={inputClass}
                          value={lotEditForm.mfg_date}
                          onChange={(e) => setLotEditForm({ ...lotEditForm, mfg_date: e.target.value })}
                        />
                      </Field>
                    </div>
                    <div className="md:col-span-4 flex flex-wrap gap-1.5">
                      <Button onClick={() => handleUpdateOrderLot(false)}>Lưu Số Lô &amp; NSX</Button>
                      <Button variant="ghost" onClick={() => handleUpdateOrderLot(true)}>
                        ↻ Tự sinh Số Lô mới
                      </Button>
                    </div>
                  </div>
                )}

                {detail.order.status === "PENDING_QC" && (
                  <div className="grid grid-cols-1 md:grid-cols-5 gap-2 mb-3 p-2.5 bg-amber-50/70 rounded border border-amber-200">
                    <Field label="SL Kit đạt QC (good_qty)">
                      <input
                        type="number"
                        step="any"
                        className={inputClass}
                        value={qcForm.good_qty}
                        onChange={(e) => setQcForm({ ...qcForm, good_qty: e.target.value })}
                      />
                    </Field>
                    <Field label="SL hủy (scrap_qty)">
                      <input
                        type="number"
                        step="any"
                        className={inputClass}
                        value={qcForm.scrap_qty}
                        onChange={(e) => setQcForm({ ...qcForm, scrap_qty: e.target.value })}
                      />
                    </Field>
                    <Field label="SL mẫu QC (sample_qty)">
                      <input
                        type="number"
                        step="any"
                        className={inputClass}
                        value={qcForm.sample_qty}
                        onChange={(e) => setQcForm({ ...qcForm, sample_qty: e.target.value })}
                      />
                    </Field>
                    <Field label="SL mẫu lưu (retain_qty)">
                      <input
                        type="number"
                        step="any"
                        className={inputClass}
                        value={qcForm.retain_qty}
                        onChange={(e) => setQcForm({ ...qcForm, retain_qty: e.target.value })}
                      />
                    </Field>
                    <Field label="Kết luận QC xuất xưởng">
                      <input
                        className={inputClass}
                        value={qcForm.qc_summary}
                        onChange={(e) => setQcForm({ ...qcForm, qc_summary: e.target.value })}
                      />
                    </Field>
                  </div>
                )}

                {detail.order.status === "PENDING_RELEASE" && (
                  <div className="mb-3">
                    <Field label="Giải trình quyết toán vật tư tổng thể (bắt buộc nếu có dòng chênh lệch > ngưỡng 5%)">
                      <input
                        className={inputClass}
                        placeholder="Nhập giải trình hao hụt công đoạn chiết rót / đông khô (nếu có)..."
                        value={reconciliationNote}
                        onChange={(e) => setReconciliationNote(e.target.value)}
                      />
                    </Field>
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <ActionBar
                    endpoint={`/api/factory/kit/orders/${detail.order.id}/actions`}
                    version={detail.order.version}
                    actions={detail.allowed_actions}
                    labels={ACTION_LABELS}
                    extraPayload={{
                      good_qty: Number(qcForm.good_qty || detail.order.planned_qty),
                      scrap_qty: Number(qcForm.scrap_qty || 0),
                      sample_qty: Number(qcForm.sample_qty || 0),
                      retain_qty: Number(qcForm.retain_qty || 0),
                      qc_summary: qcForm.qc_summary,
                      reconciliation_note: reconciliationNote,
                    }}
                    onDone={() => {
                      loadOrders();
                      loadDetail(detail.order.id);
                      onRefreshOptions();
                    }}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button variant="ghost" onClick={() => setShowBomExplosion(!showBomExplosion)}>
                      {showBomExplosion ? "Ẩn Bảng Nổ BOM" : "🔍 Xem Bảng Nổ BOM Thông Minh"}
                    </Button>
                    {!detail.order.line_clearance_passed && ["CONFIRMED", "IN_PROGRESS"].includes(detail.order.status) && (
                      <Button variant="ghost" onClick={handleLineClearance}>
                        ✓ Xác nhận Dọn dây chuyền (Line Clearance)
                      </Button>
                    )}
                    {detail.order.status === "CONFIRMED" && !detail.order.materials_issued && (
                      <Button onClick={handleIssueMaterials}>Xuất kho nguyên vật liệu (FEFO)</Button>
                    )}
                    {detail.order.lot_id && (
                      <Button
                        variant="secondary"
                        onClick={async () => {
                          if (!detail.order.label_printed_at) await handlePrintLabel();
                          setShowLabelSheet(true);
                        }}
                      >
                        🏷️ In Trọn Bộ Nhãn Kit, Ống &amp; Tờ HDSD (IFU)
                      </Button>
                    )}
                  </div>
                </div>

                {showBomExplosion && (detail.exploded_bom || []).length > 0 && (
                  <div className="mt-3 pt-3 border-t border-stone-200 space-y-2">
                    <div className="text-xs font-semibold text-stone-800">
                      Bảng Tính Nổ BOM Thông Minh (`explodeKitBom` — Chế độ:{" "}
                      {detail.order.order_mode === "DEMO"
                        ? `Kit Demo (${detail.order.demo_specification})`
                        : detail.order.order_mode === "ALIQUOTED"
                          ? "Chia sẵn (.D.IC)"
                          : "Thường"}
                      )
                    </div>
                    <Table
                      head={[
                        "#",
                        "Hộp / Vai trò",
                        "Mã VT / Bán TP",
                        "Định mức đơn vị",
                        "SL tính (gồm Mẫu lưu)",
                        "Hệ số Demo",
                        "Hao hụt",
                        "Tổng SL cần xuất",
                      ]}
                    >
                      {(detail.exploded_bom || []).map((eb: any) => (
                        <tr key={eb.bom_line_id}>
                          <td className="px-3 py-1.5 text-xs">{eb.line_no}</td>
                          <td className="px-3 py-1.5 text-xs">
                            Hộp {eb.box_no} · {ROLE_LABELS[eb.component_role] ?? eb.component_role}
                          </td>
                          <td className="px-3 py-1.5 text-xs">
                            <span className="font-mono font-semibold">{eb.component_code}</span> — {eb.component_name}
                          </td>
                          <td className="px-3 py-1.5 text-xs font-mono">
                            {fmtQty(eb.unit_norm)} {eb.uom}
                          </td>
                          <td className="px-3 py-1.5 text-xs font-mono">{fmtQty(eb.effective_order_qty)}</td>
                          <td className="px-3 py-1.5 text-xs font-mono">
                            {eb.demo_ratio_applied !== 1 ? `x${eb.demo_ratio_applied}` : "1.0 (Giữ nguyên)"}
                          </td>
                          <td className="px-3 py-1.5 text-xs">{fmtQty(eb.scrap_pct)}%</td>
                          <td className="px-3 py-1.5 text-xs font-mono font-bold text-sky-800">
                            {fmtQty(eb.required_qty)} {eb.uom}
                            {eb.is_bundled && " (Đi kèm)"}
                          </td>
                        </tr>
                      ))}
                    </Table>
                  </div>
                )}

                {showLabelSheet && (
                  <div className="mt-3 p-4 rounded-xl border-2 border-sky-600 bg-white dark:bg-slate-950 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-2.5">
                      <div>
                        <div className="text-xs font-extrabold text-sky-900 dark:text-sky-300 uppercase">
                          🏷️ Trọn Bộ Mẫu Nhãn In &amp; Tờ Hướng Dẫn Sử Dụng (IFU) Tự Động Theo PO — Lô {detail.order.lot_code} ({detail.order.product_code})
                        </div>
                        <div className="text-[11px] text-slate-500">
                          Mẫu nhãn: <b>{detail.order.label_template_code ?? `LBL-${detail.order.product_code}-V1`}</b> · Khổ tem:{" "}
                          <b>{detail.order.label_dimensions ?? "Hộp 95×65 mm · Ống 38×19 mm"}</b> · Tài liệu IFU:{" "}
                          <b>{detail.order.ifu_code ?? `IFU-${detail.order.product_code}`} ({detail.order.ifu_version ?? "Rev 01"})</b>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button onClick={() => window.print()}>🖨️ In Trọn Bộ Nhãn &amp; HDSD (Print)</Button>
                        <Button variant="ghost" onClick={() => setShowLabelSheet(false)}>
                          Đóng
                        </Button>
                      </div>
                    </div>

                    {/* Bảng 1: Tự động tính Số lượng bản in Nhãn Hộp, Nhãn Ống & Tờ HDSD theo PO */}
                    {(() => {
                      const poQty = Number(detail.order.planned_qty || 0);
                      const retQty = detail.order.no_retention ? 0 : Number(detail.order.qc_retention_qty ?? detail.order.retain_qty ?? 0);
                      const totalKits = poQty + retQty;
                      return (
                        <div className="rounded-lg border border-sky-200 dark:border-sky-900 bg-sky-50/60 dark:bg-sky-950/30 p-2.5 text-xs space-y-1.5">
                          <div className="font-bold text-sky-900 dark:text-sky-200">
                            🧮 Bảng Định Mức Số Lượng Bản In Tự Động Cho Lệnh {detail.order.code} {detail.order.kd_po_code ? `(PO: ${detail.order.kd_po_code})` : ""}:
                          </div>
                          <div className="flex flex-wrap gap-3 text-[11px]">
                            <span className="px-2 py-1 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                              📦 Nhãn Hộp Ngoài: <b>{totalKits} tem</b> ({poQty} bộ PO + {retQty} bộ mẫu lưu)
                            </span>
                            <span className="px-2 py-1 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                              📖 Tờ Hướng dẫn sử dụng ({detail.order.ifu_code ?? `IFU-${detail.order.product_code}`}): <b>{totalKits} tờ</b> (1 tờ/hộp)
                            </span>
                            {(detail.packaging || []).map((pk: any) => (
                              <span
                                key={pk.id}
                                className="px-2 py-1 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
                              >
                                🧪 Nhãn ống <b>{pk.component_name}</b>: <b>{totalKits * Number(pk.units_per_kit || 1)} tem</b> ({pk.units_per_kit} ống/bộ)
                              </span>
                            ))}
                          </div>
                        </div>
                      );
                    })()}

                    {/* Bảng 2: Bản in Nhãn Hộp Ngoài & Nhãn Từng Ống Thành Phần */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="p-3 border-2 border-stone-800 rounded-lg bg-stone-50 dark:bg-slate-900 text-xs space-y-1">
                        <div className="font-bold text-stone-900 dark:text-slate-100 border-b border-stone-300 pb-1 flex justify-between">
                          <span>ABT BIOLOGICAL SOLUTIONS — NHÃN HỘP NGOÀI ({detail.order.label_template_code ?? "LBL-OUTER"})</span>
                          <span className="px-1.5 py-0.5 rounded bg-stone-900 text-white font-mono text-[10px]">IVD</span>
                        </div>
                        <div className="font-bold text-sm text-sky-900 dark:text-sky-300">{detail.order.product_name}</div>
                        <div className="grid grid-cols-2 gap-1 font-mono text-[11px] pt-1">
                          <div>REF: {detail.order.product_code}</div>
                          <div>LOT: {detail.order.lot_code}</div>
                          <div>MFG: {fmtDate(detail.order.mfg_date)}</div>
                          <div>EXP: {fmtDate(detail.order.expiry_date)}</div>
                          <div>
                            QUY CÁCH:{" "}
                            {detail.order.order_mode === "DEMO"
                              ? `DEMO (${detail.order.demo_specification})`
                              : detail.order.order_mode === "ALIQUOTED" || detail.order.is_aliquoted
                                ? `48 Tests (Chia sẵn .D.IC)`
                                : `${detail.order.tests_per_kit || 50} Tests`}
                          </div>
                          <div>UDI: {detail.order.udi_di ?? "(01)08936192830117"}(10){detail.order.lot_code}</div>
                          {detail.order.actual_ph && <div>pH THỰC TẾ: {detail.order.actual_ph}</div>}
                        </div>
                      </div>
                      {(detail.packaging || []).map((pk: any) => (
                        <div key={pk.id} className="p-3 border border-stone-400 rounded-lg bg-white dark:bg-slate-900 text-xs space-y-1">
                          <div className="font-semibold text-stone-700 dark:text-slate-300 flex justify-between">
                            <span>NHÃN ỐNG THÀNH PHẦN (Hộp {pk.box_no}: {pk.box_name})</span>
                            <span className="font-mono px-1.5 py-0.5 rounded bg-sky-100 text-sky-900">{pk.storage_temp}</span>
                          </div>
                          <div className="font-bold text-stone-900 dark:text-white">{pk.component_name}</div>
                          <div className="grid grid-cols-2 gap-1 font-mono text-[11px]">
                            <div>
                              Vol: {fmtQty(pk.fill_qty)} {pk.fill_uom} × {pk.units_per_kit} ống
                            </div>
                            <div>LOT: {detail.order.lot_code}</div>
                            <div>EXP: {fmtDate(detail.order.expiry_date)}</div>
                            {detail.order.actual_ph && <div>pH: {detail.order.actual_ph}</div>}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Bảng 3: Bản in Tờ Hướng Dẫn Sử Dụng (IFU - Instructions For Use) đi kèm Hộp Kit */}
                    <div className="p-3.5 rounded-xl border-2 border-emerald-700 bg-emerald-50/30 dark:bg-emerald-950/20 text-xs space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-emerald-300 dark:border-emerald-800 pb-1.5">
                        <div className="font-extrabold text-emerald-950 dark:text-emerald-200 uppercase">
                          📖 TỜ HƯỚNG DẪN SỬ DỤNG ĐI KÈM BỘ KIT (IFU — {detail.order.ifu_code ?? `IFU-${detail.order.product_code}`})
                        </div>
                        <div className="font-mono text-[11px] text-emerald-800 dark:text-emerald-300">
                          Phiên bản: {detail.order.ifu_version ?? "Rev 01 (ISO 13485)"} · Áp dụng Lô: <b>{detail.order.lot_code}</b> (HSD: {fmtDate(detail.order.expiry_date)})
                        </div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 text-[11px]">
                        <div>
                          <div className="font-bold text-slate-800 dark:text-slate-100">1. Mục đích sử dụng (Intended Use):</div>
                          <div className="text-slate-700 dark:text-slate-300">
                            {detail.order.ifu_intended_use ??
                              "Bộ Kit xét nghiệm chẩn đoán in vitro (IVD) phát hiện và định lượng acid nucleic đặc hiệu bằng kỹ thuật Real-time PCR / RT-qPCR."}
                          </div>
                        </div>
                        <div>
                          <div className="font-bold text-slate-800 dark:text-slate-100">2. Kênh màu Huỳnh quang (Fluorescence Channels):</div>
                          <div className="text-slate-700 dark:text-slate-300 font-mono">
                            {detail.order.ifu_channels ?? "FAM: Đích tác nhân chính (Target) · HEX/VIC: Chứng nội (IC) · ROX: Tham chiếu"}
                          </div>
                        </div>
                        <div>
                          <div className="font-bold text-slate-800 dark:text-slate-100">3. Chương trình Chu kỳ nhiệt Real-time PCR (Thermal Profile):</div>
                          <div className="text-slate-700 dark:text-slate-300">
                            {detail.order.ifu_thermal_profile ??
                              "50°C × 10 phút (1 chu kỳ) ➔ 95°C × 3 phút (1 chu kỳ) ➔ 45 chu kỳ: [95°C × 15 giây + 60°C × 45 giây (Đọc tín hiệu tại 60°C)]."}
                          </div>
                        </div>
                        <div>
                          <div className="font-bold text-slate-800 dark:text-slate-100">4. Phiên giải Kết quả Ct (Result Interpretation):</div>
                          <div className="text-slate-700 dark:text-slate-300">
                            {detail.order.ifu_interpretation ??
                              "Dương tính: Ct (FAM) ≤ 38.0 · Âm tính: Không lên FAM và Ct (HEX/IC) ≤ 35.0 · Không hợp lệ: Không lên cả FAM và HEX/IC."}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {detail.order.lot_id && (
                  <div className="mt-3 pt-3 border-t border-stone-200 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-semibold text-stone-700">
                        Tách lô / Chia lô thành phẩm (`kit.lot_split` — Đã tách {(detail.lot_splits || []).length} lô con)
                      </div>
                      <Button variant="ghost" onClick={() => setShowSplitForm((v) => !v)}>
                        {showSplitForm ? "Đóng tách lô" : "✂️ + Tách lô thành phẩm"}
                      </Button>
                    </div>
                    {(detail.lot_splits || []).length > 0 && (
                      <Table head={["Mã Lô con", "SL tách", "NSX → HSD", "Trạng thái lô con", "Lý do tách"]}>
                        {(detail.lot_splits || []).map((ls: any) => (
                          <tr key={ls.id}>
                            <td className="px-3 py-1.5 font-mono text-xs font-bold text-sky-700">{ls.child_lot_code}</td>
                            <td className="px-3 py-1.5 text-xs font-semibold">
                              {fmtQty(ls.split_qty)} {ls.uom}
                            </td>
                            <td className="px-3 py-1.5 text-xs">
                              {fmtDate(ls.mfg_date)} → {fmtDate(ls.expiry_date)}
                            </td>
                            <td className="px-3 py-1.5">
                              <StatusBadge status={ls.child_lot_status} />
                            </td>
                            <td className="px-3 py-1.5 text-xs text-stone-600">{ls.reason ?? "-"}</td>
                          </tr>
                        ))}
                      </Table>
                    )}
                    {showSplitForm && (
                      <form onSubmit={handleSplitLot} className="grid grid-cols-1 md:grid-cols-5 gap-2 items-end p-2.5 rounded-lg bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800">
                        <Field label="Mã Lô con (Trống = tự sinh)">
                          <input
                            className={`${inputClass} font-mono`}
                            placeholder="VD: 010326-B"
                            value={splitForm.child_lot_code}
                            onChange={(e) => setSplitForm({ ...splitForm, child_lot_code: e.target.value })}
                          />
                        </Field>
                        <Field label={`SL tách (${detail.order.uom})`}>
                          <input
                            type="number"
                            step="any"
                            className={inputClass}
                            value={splitForm.split_qty}
                            onChange={(e) => setSplitForm({ ...splitForm, split_qty: e.target.value })}
                            required
                          />
                        </Field>
                        <Field label="NSX lô con (Tùy chọn)">
                          <input
                            type="date"
                            className={inputClass}
                            value={splitForm.mfg_date}
                            onChange={(e) => setSplitForm({ ...splitForm, mfg_date: e.target.value })}
                          />
                        </Field>
                        <Field label="Lý do tách lô">
                          <input
                            className={inputClass}
                            value={splitForm.reason}
                            onChange={(e) => setSplitForm({ ...splitForm, reason: e.target.value })}
                          />
                        </Field>
                        <Button type="submit">
                          Xác nhận Tách lô
                        </Button>
                      </form>
                    )}
                  </div>
                )}
              </Card>

              <Card title={`1. Cấp phát FEFO & Quyết toán tiêu hao nguyên vật liệu (${detail.consumptions.length} dòng)`}>
                {detail.consumptions.length === 0 ? (
                  <Empty>Xác nhận lệnh sản xuất để hệ thống tự động phân bổ lô nguyên vật liệu theo FEFO.</Empty>
                ) : (
                  <Table
                    head={[
                      "Hộp / Vai trò",
                      "Vật tư / Bán TP",
                      "Lô FEFO & Hạn dùng",
                      "Định mức",
                      "Đã xuất",
                      "Thực dùng & Giải trình",
                    ]}
                  >
                    {detail.consumptions.map((c: any) => (
                      <ConsumptionRow
                        key={c.id}
                        row={c}
                        locked={["COMPLETED", "CANCELLED"].includes(detail.order.status)}
                        onSave={handleReconcile}
                      />
                    ))}
                  </Table>
                )}
              </Card>

              <Card title={`2. Hồ sơ lô điện tử — EBR (${detail.steps.length} bước công đoạn & Chốt chặn QC xen kẽ)`}>
                {detail.steps.length === 0 ? (
                  <Empty>Bấm &ldquo;Xác nhận lệnh &amp; Giữ chỗ nguyên liệu (FEFO)&rdquo; ở trên để hệ thống khởi tạo các bước Hồ sơ lô (EBR) từ Quy trình (Routing).</Empty>
                ) : (
                  <div className="space-y-3">
                    {detail.steps.map((s: any) => {
                      const schema: any[] = Array.isArray(s.param_schema) ? s.param_schema : [];
                      const curVals = { ...(s.param_values || {}), ...(stepParams[s.id] || {}) };
                      const blockingPrevQc = (detail.steps || []).find(
                        (prev: any) => prev.seq < s.seq && prev.is_qc && prev.qc_gate_status !== "PASSED"
                      );
                      const opEdit = operatorEdits[s.id] ?? {
                        assigned_to_name: s.assigned_to_name ?? PRESET_OPERATORS[0],
                        shift_code: s.shift_code ?? "CA_SANG",
                        planned_date: s.planned_date
                          ? String(s.planned_date).slice(0, 10)
                          : new Date().toISOString().slice(0, 10),
                      };

                      return (
                        <div
                          key={s.id}
                          className={`p-3 rounded-xl border space-y-2.5 ${
                            s.is_qc
                              ? "border-amber-300 dark:border-amber-800 bg-amber-50/40 dark:bg-amber-950/20"
                              : "border-stone-200 dark:border-slate-800 bg-stone-50/60 dark:bg-slate-900/40"
                          }`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="text-xs font-bold text-stone-800 dark:text-slate-100 flex flex-wrap items-center gap-1.5">
                              <span>
                                Bước {s.seq}: {s.step_code} — {s.step_name}
                              </span>
                              <span className="font-normal text-stone-500">
                                ({STEP_CATEGORY_LABELS[s.category] ?? s.category})
                              </span>
                              {s.is_qc && (
                                <span
                                  title="Bước Kiểm soát Chất lượng Trung gian Xen kẽ (IPQC Gate): Các bước công đoạn phía sau sẽ bị khóa cho tới khi bước này được QA/QC xác nhận thông qua"
                                  className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-200/80 text-amber-950 dark:bg-amber-900/70 dark:text-amber-200"
                                >
                                  🛡️ BƯỚC QC XEN KẼ (IPQC GATE)
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              {s.deviation_code && (
                                <span className="px-2 py-0.5 text-[11px] rounded bg-red-100 text-red-800 font-mono">
                                  Sai lệch: {s.deviation_code}
                                </span>
                              )}
                              <StatusBadge status={s.status} />
                            </div>
                          </div>

                          {blockingPrevQc && s.status === "PENDING" && (
                            <div className="p-2 rounded-lg border border-rose-300 bg-rose-50/80 dark:bg-rose-950/30 dark:border-rose-800 text-xs text-rose-900 dark:text-rose-200 font-medium">
                              🔒 <b>Đang khóa tự động:</b> Bước này chưa thể bắt đầu vì bước QC xen kẽ phía trước (
                              <b>
                                Bước #{blockingPrevQc.seq}: {blockingPrevQc.step_name}
                              </b>
                              ) chưa được bộ phận QA/QC xác nhận thông qua.
                            </div>
                          )}

                          <div className="text-xs text-stone-600 dark:text-slate-300">{s.instructions}</div>

                          {/* Thanh Phân công Nhân viên & Ca trực cho bước công đoạn */}
                          <div className="p-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-wrap items-center justify-between gap-2 text-xs">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-semibold text-slate-700 dark:text-slate-300">
                                👨‍🔬 Nhân viên phụ trách &amp; Ca trực:
                              </span>
                              <input
                                list={`preset-operators-${s.id}`}
                                className={`${inputClass} !w-64 !py-1 text-xs`}
                                placeholder="Nhập hoặc chọn nhân viên thực hiện..."
                                value={opEdit.assigned_to_name}
                                onChange={(e) =>
                                  setOperatorEdits((prev) => ({
                                    ...prev,
                                    [s.id]: { ...opEdit, assigned_to_name: e.target.value },
                                  }))
                                }
                              />
                              <datalist id={`preset-operators-${s.id}`}>
                                {deptOperatorOptions.map((op) => (
                                  <option key={op} value={op} />
                                ))}
                              </datalist>
                              <select
                                className={`${inputClass} !w-44 !py-1 text-xs`}
                                value={opEdit.shift_code}
                                onChange={(e) =>
                                  setOperatorEdits((prev) => ({
                                    ...prev,
                                    [s.id]: { ...opEdit, shift_code: e.target.value },
                                  }))
                                }
                              >
                                {Object.entries(SHIFT_LABELS).map(([k, lbl]) => (
                                  <option key={k} value={k}>
                                    {lbl}
                                  </option>
                                ))}
                              </select>
                              <input
                                type="date"
                                className={`${inputClass} !w-36 !py-1 text-xs`}
                                value={opEdit.planned_date}
                                onChange={(e) =>
                                  setOperatorEdits((prev) => ({
                                    ...prev,
                                    [s.id]: { ...opEdit, planned_date: e.target.value },
                                  }))
                                }
                              />
                              <Button
                                variant="secondary"
                                title="Lưu phân công nhân viên và ca sản xuất cho bước công đoạn này để theo dõi trên Bảng kế hoạch PO hằng ngày"
                                onClick={() => handleAssignOperator(detail.order.id, s)}
                              >
                                💾 Lưu phân công
                              </Button>
                            </div>
                            <div className="flex flex-wrap gap-3 text-[11px] text-stone-500">
                              {s.sop_doc_code && <span title="Quy trình thao tác chuẩn (Standard Operating Procedure)">SOP: {s.sop_doc_code}</span>}
                              {s.asset_code && (
                                <span>
                                  Thiết bị: {s.asset_code} ({s.asset_name})
                                </span>
                              )}
                              {s.started_at && <span>Bắt đầu: {fmtDateTime(s.started_at)}</span>}
                              {s.completed_at && <span>Hoàn tất: {fmtDateTime(s.completed_at)}</span>}
                              {s.performed_by_name && <span>Người thực hiện: <b>{s.performed_by_name}</b></span>}
                              {s.checked_by_name && <span>Người kiểm tra chéo: <b>{s.checked_by_name}</b></span>}
                            </div>
                          </div>

                          {schema.length > 0 && (
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 pt-1">
                              {schema.map((f: any) => (
                                <Field
                                  key={f.key}
                                  label={`${f.label} (Chuẩn: ${f.min ?? "-"}..${f.max ?? "-"} ${f.unit ?? ""})`}
                                >
                                  <input
                                    className={inputClass}
                                    disabled={s.status === "DONE"}
                                    placeholder={`Nhập ${f.label}...`}
                                    value={String(curVals[f.key] ?? "")}
                                    onChange={(e) =>
                                      setStepParams((prev) => ({
                                        ...prev,
                                        [s.id]: { ...(prev[s.id] || {}), [f.key]: e.target.value },
                                      }))
                                    }
                                  />
                                </Field>
                              ))}
                            </div>
                          )}

                          {/* Hộp Chốt Chặn Kiểm Soát Chất Lượng Xen Kẽ (IPQC Gate) */}
                          {s.is_qc && (
                            <div
                              className={`p-3 rounded-xl border-2 space-y-2 text-xs ${
                                s.qc_gate_status === "PASSED"
                                  ? "border-emerald-400 bg-emerald-50/70 dark:bg-emerald-950/30 dark:border-emerald-800"
                                  : s.qc_gate_status === "REJECTED"
                                    ? "border-rose-400 bg-rose-50/70 dark:bg-rose-950/30 dark:border-rose-800"
                                    : "border-amber-400 bg-amber-50/80 dark:bg-amber-950/30 dark:border-amber-700"
                              }`}
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="font-extrabold flex items-center gap-2">
                                  <span>🛡️ CỔNG KIỂM SOÁT CHẤT LƯỢNG XEN KẼ (IPQC GATE — CẦN QC XÁC NHẬN THÔNG QUA ĐỂ TIẾP TỤC):</span>
                                  {s.qc_gate_status === "PASSED" ? (
                                    <span className="px-2 py-0.5 rounded-full bg-emerald-600 text-white text-[11px]">
                                      ✅ ĐÃ ĐƯỢC QC XÁC NHẬN THÔNG QUA (ĐÃ MỞ KHÓA BƯỚC TIẾP THEO)
                                    </span>
                                  ) : s.qc_gate_status === "REJECTED" ? (
                                    <span className="px-2 py-0.5 rounded-full bg-rose-600 text-white text-[11px]">
                                      ❌ QC TỪ CHỐI THÔNG QUA — YÊU CẦU PHA CHỈNH LẠI
                                    </span>
                                  ) : (
                                    <span className="px-2 py-0.5 rounded-full bg-amber-600 text-white text-[11px]">
                                      ⏳ ĐANG CHỜ QC XÁC NHẬN THÔNG QUA
                                    </span>
                                  )}
                                </div>
                                {s.qc_verified_by_name ? (
                                  <div className="text-[11px] font-medium text-slate-700 dark:text-slate-300">
                                    Người xác nhận QC: <b>{s.qc_verified_by_name}</b> ({fmtDateTime(s.qc_verified_at)})
                                  </div>
                                ) : (
                                  <div className="text-[11px] font-medium text-slate-700 dark:text-slate-300">
                                    QA phụ trách giám sát:{" "}
                                    <b>{s.qa_assignee_name ?? detail.order.qa_assignee_name ?? "Chưa phân công (Phòng QA/QC phân bổ)"}</b>
                                  </div>
                                )}
                              </div>

                              <div className="grid grid-cols-1 md:grid-cols-12 gap-2 items-end">
                                <div className="md:col-span-5">
                                  <Field label="Nhận xét / Kết luận kiểm tra của QC hoặc Tổ Sản xuất">
                                    <input
                                      className={inputClass}
                                      placeholder="VD: Độ pH đạt 8.32, tín hiệu khuếch đại chuẩn đạt yêu cầu, cho phép chia lẻ..."
                                      value={qcGateNotes[s.id] ?? s.qc_gate_note ?? ""}
                                      onChange={(e) =>
                                        setQcGateNotes((prev) => ({ ...prev, [s.id]: e.target.value }))
                                      }
                                    />
                                  </Field>
                                </div>
                                <div className="md:col-span-7 flex flex-wrap gap-1.5">
                                  {s.qc_gate_status !== "PASSED" && (
                                    <Button
                                      variant="secondary"
                                      title="Tổ Sản xuất gửi mẫu bán thành phẩm và thông báo đẩy sang Phòng Đảm bảo & Kiểm soát Chất lượng (QA/QC) để yêu cầu xác nhận thông qua bước này"
                                      onClick={() => handleVerifyQcGate(detail.order.id, s, "REQUEST_QC", curVals)}
                                    >
                                      📤 Gửi mẫu yêu cầu QC xác nhận thông qua
                                    </Button>
                                  )}
                                  <Button
                                    title="Chuyên viên QA/QC xác nhận bán thành phẩm ĐẠT chất lượng trung gian (IPQC), tự động hoàn tất bước này và mở khóa cho phép chạy bước công đoạn kế tiếp"
                                    onClick={() => handleVerifyQcGate(detail.order.id, s, "PASS", curVals)}
                                  >
                                    🛡️ QC Xác nhận Thông qua (Cho phép chạy bước kế tiếp)
                                  </Button>
                                  <Button
                                    variant="danger"
                                    title="Chuyên viên QA/QC từ chối thông qua do thông số chưa đạt chuẩn, giữ khóa bước tiếp theo và yêu cầu Tổ Sản xuất pha chỉnh lại"
                                    onClick={() => handleVerifyQcGate(detail.order.id, s, "REJECT", curVals)}
                                  >
                                    ❌ QC Từ chối Thông qua (Yêu cầu chỉnh lại)
                                  </Button>
                                </div>
                              </div>
                            </div>
                          )}

                          <ActionBar
                            endpoint={`/api/factory/kit/steps/${s.id}/actions`}
                            version={s.version}
                            actions={s.allowed_actions}
                            labels={ACTION_LABELS}
                            extraPayload={{ param_values: curVals }}
                            onDone={() => {
                              loadDetail(detail.order.id);
                              loadOrders();
                            }}
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>

              <Card
                title={`3. Làm lại một phần / Thay thế Hộp thành phần (${detail.reworks.length})`}
                actions={
                  <Button variant="ghost" onClick={() => setShowReworkForm((v) => !v)}>
                    {showReworkForm ? "Đóng form Rework" : "+ Lập lệnh làm lại (Rework)"}
                  </Button>
                }
              >
                {detail.reworks.length === 0 && !showReworkForm && (
                  <Empty>Chưa có lệnh làm lại (Rework) nào cho lô sản xuất này.</Empty>
                )}
                {detail.reworks.length > 0 && (
                  <Table head={["Mã RW", "Phạm vi", "Vật tư cấp bù", "Lô xuất bù", "Trạng thái", "Thao tác"]}>
                    {detail.reworks.map((rw: any) => (
                      <tr key={rw.id}>
                        <td className="px-3 py-2 font-mono text-xs font-semibold">{rw.code}</td>
                        <td className="px-3 py-2 text-xs">
                          {rw.scope === "PARTIAL" ? `Hộp ${rw.box_no}` : "Toàn bộ"} — {rw.instructions}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {rw.component_code ? `${rw.component_code} (${fmtQty(rw.qty_to_rework)} ${rw.uom})` : "-"}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs">{rw.used_lot_code ?? "-"}</td>
                        <td className="px-3 py-2">
                          <StatusBadge status={rw.status} />
                        </td>
                        <td className="px-3 py-2">
                          <ActionBar
                            endpoint={`/api/factory/kit/reworks/${rw.id}/actions`}
                            version={rw.version}
                            actions={rw.allowed_actions || []}
                            labels={ACTION_LABELS}
                            onDone={() => {
                              loadDetail(detail.order.id);
                              loadOrders();
                            }}
                          />
                        </td>
                      </tr>
                    ))}
                  </Table>
                )}

                {showReworkForm && (
                  <form onSubmit={handleCreateRework} className="mt-3 pt-3 border-t border-stone-200 space-y-2">
                    <div className="text-xs font-semibold text-stone-700">
                      Tạo lệnh làm lại (Rework) — Hỗ trợ thay thế riêng một Hộp thành phần trong Bộ Kit nhiều hộp
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                      <Field label="Phạm vi & Hộp số">
                        <div className="flex gap-1">
                          <select
                            className={inputClass}
                            value={rwForm.scope}
                            onChange={(e) => setRwForm({ ...rwForm, scope: e.target.value })}
                          >
                            <option value="PARTIAL">Một phần (Theo Hộp)</option>
                            <option value="FULL">Toàn bộ Bộ Kit</option>
                          </select>
                          {rwForm.scope === "PARTIAL" && (
                            <input
                              type="number"
                              className={`${inputClass} w-16`}
                              value={rwForm.box_no}
                              onChange={(e) => setRwForm({ ...rwForm, box_no: e.target.value })}
                            />
                          )}
                        </div>
                      </Field>
                      <Field label="Vật tư / Bán TP xuất bù (FEFO)">
                        <select
                          className={inputClass}
                          value={rwForm.component_item_id}
                          onChange={(e) => {
                            const it = options.items.find((x) => x.id === e.target.value);
                            setRwForm({ ...rwForm, component_item_id: e.target.value, uom: it?.base_uom ?? "" });
                          }}
                        >
                          <option value="">-- Chọn thành phần thay thế --</option>
                          {options.items.map((i) => (
                            <option key={i.id} value={i.id}>
                              {i.code} — {i.name} ({i.base_uom})
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Số lượng bù & ĐVT">
                        <div className="flex gap-1">
                          <input
                            type="number"
                            step="any"
                            className={inputClass}
                            value={rwForm.qty_to_rework}
                            onChange={(e) => setRwForm({ ...rwForm, qty_to_rework: e.target.value })}
                            required
                          />
                          <input
                            className={`${inputClass} w-20`}
                            value={rwForm.uom}
                            onChange={(e) => setRwForm({ ...rwForm, uom: e.target.value })}
                            placeholder="ĐVT"
                          />
                        </div>
                      </Field>
                      <Field label="Hướng dẫn xử lý">
                        <input
                          className={inputClass}
                          value={rwForm.instructions}
                          onChange={(e) => setRwForm({ ...rwForm, instructions: e.target.value })}
                          required
                        />
                      </Field>
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button type="button" variant="ghost" onClick={() => setShowReworkForm(false)}>
                        Hủy
                      </Button>
                      <Button type="submit">
                        Lập lệnh làm lại (Rework)
                      </Button>
                    </div>
                  </form>
                )}
              </Card>
          </div>
        )}
      </div>
      )}
    </div>
  );
}

function DailyOperatorTrackerSection({
  dailySteps,
  operatorOptions,
  dailyShiftFilter,
  setDailyShiftFilter,
  dailyStatusFilter,
  setDailyStatusFilter,
  dailySearch,
  setDailySearch,
  operatorEdits,
  setOperatorEdits,
  qcGateNotes,
  setQcGateNotes,
  onAssignOperator,
  onVerifyQcGate,
  onOpenOrderEbr,
}: {
  dailySteps: any[];
  operatorOptions: string[];
  dailyShiftFilter: string;
  setDailyShiftFilter: (v: string) => void;
  dailyStatusFilter: string;
  setDailyStatusFilter: (v: string) => void;
  dailySearch: string;
  setDailySearch: (v: string) => void;
  operatorEdits: Record<string, { assigned_to_name: string; shift_code: string; planned_date: string }>;
  setOperatorEdits: React.Dispatch<
    React.SetStateAction<Record<string, { assigned_to_name: string; shift_code: string; planned_date: string }>>
  >;
  qcGateNotes: Record<string, string>;
  setQcGateNotes: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  onAssignOperator: (orderId: string, step: any) => void;
  onVerifyQcGate: (orderId: string, step: any, decision: "REQUEST_QC" | "PASS" | "REJECT") => void;
  onOpenOrderEbr: (orderId: string) => void;
}) {
  const totalSteps = dailySteps.length;
  const doneSteps = dailySteps.filter((s) => s.status === "DONE" || s.status === "SKIPPED").length;
  const inProgressSteps = dailySteps.filter((s) => s.status === "IN_PROGRESS" || s.status === "AWAITING_CHECK").length;
  const waitingQcSteps = dailySteps.filter((s) => s.is_qc && s.qc_gate_status !== "PASSED").length;

  // Tổng hợp năng suất theo từng nhân viên
  const operatorStatsMap = new Map<
    string,
    { name: string; shift: string; total: number; inProgress: number; waitingQc: number; done: number }
  >();
  for (const s of dailySteps) {
    const name = s.assigned_to_name || "Chưa phân công";
    const cur = operatorStatsMap.get(name) ?? {
      name,
      shift: SHIFT_LABELS[s.shift_code] ?? "Ca sáng",
      total: 0,
      inProgress: 0,
      waitingQc: 0,
      done: 0,
    };
    cur.total += 1;
    if (s.status === "DONE" || s.status === "SKIPPED") cur.done += 1;
    else if (s.status === "IN_PROGRESS" || s.status === "AWAITING_CHECK") cur.inProgress += 1;
    if (s.is_qc && s.qc_gate_status !== "PASSED") cur.waitingQc += 1;
    operatorStatsMap.set(name, cur);
  }
  const operatorStats = Array.from(operatorStatsMap.values());

  const filteredSteps = dailySteps.filter((s) => {
    if (dailyShiftFilter !== "ALL" && (s.shift_code || "CA_SANG") !== dailyShiftFilter) return false;
    if (dailyStatusFilter === "WAITING_QC" && !(s.is_qc && s.qc_gate_status !== "PASSED")) return false;
    if (dailyStatusFilter === "IN_PROGRESS" && !["IN_PROGRESS", "AWAITING_CHECK"].includes(s.status)) return false;
    if (dailyStatusFilter === "DONE" && !["DONE", "SKIPPED"].includes(s.status)) return false;
    if (dailySearch.trim()) {
      const q = dailySearch.toLowerCase();
      const hay = `${s.order_code} ${s.product_code} ${s.lot_code ?? ""} ${s.kd_po_code ?? ""} ${s.internal_order_code ?? ""} ${s.assigned_to_name ?? ""} ${s.step_name}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  return (
    <div className="space-y-4">
      {/* KPI Ca sản xuất & Chốt chặn QC trong ngày */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <div className="text-[11px] text-slate-500">Tổng công đoạn theo PO trong ngày</div>
          <div className="text-lg font-extrabold text-slate-900 dark:text-white">{totalSteps} bước</div>
        </div>
        <div className="p-3 rounded-xl border border-sky-200 dark:border-sky-900 bg-sky-50/60 dark:bg-sky-950/30">
          <div className="text-[11px] text-sky-700 dark:text-sky-300">Đang thực hiện / Chờ kiểm tra chéo</div>
          <div className="text-lg font-extrabold text-sky-900 dark:text-sky-200">{inProgressSteps} bước</div>
        </div>
        <div className="p-3 rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50/70 dark:bg-amber-950/30">
          <div className="text-[11px] text-amber-800 dark:text-amber-300">🛡️ Bước QC xen kẽ chờ QC xác nhận thông qua</div>
          <div className="text-lg font-extrabold text-amber-900 dark:text-amber-200">{waitingQcSteps} cổng IPQC</div>
        </div>
        <div className="p-3 rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50/60 dark:bg-emerald-950/30">
          <div className="text-[11px] text-emerald-700 dark:text-emerald-300">Đã hoàn tất trong ca</div>
          <div className="text-lg font-extrabold text-emerald-900 dark:text-emerald-200">
            {doneSteps}/{totalSteps} ({totalSteps ? Math.round((doneSteps / totalSteps) * 100) : 0}%)
          </div>
        </div>
      </div>

      {/* Bảng 1: Tổng hợp khối lượng công việc & tiến độ theo từng Nhân viên */}
      <Card title={`1. Bảng Tổng Hợp Phân Công & Năng Suất Nhân Viên Theo Ca (${operatorStats.length} nhân sự)`}>
        {operatorStats.length === 0 ? (
          <Empty>Chưa có công đoạn nào được khởi tạo. Hãy xác nhận Lệnh sản xuất để hệ thống phân bổ công đoạn cho nhân viên.</Empty>
        ) : (
          <Table head={["Nhân viên phụ trách / Tổ chuyên môn", "Ca làm việc chính", "Tổng bước được giao", "Đang thực hiện", "Chờ QC thông qua", "Đã hoàn tất", "Tỷ lệ hoàn thành"]}>
            {operatorStats.map((op) => {
              const pct = op.total ? Math.round((op.done / op.total) * 100) : 0;
              return (
                <tr
                  key={op.name}
                  className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50"
                  onClick={() => setDailySearch(op.name)}
                >
                  <td className="px-3 py-2 text-xs font-bold text-sky-800 dark:text-sky-300">👨‍🔬 {op.name}</td>
                  <td className="px-3 py-2 text-xs">{op.shift}</td>
                  <td className="px-3 py-2 text-xs font-mono font-semibold">{op.total} bước</td>
                  <td className="px-3 py-2 text-xs font-mono text-sky-700 font-bold">{op.inProgress}</td>
                  <td className="px-3 py-2 text-xs font-mono text-amber-700 font-bold">{op.waitingQc}</td>
                  <td className="px-3 py-2 text-xs font-mono text-emerald-700 font-bold">{op.done}</td>
                  <td className="px-3 py-2 text-xs">
                    <div className="flex items-center gap-2">
                      <div className="w-24 h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                        <div className="h-full bg-emerald-600" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="font-mono font-semibold">{pct}%</span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>

      {/* Bảng 2: Bảng Điều độ & Giám sát chi tiết từng bước công đoạn theo PO hằng ngày */}
      <Card
        title={`2. Bảng Giám Sát Nhân Viên Triển Khai Kế Hoạch Sản Xuất Theo PO Hằng Ngày (${filteredSteps.length} bước)`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <select
              className={`${inputClass} !w-44 !py-1 text-xs`}
              value={dailyShiftFilter}
              onChange={(e) => setDailyShiftFilter(e.target.value)}
            >
              <option value="ALL">Tất cả ca làm việc</option>
              <option value="CA_SANG">🌅 Ca sáng (07:30–16:30)</option>
              <option value="CA_CHIEU">🌇 Ca chiều (13:30–21:30)</option>
              <option value="CA_TOI">🌙 Ca tối / Tăng ca</option>
            </select>
            <select
              className={`${inputClass} !w-52 !py-1 text-xs`}
              value={dailyStatusFilter}
              onChange={(e) => setDailyStatusFilter(e.target.value)}
            >
              <option value="ALL">Tất cả trạng thái công đoạn</option>
              <option value="WAITING_QC">🛡️ Đang chờ QC xác nhận thông qua</option>
              <option value="IN_PROGRESS">⚡ Đang thực hiện / Chờ kiểm tra</option>
              <option value="DONE">✅ Đã hoàn tất</option>
            </select>
            <input
              className={`${inputClass} !w-56 !py-1 text-xs`}
              placeholder="Tìm PO, Mã lệnh, Lô, Nhân viên..."
              value={dailySearch}
              onChange={(e) => setDailySearch(e.target.value)}
            />
            {dailySearch && (
              <Button variant="ghost" onClick={() => setDailySearch("")}>
                Xóa lọc
              </Button>
            )}
          </div>
        }
      >
        {filteredSteps.length === 0 ? (
          <Empty>Không có công đoạn nào khớp với bộ lọc hiện tại.</Empty>
        ) : (
          <Table
            head={[
              "Đơn PO / Lệnh SX & Lô",
              "Bước công đoạn EBR",
              "Nhân viên phụ trách & Ca trực",
              "Giờ thực hiện & Thông số đo",
              "Trạng thái & Cổng QC Xen Kẽ (IPQC)",
              "Thao tác điều độ & Xác nhận QC",
            ]}
          >
            {filteredSteps.map((s) => {
              const opEdit = operatorEdits[s.id] ?? {
                assigned_to_name: s.assigned_to_name ?? PRESET_OPERATORS[0],
                shift_code: s.shift_code ?? "CA_SANG",
                planned_date: s.planned_date ? String(s.planned_date).slice(0, 10) : new Date().toISOString().slice(0, 10),
              };
              const paramEntries = Object.entries(s.param_values || {});
              return (
                <tr key={s.id} className={s.is_qc && s.qc_gate_status !== "PASSED" ? "bg-amber-50/40 dark:bg-amber-950/20" : ""}>
                  <td className="px-3 py-2 text-xs">
                    <div className="font-mono font-bold text-sky-700 dark:text-sky-400">
                      {s.order_code} · {s.product_code}
                    </div>
                    <div className="text-[11px] text-slate-600 dark:text-slate-300">
                      Lô: <b className="font-mono">{s.lot_code ?? "Chưa cấp"}</b> ({fmtQty(s.planned_qty)} {s.uom})
                    </div>
                    {s.kd_po_code && (
                      <div className="text-[11px] font-semibold text-indigo-700 dark:text-indigo-300">
                        📦 PO: {s.kd_po_code} ({s.internal_order_code})
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    <div className="font-bold text-slate-800 dark:text-slate-100">
                      Bước #{s.seq}: {s.step_name}
                    </div>
                    <div className="text-[11px] text-slate-500 font-mono">
                      {s.step_code} · {STEP_CATEGORY_LABELS[s.category] ?? s.category}
                    </div>
                    {s.asset_code && (
                      <div className="text-[11px] text-slate-500">
                        🔧 Máy: {s.asset_code} ({s.asset_name})
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs space-y-1">
                    <input
                      list={`daily-op-${s.id}`}
                      className={`${inputClass} !py-1 text-xs`}
                      value={opEdit.assigned_to_name}
                      onChange={(e) =>
                        setOperatorEdits((prev) => ({
                          ...prev,
                          [s.id]: { ...opEdit, assigned_to_name: e.target.value },
                        }))
                      }
                    />
                    <datalist id={`daily-op-${s.id}`}>
                      {operatorOptions.map((op) => (
                        <option key={op} value={op} />
                      ))}
                    </datalist>
                    <div className="flex items-center gap-1">
                      <select
                        className={`${inputClass} !py-1 text-[11px]`}
                        value={opEdit.shift_code}
                        onChange={(e) =>
                          setOperatorEdits((prev) => ({
                            ...prev,
                            [s.id]: { ...opEdit, shift_code: e.target.value },
                          }))
                        }
                      >
                        {Object.entries(SHIFT_LABELS).map(([k, lbl]) => (
                          <option key={k} value={k}>
                            {lbl}
                          </option>
                        ))}
                      </select>
                      <Button
                        variant="ghost"
                        title="Cập nhật nhân viên phụ trách và ca làm việc cho bước công đoạn này"
                        onClick={() => onAssignOperator(s.order_id, s)}
                      >
                        Lưu
                      </Button>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs space-y-0.5">
                    <div>
                      Bắt đầu: <b>{s.started_at ? fmtDateTime(s.started_at) : "Chưa bắt đầu"}</b>
                    </div>
                    <div>
                      Hoàn tất: <b>{s.completed_at ? fmtDateTime(s.completed_at) : "-"}</b>
                    </div>
                    {s.performed_by_name && <div className="text-[11px] text-slate-500">Thực hiện: {s.performed_by_name}</div>}
                    {s.checked_by_name && <div className="text-[11px] text-slate-500">Kiểm tra: {s.checked_by_name}</div>}
                    {paramEntries.length > 0 && (
                      <div className="pt-1 flex flex-wrap gap-1">
                        {paramEntries.map(([k, v]) => (
                          <span key={k} className="px-1.5 py-0.5 rounded bg-sky-100 text-sky-900 font-mono text-[10px]">
                            {k}: {String(v)}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs space-y-1">
                    <div>
                      <StatusBadge status={s.status} />
                    </div>
                    {s.is_qc && (
                      <div className="pt-0.5">
                        {s.qc_gate_status === "PASSED" ? (
                          <span
                            title="Bước QC xen kẽ đã được QA/QC xác nhận thông qua — Dây chuyền được phép chạy bước tiếp theo"
                            className="inline-block px-2 py-0.5 rounded bg-emerald-100 text-emerald-900 font-bold text-[10px]"
                          >
                            🛡️ QC Đã thông qua ({s.qc_verified_by_name ?? "QA/QC"})
                          </span>
                        ) : s.qc_gate_status === "REJECTED" ? (
                          <span
                            title="Bước QC xen kẽ bị từ chối — Khóa bước tiếp theo, yêu cầu pha chỉnh lại"
                            className="inline-block px-2 py-0.5 rounded bg-rose-100 text-rose-900 font-bold text-[10px]"
                          >
                            ❌ QC Từ chối thông qua
                          </span>
                        ) : (
                          <span
                            title="Bước QC xen kẽ đang chờ QA/QC xác nhận thông qua để mở khóa bước tiếp theo"
                            className="inline-block px-2 py-0.5 rounded bg-amber-200 text-amber-950 font-bold text-[10px]"
                          >
                            ⏳ Chờ QC xác nhận thông qua (IPQC)
                          </span>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    <div className="flex flex-col gap-1.5">
                      {s.is_qc && s.qc_gate_status !== "PASSED" && (
                        <>
                          <input
                            className={`${inputClass} !py-1 text-[11px]`}
                            placeholder="Ghi chú xác nhận QC (VD: pH=8.32 đạt)..."
                            value={qcGateNotes[s.id] ?? s.qc_gate_note ?? ""}
                            onChange={(e) => setQcGateNotes((prev) => ({ ...prev, [s.id]: e.target.value }))}
                          />
                          <div className="flex flex-wrap gap-1">
                            <Button
                              variant="secondary"
                              title="Gửi yêu cầu và thông báo đẩy sang Phòng QA/QC để xác nhận thông qua bước kiểm soát trung gian này"
                              onClick={() => onVerifyQcGate(s.order_id, s, "REQUEST_QC")}
                            >
                              📤 Gửi chờ QC
                            </Button>
                            <Button
                              title="QA/QC xác nhận thông qua bước QC xen kẽ này (Đạt IPQC) và mở khóa cho phép chạy bước công đoạn tiếp theo"
                              onClick={() => onVerifyQcGate(s.order_id, s, "PASS")}
                            >
                              🛡️ QC Xác nhận Thông qua
                            </Button>
                            <Button
                              variant="danger"
                              title="QA/QC từ chối thông qua bước này và giữ khóa bước kế tiếp"
                              onClick={() => onVerifyQcGate(s.order_id, s, "REJECT")}
                            >
                              ❌ Từ chối
                            </Button>
                          </div>
                        </>
                      )}
                      <Button
                        variant="ghost"
                        title="Mở chi tiết Hồ sơ lô điện tử (EBR) của Lệnh sản xuất này để nhập thông số và ký điện tử"
                        onClick={() => onOpenOrderEbr(s.order_id)}
                      >
                        🔎 Mở Hồ sơ Lô (EBR)
                      </Button>
                    </div>
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

function ConsumptionRow({
  row,
  locked,
  onSave,
}: {
  row: any;
  locked: boolean;
  onSave: (row: any, actual: string, reason: string) => void;
}) {
  const [actual, setActual] = useState(String(row.actual_qty ?? row.planned_qty));
  const [reason, setReason] = useState(row.variance_reason ?? "");
  useEffect(() => {
    setActual(String(row.actual_qty ?? row.planned_qty));
    setReason(row.variance_reason ?? "");
  }, [row.actual_qty, row.planned_qty, row.variance_reason]);

  const variance = Number(row.variance_pct || 0);
  return (
    <tr>
      <td className="px-3 py-2 text-xs">
        <div className="font-medium">Hộp {row.box_no}</div>
        <div className="text-stone-500">{ROLE_LABELS[row.component_role] ?? row.component_role}</div>
      </td>
      <td className="px-3 py-2 text-xs">
        <span className="font-mono font-semibold">{row.item_code}</span> — {row.item_name}
      </td>
      <td className="px-3 py-2 text-xs font-mono">
        {row.lot_code} (HSD: {fmtDate(row.expiry_date)})
      </td>
      <td className="px-3 py-2 text-xs">
        {fmtQty(row.planned_qty)} {row.uom}
      </td>
      <td className="px-3 py-2 text-xs">
        {fmtQty(row.issued_qty)} {row.uom}
      </td>
      <td className="px-3 py-2 text-xs">
        <div className="flex items-center gap-1">
          <input
            type="number"
            step="any"
            disabled={locked}
            className={`${inputClass} w-24`}
            value={actual}
            onChange={(e) => setActual(e.target.value)}
          />
          <input
            disabled={locked}
            className={`${inputClass} w-36`}
            placeholder="Lý do chênh lệch"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          {!locked && (
            <Button variant="ghost" onClick={() => onSave(row, actual, reason)}>
              Lưu ({variance > 0 ? `+${variance}%` : `${variance}%`})
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}
