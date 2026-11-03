import { factoryRoute, idempotent } from "@/factory/http";
import {
  advanceDeviceRdGate,
  convertPoToWorkOrder,
  createDevicePoOrder,
  createDeviceRdProject,
  createSubcontractFromPo,
  issueWorkOrderBomKitting,
  listDevicePoOrdersWithMrp,
  listDeviceRdProjects,
  progressWorkOrderStage,
  proposePrFromPoShortage,
  transferDeviceRdToProduction,
} from "@/factory/device/workflow";
import { saveSpecEvaluation } from "@/factory/rd/projects";
import { addModelBomLine } from "@/factory/device/models";

export const GET = factoryRoute(async (tx, { actor, url }) => {
  const section = url.searchParams.get("section") || "all";
  if (section === "rd") {
    return { rd_projects: await listDeviceRdProjects(tx, actor) };
  }
  if (section === "po") {
    return { po_orders: await listDevicePoOrdersWithMrp(tx, actor) };
  }
  const [rd_projects, po_orders] = await Promise.all([
    listDeviceRdProjects(tx, actor),
    listDevicePoOrdersWithMrp(tx, actor),
  ]);
  return { rd_projects, po_orders };
});

export const POST = factoryRoute((tx, ctx) =>
  idempotent(tx, ctx, "POST /api/factory/device/workflow", async () => {
    const b = (ctx.body ?? {}) as Record<string, any>;
    const action = String(b.action ?? "");

    if (action === "create_rd_project") {
      return createDeviceRdProject(tx, ctx.actor, b);
    }
    if (action === "advance_rd_gate") {
      return advanceDeviceRdGate(tx, ctx.actor, String(b.project_id), {
        gate_no: b.gate_no ? Number(b.gate_no) : undefined,
        decision_note: b.decision_note ? String(b.decision_note) : undefined,
      });
    }
    if (action === "transfer_rd_to_production") {
      return transferDeviceRdToProduction(tx, ctx.actor, String(b.project_id), {
        pilot_serial_ref: b.pilot_serial_ref ? String(b.pilot_serial_ref) : undefined,
        transfer_note: b.transfer_note ? String(b.transfer_note) : undefined,
      });
    }
    if (action === "save_rd_spec") {
      return saveSpecEvaluation(tx, ctx.actor, String(b.project_id), b.spec_id ? String(b.spec_id) : null, b);
    }
    if (action === "add_rd_bom_line") {
      return addModelBomLine(tx, ctx.actor, b);
    }
    if (action === "create_po_order") {
      return createDevicePoOrder(tx, ctx.actor, b);
    }
    if (action === "convert_po_to_wo") {
      return convertPoToWorkOrder(tx, ctx.actor, {
        internal_order_id: String(b.internal_order_id),
        internal_order_line_id: b.internal_order_line_id ? String(b.internal_order_line_id) : undefined,
        lot_no: b.lot_no ?? null,
        serial_numbers: b.serial_numbers ?? null,
        priority: b.priority ?? "HIGH",
      });
    }
    if (action === "propose_pr_from_po") {
      return proposePrFromPoShortage(tx, ctx.actor, {
        internal_order_id: String(b.internal_order_id),
        include_subcontract_shortage: Boolean(b.include_subcontract_shortage),
      });
    }
    if (action === "create_subcontract_from_po") {
      return createSubcontractFromPo(tx, ctx.actor, {
        internal_order_id: String(b.internal_order_id),
        vendor_id: b.vendor_id ? String(b.vendor_id) : null,
        only_shortage: Boolean(b.only_shortage),
      });
    }
    if (action === "kitting_issue") {
      return issueWorkOrderBomKitting(tx, ctx.actor, String(b.order_id), {
        auto_advance_to_burn_in: Boolean(b.auto_advance_to_burn_in),
      });
    }
    if (action === "progress_wo_stage") {
      return progressWorkOrderStage(tx, ctx.actor, String(b.order_id), {
        stage_action: b.stage_action,
        customer_name: b.customer_name,
        handover_accessories: Array.isArray(b.handover_accessories) ? b.handover_accessories : undefined,
      });
    }

    throw new Error(`Thao tác không hợp lệ: ${action}`);
  })
);
