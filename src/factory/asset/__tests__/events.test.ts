import { afterAll, describe, expect, it } from "vitest";
import { createOrgUnit, createUser, grant } from "../../__tests__/helpers";
import { closeFactoryPool, getFactoryPool, withTransaction } from "../../core/db";
import type { AuthzActor } from "../../core/authz";
import { addDays, vnToday } from "../../core/dates";
import { preAuthenticate, runTransition, type TransitionRequest } from "../../core/stateMachine";
import { assertUsable, createAsset } from "../service";
import { assetEventMachine, attachToEvent, listEventFiles, listEvents, planEvent } from "../events";
import "../../modules";

afterAll(closeFactoryPool);
const db = () => getFactoryPool();
const PIN = "248613";

async function act(actor: AuthzActor, id: string, action: string, extra: Partial<TransitionRequest> = {}) {
  const row = (await db().query("SELECT status, version FROM asset.event WHERE id = $1", [id])).rows[0];
  const req: TransitionRequest = { id, action, expectedVersion: row.version, ...extra };
  await preAuthenticate(assetEventMachine, row.status, req, actor);
  return withTransaction((tx) => runTransition(tx, assetEventMachine, actor, req, { signerAuthenticated: true }));
}
const status = async (id: string) => (await db().query("SELECT status, next_calibration_due FROM asset.asset WHERE id = $1", [id])).rows[0];

describe("equipment maintenance, calibration and repair", () => {
  it("a breakdown takes the instrument out of service until the signed repair; calibration sets the due date", async () => {
    const dept = await createOrgUnit("OLIGO");
    const tech = await createUser("KTV vận hành");
    await grant(tech, ["asset.view", "asset.operate"], dept);
    const mgr = await createUser("Phụ trách thiết bị", PIN);
    await grant(mgr, ["asset.view", "asset.operate", "asset.manage"], dept);
    const hplc = await withTransaction((tx) => createAsset(tx, mgr, { name: "HPLC", asset_type: "HPLC", owner_org_unit_id: dept, calibration_interval_days: 180 }));
    const today = vnToday();

    const repair = await withTransaction((tx) => planEvent(tx, tech, { asset_id: hplc.id, kind: "REPAIR", planned_date: today, description: "Bơm báo lỗi áp suất", out_of_service: true }));
    expect(repair.code).toMatch(/^BT\d{4}-\d{4}$/);
    expect((await status(hplc.id)).status).toBe("UNDER_MAINTENANCE");
    await expect(withTransaction((tx) => assertUsable(tx, hplc.id))).rejects.toMatchObject({ code: "ASSET_UNAVAILABLE" });
    const done = { done_date: today, performed_by: "Hãng Waters", result: "Thay seal bơm", cost_vnd: 4500000 };
    await expect(act(tech, repair.id, "complete", { payload: done })).rejects.toMatchObject({ code: "GUARD_FAILED" });
    await expect(act(mgr, repair.id, "complete_signed", { payload: { ...done, done_date: addDays(today, 3) }, credential: { method: "PIN", secret: PIN } })).rejects.toMatchObject({ code: "GUARD_FAILED" });
    await act(mgr, repair.id, "complete_signed", { payload: done, credential: { method: "PIN", secret: PIN } });
    expect((await status(hplc.id)).status).toBe("IN_SERVICE");
    expect((await db().query("SELECT 1 FROM core.e_signature WHERE entity_type = 'asset_event' AND entity_id = $1 AND meaning = 'PERFORMED'", [repair.id])).rowCount).toBe(1);

    // the operator may only propose a calibration; someone outside the department may not even do that
    const outsider = await createUser("Phòng khác");
    await grant(outsider, ["asset.view", "asset.operate"], await createOrgUnit("KIT"));
    await expect(withTransaction((tx) => planEvent(tx, outsider, { asset_id: hplc.id, kind: "CALIBRATION", planned_date: today }))).rejects.toThrow(/quyền/);
    const proposed = await withTransaction((tx) => planEvent(tx, tech, { asset_id: hplc.id, kind: "CALIBRATION", planned_date: today }));
    expect((await withTransaction((tx) => listEvents(tx, tech, {}))).events.find((e: any) => e.id === proposed.id).actions.map((a: any) => a.action)).not.toContain("complete_signed");
    await act(mgr, proposed.id, "cancel", { reason: "Gộp vào phiếu hiệu chuẩn của phụ trách" });
    expect((await withTransaction((tx) => listEvents(tx, outsider, {}))).events.some((e: any) => e.asset_id === hplc.id)).toBe(false);
    const cal1 = await withTransaction((tx) => planEvent(tx, mgr, { asset_id: hplc.id, kind: "CALIBRATION", planned_date: today }));
    await expect(act(mgr, cal1.id, "complete_signed", { payload: { done_date: today, performed_by: "Quatest 3", result: "Sai số đầu dò" }, credential: { method: "PIN", secret: PIN } })).rejects.toMatchObject({ code: "GUARD_FAILED" });
    await act(mgr, cal1.id, "complete_signed", { payload: { done_date: today, performed_by: "Quatest 3", result: "Sai số đầu dò vượt", passed: false }, credential: { method: "PIN", secret: PIN } });
    expect((await status(hplc.id)).status).toBe("OUT_OF_CALIBRATION");
    const cal2 = await withTransaction((tx) => planEvent(tx, mgr, { asset_id: hplc.id, kind: "CALIBRATION", planned_date: today }));
    await act(mgr, cal2.id, "complete_signed", { payload: { done_date: today, performed_by: "Quatest 3", result: "Đạt sau hiệu chỉnh", passed: true }, credential: { method: "PIN", secret: PIN } });
    expect(await status(hplc.id)).toEqual({ status: "IN_SERVICE", next_calibration_due: addDays(today, 180) });

    const clean = await withTransaction((tx) => planEvent(tx, tech, { asset_id: hplc.id, kind: "CLEANING", planned_date: today }));
    await act(tech, clean.id, "complete", { payload: { done_date: today, performed_by: "KTV", result: "Rửa cột, đuổi khí đệm" } });
    const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
    await withTransaction((tx) => attachToEvent(tx, tech, clean.id, { fileName: "bien-ban.pdf", mimeType: "application/pdf", data: pdf }));
    expect((await withTransaction((tx) => listEventFiles(tx, mgr, clean.id))).map((f: any) => f.file_name)).toEqual(["bien-ban.pdf"]);

    const soon = await withTransaction((tx) => createAsset(tx, mgr, { name: "Máy đo quang", asset_type: "SPECTROPHOTOMETER", owner_org_unit_id: dept, next_calibration_due: addDays(today, 10) }));
    const list = await withTransaction((tx) => listEvents(tx, tech, {}));
    expect(list.calibration_due.map((a: any) => a.id)).toContain(soon.id);
    expect(list.events.find((e: any) => e.id === clean.id)).toMatchObject({ status: "DONE", files: 1 });
  });
});
