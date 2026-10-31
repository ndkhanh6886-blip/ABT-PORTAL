import { factoryRoute } from "@/factory/http";
import {
  allocateOrderSerials,
  getDeviceOrderDetail,
  updateDeviceUnitSerial,
  type DeviceOrderRow,
} from "@/factory/device/assembly";
import { issueWorkOrderBomKitting, progressWorkOrderStage } from "@/factory/device/workflow";
import { authorize } from "@/factory/core/authz";
import { notFound } from "@/factory/core/errors";

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
    await allocateOrderSerials(tx, actor, order, {
      serial_prefix: b.serial_prefix ? String(b.serial_prefix) : null,
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
      handover_accessories: Array.isArray(b.handover_accessories) ? (b.handover_accessories as string[]) : undefined,
    });
  }
  return getDeviceOrderDetail(tx, actor, params.id);
});
