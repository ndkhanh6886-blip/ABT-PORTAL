import { afterAll, describe, expect, it } from "vitest";
import { createUser, grant } from "../../__tests__/helpers";
import type { AuthzActor } from "../../core/authz";
import { closeFactoryPool, getFactoryPool, withTransaction } from "../../core/db";
import { preAuthenticate, runTransition, type MachineDef, type TransitionRequest } from "../../core/stateMachine";
import { makeItem, makeSite, stockedLot, type Site } from "../../inv/__tests__/fixtures";
import { addBomLine, addRoutingStep, bomMachine, createBom, createRouting, routingMachine } from "../bomRouting";
import { createProductionOrder, getProductionOrderDetail, issueOrderMaterials, productionOrderMachine } from "../ordersEbr";
import "../../modules";

afterAll(closeFactoryPool);

const PIN = "482910";
const signed = { credential: { method: "PIN" as const, secret: PIN } };

async function act<S extends string, R extends { id: string; status: S; version: number }>(
  machine: MachineDef<S, R>,
  actor: AuthzActor,
  id: string,
  action: string,
  extra: Partial<TransitionRequest> = {}
): Promise<R> {
  const row = (await getFactoryPool().query(`SELECT status, version FROM ${machine.table} WHERE id = $1`, [id])).rows[0];
  const req: TransitionRequest = { id, action, expectedVersion: row.version, ...extra };
  await preAuthenticate(machine, row.status, req, actor);
  return withTransaction((tx) => runTransition(tx, machine, actor, req, { signerAuthenticated: true }));
}

/** Mã chính / mã vật tư phụ kiện là mã thật trong danh mục: dùng lại nếu đã có, chưa có thì tạo. */
async function getOrMakeItem(site: Site, code: string, over: Record<string, unknown>) {
  const ex = (await getFactoryPool().query("SELECT * FROM master.item WHERE upper(code) = $1 LIMIT 1", [code.toUpperCase()])).rows[0];
  return ex ?? (await makeItem(site, { code, ...over }));
}

describe("Kit tách chiết máy — mã phụ → vật tư cấp kèm tự trừ kho", () => {
  it("chọn mã phụ trên lệnh sản xuất: giữ chỗ đúng mã vật tư khi xác nhận và xuất kho cùng phiếu xuất", async () => {
    const site = await makeSite();
    const operator = await createUser("KTV Kit tách chiết", PIN);
    await grant(operator, ["kit.view", "kit.bom.manage", "kit.order.manage", "kit.ebr.execute", "inv.stock.view", "master.data.view", "master.item.manage"], site.dept);
    const checker = await createUser("Tổ trưởng Kit tách chiết", PIN);
    await grant(checker, ["kit.view", "kit.bom.manage", "kit.bom.approve", "kit.order.manage"], site.dept);

    const kit = await getOrMakeItem(site, "HM-001.A", { name: "Kit tách chiết máy HM-001.A", item_type: "FINISHED_KIT", base_uom: "kit" });
    const dpa = await getOrMakeItem(site, "DPA", { name: "Deep Plate 96 ABT", item_type: "CONSUMABLE", base_uom: "pcs" });
    const tcbi = await getOrMakeItem(site, "TCBI32", { name: "Tipcomb Bioer 32", item_type: "CONSUMABLE", base_uom: "pcs" });
    const buf = await makeItem(site, { name: "Dung dịch ly giải", item_type: "SEMI_FINISHED", base_uom: "mL" });
    await stockedLot(site, buf.id, 5000, "2028-12-31", { uom: "mL" });
    const dpaLot = await stockedLot(site, dpa.id, 100, "2029-12-31", { uom: "pcs" });
    await stockedLot(site, tcbi.id, 100, "2029-12-31", { uom: "pcs" });

    const bom = await withTransaction(async (tx) => {
      const b = await createBom(tx, operator, {
        org_unit_id: site.dept,
        product_item_id: kit.id,
        name: "BOM Kit tách chiết HM-001.A",
        bom_category: "Tách chiết / Khác",
        tests_per_kit: 50,
      });
      await addBomLine(tx, operator, {
        bom_id: b.id,
        component_item_id: buf.id,
        qty_per_base: 50,
        uom: "mL",
        box_no: 1,
        component_role: "EXTRACTION_BUFFER",
        scrap_pct: 0,
      });
      return b;
    });
    const rt = await withTransaction(async (tx) => {
      const r = await createRouting(tx, operator, {
        org_unit_id: site.dept,
        product_item_id: kit.id,
        routing_category: "Tách chiết / Khác",
        name: "Routing kit tách chiết",
      });
      await addRoutingStep(tx, operator, { routing_id: r.id, seq: 10, step_code: "S10", step_name: "Đóng gói", category: "FILLING", instructions: "Đóng gói." });
      return r;
    });
    await act(bomMachine, operator, bom.id, "submit_review");
    await act(bomMachine, checker, bom.id, "approve", signed);
    await act(routingMachine, operator, rt.id, "submit_review");
    await act(routingMachine, checker, rt.id, "approve", signed);

    const base = { org_unit_id: site.dept, product_item_id: kit.id, bom_id: bom.id, routing_id: rt.id, warehouse_id: site.warehouse, planned_qty: 10 };

    // Mã phụ của nhóm khác không được dùng cho mã này
    await expect(withTransaction((tx) => createProductionOrder(tx, operator, { ...base, accessory_set: "HI.B:KF" }))).rejects.toThrow(/không áp dụng/);

    const order = await withTransaction((tx) => createProductionOrder(tx, operator, { ...base, accessory_set: "HM.A:B32" }));
    expect(order.accessory_set).toBe("HM.A:B32");
    const lotRow = (await getFactoryPool().query("SELECT l.code FROM inv.lot l JOIN kit.production_order o ON o.lot_id = l.id WHERE o.id = $1", [order.id])).rows[0];
    expect(lotRow.code).toMatch(/^B\d{4,}\d{3,4}\.B32$/);

    await act(productionOrderMachine, operator, order.id, "confirm");
    const acc = (await getFactoryPool().query("SELECT * FROM kit.order_accessory_consumption WHERE order_id = $1", [order.id])).rows;
    expect(acc).toHaveLength(2);
    expect(acc.map((r) => r.item_id).sort()).toEqual([dpa.id, tcbi.id].sort());
    expect(acc.every((r) => Number(r.planned_qty) === 10 && r.reservation_id)).toBe(true);

    const detailBefore = await withTransaction((tx) => getProductionOrderDetail(tx, operator, order.id));
    expect(detailBefore.accessories?.variant).toBe("B32");
    expect(detailBefore.accessories?.items.map((i: any) => i.code)).toEqual(["DPA", "TCBI32"]);
    expect(detailBefore.accessories?.items[0].required_qty).toBe(10);

    await withTransaction((tx) => issueOrderMaterials(tx, operator, order.id));
    const after = (await getFactoryPool().query("SELECT * FROM kit.order_accessory_consumption WHERE order_id = $1", [order.id])).rows;
    expect(after.every((r) => Number(r.issued_qty) === 10 && r.stock_document_id)).toBe(true);
    // Tồn lô đĩa deep plate đã bị trừ 10
    const bal = (
      await getFactoryPool().query("SELECT coalesce(sum(qty_on_hand), 0)::float AS q FROM inv.stock_balance WHERE lot_id = $1", [dpaLot.id])
    ).rows[0];
    expect(Number(bal.q)).toBeCloseTo(90, 3);
  });
});
