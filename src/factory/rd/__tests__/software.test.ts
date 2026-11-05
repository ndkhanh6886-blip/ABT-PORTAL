import { afterAll, describe, expect, it } from "vitest";
import { createOrgUnit, createUser, grant } from "../../__tests__/helpers";
import type { AuthzActor } from "../../core/authz";
import { closeFactoryPool, getFactoryPool, withTransaction } from "../../core/db";
import { preAuthenticate, runTransition, type MachineDef, type TransitionRequest } from "../../core/stateMachine";
import { createProject } from "../projects";
import { createSoftwareRelease, swReleaseMachine } from "../transfer";
import {
  createProblem,
  createValidation,
  getSoftwareLifecycle,
  recordTestRun,
  saveRequirement,
  saveTestCase,
  swProblemMachine,
  swValidationMachine,
} from "../software";
import "../../modules";

afterAll(closeFactoryPool);
const PIN = "731904";
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

async function setupKtcn() {
  const ktcn = await createOrgUnit("DEVICE");
  const dev = await createUser("Kỹ sư phần mềm KTCN", PIN);
  await grant(dev, ["rd.view", "rd.project.manage", "rd.transfer.manage"], ktcn);
  const tester = await createUser("Kỹ sư kiểm thử KTCN", PIN);
  await grant(tester, ["rd.view", "rd.project.manage"], ktcn);
  const head = await createUser("Trưởng phòng KTCN", PIN);
  await grant(head, ["rd.view", "rd.project.manage", "rd.gate.review", "rd.transfer.manage", "rd.software.release"], ktcn);
  const project = await withTransaction((tx) =>
    createProject(tx, head, { name: "Phần mềm điều khiển máy tách chiết EZ32", owner_org_unit_id: ktcn, target_domain: "SOFTWARE", project_type: "NEW_PRODUCT" })
  );
  return { ktcn, dev, tester, head, project };
}

describe("KTCN software lifecycle (IEC 62304)", () => {
  it("generates the release traceability from requirements, test cases and runs on that version; open problems block release", async () => {
    const { dev, tester, head, project } = await setupKtcn();
    const r1 = await withTransaction((tx) => saveRequirement(tx, dev, { project_id: project.id, req_code: "SRS-001", title: "Gia nhiệt khối ủ 56 °C ± 1 °C", kind: "SAFETY" }));
    const r2 = await withTransaction((tx) => saveRequirement(tx, dev, { project_id: project.id, req_code: "SRS-002", title: "Dừng khẩn khi mở nắp" }));
    const t1 = await withTransaction((tx) =>
      saveTestCase(tx, dev, { project_id: project.id, tc_code: "TC-001", title: "Đo nhiệt độ khối ủ", expected: "55–57 °C sau 5 phút", requirement_ids: [r1.id] })
    );

    const sw = await withTransaction((tx) =>
      createSoftwareRelease(tx, dev, {
        project_id: project.id,
        version_tag: "v1.0.0",
        target_kind: "FIRMWARE",
        safety_class: "CLASS_B",
        release_notes: "Bản đầu tiên firmware EZ32",
        validation_summary: "Kiểm thử hệ thống trên máy mẫu",
        source_ref: "git:ez32-fw@v1.0.0",
      })
    );

    // SRS-002 has no test, TC-001 not run yet: release refused
    await expect(act(swReleaseMachine, head, sw.id, "release", signed)).rejects.toMatchObject({
      code: "GUARD_FAILED",
      details: expect.arrayContaining([expect.objectContaining({ code: "IEC62304_SRS_FAILED" })]),
    });

    const t2 = await withTransaction((tx) =>
      saveTestCase(tx, dev, { project_id: project.id, tc_code: "TC-002", title: "Mở nắp khi đang chạy", expected: "Dừng động cơ < 1 s", requirement_ids: [r2.id] })
    );
    await withTransaction((tx) => recordTestRun(tx, tester, { test_case_id: t1.id, version_tag: "v1.0.0", result: "PASS" }));
    await expect(withTransaction((tx) => recordTestRun(tx, tester, { test_case_id: t2.id, version_tag: "v1.0.0", result: "FAIL" }))).rejects.toThrow(/kết quả thực tế/);
    await withTransaction((tx) => recordTestRun(tx, tester, { test_case_id: t2.id, version_tag: "v1.0.0", result: "FAIL", actual: "Dừng sau 2,3 s" }));

    const lc = await withTransaction((tx) => getSoftwareLifecycle(tx, dev, project.id, "v1.0.0"));
    expect(lc.traceability).toEqual([
      { req_id: "SRS-001", title: "Gia nhiệt khối ủ 56 °C ± 1 °C", test_case_id: "TC-001", result: "PASS" },
      { req_id: "SRS-002", title: "Dừng khẩn khi mở nắp", test_case_id: "TC-002", result: "FAIL" },
    ]);

    // a critical problem is reported, fixed by the developer and verified by someone else
    const pr = await withTransaction((tx) =>
      createProblem(tx, tester, { project_id: project.id, title: "Dừng khẩn chậm", description: "Mở nắp khi đang chạy, động cơ dừng sau 2,3 s", severity: "CRITICAL", found_in_version: "v1.0.0" })
    );
    expect(pr.code).toMatch(/^SPR\d{2}-\d{4}$/);
    await expect(act(swProblemMachine, dev, pr.id, "fix", { payload: { root_cause: "x" } })).rejects.toMatchObject({ code: "GUARD_FAILED" });
    await act(swProblemMachine, dev, pr.id, "fix", { payload: { root_cause: "Ngắt ưu tiên thấp", fix_summary: "Chuyển xử lý nắp sang ngắt mức cao", fixed_in_version: "v1.0.1" } });
    // still FIXED (not verified): it is an open anomaly of the release, and TC-002 still fails on v1.0.0
    await expect(act(swReleaseMachine, head, sw.id, "release", signed)).rejects.toMatchObject({
      details: expect.arrayContaining([expect.objectContaining({ code: "IEC62304_CRITICAL_ANOMALY_OPEN" })]),
    });
    await expect(act(swProblemMachine, dev, pr.id, "verify")).rejects.toMatchObject({
      details: expect.arrayContaining([expect.objectContaining({ code: "SAME_PERSON" })]),
    });

    // v1.0.1: both tests pass, the fix is verified → the release of v1.0.1 goes out with its matrix snapshot
    await withTransaction((tx) => recordTestRun(tx, tester, { test_case_id: t1.id, version_tag: "v1.0.1", result: "PASS" }));
    await withTransaction((tx) => recordTestRun(tx, tester, { test_case_id: t2.id, version_tag: "v1.0.1", result: "PASS" }));
    await act(swProblemMachine, tester, pr.id, "verify");
    const sw2 = await withTransaction((tx) =>
      createSoftwareRelease(tx, dev, { project_id: project.id, version_tag: "v1.0.1", target_kind: "FIRMWARE", safety_class: "CLASS_B", release_notes: "Sửa dừng khẩn", validation_summary: "TC-001, TC-002 đạt" })
    );
    const released = await act(swReleaseMachine, head, sw2.id, "release", signed);
    expect(released.status).toBe("RELEASED");
    const snap = (await getFactoryPool().query("SELECT srs_traceability, known_anomalies, source_ref FROM rd.software_release WHERE id = $1", [sw2.id])).rows[0];
    expect(snap.srs_traceability.map((t: any) => t.result)).toEqual(["PASS", "PASS"]);
    expect(snap.known_anomalies).toEqual([]);
  });

  it("validates in-house GMP software: IQ → OQ → PQ with evidence, approved for use by a third person", async () => {
    const { ktcn, dev, tester, head } = await setupKtcn();
    const v = await withTransaction((tx) =>
      createValidation(tx, dev, { org_unit_id: ktcn, system_name: "ABT Portal — Nhà máy", system_version: "2026.11", gamp_category: "5", intended_use: "Quản lý hồ sơ lô, kho nhà máy, QC theo GMP" })
    );
    expect(v.code).toMatch(/^CSV\d{2}-\d{3}$/);
    await expect(act(swValidationMachine, dev, v.id, "complete_iq", { payload: { summary: "ok" } })).rejects.toMatchObject({ code: "GUARD_FAILED" });
    await act(swValidationMachine, dev, v.id, "complete_iq", { payload: { summary: "Cài đặt máy chủ, CSDL, sao lưu đúng tài liệu cấu hình" } });
    await act(swValidationMachine, dev, v.id, "complete_oq", { payload: { summary: "42 kịch bản chức năng đạt, phân quyền và nhật ký đạt" } });
    await act(swValidationMachine, tester, v.id, "complete_pq", { payload: { summary: "Chạy song song 2 tuần với hồ sơ giấy, không sai lệch" } });
    // the head may approve only if they neither prepared it nor ran the PQ; here the head did neither
    await expect(act(swValidationMachine, tester, v.id, "approve_use", signed)).rejects.toThrow(/quyền/);
    const inUse = await act(swValidationMachine, head, v.id, "approve_use", signed);
    expect(inUse.status).toBe("IN_USE");
    expect((await getFactoryPool().query("SELECT 1 FROM core.e_signature WHERE entity_type = 'rd_sw_validation' AND entity_id = $1", [v.id])).rowCount).toBe(1);
  });
});
