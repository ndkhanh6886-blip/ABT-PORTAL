import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createOrgUnit, createUser, grant } from "../../__tests__/helpers";
import { closeFactoryPool, getFactoryPool, withTransaction } from "../../core/db";
import type { AuthzActor } from "../../core/authz";
import { preAuthenticate, runTransition, type MachineDef, type TransitionRequest } from "../../core/stateMachine";
import { approveSpec, createSpecDraft, specMachine } from "../../qms/specs";
import { getQcTest, qcTestMachine, saveResults } from "../../qms/qcTests";
import { addSequences, createOligoOrder } from "../orders";
import { getPostProcess, quantify, savePostProcess, sendToQc, startPostProcess } from "../postProcess";
import "../../modules";

afterAll(closeFactoryPool);

const PIN = "640213";
const signed = { credential: { method: "PIN" as const, secret: PIN } };
const db = () => getFactoryPool();

async function act<S extends string, R extends { id: string; status: S; version: number }>(machine: MachineDef<S, R>, actor: AuthzActor, table: string, id: string, action: string, extra: Partial<TransitionRequest> = {}) {
  const row = (await db().query(`SELECT status, version FROM ${table} WHERE id = $1`, [id])).rows[0];
  const req: TransitionRequest = { id, action, expectedVersion: row.version, ...extra };
  await preAuthenticate(machine, row.status, req, actor);
  return withTransaction((tx) => runTransition(tx, machine, actor, req, { signerAuthenticated: true }));
}

let dept: string;
let op: AuthzActor, analyst: AuthzActor, qa: AuthzActor, author: AuthzActor;
beforeAll(async () => {
  dept = await createOrgUnit("OLIGO");
  await db().query("UPDATE core.org_unit SET module_key = 'OLIGO' WHERE id = $1", [dept]);
  op = await createUser("KTV hậu tổng hợp");
  await grant(op, ["oligo.view", "oligo.order.manage", "oligo.post.manage"], dept);
  author = await createUser("Soạn tiêu chuẩn");
  await grant(author, ["qms.spec.manage", "qms.qc.view"]);
  analyst = await createUser("Kiểm nghiệm Oligo", PIN);
  await grant(analyst, ["qms.qc.view", "qms.qc.analyze"]);
  qa = await createUser("QA Oligo", PIN);
  await grant(qa, ["qms.qc.view", "qms.qc.review", "qms.qc.lead", "qms.spec.approve"]);
});

/** One order with one DESALT primer that has just come off the synthesizer. */
async function synthesized(text = "F; ACGTACGTACGTACGTAC") {
  const order = await withTransaction((tx) => createOligoOrder(tx, op, { org_unit_id: dept }));
  await withTransaction((tx) => addSequences(tx, op, order.id, { text, defaults: { scale_code: "100NMOL", purification: "DESALT", format: "LYOPHILIZED" } }));
  const s = (await db().query("SELECT * FROM oligo.oligo_sequence WHERE order_id = $1", [order.id])).rows[0];
  await db().query("UPDATE oligo.oligo_sequence SET status = 'SYNTHESIZED' WHERE id = $1", [s.id]); // stands in for a finished batch
  return { order, s };
}
const seqStatus = async (id: string) => (await db().query("SELECT status FROM oligo.oligo_sequence WHERE id = $1", [id])).rows[0].status;
const recVersion = async (id: string) => (await db().query("SELECT version FROM oligo.post_process WHERE sequence_id = $1 AND status <> 'VOID'", [id])).rows[0].version;

async function measureAll(seqId: string, a260 = 0.5) {
  return withTransaction(async (tx) =>
    savePostProcess(tx, op, seqId, { version: await recVersion(seqId), cleavage_done: true, deprotection_done: true, purification_done: true, a260, dilution_factor: 100, stock_volume_ul: 500, tube_count: 2 })
  );
}

async function oligoSpec() {
  const draft = await withTransaction((tx) =>
    createSpecDraft(tx, author, {
      name: "Tiêu chuẩn xuất xưởng Oligo",
      applies_to: "OLIGO",
      parameters: [
        { name: "Sai lệch khối lượng phân tử (ESI-MS)", value_type: "NUMERIC", unit: "Da", lower_limit: -3, upper_limit: 3, derived_metric: "MW_DELTA_DA" },
        { name: "Tổng OD260", value_type: "NUMERIC", unit: "OD", lower_limit: 2, derived_metric: "OD_TOTAL" },
        { name: "Độ tinh khiết HPLC", value_type: "NUMERIC", unit: "%", lower_limit: 85, oligo_purifications: ["HPLC"] },
        { name: "Cảm quan", value_type: "PASS_FAIL" },
      ],
    })
  );
  const row = (await db().query("SELECT version FROM qms.qc_spec WHERE id = $1", [draft.id])).rows[0];
  const req = { id: draft.id, action: "approve", expectedVersion: row.version, ...signed };
  await preAuthenticate(specMachine, "DRAFT", req, qa);
  await withTransaction((tx) => approveSpec(tx, qa, req, true));
}

async function analyse(testId: string, observedMw: number) {
  await act(qcTestMachine, analyst, "qms.qc_test", testId, "start");
  const t = await withTransaction((tx) => getQcTest(tx, testId));
  const by = (n: string) => t.parameters.find((p: any) => p.name.startsWith(n))!.id;
  await withTransaction((tx) =>
    saveResults(tx, analyst, testId, {
      results: [
        { parameter_id: by("Sai lệch"), value_numeric: observedMw },
        { parameter_id: by("Tổng OD"), value_numeric: 999 }, // ignored: the server takes the measured OD
        { parameter_id: by("Cảm quan"), value_text: "PASS" },
      ],
    })
  );
  await act(qcTestMachine, analyst, "qms.qc_test", testId, "submit_results");
  return withTransaction((tx) => getQcTest(tx, testId));
}

describe("post-synthesis quantification", () => {
  it("computes OD, nmol, µg, resuspension volume and OD per tube like OligoFlow", () => {
    // 0.5 A260 × 100 dilution × 0.5 mL / 1 cm = 25 OD
    const q = quantify({ nmol_per_od: 5.31, ug_per_od: 32.4 }, { a260: 0.5, dilution_factor: 100, path_cm: 1, stock_volume_ul: 500, target_conc_um: 100, tube_count: 2 });
    expect(q).toEqual({ od_total: 25, nmol: 132.75, ug: 810, resuspend_volume_ul: 1327.5, od_per_tube: 12.5 });
  });
});

describe("post-synthesis and Oligo QC", () => {
  it("needs every step and a measurement, and an effective Oligo spec, before QC", async () => {
    const { s } = await synthesized();
    await withTransaction((tx) => startPostProcess(tx, op, s.id));
    expect(await seqStatus(s.id)).toBe("POST_PROCESSING");
    await expect(withTransaction((tx) => sendToQc(tx, op, s.id))).rejects.toMatchObject({ code: "POST_INCOMPLETE" });
    const rec = await measureAll(s.id);
    expect(Number(rec.od_total)).toBe(25);
    expect(Number(rec.nmol)).toBeCloseTo(25 * Number(s.nmol_per_od), 2);
    expect(Number(rec.od_per_tube)).toBe(12.5);
    await db().query("UPDATE qms.qc_spec SET status = 'OBSOLETE' WHERE applies_to = 'OLIGO' AND status = 'EFFECTIVE'");
    await expect(withTransaction((tx) => sendToQc(tx, op, s.id))).rejects.toMatchObject({ code: "NO_SPEC" });
  });

  it("derives ΔMW and OD on the server, skips HPLC-only parameters, and a passing review completes the sequence and order", async () => {
    await oligoSpec();
    const { order, s } = await synthesized();
    await withTransaction((tx) => startPostProcess(tx, op, s.id));
    await measureAll(s.id);
    const test = await withTransaction((tx) => sendToQc(tx, op, s.id));
    expect(await seqStatus(s.id)).toBe("QC");
    await expect(measureAll(s.id, 0.6)).rejects.toThrow(/chưa gửi QC/);

    const t = await analyse(test.id, Number(s.mw) + 1.2);
    expect(t.parameters.map((p: any) => p.name)).not.toContain("Độ tinh khiết HPLC");
    const value = (n: string) => t.results.find((r: any) => r.parameter_id === t.parameters.find((p: any) => p.name.startsWith(n))!.id);
    expect(Number(value("Sai lệch").value_numeric)).toBeCloseTo(1.2, 6);
    expect(Number(value("Sai lệch").observed_numeric)).toBeCloseTo(Number(s.mw) + 1.2, 6);
    expect(Number(value("Tổng OD").value_numeric)).toBe(25);
    expect(t.overall_result).toBe("PASS");
    expect(t.subject.reference).toMatchObject({ code: s.code, od_total: 25 });

    await act(qcTestMachine, qa, "qms.qc_test", test.id, "review", signed);
    expect(await seqStatus(s.id)).toBe("COMPLETED");
    expect((await db().query("SELECT status FROM oligo.oligo_order WHERE id = $1", [order.id])).rows[0].status).toBe("COMPLETED");
  });

  it("a failing review fails the sequence with an NCR; a cancelled test returns it to post-processing", async () => {
    const bad = await synthesized();
    await withTransaction((tx) => startPostProcess(tx, op, bad.s.id));
    await measureAll(bad.s.id);
    const t1 = await withTransaction((tx) => sendToQc(tx, op, bad.s.id));
    expect((await analyse(t1.id, Number(bad.s.mw) - 18)).overall_result).toBe("FAIL"); // e.g. a deletion product
    await act(qcTestMachine, qa, "qms.qc_test", t1.id, "review", signed);
    expect(await seqStatus(bad.s.id)).toBe("FAILED");
    expect((await db().query("SELECT 1 FROM qms.ncr WHERE entity_type = 'OLIGO_SEQUENCE' AND entity_id = $1", [bad.s.id])).rowCount).toBe(1);

    const other = await synthesized();
    await withTransaction((tx) => startPostProcess(tx, op, other.s.id));
    await measureAll(other.s.id);
    const t2 = await withTransaction((tx) => sendToQc(tx, op, other.s.id));
    await act(qcTestMachine, qa, "qms.qc_test", t2.id, "cancel", { reason: "Mẫu đổ, gửi lại" });
    expect(await seqStatus(other.s.id)).toBe("POST_PROCESSING");
    const rec = await measureAll(other.s.id, 0.4); // editable again
    expect(Number(rec.od_total)).toBe(20);
    const again = await withTransaction((tx) => sendToQc(tx, op, other.s.id));
    expect(again.code).not.toBe(t2.code);
    const detail = await withTransaction((tx) => getPostProcess(tx, op, other.s.id));
    expect(detail.qc_tests.map((q: any) => q.status)).toEqual(["CANCELLED", "PLANNED"]);
  });

  it("refuses Oligo-only parameter settings on other specifications", async () => {
    await expect(
      withTransaction((tx) =>
        createSpecDraft(tx, author, { name: "Sai", applies_to: "DEVICE_MODEL", parameters: [{ name: "ΔMW", value_type: "NUMERIC", derived_metric: "MW_DELTA_DA" }] })
      )
    ).rejects.toThrow(/chỉ dùng cho tiêu chuẩn Oligo/);
  });
});
