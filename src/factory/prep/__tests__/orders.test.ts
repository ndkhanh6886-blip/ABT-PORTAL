import { afterAll, describe, expect, it } from "vitest";
import { createUser, grant } from "../../__tests__/helpers";
import { closeFactoryPool, getFactoryPool, withTransaction } from "../../core/db";
import { addDays, vnToday } from "../../core/dates";
import { makeItem, makeSite, stockedLot } from "../../inv/__tests__/fixtures";
import { cancelPrepOrder, createPrepOrder, executePrepOrder, finishIncubation, getPreparation } from "../orders";
import { prepare, saveFormula } from "../service";
import "../../modules";

afterAll(closeFactoryPool);
const db = () => getFactoryPool();
const rnd = () => Math.random().toString(36).slice(2, 6).toUpperCase();
const free = async (lotId: string) => Number((await db().query("SELECT coalesce(sum(qty_on_hand - qty_reserved), 0)::float AS f FROM inv.stock_balance WHERE lot_id = $1", [lotId])).rows[0].f);

async function setup(incubation_days = 0) {
  const site = await makeSite();
  const lead = await createUser("KTV pha chế");
  await grant(lead, ["prep.formula.manage", "prep.execute", "inv.stock.view"], site.dept);
  const salt = await makeItem(site, { name: "Muối", base_uom: "g" });
  const out = await makeItem(site, { name: "Đệm pha", base_uom: "mL" });
  const saltLot = await stockedLot(site, salt.id, 100, "2032-01-01", { uom: "g" });
  const f = await withTransaction((tx) =>
    saveFormula(tx, lead, null, { code: `F-${rnd()}`, name: "Đệm", output_item_id: out.id, basis_qty: 100, basis_uom: "mL", incubation_days, lines: [{ item_id: salt.id, qty: 10, uom: "g" }] })
  );
  return { site, lead, f, saltLot };
}

describe("preparation orders and incubation", () => {
  it("an order reserves its ingredients until it is made or cancelled", async () => {
    const t = await setup();
    const o = await withTransaction((tx) => createPrepOrder(tx, t.lead, { formula_id: t.f.id, qty: 300, uom: "mL", warehouse_id: t.site.warehouse, to_location_id: t.site.shelf, planned_date: vnToday() }));
    expect(o.code).toMatch(/^LP\d{4}-\d{4}$/);
    expect(await free(t.saltLot.id)).toBeCloseTo(70, 6);
    const p = await withTransaction((tx) => executePrepOrder(tx, t.lead, o.id, {}));
    expect(await free(t.saltLot.id)).toBeCloseTo(70, 6); // reserved 30 g, now consumed
    expect((await db().query("SELECT status, preparation_id FROM prep.prep_order WHERE id = $1", [o.id])).rows[0]).toEqual({ status: "DONE", preparation_id: p.id });
    const rec = await withTransaction((tx) => getPreparation(tx, t.lead, p.id));
    expect(rec).toMatchObject({ formula_code: t.f.code, lot_status: "RELEASED" });

    const o2 = await withTransaction((tx) => createPrepOrder(tx, t.lead, { formula_id: t.f.id, qty: 200, uom: "mL", warehouse_id: t.site.warehouse, planned_date: vnToday() }));
    expect(await free(t.saltLot.id)).toBeCloseTo(50, 6);
    await withTransaction((tx) => cancelPrepOrder(tx, t.lead, o2.id, "Đổi kế hoạch"));
    expect(await free(t.saltLot.id)).toBeCloseTo(70, 6);
    await expect(withTransaction((tx) => executePrepOrder(tx, t.lead, o2.id, {}))).rejects.toMatchObject({ code: "ORDER_CLOSED" });
  });

  it("an incubated reagent waits in quarantine until incubation is confirmed, then goes to its shelf", async () => {
    const t = await setup(3);
    await expect(withTransaction((tx) => prepare(tx, t.lead, { formula_id: t.f.id, qty: 100, uom: "mL", warehouse_id: t.site.warehouse }))).rejects.toThrow(/sau khi ủ/);
    const p = await withTransaction((tx) => prepare(tx, t.lead, { formula_id: t.f.id, qty: 100, uom: "mL", warehouse_id: t.site.warehouse, to_location_id: t.site.shelf }));
    expect(p.incubation_until).toBe(addDays(vnToday(), 3));
    const where = async () => (await db().query("SELECT b.location_id, l.status FROM inv.stock_balance b JOIN inv.lot l ON l.id = b.lot_id WHERE b.lot_id = $1 AND b.qty_on_hand > 0", [p.lot_id])).rows;
    expect(await where()).toEqual([{ location_id: t.site.quarantine, status: "QUARANTINE" }]);
    await expect(withTransaction((tx) => finishIncubation(tx, t.lead, p.id, {}))).rejects.toMatchObject({ code: "INCUBATING" });
    await db().query("UPDATE prep.preparation SET incubation_until = $2 WHERE id = $1", [p.id, vnToday()]);
    await withTransaction((tx) => finishIncubation(tx, t.lead, p.id, {}));
    expect(await where()).toEqual([{ location_id: t.site.shelf, status: "RELEASED" }]);
    await expect(withTransaction((tx) => finishIncubation(tx, t.lead, p.id, {}))).rejects.toThrow(/Đã xác nhận/);
  });
});
