import { NextRequest, NextResponse } from "next/server";
import { httpErrorStatus } from "@/backend/db/db";
import { getAuthorizedUser, setAuditActor, unauthorizedResponse } from "@/backend/services/authz";
import {
  acknowledgeShipment,
  bridgeOverview,
  dispatchKdOutbox,
  notifyPoCancelled,
  sendPoToFactory,
  setInternalSupplier,
} from "@/backend/services/factoryBridge";

/** Kinh doanh ↔ Nhà máy: internal suppliers, POs sent to the factory and factory shipments. */
export async function GET(req: NextRequest) {
  const me = await getAuthorizedUser(req);
  if (!me) return unauthorizedResponse();
  try {
    void dispatchKdOutbox().catch(() => {});
    return NextResponse.json(await bridgeOverview(me));
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: httpErrorStatus(error) });
  }
}

export async function POST(req: NextRequest) {
  const me = await getAuthorizedUser(req);
  setAuditActor(me);
  if (!me) return unauthorizedResponse();
  try {
    const body = await req.json().catch(() => ({}));
    switch (body.action) {
      case "set_internal_supplier":
        await setInternalSupplier(me, Number(body.supplier_id), body.factory_unit || null);
        return NextResponse.json({ success: true });
      case "send_po":
        return NextResponse.json(await sendPoToFactory(me, Number(body.po_id), body));
      case "notify_cancel":
        await notifyPoCancelled(me, Number(body.po_id), String(body.reason || "").trim() || "Kinh doanh hủy PO");
        return NextResponse.json({ success: true });
      case "ack_shipment":
        await acknowledgeShipment(me, String(body.shipment_id));
        return NextResponse.json({ success: true });
      default:
        return NextResponse.json({ error: "Thao tác không hợp lệ" }, { status: 400 });
    }
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: httpErrorStatus(error) });
  }
}
