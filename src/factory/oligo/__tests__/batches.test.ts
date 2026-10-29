import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUser, grant } from "../../__tests__/helpers";
import { closeFactoryPool, getFactoryPool, withTransaction } from "../../core/db";
import type { AuthzActor } from "../../core/authz";
import { runTransition, type TransitionRequest } from "../../core/stateMachine";
import { createAsset } from "../../asset/service";
import { makeItem, makeSite, stockedLot, type Site } from "../../inv/__tests__/fixtures";
import { analyze, type CatalogEntry } from "../analyzer";
import { batchMachine, planBatch } from "../batches";
import { estimateConsumption, type ReagentRule } from "../consumption";
import { addSequences, createOligoOrder } from "../orders";
import "../../modules";

let catalog: CatalogEntry[] = [];
let rules: ReagentRule[] = [];
beforeAll(async () => {
  const db = getFactoryPool();
  catalog = (await db.query("SELECT code, name, kind, base_letter, nn_role, mw::float AS mw, mw_delta::float AS mw_delta, ext_coeff_260::float AS ext_coeff_260, aliases, position_type FROM oligo.modification")).rows;
  rules = (await db.query("SELECT role, name, basis, qty::float AS qty, uom, item_id, status FROM oligo.reagent_rule")).rows;
});
afterAll(closeFactoryPool);

describe("consumption estimate (OligoFlow model)", () => {
  it("counts cycles, splits degenerate bases, maps internal dyes to ALKYL and other tokens to MOD_DEFAULT", () => {
    const tokens = analyze("/FAM/ACGN/BHQ1/", catalog).tokens;
    const lines = estimateConsumption([{ code: "X", molecule_type: "DNA", tokens }], rules, (c) => (c === "BHQ1" ? "item-bhq1" : null));
    const q = Object.fromEntries(lines.map((l) => [l.role, l.qty]));
    expect(q).toMatchObject({ DEBLOCK: 7.2, CAP_A: 3.6, CAP_B: 3.6, OXIDATION: 4.8, ACTIVATOR: 4.8, ACN: 18, ALKYL: 0.25, dA: 0.1875, dC: 0.1875, dG: 0.1875, dT: 0.0375 });
    const bhq = lines.find((l) => l.role === "MOD:BHQ1")!;
    expect(bhq).toMatchObject({ qty: 0.25, catalog_item_id: "item-bhq1" });
  });

  it("uses RNA amidites for RNA sequences", () => {
    const tokens = analyze("AUGC", catalog).tokens;
    const q = Object.fromEntries(estimateConsumption([{ code: "R", molecule_type: "RNA", tokens }], rules).map((l) => [l.role, l.qty]));
    expect(q).toMatchObject({ rA: 0.2, rU: 0.2, rG: 0.2, rC: 0.2 });
  });
});

async function act(actor: AuthzActor, id: string, action: string, extra: Partial<TransitionRequest> = {}) {
  const row = (await getFactoryPool().query("SELECT version FROM oligo.synthesis_batch WHERE id = $1", [id])).rows[0];
  return withTransaction((tx) => runTransition(tx, batchMachine, actor, { id, action, expectedVersion: row.version, ...extra }));
}

async function setup() {
  const site: Site = await makeSite();
  await getFactoryPool().query("UPDATE core.org_unit SET module_key = 'OLIGO' WHERE id = $1", [site.dept]);
  const op = await createUser("KTV tổng hợp");
  await grant(op, ["oligo.view", "oligo.order.manage", "oligo.batch.manage", "asset.manage"], site.dept);
  const lead = await createUser("Trưởng nhóm");
  await grant(lead, ["oligo.batch.lead", "oligo.view"], site.dept);
  // one reagent item stands in for every role here; its stock is what the batch reserves and consumes
  const reagent = await makeItem(site, { name: "Hóa chất tổng hợp", base_uom: "mL" });
  await getFactoryPool().query("UPDATE oligo.reagent_rule SET item_id = $1", [reagent.id]);
  await stockedLot(site, reagent.id, 2000, "2031-01-01", { uom: "mL" });
  const cpg = await makeItem(site, { name: "Cột CPG", base_uom: "pcs", item_type: "CONSUMABLE" });
  const cpgLot = await stockedLot(site, cpg.id, 5, "2031-01-01", { uom: "pcs" });
  const synth = await withTransaction((tx) =>
    createAsset(tx, op, { name: "Máy tổng hợp 1", asset_type: "SYNTHESIZER", owner_org_unit_id: site.dept, synthesizer: { column_positions: 2, supported_scales: ["100NMOL", "200NMOL"] } })
  );
  const order = await withTransaction((tx) => createOligoOrder(tx, op, { org_unit_id: site.dept }));
  await withTransaction((tx) => addSequences(tx, op, order.id, { text: "F; ACGTACGTAC\nR; GGCCTTAAGG\nBig; ACGT; 1UMOL", defaults: { scale_code: "100NMOL", purification: "DESALT", format: "LYOPHILIZED" } }));
  const seqs = (await getFactoryPool().query("SELECT id, code, scale_code FROM oligo.oligo_sequence WHERE order_id = $1 ORDER BY line_no", [order.id])).rows;
  return { site, op, lead, reagent, cpg, cpgLot, synth, order, seqs };
}
const free = async (itemId: string) =>
  Number((await getFactoryPool().query("SELECT coalesce(sum(qty_on_hand - qty_reserved), 0)::float AS f, coalesce(sum(qty_on_hand),0)::float AS h FROM inv.stock_balance WHERE item_id = $1", [itemId])).rows[0].f);
const onHand = async (itemId: string) => Number((await getFactoryPool().query("SELECT coalesce(sum(qty_on_hand), 0)::float AS h FROM inv.stock_balance WHERE item_id = $1", [itemId])).rows[0].h);
const seqStatus = async (id: string) => (await getFactoryPool().query("SELECT status FROM oligo.oligo_sequence WHERE id = $1", [id])).rows[0].status;

describe("synthesis batches", () => {
  it("plans, starts and finishes a batch, booking actual consumption and failing a bad position with an NCR", async () => {
    const t = await setup();
    const [f, r] = t.seqs;
    const plan = (seqIds: string[]) =>
      withTransaction((tx) => planBatch(tx, t.op, { org_unit_id: t.site.dept, synthesizer_id: t.synth.id, positions: seqIds.map((id) => ({ sequence_id: id, column_lot_id: t.cpgLot.id })) }));
    await expect(plan([t.seqs[2].id])).rejects.toThrow(/không chạy thang 1UMOL/);
    await expect(plan(t.seqs.map((s) => s.id))).rejects.toThrow(/chỉ có 2 vị trí/);
    const batch = await plan([f.id, r.id]);
    expect(batch.code).toMatch(/^SB\d{6}-\d{2}$/);
    expect(await seqStatus(f.id)).toBe("QUEUED");
    // 2 sequences × 10 cycles × (1.2+0.6+0.6+0.8+0.8+3.0) mL + 20 couplings × 0.15 mL = 143 mL reserved
    expect(await free(t.reagent.id)).toBeCloseTo(2000 - 143, 6);
    expect(await free(t.cpg.id)).toBe(3);
    await expect(plan([f.id])).rejects.toMatchObject({ code: "SEQUENCE_TAKEN" });

    await act(t.op, batch.id, "start");
    expect(await seqStatus(f.id)).toBe("SYNTHESIZING");
    expect(await onHand(t.reagent.id)).toBeCloseTo(2000 - 143, 6);

    await expect(act(t.op, batch.id, "finish", { payload: { positions: [], reagents: [] } })).rejects.toMatchObject({ code: "GUARD_FAILED" });
    await act(t.op, batch.id, "finish", {
      payload: { positions: [{ position_no: 1, coupling_efficiency_pct: 99.1, ok: true }, { position_no: 2, coupling_efficiency_pct: 80, ok: false }], reagents: [{ item_id: t.reagent.id, actual_qty_base: 150 }] },
    });
    expect(await onHand(t.reagent.id)).toBeCloseTo(2000 - 150, 6); // 7 mL more than planned issued FEFO
    expect(await seqStatus(f.id)).toBe("SYNTHESIZED");
    expect(await seqStatus(r.id)).toBe("FAILED");
    const ncr = await getFactoryPool().query("SELECT 1 FROM qms.ncr WHERE entity_type = 'OLIGO_SEQUENCE' AND entity_id = $1", [r.id]);
    expect(ncr.rowCount).toBe(1);
    expect((await getFactoryPool().query("SELECT status FROM oligo.oligo_order WHERE id = $1", [t.order.id])).rows[0].status).toBe("IN_PROGRESS");
  });

  it("returns unused reagent to its lot, and cancelling a plan frees everything", async () => {
    const t = await setup();
    const [f, r] = t.seqs;
    const b1 = await withTransaction((tx) =>
      planBatch(tx, t.op, { org_unit_id: t.site.dept, synthesizer_id: t.synth.id, positions: [{ sequence_id: f.id, column_lot_id: t.cpgLot.id }] })
    );
    await act(t.op, b1.id, "start");
    await act(t.op, b1.id, "finish", { payload: { positions: [{ position_no: 1, coupling_efficiency_pct: 99, ok: true }], reagents: [{ item_id: t.reagent.id, actual_qty_base: 60 }] } });
    expect(await onHand(t.reagent.id)).toBeCloseTo(2000 - 60, 6); // planned 71.5 mL, 11.5 returned

    const b2 = await withTransaction((tx) =>
      planBatch(tx, t.op, { org_unit_id: t.site.dept, synthesizer_id: t.synth.id, positions: [{ sequence_id: r.id, column_lot_id: t.cpgLot.id }] })
    );
    await expect(act(t.op, b2.id, "cancel")).rejects.toMatchObject({ code: "REASON_REQUIRED" });
    await act(t.op, b2.id, "cancel", { reason: "Đổi máy" });
    expect(await seqStatus(r.id)).toBe("PENDING");
    expect(await free(t.reagent.id)).toBeCloseTo(2000 - 60, 6);
    // the sequence can go into another batch once released
    await withTransaction((tx) => planBatch(tx, t.op, { org_unit_id: t.site.dept, synthesizer_id: t.synth.id, positions: [{ sequence_id: r.id, column_lot_id: t.cpgLot.id }] }));
  });

  it("refuses an out-of-calibration synthesizer and unmapped reagents; abort fails every sequence", async () => {
    const t = await setup();
    const [f] = t.seqs;
    await getFactoryPool().query("UPDATE asset.asset SET next_calibration_due = '2020-01-01' WHERE id = $1", [t.synth.id]);
    const plan = () => withTransaction((tx) => planBatch(tx, t.op, { org_unit_id: t.site.dept, synthesizer_id: t.synth.id, positions: [{ sequence_id: f.id, column_lot_id: t.cpgLot.id }] }));
    await expect(plan()).rejects.toMatchObject({ code: "ASSET_CALIBRATION_DUE" });
    await getFactoryPool().query("UPDATE asset.asset SET next_calibration_due = NULL WHERE id = $1", [t.synth.id]);
    await getFactoryPool().query("UPDATE oligo.reagent_rule SET item_id = NULL WHERE role = 'ACN'");
    await expect(plan()).rejects.toMatchObject({ code: "REAGENT_UNMAPPED" });
    await getFactoryPool().query("UPDATE oligo.reagent_rule SET item_id = $1 WHERE role = 'ACN'", [t.reagent.id]);
    const b = await plan();
    await act(t.op, b.id, "start");
    await expect(act(t.op, b.id, "abort", { reason: "Mất điện" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await act(t.lead, b.id, "abort", { reason: "Mất điện" });
    expect(await seqStatus(f.id)).toBe("FAILED");
  });
});
