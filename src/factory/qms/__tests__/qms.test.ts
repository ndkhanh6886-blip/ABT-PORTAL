import { afterAll, describe, expect, it } from "vitest";
import { createUser, grant } from "../../__tests__/helpers";
import { closeFactoryPool, getFactoryPool, withTransaction } from "../../core/db";
import type { AuthzActor } from "../../core/authz";
import { preAuthenticate, runTransition, type MachineDef, type TransitionRequest } from "../../core/stateMachine";
import { lotMachine } from "../../inv/lots";
import { makeItem, makeSite, stockedLot } from "../../inv/__tests__/fixtures";
import { evaluateResult, overallResult } from "../evaluate";
import { approveSpec, createSpecDraft, specMachine, updateSpecDraft } from "../specs";
import { deviationMachine, ncrMachine } from "../ncr";
import { createRetest, qcTestMachine, saveResults } from "../qcTests";
import "../../modules";

afterAll(closeFactoryPool);

const PIN = "583920";

/** Runs a machine action like the API does: signature first, then the business transaction. */
async function act<S extends string, R extends { id: string; status: S; version: number }>(
  machine: MachineDef<S, R>,
  actor: AuthzActor,
  table: string,
  id: string,
  action: string,
  extra: Partial<TransitionRequest> = {}
): Promise<R> {
  const row = (await getFactoryPool().query(`SELECT status, version FROM ${table} WHERE id = $1`, [id])).rows[0];
  const req: TransitionRequest = { id, action, expectedVersion: row.version, ...extra };
  await preAuthenticate(machine, row.status, req, actor);
  return withTransaction((tx) => runTransition(tx, machine, actor, req, { signerAuthenticated: true }));
}
const signed = { credential: { method: "PIN" as const, secret: PIN } };

async function people() {
  const author = await createUser("Soạn tiêu chuẩn");
  await grant(author, ["qms.spec.manage", "qms.qc.view", "qms.ncr.propose"]);
  const analyst = await createUser("Kiểm nghiệm viên", PIN);
  await grant(analyst, ["qms.qc.view", "qms.qc.analyze", "inv.lot.sample", "qms.qc.review", "inv.lot.release"]);
  const qa = await createUser("QA", PIN);
  await grant(qa, ["qms.qc.view", "qms.qc.review", "qms.qc.lead", "qms.spec.approve", "qms.ncr.approve", "inv.lot.release", "inv.lot.reject", "inv.lot.hold"]);
  const qaLead = await createUser("Trưởng QA", PIN);
  await grant(qaLead, ["qms.qc.view", "qms.qc.review", "qms.ncr.approve"]);
  return { author, analyst, qa, qaLead };
}

async function effectiveSpec(itemId: string, p: Awaited<ReturnType<typeof people>>, appliesTo = "ITEM") {
  const draft = await withTransaction((tx) =>
    createSpecDraft(tx, p.author, {
      name: "Tiêu chuẩn thử",
      applies_to: appliesTo,
      item_id: itemId,
      parameters: [
        { name: "Độ tinh khiết", value_type: "NUMERIC", unit: "%", lower_limit: 95, is_critical: true },
        { name: "Cảm quan", value_type: "PASS_FAIL", is_critical: true },
        { name: "Ghi chú", value_type: "TEXT", is_critical: false },
      ],
    })
  );
  const row = (await getFactoryPool().query("SELECT version FROM qms.qc_spec WHERE id = $1", [draft.id])).rows[0];
  const req = { id: draft.id, action: "approve", expectedVersion: row.version, ...signed };
  await preAuthenticate(specMachine, "DRAFT", req, p.qa);
  await withTransaction((tx) => approveSpec(tx, p.qa, req, true));
  return draft;
}

async function paramIds(specId: string) {
  return (await getFactoryPool().query("SELECT id, name FROM qms.qc_spec_parameter WHERE spec_id = $1 ORDER BY seq", [specId])).rows.map((r) => r.id);
}
async function testOfLot(lotId: string) {
  return (await getFactoryPool().query("SELECT * FROM qms.qc_test WHERE entity_id = $1 ORDER BY created_at DESC LIMIT 1", [lotId])).rows[0];
}

describe("QC evaluation", () => {
  it("computes pass/fail from limits and requires every critical result", () => {
    const p = { id: "a", name: "pH", value_type: "NUMERIC" as const, lower_limit: "6.5", upper_limit: "7.5", target: null, is_critical: true };
    expect(evaluateResult(p, { value_numeric: 7 })).toBe(true);
    expect(evaluateResult(p, { value_numeric: 7.6 })).toBe(false);
    expect(() => evaluateResult(p, { value_numeric: null })).toThrow(/giá trị số/);
    expect(evaluateResult({ ...p, value_type: "PASS_FAIL", lower_limit: null, upper_limit: null }, { value_text: "FAIL" })).toBe(false);
    expect(evaluateResult({ ...p, value_type: "TEXT", lower_limit: null, upper_limit: null, target: "Trong suốt" }, { value_text: "trong suốt" })).toBe(true);
    expect(overallResult([p], [])).toEqual({ missing: ["pH"], result: "PASS" });
    expect(overallResult([p], [{ parameter_id: "a", passed: false }]).result).toBe("FAIL");
  });
});

describe("QC specifications", () => {
  it("needs a different approver and a signature; a new revision supersedes the old one", async () => {
    const site = await makeSite();
    const item = await makeItem(site);
    const p = await people();
    const self = await createUser("Tự duyệt", PIN);
    await grant(self, ["qms.spec.manage", "qms.spec.approve"]);
    const own = await withTransaction((tx) =>
      createSpecDraft(tx, self, { name: "X", applies_to: "ITEM", item_id: item.id, parameters: [{ name: "a", value_type: "PASS_FAIL" }] })
    );
    await expect(act(specMachine, self, "qms.qc_spec", own.id, "approve", signed)).rejects.toThrow(/khác người soạn/);

    const rev1 = await effectiveSpec(item.id, p);
    await expect(
      withTransaction((tx) => updateSpecDraft(tx, p.author, rev1.id, { version: 99, name: "x", applies_to: "ITEM", item_id: item.id, parameters: [{ name: "a", value_type: "TEXT" }] }))
    ).rejects.toThrow(/Chỉ sửa được bản nháp/);
    const rev2 = await withTransaction((tx) =>
      createSpecDraft(tx, p.author, { name: "Rev 2", applies_to: "ITEM", item_id: item.id, parameters: [{ name: "a", value_type: "PASS_FAIL" }] }, rev1.code)
    );
    expect(rev2.spec_version).toBe(2);
    const row = (await getFactoryPool().query("SELECT version FROM qms.qc_spec WHERE id = $1", [rev2.id])).rows[0];
    const req = { id: rev2.id, action: "approve", expectedVersion: row.version, ...signed };
    await preAuthenticate(specMachine, "DRAFT", req, p.qa);
    await withTransaction((tx) => approveSpec(tx, p.qa, req, true));
    const statuses = (await getFactoryPool().query("SELECT spec_version, status FROM qms.qc_spec WHERE code = $1 ORDER BY spec_version", [rev1.code])).rows;
    expect(statuses).toEqual([{ spec_version: 1, status: "OBSOLETE" }, { spec_version: 2, status: "EFFECTIVE" }]);
  });
});

describe("lot QC → release", () => {
  it("runs sampling, a failed test with NCR, a retest and a signed release by a different person", async () => {
    const site = await makeSite();
    const item = await makeItem(site, { receipt_qc_required: true });
    const p = await people();
    const lot = await stockedLot(site, item.id, 10, null, { release: false });

    await expect(act(lotMachine, p.analyst, "inv.lot", lot.id, "sample")).rejects.toThrow(/chưa có tiêu chuẩn QC hiệu lực/);
    const spec = await effectiveSpec(item.id, p);
    await act(lotMachine, p.analyst, "inv.lot", lot.id, "sample");
    const t1 = await testOfLot(lot.id);
    expect(t1).toMatchObject({ status: "PLANNED", test_kind: "RELEASE" });

    const [purity, look] = await paramIds(spec.id);
    await act(qcTestMachine, p.analyst, "qms.qc_test", t1.id, "start");
    await expect(withTransaction((tx) => saveResults(tx, p.qa, t1.id, { results: [{ parameter_id: purity, value_numeric: 99 }] }))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await withTransaction((tx) => saveResults(tx, p.analyst, t1.id, { results: [{ parameter_id: purity, value_numeric: 90 }] }));
    await expect(act(qcTestMachine, p.analyst, "qms.qc_test", t1.id, "submit_results")).rejects.toThrow(/chưa có kết quả/);
    await withTransaction((tx) => saveResults(tx, p.analyst, t1.id, { results: [{ parameter_id: look, value_text: "PASS" }] }));
    await act(qcTestMachine, p.analyst, "qms.qc_test", t1.id, "submit_results");
    await expect(withTransaction((tx) => saveResults(tx, p.analyst, t1.id, { results: [{ parameter_id: purity, value_numeric: 99 }] }))).rejects.toThrow(/đang kiểm nghiệm/);
    await expect(act(qcTestMachine, p.analyst, "qms.qc_test", t1.id, "review", signed)).rejects.toThrow(/khác người kiểm nghiệm/);
    const reviewed = await act(qcTestMachine, p.qa, "qms.qc_test", t1.id, "review", signed);
    expect(reviewed).toMatchObject({ status: "REVIEWED", overall_result: "FAIL", reviewer_id: p.qa.userId });
    const ncr = (await getFactoryPool().query("SELECT status FROM qms.ncr WHERE lot_id = $1", [lot.id])).rows;
    expect(ncr).toEqual([{ status: "OPEN" }]);

    await expect(act(lotMachine, p.qa, "inv.lot", lot.id, "release", signed)).rejects.toThrow(/không phải ĐẠT/);

    const retest = await withTransaction((tx) => createRetest(tx, p.qa, t1.id, "Mẫu lấy sai quy trình"));
    await act(qcTestMachine, p.analyst, "qms.qc_test", retest.id, "start");
    await expect(act(lotMachine, p.qa, "inv.lot", lot.id, "release", signed)).rejects.toThrow(/chưa được duyệt/);
    await withTransaction((tx) =>
      saveResults(tx, p.analyst, retest.id, { results: [{ parameter_id: purity, value_numeric: 98.5 }, { parameter_id: look, value_text: "PASS" }] })
    );
    await act(qcTestMachine, p.analyst, "qms.qc_test", retest.id, "submit_results");
    await act(qcTestMachine, p.qa, "qms.qc_test", retest.id, "review", signed);

    // Open OOS NCR / HIGH deviation from failed t1 still blocks release until investigated & closed with CAPA effectiveness
    await expect(act(lotMachine, p.qa, "inv.lot", lot.id, "release", signed)).rejects.toThrow(/NCR chưa đóng/);
    const ncrRow = (await getFactoryPool().query("SELECT id, deviation_id FROM qms.ncr WHERE lot_id = $1", [lot.id])).rows[0];
    await act(ncrMachine, p.author, "qms.ncr", ncrRow.id, "propose", { payload: { disposition: "REWORK", note: "Tái kiểm nghiệm lô mẫu đạt chuẩn" } });
    await act(ncrMachine, p.qa, "qms.ncr", ncrRow.id, "approve", signed);
    await act(ncrMachine, p.qa, "qms.ncr", ncrRow.id, "close", { ...signed, reason: "Đã tái kiểm nghiệm đạt" });
    await act(deviationMachine, p.author, "qms.deviation", ncrRow.deviation_id, "investigate");
    await act(deviationMachine, p.author, "qms.deviation", ncrRow.deviation_id, "define_action", {
      payload: {
        root_cause: "Mẫu lần 1 lấy sai thao tác hút",
        corrective_action: "Lấy lại mẫu đại diện và kiểm lại đạt 98.5%",
        preventive_action: "Đào tạo lại SOP lấy mẫu cho KTV",
      },
    });
    await expect(
      act(deviationMachine, p.qa, "qms.deviation", ncrRow.deviation_id, "close", {
        ...signed,
        reason: "Đã xác minh CAPA hiệu quả",
        payload: { effectiveness_summary: "Phiếu retest đạt 98.5% và đã nhắc nhở SOP lấy mẫu" },
      })
    ).rejects.toMatchObject({ code: "GUARD_FAILED", details: expect.arrayContaining([expect.objectContaining({ code: "NOT_REPORTER" })]) });
    await act(deviationMachine, p.qaLead, "qms.deviation", ncrRow.deviation_id, "close", {
      ...signed,
      reason: "Đã xác minh CAPA hiệu quả",
      payload: { effectiveness_summary: "Phiếu retest đạt 98.5% và đã nhắc nhở SOP lấy mẫu" },
    });

    await expect(act(lotMachine, p.analyst, "inv.lot", lot.id, "release", signed)).rejects.toThrow(/khác người kiểm nghiệm/);
    const released = await act(lotMachine, p.qa, "inv.lot", lot.id, "release", signed);
    expect(released.status).toBe("RELEASED");
    const sigs = (await getFactoryPool().query("SELECT meaning FROM core.e_signature WHERE entity_id = ANY($1::text[]) ORDER BY signed_at", [[t1.id, retest.id, lot.id]])).rows;
    expect(sigs.map((s) => s.meaning)).toEqual(["REVIEWED", "REVIEWED", "RELEASED"]);
  });

  it("rejecting a lot opens an NCR; un-hold waits until open NCRs are closed", async () => {
    const site = await makeSite();
    const item = await makeItem(site, { receipt_qc_required: true });
    const p = await people();
    await effectiveSpec(item.id, p, "ITEM");
    const lot = await stockedLot(site, item.id, 5, null, { release: false });
    await act(lotMachine, p.analyst, "inv.lot", lot.id, "sample");
    await expect(act(lotMachine, p.qa, "inv.lot", lot.id, "reject")).rejects.toMatchObject({ code: "REASON_REQUIRED" });
    await act(lotMachine, p.qa, "inv.lot", lot.id, "reject", { reason: "Bao bì rách" });
    const ncr = (await getFactoryPool().query("SELECT description FROM qms.ncr WHERE lot_id = $1", [lot.id])).rows;
    expect(ncr[0].description).toMatch(/Bao bì rách/);

    const free = await makeItem(site);
    const held = await stockedLot(site, free.id, 5, null);
    await act(lotMachine, p.qa, "inv.lot", held.id, "hold", { reason: "Nghi nhiễm" });
    await getFactoryPool().query(
      "INSERT INTO qms.ncr (code, entity_type, entity_id, lot_id, description) VALUES ($1, 'LOT', $2, $2, 'Đang điều tra')",
      [`NCR-T-${Date.now()}`, held.id]
    );
    await expect(act(lotMachine, p.qa, "inv.lot", held.id, "unhold", signed)).rejects.toThrow(/NCR chưa đóng/);
  });
});
