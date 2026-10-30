import { afterAll, describe, expect, it } from "vitest";
import { createOrgUnit, createUser, grant } from "../../__tests__/helpers";
import { closeFactoryPool, getFactoryPool, withTransaction } from "../../core/db";
import { createTask, planBoard, setTaskStatus, updateTask, workHours } from "../service";
import "../../modules";

afterAll(closeFactoryPool);
const db = () => getFactoryPool();

describe("work hours (OligoFlow rule)", () => {
  it("splits regular time and overtime, overnight and weekends", () => {
    expect(workHours("2026-10-29", "08:00", "17:00")).toEqual({ duration_h: 9, regular_h: 9, overtime_h: 0 });
    expect(workHours("2026-10-29", "16:30", "19:15")).toEqual({ duration_h: 2.75, regular_h: 0.5, overtime_h: 2.25 });
    expect(workHours("2026-10-29", "22:00", "02:00")).toEqual({ duration_h: 4, regular_h: 0, overtime_h: 4 });
    expect(workHours("2026-10-31", "08:00", "12:00")).toEqual({ duration_h: 4, regular_h: 0, overtime_h: 4 }); // Saturday
    expect(workHours("2026-10-29", "07:00", "09:00", { start: "07:30", end: "16:30" })).toEqual({ duration_h: 2, regular_h: 1.5, overtime_h: 0.5 });
  });
});

describe("work planner", () => {
  it("assigns tasks to the department's staff, totals hours, lets the assignee report progress", async () => {
    const unit = await createOrgUnit("OLIGO");
    const head = await createUser("Trưởng phòng");
    await grant(head, ["plan.manage", "plan.view"], unit);
    const tech = await createUser("KTV");
    await grant(tech, ["plan.view"], unit);
    const outsider = await createUser("Người phòng khác");
    const date = "2026-10-29";
    const base = { org_unit_id: unit, kind: "POST_PROCESS", title: "Khử bảo vệ 24 trình tự", work_date: date };
    await expect(withTransaction((tx) => createTask(tx, head, { ...base, assignee_id: outsider.userId, start_time: "08:00", end_time: "12:00" }))).rejects.toMatchObject({ code: "NOT_STAFF" });
    await expect(withTransaction((tx) => createTask(tx, tech, { ...base, start_time: "08:00", end_time: "12:00" }))).rejects.toThrow(/quyền/);
    const t1 = await withTransaction((tx) => createTask(tx, head, { ...base, assignee_id: tech.userId, start_time: "08:00", end_time: "12:00" }));
    const t2 = await withTransaction((tx) => createTask(tx, head, { ...base, title: "Tăng ca chạy HPLC", assignee_id: tech.userId, start_time: "16:30", end_time: "19:15" }));
    await withTransaction((tx) => createTask(tx, head, { ...base, title: "Chưa giao", start_time: "13:00", end_time: "17:00" }));

    const b = await withTransaction((tx) => planBoard(tx, tech, { org_unit_id: unit, date }));
    const me = b.staff.find((s: any) => s.user_id === tech.userId)!;
    expect([me.tasks.length, me.regular_h, me.overtime_h]).toEqual([2, 4.5, 2.25]);
    expect(b.unassigned).toHaveLength(1);
    expect(b.totals).toMatchObject({ tasks: 3, hours: 10.75, overtime_h: 2.25 });
    expect(b.can_manage).toBe(false);

    await withTransaction((tx) => setTaskStatus(tx, tech, t1.id, { status: "IN_PROGRESS", version: 0 }));
    await withTransaction((tx) => setTaskStatus(tx, tech, t1.id, { status: "DONE", version: 1 }));
    await expect(withTransaction((tx) => setTaskStatus(tx, tech, t2.id, { status: "CANCELLED", version: 0 }))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await withTransaction((tx) => updateTask(tx, head, t2.id, { version: 0, start_time: "17:00", end_time: "20:00" }));
    const t2b = (await db().query("SELECT overtime_h::float AS ot FROM plan.task WHERE id = $1", [t2.id])).rows[0];
    expect(t2b.ot).toBe(3);
  });
});
