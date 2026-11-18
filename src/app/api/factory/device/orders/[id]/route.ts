import { factoryRoute } from "@/factory/http";
import {
  allocateOrderSerials,
  checkOrderBomShortages,
  getDeviceOrderDetail,
  updateDeviceUnitSerial,
  type DeviceOrderRow,
} from "@/factory/device/assembly";
import { issueWorkOrderBomKitting, progressWorkOrderStage } from "@/factory/device/workflow";
import { authorize } from "@/factory/core/authz";
import { invalid, notFound } from "@/factory/core/errors";

export const GET = factoryRoute((tx, { actor, params }) => getDeviceOrderDetail(tx, actor, params.id));

export const POST = factoryRoute(async (tx, { actor, params, body }) => {
  const b = (body ?? {}) as Record<string, unknown>;
  if (b.operation === "update_unit_serial") {
    await updateDeviceUnitSerial(tx, actor, params.id, {
      unit_id: String(b.unit_id ?? ""),
      serial_no: String(b.serial_no ?? ""),
    });
    return getDeviceOrderDetail(tx, actor, params.id);
  }
  if (b.operation === "assign_serials_now") {
    const order = (await tx.query("SELECT * FROM device.device_order WHERE id = $1 FOR UPDATE", [params.id])).rows[0] as
      | DeviceOrderRow
      | undefined;
    if (!order) throw notFound("lệnh lắp ráp thiết bị");
    await authorize(tx, actor, "device.order.manage", order.org_unit_id);
    const { shortages } = await checkOrderBomShortages(tx, {
      revisionId: order.model_revision_id,
      warehouseId: order.warehouse_id,
      qty: order.qty,
      orderId: order.id,
    });
    if (shortages.length > 0) {
      const shortList = shortages
        .slice(0, 6)
        .map((s) => `${s.item_code} (thiếu ${s.shortage} ${s.uom})`)
        .join("; ");
      throw invalid(
        `Chưa đủ linh kiện theo định mức BOM (${shortages.length} mã thiếu: ${shortList}). Vui lòng nhập kho linh kiện trước khi cấp Serial & bắt đầu lắp ráp.`,
        { shortages },
        "BOM_SHORTAGE"
      );
    }
    await allocateOrderSerials(tx, actor, order, {
      serial_numbers: (b.serial_numbers as string[] | string | null | undefined) ?? null,
    });
    return getDeviceOrderDetail(tx, actor, params.id);
  }
  if (b.operation === "kitting_issue") {
    return issueWorkOrderBomKitting(tx, actor, params.id, {
      auto_advance_to_burn_in: Boolean(b.auto_advance_to_burn_in),
    });
  }
  if (b.operation === "progress_stage") {
    return progressWorkOrderStage(tx, actor, params.id, {
      stage_action: b.stage_action as any,
      customer_name: b.customer_name ? String(b.customer_name) : undefined,
      fqc_assignee_id: b.fqc_assignee_id ? Number(b.fqc_assignee_id) : null,
      handover_accessories: Array.isArray(b.handover_accessories) ? (b.handover_accessories as string[]) : undefined,
    });
  }
  return getDeviceOrderDetail(tx, actor, params.id);
});
