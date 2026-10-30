import { afterAll, describe, expect, it } from "vitest";
import { createUser, grant } from "../../__tests__/helpers";
import { closeFactoryPool, getFactoryPool, withTransaction } from "../../core/db";
import { createAsset } from "../../asset/service";
import { makeItem, makeSite, stockedLot } from "../../inv/__tests__/fixtures";
import { addSequences, createOligoOrder } from "../orders";
import { getPostProcess, savePostProcess, sendToQc, startPostProcess } from "../postProcess";
import { logStep, saveMethod, saveWorkflow } from "../postSop";
import "../../modules";

afterAll(closeFactoryPool);
const db = () => getFactoryPool();
const rnd = () => Math.random().toString(36).slice(2, 7);

describe("post-synthesis SOP (methods, workflows, step log)", () => {
  it("follows the purification's workflow step by step, issuing step reagents and checking equipment", async () => {
    const site = await makeSite();
    await db().query("UPDATE core.org_unit SET module_key = 'OLIGO' WHERE id = $1", [site.dept]);
    const lead = await createUser("Trưởng phòng Oligo");
    await grant(lead, ["oligo.view", "oligo.sop.manage", "oligo.order.manage", "oligo.post.manage", "asset.manage"], site.dept);
    const ama = await makeItem(site, { name: "AMA", base_uom: "mL" });
    const amaLot = await stockedLot(site, ama.id, 100, "2031-01-01", { uom: "mL" });
    const hplc = await withTransaction((tx) => createAsset(tx, lead, { name: "HPLC 1", asset_type: "HPLC", owner_org_unit_id: site.dept }));

    const m = (category: string, name: string, kind: "STANDARD" | "QUANTIFICATION", fields: unknown[]) =>
      withTransaction((tx) => saveMethod(tx, lead, null, { category, name: `${name} ${rnd()}`, kind, target_hours: 2, fields }));
    const cleave = await m("Cắt & khử bảo vệ", "AMA 65°C", "STANDARD", [
      { key: "temp", label: "Nhiệt độ", type: "NUMBER", unit: "°C" },
      { key: "ama", label: "AMA", type: "REAGENT", item_id: ama.id, default_qty: 1, uom: "mL" },
    ]);
    const purify = await m("Tinh sạch", "HPLC RP", "STANDARD", [
      { key: "column", label: "Cột", type: "TEXT" },
      { key: "device", label: "Máy HPLC", type: "EQUIPMENT" },
      { key: "purity", label: "Độ tinh khiết", type: "NUMBER", unit: "%" },
    ]);
    const od = await m("Đo OD", "Nanodrop", "QUANTIFICATION", []);
    await expect(withTransaction((tx) => saveWorkflow(tx, lead, null, { name: `Thiếu đo ${rnd()}`, purifications: ["HPLC"], steps: [{ method_id: cleave.id }] }))).rejects.toMatchObject({
      code: "QUANTIFICATION_STEP",
    });
    // any active HPLC workflow from an earlier run of this test is retired first
    await db().query("UPDATE oligo.ps_workflow SET status = 'INACTIVE' WHERE 'HPLC' = ANY(purifications)");
    const wf = await withTransaction((tx) =>
      saveWorkflow(tx, lead, null, { name: `HPLC chuẩn ${rnd()}`, purifications: ["HPLC"], steps: [{ method_id: cleave.id }, { method_id: purify.id }, { method_id: od.id, name: "Đo OD260" }] })
    );
    await expect(withTransaction((tx) => saveWorkflow(tx, lead, null, { name: `Trùng ${rnd()}`, purifications: ["HPLC"], steps: [{ method_id: od.id }] }))).rejects.toMatchObject({
      code: "WORKFLOW_CLASH",
    });

    const order = await withTransaction((tx) => createOligoOrder(tx, lead, { org_unit_id: site.dept }));
    await withTransaction((tx) => addSequences(tx, lead, order.id, { text: "A; ACGTACGTAC\nB; GGCCTTAAGG", defaults: { scale_code: "100NMOL", purification: "HPLC", format: "LYOPHILIZED" } }));
    const seqs = (await db().query("SELECT id FROM oligo.oligo_sequence WHERE order_id = $1 ORDER BY line_no", [order.id])).rows.map((r) => r.id as string);
    await db().query("UPDATE oligo.oligo_sequence SET status = 'SYNTHESIZED' WHERE id = ANY($1::uuid[])", [seqs]);
    for (const id of seqs) await withTransaction((tx) => startPostProcess(tx, lead, id));
    const rec = (await db().query("SELECT workflow_id, workflow_steps FROM oligo.post_process WHERE sequence_id = $1", [seqs[0]])).rows[0];
    expect(rec.workflow_id).toBe(wf.id);
    expect(rec.workflow_steps.map((s: any) => s.name)).toEqual([cleave.name, purify.name, "Đo OD260"]);

    const log = (step_no: number, values: Record<string, unknown>, ids = seqs) => withTransaction((tx) => logStep(tx, lead, { sequence_ids: ids, step_no, values }));
    await expect(log(2, {})).rejects.toMatchObject({ code: "STEP_ORDER" });
    await expect(log(1, {})).rejects.toMatchObject({ code: "STEP_FIELD_MISSING" });
    await log(1, { temp: 65 }); // AMA defaults to 1 mL per sequence
    const onHand = async () => Number((await db().query("SELECT sum(qty_on_hand)::float AS h FROM inv.stock_balance WHERE lot_id = $1", [amaLot.id])).rows[0].h);
    expect(await onHand()).toBeCloseTo(98, 6);

    await db().query("UPDATE asset.asset SET next_calibration_due = '2020-01-01' WHERE id = $1", [hplc.id]);
    await expect(log(2, { column: "C18", device: hplc.id, purity: 92 })).rejects.toMatchObject({ code: "ASSET_CALIBRATION_DUE" });
    await db().query("UPDATE asset.asset SET next_calibration_due = NULL WHERE id = $1", [hplc.id]);
    await log(2, { column: "C18", device: hplc.id, purity: 92 });

    await expect(withTransaction((tx) => sendToQc(tx, lead, seqs[0]))).rejects.toMatchObject({ code: "POST_INCOMPLETE" });
    await expect(log(3, {}, [seqs[0]])).rejects.toMatchObject({ code: "OD_MISSING" });
    const version = (await db().query("SELECT version FROM oligo.post_process WHERE sequence_id = $1", [seqs[0]])).rows[0].version;
    // ticking steps by hand is ignored under an SOP
    await withTransaction((tx) => savePostProcess(tx, lead, seqs[0], { version, cleavage_done: false, a260: 0.4, dilution_factor: 100, stock_volume_ul: 500 }));
    await log(3, {}, [seqs[0]]);
    const after = (await db().query("SELECT cleavage_done, purification_done FROM oligo.post_process WHERE sequence_id = $1", [seqs[0]])).rows[0];
    expect(after).toEqual({ cleavage_done: true, purification_done: true });
    const detail = await withTransaction((tx) => getPostProcess(tx, lead, seqs[0]));
    expect(detail.steps.map((s: any) => s.step_no)).toEqual([1, 2, 3]);
    expect(detail.steps[0].values).toMatchObject({ temp: 65, ama: 1 });
    // the SOP no longer blocks QC (an Oligo spec may or may not be effective in this database)
    await withTransaction((tx) => sendToQc(tx, lead, seqs[0])).catch((e) => expect(e.code).not.toBe("POST_INCOMPLETE"));
  });
});
