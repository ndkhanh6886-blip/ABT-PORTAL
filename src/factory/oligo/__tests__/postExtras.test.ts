import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createOrgUnit, createUser, grant } from "../../__tests__/helpers";
import { closeFactoryPool, getFactoryPool, withTransaction } from "../../core/db";
import type { AuthzActor } from "../../core/authz";
import { createColumn, listColumns, retireColumn } from "../../asset/columns";
import { printLabels } from "../fulfilment";
import { addSequences, createOligoOrder } from "../orders";
import { aliquotPool, correctStep } from "../poolAliquot";
import { startPostProcess } from "../postProcess";
import { logStep, saveMethod, saveWorkflow } from "../postSop";
import { poolSequences } from "../sequences";
import "../../modules";

afterAll(closeFactoryPool);
const db = () => getFactoryPool();
const rnd = () => Math.random().toString(36).slice(2, 7);

let dept: string;
let lead: AuthzActor;
beforeAll(async () => {
  dept = await createOrgUnit("OLIGO");
  await db().query("UPDATE core.org_unit SET module_key = 'OLIGO' WHERE id = $1", [dept]);
  lead = await createUser("Trưởng phòng Oligo");
  await grant(lead, ["oligo.view", "oligo.order.manage", "oligo.post.manage", "oligo.delivery.manage", "oligo.sop.manage", "asset.manage", "asset.view"], dept);
});

describe("pooled synthesis aliquots", () => {
  it("shares the pool master's measurement between customer tubes; labels follow each tube's share", async () => {
    const o1 = await withTransaction((tx) => createOligoOrder(tx, lead, { org_unit_id: dept }));
    const o2 = await withTransaction((tx) => createOligoOrder(tx, lead, { org_unit_id: dept }));
    for (const o of [o1, o2]) await withTransaction((tx) => addSequences(tx, lead, o.id, { text: "P; ACGTTGCAACGTTGCAAC", defaults: { scale_code: "100NMOL", purification: "DESALT", format: "LYOPHILIZED" } }));
    const ids = (await db().query("SELECT id FROM oligo.oligo_sequence WHERE order_id = ANY($1::uuid[]) ORDER BY code", [[o1.id, o2.id]])).rows.map((r) => r.id);
    await withTransaction((tx) => poolSequences(tx, lead, { sequence_ids: ids, scale_code: "200NMOL" }));
    const master = (await db().query("SELECT m.id FROM oligo.oligo_pool p JOIN oligo.oligo_sequence m ON m.id = p.master_sequence_id JOIN oligo.oligo_pool_member pm ON pm.pool_id = p.id WHERE pm.sequence_id = $1", [ids[0]])).rows[0];
    await expect(withTransaction((tx) => printLabels(tx, lead, { sequence_ids: [ids[0]] }))).rejects.toMatchObject({ code: "ALIQUOT_MISSING" });
    await db().query("UPDATE oligo.oligo_sequence SET status = 'POST_PROCESSING' WHERE id = $1", [master.id]);
    await db().query(
      "INSERT INTO oligo.post_process (sequence_id, status, purification, format, od_total, nmol, ug, tube_count) VALUES ($1, 'OPEN', 'DESALT', 'LYOPHILIZED', 20, 100, 600, 1)",
      [master.id]
    );
    await expect(withTransaction((tx) => aliquotPool(tx, lead, master.id, { members: [{ sequence_id: ids[0], ratio_pct: 60 }, { sequence_id: ids[1], ratio_pct: 30 }] }))).rejects.toMatchObject({ code: "RATIO_TOTAL" });
    const v = await withTransaction((tx) => aliquotPool(tx, lead, master.id, { members: [{ sequence_id: ids[0], ratio_pct: 60, tube_count: 2 }, { sequence_id: ids[1], ratio_pct: 40 }] }));
    expect(v.members.map((m: any) => [m.ratio_pct, m.od])).toEqual([[60, 12], [40, 8]]);
    const labels = await withTransaction((tx) => printLabels(tx, lead, { sequence_ids: [ids[0]] }));
    expect(labels).toHaveLength(2);
    expect(labels[0]).toMatchObject({ od: 6, nmol: 30, released: false });
  });
});

describe("HPLC column depreciation and step corrections", () => {
  it("counts a run per sequence on the column of an SOP step; logged readings can be corrected with a reason", async () => {
    const col = await withTransaction((tx) => createColumn(tx, lead, { code: `COL-${rnd()}`, name: "XBridge C18", price_vnd: 30_000_000, design_runs: 300 }));
    const m1 = await withTransaction((tx) =>
      saveMethod(tx, lead, null, { category: "Tinh sạch", name: `OPC ${rnd()}`, fields: [{ key: "column", label: "Cột", type: "COLUMN" }, { key: "purity", label: "Độ tinh khiết", type: "NUMBER", unit: "%" }] })
    );
    const od = await withTransaction((tx) => saveMethod(tx, lead, null, { category: "Đo OD", name: `OD ${rnd()}`, kind: "QUANTIFICATION", fields: [] }));
    await db().query("UPDATE oligo.ps_workflow SET status = 'INACTIVE' WHERE 'OPC' = ANY(purifications)");
    await withTransaction((tx) => saveWorkflow(tx, lead, null, { name: `OPC ${rnd()}`, purifications: ["OPC"], steps: [{ method_id: m1.id }, { method_id: od.id }] }));
    const o = await withTransaction((tx) => createOligoOrder(tx, lead, { org_unit_id: dept }));
    await withTransaction((tx) => addSequences(tx, lead, o.id, { text: "A; ACGTACGTAC\nB; GGCCTTAAGG", defaults: { scale_code: "100NMOL", purification: "OPC", format: "LYOPHILIZED" } }));
    const seqs = (await db().query("SELECT id FROM oligo.oligo_sequence WHERE order_id = $1 ORDER BY line_no", [o.id])).rows.map((r) => r.id as string);
    await db().query("UPDATE oligo.oligo_sequence SET status = 'SYNTHESIZED' WHERE id = ANY($1::uuid[])", [seqs]);
    for (const id of seqs) await withTransaction((tx) => startPostProcess(tx, lead, id));
    await withTransaction((tx) => logStep(tx, lead, { sequence_ids: seqs, step_no: 1, values: { column: col.id, purity: 92 } }));
    const c = (await withTransaction((tx) => listColumns(tx, lead))).find((x: any) => x.id === col.id);
    expect(c).toMatchObject({ runs_used: 2, cost_per_run: 100000, depreciated_vnd: 200000 });

    await expect(withTransaction((tx) => correctStep(tx, lead, seqs[0], { step_no: 1, values: { column: col.id }, reason: "nhầm cột" }))).rejects.toMatchObject({ code: "NOT_EDITABLE" });
    await withTransaction((tx) => correctStep(tx, lead, seqs[0], { step_no: 1, values: { purity: 95 }, reason: "Đọc nhầm sắc ký đồ" }));
    const log = (await db().query("SELECT l.values, l.previous_values FROM oligo.ps_step_log l JOIN oligo.post_process p ON p.id = l.post_process_id WHERE p.sequence_id = $1", [seqs[0]])).rows[0];
    expect([log.values.purity, log.previous_values.purity]).toEqual([95, 92]);

    await withTransaction((tx) => retireColumn(tx, lead, col.id, "Áp suất tăng, hết hiệu năng"));
    const o2 = await withTransaction((tx) => createOligoOrder(tx, lead, { org_unit_id: dept }));
    await withTransaction((tx) => addSequences(tx, lead, o2.id, { text: "C; ACGTACGTAC", defaults: { scale_code: "100NMOL", purification: "OPC", format: "LYOPHILIZED" } }));
    const s3 = (await db().query("SELECT id FROM oligo.oligo_sequence WHERE order_id = $1", [o2.id])).rows[0].id;
    await db().query("UPDATE oligo.oligo_sequence SET status = 'SYNTHESIZED' WHERE id = $1", [s3]);
    await withTransaction((tx) => startPostProcess(tx, lead, s3));
    await expect(withTransaction((tx) => logStep(tx, lead, { sequence_ids: [s3], step_no: 1, values: { column: col.id, purity: 90 } }))).rejects.toMatchObject({ code: "COLUMN_RETIRED" });
  });
});
