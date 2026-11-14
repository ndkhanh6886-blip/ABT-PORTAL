import { afterAll, describe, expect, it } from "vitest";
import { createOrgUnit, createUser, grant } from "../../__tests__/helpers";
import { closeFactoryPool, getFactoryPool, withTransaction } from "../../core/db";
import type { AuthzActor } from "../../core/authz";
import { preAuthenticate, runTransition, type TransitionRequest } from "../../core/stateMachine";
import { addSequences, createOligoOrder } from "../../oligo/orders";
import { traceSequence } from "../../oligo/trace";
import { listDeviations, reportIncident } from "../deviations";
import { deviationMachine } from "../ncr";
import "../../modules";

afterAll(closeFactoryPool);
const db = () => getFactoryPool();
const PIN = "390517";

async function act(actor: AuthzActor, id: string, action: string, extra: Partial<TransitionRequest> = {}) {
  const row = (await db().query("SELECT status, version FROM qms.deviation WHERE id = $1", [id])).rows[0];
  const req: TransitionRequest = { id, action, expectedVersion: row.version, ...extra };
  await preAuthenticate(deviationMachine, row.status, req, actor);
  return withTransaction((tx) => runTransition(tx, deviationMachine, actor, req, { signerAuthenticated: true }));
}

describe("operational incidents with CAPA, and sequence trace", () => {
  it("reports an incident on a sequence, investigates it into a CAPA and closes it; the trace shows it", async () => {
    const dept = await createOrgUnit("OLIGO");
    await db().query("UPDATE core.org_unit SET module_key = 'OLIGO' WHERE id = $1", [dept]);
    const op = await createUser("KTV Oligo");
    await grant(op, ["oligo.view", "oligo.order.manage", "qms.deviation.report"], dept);
    const other = await createUser("KTV khác");
    await grant(other, ["qms.deviation.report"], dept);
    const head = await createUser("Trưởng phòng");
    await grant(head, ["qms.ncr.propose", "qms.qc.view"]);
    const qa = await createUser("QA", PIN);
    await grant(qa, ["qms.ncr.approve", "qms.qc.view"]);

    const o = await withTransaction((tx) => createOligoOrder(tx, op, { org_unit_id: dept }));
    await withTransaction((tx) => addSequences(tx, op, o.id, { text: "F; ACGTACGTACGTACGTAC", defaults: { scale_code: "100NMOL", purification: "DESALT", format: "LYOPHILIZED" } }));
    const s = (await db().query("SELECT * FROM oligo.oligo_sequence WHERE order_id = $1", [o.id])).rows[0];
    await db().query(
      `INSERT INTO oligo.post_process (sequence_id, status, purification, format, cleavage_done, deprotection_done, purification_done, od_total, nmol, ug, tube_count)
       VALUES ($1, 'OPEN', 'DESALT', 'LYOPHILIZED', true, false, false, 12, 60, 400, 1)`,
      [s.id]
    );

    await expect(withTransaction((tx) => reportIncident(tx, op, { entity_type: "OLIGO_SEQUENCE", entity_code: "KHONG-CO", title: "Thử mã sai", severity: "LOW", description: "mô tả đủ dài để qua" }))).rejects.toThrow(/Không tìm thấy|không tìm thấy/);
    const r = await withTransaction((tx) =>
      reportIncident(tx, op, {
        entity_type: "OLIGO_SEQUENCE", entity_code: s.code.toLowerCase(), title: "Ống bị đổ khi khử bảo vệ", severity: "HIGH", step_ref: "Khử bảo vệ",
        performer_id: op.userId, description: "Ống ly tâm nứt, mất khoảng một nửa thể tích dung dịch", product_affected: true,
      })
    );
    expect(r.ncr_id).toBeTruthy();
    expect((await withTransaction((tx) => listDeviations(tx, other, {}))).map((d: any) => d.id)).not.toContain(r.deviation_id);
    const mine = await withTransaction((tx) => listDeviations(tx, op, {}));
    expect(mine.find((d: any) => d.id === r.deviation_id)).toMatchObject({ title: "Ống bị đổ khi khử bảo vệ", entity_code: s.code, step_ref: "Khử bảo vệ" });

    await act(head, r.deviation_id, "investigate");
    await expect(act(head, r.deviation_id, "define_action", { payload: { root_cause: "Ống cũ, nứt sẵn", corrective_action: "Chuyển ống mới" } })).rejects.toMatchObject({ code: "GUARD_FAILED" }); // HIGH: preventive needed
    await act(head, r.deviation_id, "define_action", {
      payload: { root_cause: "Ống cũ, nứt sẵn", corrective_action: "Chuyển ống mới, đo lại OD", preventive_action: "Kiểm tra ống trước khi dùng, thay lô ống", action_owner: "Trưởng phòng", action_due: "2099-01-01" },
    });
    // the NCR is still open: the deviation cannot close yet
    await expect(act(qa, r.deviation_id, "close", { reason: "Đã khắc phục", credential: { method: "PIN", secret: PIN } })).rejects.toMatchObject({ code: "GUARD_FAILED" });
    await db().query("UPDATE qms.ncr SET status = 'CLOSED', disposition = 'REWORK' WHERE id = $1", [r.ncr_id]);
    // HIGH deviation still requires effectiveness_summary before closing (ISO 13485 §8.5.2)
    await expect(act(qa, r.deviation_id, "close", { reason: "Đã khắc phục", credential: { method: "PIN", secret: PIN } })).rejects.toMatchObject({ code: "GUARD_FAILED" });
    await act(qa, r.deviation_id, "close", {
      reason: "Đã khắc phục",
      payload: { effectiveness_summary: "Đã kiểm tra 3 mẻ liên tiếp đạt yêu cầu, không tái diễn" },
      credential: { method: "PIN", secret: PIN },
    });
    expect((await db().query("SELECT status, closed_at IS NOT NULL AS closed FROM qms.deviation WHERE id = $1", [r.deviation_id])).rows[0]).toEqual({ status: "CLOSED", closed: true });

    const t = await withTransaction((tx) => traceSequence(tx, op, s.code));
    expect(t.order).toMatchObject({ code: o.code });
    expect(t.post).toHaveLength(1);
    expect(t.quality[0]).toMatchObject({ title: "Ống bị đổ khi khử bảo vệ", root_cause: "Ống cũ, nứt sẵn", ncr_status: "CLOSED" });
    await expect(withTransaction((tx) => traceSequence(tx, other, s.code))).rejects.toThrow(/trình tự/);
  });
});
