import { afterAll, afterEach, describe, expect, it } from "vitest";
import { createOrgUnit, createUser, grant } from "./helpers";
import { closeFactoryPool, getFactoryPool, withTransaction } from "../core/db";
import { notifyUsers, setNoticePolicy } from "../core/notifications";
import "../modules";

afterAll(closeFactoryPool);
afterEach(() => setNoticePolicy(null));
const received = async (userId: number, key: string) =>
  (await getFactoryPool().query("SELECT 1 FROM core.notification WHERE user_id = $1 AND source_key = $2", [userId, key])).rowCount;

describe("factory notices follow the portal notification matrix", () => {
  it("an event switched off notifies nobody; an added group is notified in any department", async () => {
    const qa = await createUser("QA nhận mặc định");
    const kit = await createUser("Tổ Kit");
    await grant(kit, ["kit.view"], await createOrgUnit("KIT"));

    setNoticePolicy({ ruleFor: async (type) => (type === "KIT_IPC_GATE_REQUEST" ? { enabled: false, permissions: [], userIds: [] } : null) });
    const off = `test_off_${Date.now()}`;
    expect(await withTransaction((tx) => notifyUsers(tx, [qa.userId], { type: "KIT_IPC_GATE_REQUEST", title: "IPQC", sourceKey: off }))).toBe(0);
    expect(await received(qa.userId, off)).toBe(0);

    setNoticePolicy({ ruleFor: async () => ({ enabled: true, permissions: ["kit.view"], userIds: [] }) });
    const on = `test_on_${Date.now()}`;
    await withTransaction((tx) => notifyUsers(tx, [qa.userId], { type: "QMS_DEVIATION", title: "Sai lệch", sourceKey: on }));
    expect(await received(qa.userId, on)).toBe(1);
    expect(await received(kit.userId, on)).toBe(1);

    // a broken policy never stops the built-in recipients
    setNoticePolicy({ ruleFor: async () => { throw new Error("portal down"); } });
    const fallback = `test_fb_${Date.now()}`;
    await withTransaction((tx) => notifyUsers(tx, [qa.userId], { type: "QMS_DEVIATION", title: "Sai lệch", sourceKey: fallback }));
    expect(await received(qa.userId, fallback)).toBe(1);
  });

  it("a department group only reaches holders inside that department (or company-wide), not other heads with the same read permission", async () => {
    const qaDept = await createOrgUnit("QA");
    const qaTeam = await createOrgUnit("QA-TEAM", qaDept);
    const oligoDept = await createOrgUnit("OLIGO");
    const qaCode = (await getFactoryPool().query("SELECT code FROM core.org_unit WHERE id = $1", [qaDept])).rows[0].code as string;

    const qaStaff = await createUser("QC trong phòng QA");
    await grant(qaStaff, ["qms.qc.view"], qaTeam);
    const oligoHead = await createUser("Trưởng phòng Oligo");
    await grant(oligoHead, ["qms.qc.view", "oligo.view"], oligoDept);
    const bod = await createUser("Ban Giám đốc");
    await grant(bod, ["qms.qc.view"], null);

    setNoticePolicy({ ruleFor: async () => ({ enabled: true, permissions: [], userIds: [], groups: [{ permission: "qms.qc.view", orgUnitCode: qaCode }] }) });
    const key = `test_dept_${Date.now()}`;
    await withTransaction((tx) => notifyUsers(tx, [], { type: "KIT_IPC_GATE_REQUEST", title: "IPQC", sourceKey: key }));
    expect(await received(qaStaff.userId, key)).toBe(1);
    expect(await received(bod.userId, key)).toBe(1);
    expect(await received(oligoHead.userId, key)).toBe(0);

    // a group without a department keeps reaching holders anywhere
    setNoticePolicy({ ruleFor: async () => ({ enabled: true, permissions: [], userIds: [], groups: [{ permission: "qms.qc.view" }] }) });
    const anyKey = `test_any_${Date.now()}`;
    await withTransaction((tx) => notifyUsers(tx, [], { type: "KIT_IPC_GATE_REQUEST", title: "IPQC", sourceKey: anyKey }));
    expect(await received(oligoHead.userId, anyKey)).toBe(1);
  });
});
