import { afterAll, describe, expect, it } from "vitest";
import { createUser, grant } from "../../__tests__/helpers";
import type { AuthzActor } from "../../core/authz";
import { closeFactoryPool, getFactoryPool, withTransaction } from "../../core/db";
import { preAuthenticate, runTransition, type MachineDef, type TransitionRequest } from "../../core/stateMachine";
import { makeItem, makeSite, stockedLot, type Site } from "../../inv/__tests__/fixtures";
import { addBomLine, addRoutingStep, bomMachine, createBom, createRouting, routingMachine } from "../bomRouting";
import {
  createProductionOrder,
  getProductionOrderDetail,
  issueOrderMaterials,
  productionOrderMachine,
  selectDraftMaterialLot,
  setAccessoryQty,
} from "../ordersEbr";
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
    const dpaLot2 = await stockedLot(site, dpa.id, 100, "2030-12-31", { uom: "pcs" });

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

    // Cài định mức: DPA cấp 2 / kit (mặc định 1); TCBI32 giữ mặc định
    await withTransaction((tx) => setAccessoryQty(tx, checker, { accessory_set: "HM.A:B32", item_code: "DPA", qty_per_kit: 2 }));
    try {
      const order = await withTransaction((tx) => createProductionOrder(tx, operator, { ...base, accessory_set: "HM.A:B32" }));
      expect(order.accessory_set).toBe("HM.A:B32");
      const lotRow = (await getFactoryPool().query("SELECT l.code FROM inv.lot l JOIN kit.production_order o ON o.lot_id = l.id WHERE o.id = $1", [order.id])).rows[0];
      expect(lotRow.code).toMatch(/^B\d{4,}\d{3,4}\.B32$/);

      // Bản nháp: phiếu hiện các mã vật tư cấp kèm + danh sách lô để chọn; chỉ định lô có HSD xa hơn (FEFO sẽ chọn lô cũ)
      const draft = await withTransaction((tx) => getProductionOrderDetail(tx, operator, order.id));
      const dpaRow = draft.accessories?.items.find((i: any) => i.code === "DPA");
      expect(dpaRow.required_qty).toBe(20);
      expect(dpaRow.available_lots.map((l: any) => l.lot_id)).toEqual(expect.arrayContaining([dpaLot.id, dpaLot2.id]));
      await withTransaction((tx) => selectDraftMaterialLot(tx, operator, order.id, { bom_line_id: "acc:DPA", lot_id: dpaLot2.id }));

      await act(productionOrderMachine, operator, order.id, "confirm");
      const acc = (await getFactoryPool().query("SELECT * FROM kit.order_accessory_consumption WHERE order_id = $1", [order.id])).rows;
      expect(acc).toHaveLength(2);
      const accDpa = acc.find((r) => r.item_id === dpa.id);
      const accTc = acc.find((r) => r.item_id === tcbi.id);
      expect(Number(accDpa.planned_qty)).toBe(20);
      expect(accDpa.lot_id).toBe(dpaLot2.id);
      expect(Number(accTc.planned_qty)).toBe(10);
      expect(acc.every((r) => r.reservation_id)).toBe(true);

      const detail = await withTransaction((tx) => getProductionOrderDetail(tx, operator, order.id));
      expect(detail.accessories?.variant).toBe("B32");
      expect(detail.accessories?.items.map((i: any) => i.code)).toEqual(["DPA", "TCBI32"]);

      await withTransaction((tx) => issueOrderMaterials(tx, operator, order.id));
      const after = (await getFactoryPool().query("SELECT * FROM kit.order_accessory_consumption WHERE order_id = $1", [order.id])).rows;
      expect(after.every((r) => Number(r.issued_qty) === Number(r.planned_qty) && r.stock_document_id)).toBe(true);
      const bal = async (lotId: string) =>
        Number((await getFactoryPool().query("SELECT coalesce(sum(qty_on_hand), 0)::float AS q FROM inv.stock_balance WHERE lot_id = $1", [lotId])).rows[0].q);
      expect(await bal(dpaLot2.id)).toBeCloseTo(80, 3); // trừ 20 đúng lô đã chọn
      expect(await bal(dpaLot.id)).toBeCloseTo(100, 3); // lô FEFO không bị đụng
    } finally {
      await withTransaction((tx) => setAccessoryQty(tx, checker, { accessory_set: "HM.A:B32", item_code: "DPA", qty_per_kit: 1 }));
    }
  });
});
