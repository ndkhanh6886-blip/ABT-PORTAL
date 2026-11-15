import { afterAll, describe, expect, it } from "vitest";
import { createUser, grant } from "../../__tests__/helpers";
import { closeFactoryPool, getFactoryPool, withTransaction } from "../../core/db";
import { createAsset } from "../service";
import { configureSlots, deleteSlot, listSlots, logSlotUsage, reportSlotBottleEmpty, setSlotBottle } from "../slots";
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

  it("supports 2 independent HPLC machines, 4-category breakdown (RUN/PURGE/MAINTENANCE/LOSS), reportSlotBottleEmpty, and deleteSlot", async () => {
    const site = await makeSite();
    await db().query("UPDATE core.org_unit SET module_key = 'OLIGO' WHERE id = $1", [site.dept]);
    const lead = await createUser("Quản lý Lab Oligo");
    await grant(lead, ["oligo.view", "asset.manage", "asset.operate", "asset.view"], site.dept);

    const solventA = await makeItem(site, { name: "ACN Gradient Multi-HPLC", base_uom: "mL" });
    const solventB = await makeItem(site, { name: "TEAA Buffer Multi-HPLC", base_uom: "mL" });
    const lotM1 = await stockedLot(site, solventA.id, 1000, "2031-06-01", { uom: "mL" });
    const lotM2 = await stockedLot(site, solventA.id, 2000, "2031-09-01", { uom: "mL" });

    const hplc1 = await withTransaction((tx) => createAsset(tx, lead, { name: "HPLC Máy 1", asset_type: "HPLC", owner_org_unit_id: site.dept }));
    const hplc2 = await withTransaction((tx) => createAsset(tx, lead, { name: "HPLC Máy 2", asset_type: "HPLC", owner_org_unit_id: site.dept }));

    await withTransaction((tx) =>
      configureSlots(tx, lead, hplc1.id, {
        slots: [{ slot_no: 1, label: "Kênh A Máy 1", item_id: solventA.id, bottle_volume_base: 1000, std_qty_per_run: 20, std_qty_per_purge: 30, bottle_price_vnd: 2000000 }],
      })
    );
    await withTransaction((tx) =>
      configureSlots(tx, lead, hplc2.id, {
        slots: [
          { slot_no: 1, label: "Kênh A Máy 2", item_id: solventA.id, bottle_volume_base: 2000, std_qty_per_run: 15, std_qty_per_purge: 25, bottle_price_vnd: 3000000 },
          { slot_no: 2, label: "Kênh B Máy 2", item_id: solventB.id, bottle_volume_base: 1000 },
        ],
      })
    );

    await withTransaction((tx) => setSlotBottle(tx, lead, hplc1.id, 1, { lot_id: lotM1.id }));
    await withTransaction((tx) => setSlotBottle(tx, lead, hplc2.id, 1, { lot_id: lotM2.id }));

    // Log direct RUN, process overhead PURGE, and wash MAINTENANCE on HPLC-1 only
    await withTransaction((tx) => logSlotUsage(tx, lead, hplc1.id, 1, { kind: "RUN", qty: 900 }));
    await withTransaction((tx) => logSlotUsage(tx, lead, hplc1.id, 1, { kind: "PURGE", qty: 60 }));
    await withTransaction((tx) => logSlotUsage(tx, lead, hplc1.id, 1, { kind: "MAINTENANCE", qty: 30, notes: "Rửa cột cuối tuần" }));

    // Verify HPLC-2 remains completely untouched
    expect(await onHand(lotM2.id)).toBe(2000);
    const hplc2Before = await withTransaction((tx) => listSlots(tx, lead, hplc2.id));
    expect(hplc2Before.slots).toHaveLength(2);
    expect(hplc2Before.slots[0].current_breakdown).toMatchObject({
      run_qty: 0,
      purge_qty: 0,
      maintenance_qty: 0,
      loss_qty: 0,
      total_qty: 0,
    });

    // Report empty ("✓ Báo hết") on HPLC-1 slot 1 -> remaining 10 mL written off as LOSS, stock 0, bottle detached
    const emptyRes = await withTransaction((tx) => reportSlotBottleEmpty(tx, lead, hplc1.id, 1, { notes: "Hết chai thực tế trên máy 1" }));
    expect(emptyRes.loss_qty).toBeCloseTo(10, 6);
    expect(await onHand(lotM1.id)).toBeCloseTo(0, 6);
    expect(await onHand(lotM2.id)).toBe(2000);

    const hplc1View = await withTransaction((tx) => listSlots(tx, lead, hplc1.id));
    expect(hplc1View.slots[0].current_lot_id).toBeNull();
    expect(hplc1View.slots[0].remaining_in_bottle).toBe(0);
    expect(hplc1View.slots[0].all_time_breakdown).toMatchObject({
      run_qty: 900,
      purge_qty: 60,
      maintenance_qty: 30,
      loss_qty: 10,
      total_qty: 1000,
      total_vnd: 2000000,
    });

    // Deleting slot 2 on HPLC-2 only removes slot 2 on HPLC-2 without touching HPLC-1
    await withTransaction((tx) => deleteSlot(tx, lead, hplc2.id, 2));
    const hplc2After = await withTransaction((tx) => listSlots(tx, lead, hplc2.id));
    expect(hplc2After.slots.map((s: any) => s.slot_no)).toEqual([1]);
    const hplc1StillThere = await withTransaction((tx) => listSlots(tx, lead, hplc1.id));
    expect(hplc1StillThere.slots.map((s: any) => s.slot_no)).toEqual([1]);
  });
});
