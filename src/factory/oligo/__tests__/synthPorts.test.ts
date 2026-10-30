import { afterAll, describe, expect, it } from "vitest";
import { createUser, grant } from "../../__tests__/helpers";
import { closeFactoryPool, getFactoryPool, withTransaction } from "../../core/db";
import type { AuthzActor } from "../../core/authz";
import { runTransition, type TransitionRequest } from "../../core/stateMachine";
import { createAsset } from "../../asset/service";
import { makeItem, makeSite, stockedLot } from "../../inv/__tests__/fixtures";
import { batchMachine, planBatch } from "../batches";
import { addSequences, createOligoOrder } from "../orders";
import { configurePorts, listPorts, setBottle, swapBottle } from "../synthPorts";
import { applyCalibration, removeAndCalibrate } from "../bottleCalibration";
import { consumptionReport } from "../consumptionReport";
import "../../modules";

afterAll(closeFactoryPool);
const db = () => getFactoryPool();

async function act(actor: AuthzActor, id: string, action: string, extra: Partial<TransitionRequest> = {}) {
  const row = (await db().query("SELECT version FROM oligo.synthesis_batch WHERE id = $1", [id])).rows[0];
  return withTransaction((tx) => runTransition(tx, batchMachine, actor, { id, action, expectedVersion: row.version, ...extra }));
}
const onHand = async (lotId: string) => Number((await db().query("SELECT coalesce(sum(qty_on_hand), 0)::float AS h FROM inv.stock_balance WHERE lot_id = $1", [lotId])).rows[0].h);
const reserved = async (lotId: string) => Number((await db().query("SELECT coalesce(sum(qty_reserved), 0)::float AS r FROM inv.stock_balance WHERE lot_id = $1", [lotId])).rows[0].r);

/**
 * One reagent item stands in for every role. Lot C (earliest expiry) is what FEFO takes; lots A and B are
 * bottles for the ACN port, so their stock moves only through the port.
 */
async function setup() {
  const site = await makeSite();
  await db().query("UPDATE core.org_unit SET module_key = 'OLIGO' WHERE id = $1", [site.dept]);
  const op = await createUser("KTV máy tổng hợp");
  await grant(op, ["oligo.view", "oligo.order.manage", "oligo.batch.manage", "asset.manage"], site.dept);
  const reagent = await makeItem(site, { name: "Hóa chất tổng hợp", base_uom: "mL" });
  await db().query("UPDATE oligo.reagent_rule SET item_id = $1", [reagent.id]);
  const lotC = await stockedLot(site, reagent.id, 1000, "2031-01-01", { uom: "mL" });
  const lotA = await stockedLot(site, reagent.id, 200, "2032-01-01", { uom: "mL" });
  const lotB = await stockedLot(site, reagent.id, 200, "2033-01-01", { uom: "mL" });
  const other = await makeItem(site, { name: "Hàng khác", base_uom: "mL" });
  const otherLot = await stockedLot(site, other.id, 50, "2031-01-01", { uom: "mL" });
  const cpg = await makeItem(site, { name: "Cột CPG", base_uom: "pcs", item_type: "CONSUMABLE" });
  const cpgLot = await stockedLot(site, cpg.id, 5, "2031-01-01", { uom: "pcs" });
  const synth = await withTransaction((tx) =>
    createAsset(tx, op, { name: "Máy tổng hợp", asset_type: "SYNTHESIZER", owner_org_unit_id: site.dept, synthesizer: { column_positions: 4, supported_scales: [] } })
  );
  const order = await withTransaction((tx) => createOligoOrder(tx, op, { org_unit_id: site.dept }));
  await withTransaction((tx) => addSequences(tx, op, order.id, { text: "F; ACGTACGTAC", defaults: { scale_code: "100NMOL", purification: "DESALT", format: "LYOPHILIZED" } }));
  const seq = (await db().query("SELECT id FROM oligo.oligo_sequence WHERE order_id = $1", [order.id])).rows[0];
  const plan = () =>
    withTransaction((tx) => planBatch(tx, op, { org_unit_id: site.dept, synthesizer_id: synth.id, positions: [{ sequence_id: seq.id, column_lot_id: cpgLot.id }] }));
  return { site, op, reagent, lotA, lotB, lotC, otherLot, synth, plan };
}

describe("synthesizer ports and bottles", () => {
  it("holds a port's reagent from the bottle installed on it and splits it at a bottle change during the run", async () => {
    const t = await setup();
    await expect(withTransaction((tx) => configurePorts(tx, t.op, t.synth.id, { ports: [{ port_no: 1, role: "NOPE" }] }))).rejects.toThrow(/không có trong định mức/);
    await withTransaction((tx) => configurePorts(tx, t.op, t.synth.id, { ports: [{ port_no: 1, role: "ACN", label: "Chai ACN" }] }));
    await expect(t.plan()).rejects.toMatchObject({ code: "PORT_EMPTY" });
    await expect(withTransaction((tx) => setBottle(tx, t.op, t.synth.id, 1, { lot_id: t.otherLot.id }))).rejects.toMatchObject({ code: "WRONG_ITEM" });
    await withTransaction((tx) => setBottle(tx, t.op, t.synth.id, 1, { lot_id: t.lotA.id }));
    const ports = await withTransaction((tx) => listPorts(tx, t.op, t.synth.id));
    expect(ports.ports[0]).toMatchObject({ role: "ACN", lot_code: t.lotA.code, available: 200 });

    const b = await t.plan();
    expect(await reserved(t.lotA.id)).toBeCloseTo(30, 6); // ACN 3.0 mL × 10 cycles from the bottle on port 1
    expect(await reserved(t.lotC.id)).toBeCloseTo(10 * 4.0 + 10 * 0.15, 6); // the other roles FEFO

    await act(t.op, b.id, "start");
    expect(await onHand(t.lotA.id)).toBeCloseTo(170, 6);
    await expect(withTransaction((tx) => setBottle(tx, t.op, t.synth.id, 1, { lot_id: t.lotB.id }))).rejects.toMatchObject({ code: "SYNTHESIZER_RUNNING" });
    await expect(withTransaction((tx) => configurePorts(tx, t.op, t.synth.id, { ports: [] }))).rejects.toMatchObject({ code: "SYNTHESIZER_RUNNING" });

    const r = await withTransaction((tx) => swapBottle(tx, t.op, b.id, { port_no: 1, lot_id: t.lotB.id, cycle: 6 }));
    expect(r.qty_moved_base).toBeCloseTo(15, 6); // cycles 6–10 × 3.0 mL
    expect(await onHand(t.lotA.id)).toBeCloseTo(185, 6);
    expect(await onHand(t.lotB.id)).toBeCloseTo(185, 6);

    const est = Number((await db().query("SELECT est_qty_base FROM oligo.synthesis_reagent_use WHERE batch_id = $1", [b.id])).rows[0].est_qty_base);
    await act(t.op, b.id, "finish", { payload: { positions: [{ position_no: 1, coupling_efficiency_pct: 99, ok: true }], reagents: [{ item_id: t.reagent.id, actual_qty_base: est + 2 }] } });
    expect(await onHand(t.lotB.id)).toBeCloseTo(183, 6); // the extra comes from the bottle now on the port
    const ev = (await db().query("SELECT event, swap_cycle FROM oligo.bottle_event WHERE synthesizer_id = $1 ORDER BY created_at", [t.synth.id])).rows;
    expect(ev.map((e) => e.event)).toEqual(["INSTALL", "SWAP"]);

    // the report shows the batch's variance: 2 mL over the estimate
    const report = await withTransaction((tx) => consumptionReport(tx, t.op, {}));
    const v = report.variance.find((r: any) => r.batch_id === b.id)!;
    expect(v.diff).toBeCloseTo(2, 6);

    // bottle B comes off: 200 mL at install, 180 mL left → it gave 20 mL, batches booked 15 (swap) + 2 (extra) = 17 mL
    await expect(withTransaction((tx) => removeAndCalibrate(tx, t.op, t.synth.id, 1, { volume_start: 200, volume_left: 210, uom: "mL" }))).rejects.toThrow(/không được lớn hơn/);
    const cal = await withTransaction((tx) => removeAndCalibrate(tx, t.op, t.synth.id, 1, { volume_start: 200, volume_left: 180, uom: "mL" }));
    expect(Number(cal.booked_qty)).toBeCloseTo(17, 6);
    expect(Number(cal.ratio)).toBeCloseTo(1.1765, 4);
    expect(Number(cal.suggested_qty)).toBeCloseTo(3.5294, 4); // ACN 3.0 mL/cycle × 20/17
    expect(await onHand(t.lotB.id)).toBeCloseTo(180, 6); // the 3 mL not booked by batches is issued now
    expect((await db().query("SELECT current_lot_id FROM oligo.synth_port WHERE synthesizer_id = $1 AND port_no = 1", [t.synth.id])).rows[0].current_lot_id).toBeNull();

    const lead = await createUser("Trưởng phòng Oligo");
    await grant(lead, ["oligo.reagent.manage"], t.site.dept);
    await expect(withTransaction((tx) => applyCalibration(tx, t.op, cal.id, "Theo hiệu chuẩn chai"))).rejects.toThrow(/quyền/);
    await withTransaction((tx) => applyCalibration(tx, lead, cal.id, "Theo hiệu chuẩn chai"));
    expect(Number((await db().query("SELECT qty FROM oligo.reagent_rule WHERE role = 'ACN'")).rows[0].qty)).toBeCloseTo(3.5294, 4);
    await db().query("UPDATE oligo.reagent_rule SET qty = 3.0 WHERE role = 'ACN'"); // other tests rely on the seeded rule
  });

  it("a bottle changed between plan and start moves the batch's hold to the new bottle", async () => {
    const t = await setup();
    await withTransaction((tx) => configurePorts(tx, t.op, t.synth.id, { ports: [{ port_no: 3, role: "ACN" }] }));
    await withTransaction((tx) => setBottle(tx, t.op, t.synth.id, 3, { lot_id: t.lotA.id }));
    const b = await t.plan();
    await withTransaction((tx) => setBottle(tx, t.op, t.synth.id, 3, { lot_id: t.lotB.id }));
    await act(t.op, b.id, "start");
    expect(await reserved(t.lotA.id)).toBe(0);
    expect(await onHand(t.lotA.id)).toBe(200);
    expect(await onHand(t.lotB.id)).toBeCloseTo(170, 6);
  });
});
