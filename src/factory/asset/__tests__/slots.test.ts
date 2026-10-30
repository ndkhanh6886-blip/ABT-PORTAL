import { afterAll, describe, expect, it } from "vitest";
import { createUser, grant } from "../../__tests__/helpers";
import { closeFactoryPool, getFactoryPool, withTransaction } from "../../core/db";
import { createAsset } from "../service";
import { configureSlots, listSlots, logSlotUsage, setSlotBottle } from "../slots";
import { makeItem, makeSite, stockedLot } from "../../inv/__tests__/fixtures";
import { addSequences, createOligoOrder } from "../../oligo/orders";
import { savePostProcess, startPostProcess } from "../../oligo/postProcess";
import { logStep, saveMethod, saveWorkflow } from "../../oligo/postSop";
import "../../modules";

afterAll(closeFactoryPool);
const db = () => getFactoryPool();
const rnd = () => Math.random().toString(36).slice(2, 7);
const onHand = async (lotId: string) => Number((await db().query("SELECT coalesce(sum(qty_on_hand), 0)::float AS h FROM inv.stock_balance WHERE lot_id = $1", [lotId])).rows[0].h);

describe("instrument reagent positions (HPLC)", () => {
  it("runs, purges and maintenance consume the bottle installed on the position", async () => {
    const site = await makeSite();
    await db().query("UPDATE core.org_unit SET module_key = 'OLIGO' WHERE id = $1", [site.dept]);
    const lead = await createUser("Trưởng phòng Oligo");
    await grant(lead, ["oligo.view", "oligo.sop.manage", "oligo.order.manage", "oligo.post.manage", "asset.manage", "asset.operate", "asset.view"], site.dept);
    const bufferA = await makeItem(site, { name: "Đệm A TEAA", base_uom: "mL" });
    const older = await stockedLot(site, bufferA.id, 500, "2030-06-01", { uom: "mL" }); // FEFO would take this one
    const bottle = await stockedLot(site, bufferA.id, 1000, "2031-01-01", { uom: "mL" });
    const other = await makeItem(site, { name: "Khác", base_uom: "mL" });
    const otherLot = await stockedLot(site, other.id, 10, "2031-01-01", { uom: "mL" });
    const hplc = await withTransaction((tx) => createAsset(tx, lead, { name: "HPLC", asset_type: "HPLC", owner_org_unit_id: site.dept }));

    await withTransaction((tx) => configureSlots(tx, lead, hplc.id, { slots: [{ slot_no: 1, label: "Đệm A", item_id: bufferA.id }] }));
    await expect(withTransaction((tx) => setSlotBottle(tx, lead, hplc.id, 1, { lot_id: otherLot.id }))).rejects.toMatchObject({ code: "WRONG_ITEM" });
    await expect(withTransaction((tx) => logSlotUsage(tx, lead, hplc.id, 1, { kind: "PURGE", qty: 5 }))).rejects.toMatchObject({ code: "SLOT_EMPTY" });
    await withTransaction((tx) => setSlotBottle(tx, lead, hplc.id, 1, { lot_id: bottle.id }));
    await withTransaction((tx) => logSlotUsage(tx, lead, hplc.id, 1, { kind: "PURGE", qty: 5 }));
    expect(await onHand(bottle.id)).toBeCloseTo(995, 6);

    // a PAGE-purification SOP whose purification step runs on the HPLC and uses 2 mL buffer A per sequence
    await db().query("UPDATE oligo.ps_workflow SET status = 'INACTIVE' WHERE 'PAGE' = ANY(purifications)");
    const run = await withTransaction((tx) =>
      saveMethod(tx, lead, null, {
        category: "Tinh sạch", name: `HPLC ${rnd()}`, fields: [
          { key: "device", label: "Máy", type: "EQUIPMENT" },
          { key: "buffer_a", label: "Đệm A", type: "REAGENT", item_id: bufferA.id, default_qty: 2, uom: "mL" },
        ],
      })
    );
    const od = await withTransaction((tx) => saveMethod(tx, lead, null, { category: "Đo OD", name: `OD ${rnd()}`, kind: "QUANTIFICATION", fields: [] }));
    await withTransaction((tx) => saveWorkflow(tx, lead, null, { name: `PAGE ${rnd()}`, purifications: ["PAGE"], steps: [{ method_id: run.id }, { method_id: od.id }] }));
    const order = await withTransaction((tx) => createOligoOrder(tx, lead, { org_unit_id: site.dept }));
    await withTransaction((tx) => addSequences(tx, lead, order.id, { text: "A; ACGTACGTAC\nB; GGCCTTAAGG", defaults: { scale_code: "100NMOL", purification: "PAGE", format: "LYOPHILIZED" } }));
    const seqs = (await db().query("SELECT id FROM oligo.oligo_sequence WHERE order_id = $1", [order.id])).rows.map((r) => r.id as string);
    await db().query("UPDATE oligo.oligo_sequence SET status = 'SYNTHESIZED' WHERE id = ANY($1::uuid[])", [seqs]);
    for (const id of seqs) await withTransaction((tx) => startPostProcess(tx, lead, id));
    await withTransaction((tx) => logStep(tx, lead, { sequence_ids: seqs, step_no: 1, values: { device: hplc.id } }));
    expect(await onHand(bottle.id)).toBeCloseTo(991, 6); // 2 × 2 mL from the bottle on the HPLC, not FEFO
    expect(await onHand(older.id)).toBe(500);

    await withTransaction((tx) => logSlotUsage(tx, lead, hplc.id, 1, { kind: "MAINTENANCE", qty: 10 }));
    const view = await withTransaction((tx) => listSlots(tx, lead, hplc.id));
    expect(Object.fromEntries(view.slots[0].usage.map((u: any) => [u.kind, u.qty]))).toEqual({ PURGE: 5, RUN: 4, MAINTENANCE: 10 });
    expect(view.slots[0].available).toBeCloseTo(981, 6);
    // the SOP's OD step still works afterwards
    const v = (await db().query("SELECT version FROM oligo.post_process WHERE sequence_id = $1", [seqs[0]])).rows[0].version;
    await withTransaction((tx) => savePostProcess(tx, lead, seqs[0], { version: v, a260: 0.2, stock_volume_ul: 500, dilution_factor: 50 }));
    await withTransaction((tx) => logStep(tx, lead, { sequence_ids: [seqs[0]], step_no: 2, values: {} }));
  });
});
