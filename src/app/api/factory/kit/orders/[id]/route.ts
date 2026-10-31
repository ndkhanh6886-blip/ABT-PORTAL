import { factoryRoute } from "@/factory/http";
import { invalid } from "@/factory/core/errors";
import {
  assignStepOperator,
  getProductionOrderDetail,
  issueOrderMaterials,
  printOrderLabel,
  splitKitLot,
  updateMaterialActuals,
  updateOrderDates,
  updateOrderPlan,
  verifyLineClearance,
  verifyStepQcGate,
} from "@/factory/kit/ordersEbr";

export const GET = factoryRoute(async (tx, { actor, params }) => {
  return getProductionOrderDetail(tx, actor, params.id);
});

export const POST = factoryRoute(async (tx, { actor, params, body }) => {
  const b = body as Record<string, unknown>;
  if (b.operation === "issue_materials") {
    const document = await issueOrderMaterials(tx, actor, params.id);
    return { document };
  }
  if (b.operation === "line_clearance") {
    const order = await verifyLineClearance(tx, actor, params.id, b);
    return { order };
  }
  if (b.operation === "print_label") {
    const order = await printOrderLabel(tx, actor, params.id);
    return { order };
  }
  if (b.operation === "split_lot") {
    return splitKitLot(tx, actor, params.id, b);
  }
  if (b.operation === "assign_operator") {
    const step = await assignStepOperator(tx, actor, params.id, b as any);
    return { step };
  }
  if (b.operation === "verify_qc_gate") {
    const step = await verifyStepQcGate(tx, actor, params.id, b as any);
    return { step };
  }
  if (b.operation === "update_plan") {
    const { operation: _op, ...fields } = b;
    void _op;
    const order = await updateOrderPlan(tx, actor, params.id, fields);
    return { order };
  }
  if (b.operation === "update_dates" || b.operation === "update_lot") {
    await updateOrderDates(tx, actor, params.id, {
      mfg_date: b.mfg_date ? String(b.mfg_date) : null,
      lot_code: b.lot_code != null ? String(b.lot_code) : null,
      regenerate_lot_code: Boolean(b.regenerate_lot_code),
    });
    return getProductionOrderDetail(tx, actor, params.id);
  }
  if (b.operation === "reconcile_material") {
    const consumption = await updateMaterialActuals(tx, actor, params.id, b);
    return { consumption };
  }
  throw invalid(`Thao tác lệnh sản xuất không hợp lệ: ${String(b.operation ?? "")}`);
});
