import crypto from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUser, grant } from "../../__tests__/helpers";
import { closeFactoryPool, getFactoryPool, withTransaction } from "../../core/db";
import type { AuthzActor } from "../../core/authz";
import { saveAttachment } from "../../core/files";
import { processOutbox } from "../../core/worker";
import { preAuthenticate, runTransition, type TransitionRequest } from "../../core/stateMachine";
import { makeItem, makeSite, stockedLot, type Site } from "../../inv/__tests__/fixtures";
import { setKdGateway, type BridgeEvent } from "../gateway";
import { handleKdEvent } from "../kdEvents";
import { orderMachine } from "../orders";
import { markDropShipDelivered, postShipment } from "../shipments";
import "../../modules";

const PIN = "583920";
const delivered: BridgeEvent[] = [];
beforeAll(() => setKdGateway({ deliver: async (e) => void delivered.push(e) }));
afterAll(async () => {
  setKdGateway(null);
  await closeFactoryPool();
});

async function drain() {
  while ((await processOutbox(200)).processed > 0);
}

/** The site's department becomes a KIT production department (internal orders are routed by module key). */
async function kitSite(): Promise<Site> {
  const site = await makeSite();
  await getFactoryPool().query("UPDATE core.org_unit SET module_key = NULL WHERE module_key = 'KIT'");
  await getFactoryPool().query("UPDATE core.org_unit SET module_key = 'KIT' WHERE id = $1", [site.dept]);
  return site;
}

const poEvent = (code: string, productCode: string, extra: Record<string, unknown> = {}): BridgeEvent => ({
  event_id: crypto.randomUUID(),
  event_type: "KdPoIssued",
  payload: {
    kd_po_id: 1,
    kd_po_code: code,
    factory_unit: "KIT",
    ship_mode: "TO_KD",
    lines: [{ line_index: 0, product_code: productCode, product_name: "Kit PCR", unit: "Hộp", quantity: 3, unit_price: 500000 }],
    ...extra,
  },
});

async function accept(head: AuthzActor, orderId: string, committed = "2099-01-01") {
  const row = (await getFactoryPool().query("SELECT status, version FROM intake.internal_order WHERE id = $1", [orderId])).rows[0];
  const req: TransitionRequest = { id: orderId, action: "accept", expectedVersion: row.version, payload: { committed_date: committed }, credential: { method: "PIN", secret: PIN } };
  await preAuthenticate(orderMachine, row.status, req, head);
  return withTransaction((tx) => runTransition(tx, orderMachine, head, req, { signerAuthenticated: true }));
}

async function setup() {
  const site = await kitSite();
  const kd = `KIT-${Math.random().toString(36).slice(2, 8)}`;
  const item = await makeItem(site, { item_type: "FINISHED_KIT", kd_item_code: kd, kd_unit: "Hộp", kd_unit_factor: 10 });
  const head = await createUser("Trưởng SX Kit", PIN);
  await grant(head, ["intake.order.view", "intake.order.accept", "intake.order.manage", "intake.shipment.post"], site.dept);
  const code = `PO-T-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
  return { site, item, head, code, kd };
}
const orderOf = async (code: string) => (await getFactoryPool().query("SELECT * FROM intake.internal_order WHERE kd_po_code = $1", [code])).rows[0];

describe("internal orders from Kinh doanh", () => {
  it("receives a PO once, routes it to the department and needs a signed acceptance with a date", async () => {
    const { head, code, kd } = await setup();
    const ev = poEvent(code, kd);
    expect(await handleKdEvent(ev)).toBe("processed");
    expect(await handleKdEvent(ev)).toBe("duplicate");
    const order = await orderOf(code);
    expect(order.status).toBe("RECEIVED");
    await expect(accept(head, order.id, "2000-01-01")).rejects.toThrow(/ngày giao cam kết/);
    await accept(head, order.id);
    await drain();
    expect(delivered.some((e) => e.event_type === "FactoryOrderAccepted" && e.payload.kd_po_code === code)).toBe(true);
  });

  it("will not accept while a Kinh doanh product is not mapped to a factory item", async () => {
    const { head, code } = await setup();
    await handleKdEvent(poEvent(code, "KHONG-CO-MA"));
    await expect(accept(head, (await orderOf(code)).id)).rejects.toThrow(/chưa gắn với mã vật tư/);
  });

  it("ships released lots in KD units, reports to Kinh doanh, closes after acknowledgment", async () => {
    const { site, item, head, code, kd } = await setup();
    await handleKdEvent(poEvent(code, kd));
    const order = await orderOf(code);
    await accept(head, order.id);
    const lot = await stockedLot(site, item.id, 50, "2031-06-30"); // 50 µL = 5 "Hộp" with factor 10
    const line = (await getFactoryPool().query("SELECT id FROM intake.internal_order_line WHERE order_id = $1", [order.id])).rows[0];
    const ship = (qty: number) =>
      withTransaction((tx) => postShipment(tx, head, { order_id: order.id, warehouse_id: site.warehouse, lines: [{ order_line_id: line.id, lot_id: lot.id, from_location_id: site.shelf, qty }] }));
    await expect(ship(4)).rejects.toMatchObject({ code: "OVER_DELIVERY" });
    const s1 = await ship(2);
    expect((await orderOf(code)).status).toBe("PARTIALLY_DELIVERED");
    const bal = (await getFactoryPool().query("SELECT qty_on_hand::float AS q FROM inv.stock_balance WHERE lot_id = $1 AND location_id = $2", [lot.id, site.shelf])).rows[0];
    expect(bal.q).toBe(30);
    const s2 = await ship(1);
    expect((await orderOf(code)).status).toBe("DELIVERED");
    await drain();
    const posted = delivered.filter((e) => e.event_type === "FactoryShipmentPosted" && e.payload.kd_po_code === code);
    expect(posted).toHaveLength(2);
    expect(posted[0].payload.lines[0]).toMatchObject({ product_code: kd, quantity: 2, unit_price: 500000, lot_number: lot.code, expiry_date: "2031-06-30" });

    for (const s of [s1, s2]) await handleKdEvent({ event_id: crypto.randomUUID(), event_type: "KdShipmentAcknowledged", payload: { shipment_id: s.id, inbound_code: "PNK-1" } });
    expect((await orderOf(code)).status).toBe("CLOSED");
  });

  it("never ships an unreleased lot or from another department's warehouse", async () => {
    const { site, item, head, code, kd } = await setup();
    await handleKdEvent(poEvent(code, kd));
    const order = await orderOf(code);
    await accept(head, order.id);
    const held = await stockedLot(site, item.id, 30, null, { release: false });
    const line = (await getFactoryPool().query("SELECT id FROM intake.internal_order_line WHERE order_id = $1", [order.id])).rows[0];
    await expect(
      withTransaction((tx) => postShipment(tx, head, { order_id: order.id, warehouse_id: site.warehouse, lines: [{ order_line_id: line.id, lot_id: held.id, from_location_id: site.quarantine, qty: 1 }] }))
    ).rejects.toThrow(/chỉ lô đã giải phóng/);
    const other = await makeSite();
    await expect(
      withTransaction((tx) => postShipment(tx, head, { order_id: order.id, warehouse_id: other.warehouse, lines: [{ order_line_id: line.id, lot_id: held.id, from_location_id: other.shelf, qty: 1 }] }))
    ).rejects.toThrow(/kho của phòng sản xuất/);
  });

  it("drop ship needs the signed hand-over record; Kinh doanh cancelling an unshipped order cancels it", async () => {
    const { site, item, head, code, kd } = await setup();
    await handleKdEvent(poEvent(code, kd, { ship_mode: "DROP_SHIP", ship_to: { name: "Bệnh viện X", address: "Hà Nội" }, kd_so_code: "SO-1" }));
    const order = await orderOf(code);
    await accept(head, order.id);
    const lot = await stockedLot(site, item.id, 30, null);
    const line = (await getFactoryPool().query("SELECT id FROM intake.internal_order_line WHERE order_id = $1", [order.id])).rows[0];
    const s = await withTransaction((tx) =>
      postShipment(tx, head, { order_id: order.id, warehouse_id: site.warehouse, lines: [{ order_line_id: line.id, lot_id: lot.id, from_location_id: site.shelf, qty: 3 }] })
    );
    await expect(withTransaction((tx) => markDropShipDelivered(tx, head, s.id, {}))).rejects.toMatchObject({ code: "VALIDATION" });
    const pdf = Buffer.from("%PDF-1.7\nbien ban\n%%EOF");
    const att = await withTransaction((tx) =>
      saveAttachment(tx, head, { entityType: "shipment", entityId: s.id, category: "SIGNED_RECORD", fileName: "bien-ban.pdf", mimeType: "application/pdf", data: pdf })
    );
    await withTransaction((tx) => markDropShipDelivered(tx, head, s.id, { attachment_id: att.id }));
    expect((await getFactoryPool().query("SELECT status FROM intake.shipment WHERE id = $1", [s.id])).rows[0].status).toBe("DELIVERED");

    const code2 = `${code}-B`;
    await handleKdEvent(poEvent(code2, kd));
    await handleKdEvent({ event_id: crypto.randomUUID(), event_type: "KdPoCancelled", payload: { kd_po_code: code2, reason: "Khách hủy" } });
    expect((await orderOf(code2)).status).toBe("CANCELLED");
  });
});
