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
});
