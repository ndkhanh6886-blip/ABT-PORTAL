import { afterAll, beforeAll, describe, expect, it } from "vitest";
import "../../permissions";
import { createOrgUnit, createUser, grant } from "../../__tests__/helpers";
import { closeFactoryPool, getFactoryPool, withTransaction } from "../db";
import { authorizeAnywhere, authorizeAnywhereOneOf, hasFactoryPermission, isItOrgUnit, type AuthzActor } from "../authz";

afterAll(closeFactoryPool);

/** Phòng IT (Khối Kinh doanh) and Khối Kỹ thuật are separate both ways. */
describe("Phòng IT tách khỏi Khối Kỹ thuật", () => {
  let itUnit: string;
  let itTeam: string;
  let rdUnit: string;
  let itStaff: AuthzActor;
  let rdHead: AuthzActor;

  beforeAll(async () => {
    itUnit = await createOrgUnit("P-IT");
    await getFactoryPool().query("UPDATE core.org_unit SET module_key = 'IT' WHERE id = $1", [itUnit]);
    itTeam = await createOrgUnit("IT-TEAM", itUnit);
    rdUnit = await createOrgUnit("P-RD");
    await getFactoryPool().query("UPDATE core.org_unit SET module_key = 'RD' WHERE id = $1", [rdUnit]);

    itStaff = await createUser("Nhân viên IT");
    await grant(itStaff, ["it.view", "it.project.manage", "it.transfer.manage"], itUnit);

    // R&D head holding the R&D permissions company-wide
    rdHead = await createUser("Trưởng phòng R&D");
    await grant(rdHead, ["rd.view", "rd.project.manage", "rd.gate.review", "rd.idea.evaluate"]);
  });

  const can = (actor: AuthzActor, perm: string, unit: string | null) =>
    withTransaction((tx) => hasFactoryPermission(tx, actor, perm, unit));

  it("recognises P-IT and the units under it", async () => {
    await withTransaction(async (tx) => {
      expect(await isItOrgUnit(tx, itUnit)).toBe(true);
      expect(await isItOrgUnit(tx, itTeam)).toBe(true);
      expect(await isItOrgUnit(tx, rdUnit)).toBe(false);
    });
  });

  it("answers rd.* on an IT record with the it.* permission", async () => {
    expect(await can(itStaff, "rd.view", itUnit)).toBe(true);
    expect(await can(itStaff, "rd.project.manage", itTeam)).toBe(true);
    // IT staff do not hold it.gate.review
    expect(await can(itStaff, "rd.gate.review", itUnit)).toBe(false);
  });

  it("keeps IT staff out of Khối Kỹ thuật", async () => {
    expect(await can(itStaff, "rd.view", rdUnit)).toBe(false);
    expect(await can(itStaff, "rd.view", null)).toBe(false);
    // an IT-scoped role must not count as holding rd.view "somewhere" (R&D ideas, samples, ELN screens)
    await expect(withTransaction((tx) => authorizeAnywhere(tx, itStaff, "rd.view"))).rejects.toThrow();
    // the shared project list opens with it.view; rows are then filtered by owner unit
    await expect(withTransaction((tx) => authorizeAnywhereOneOf(tx, itStaff, ["rd.view", "it.view"]))).resolves.toBeUndefined();
  });

  it("keeps Khối Kỹ thuật out of IT records, even with company-wide R&D permissions", async () => {
    expect(await can(rdHead, "rd.view", rdUnit)).toBe(true);
    expect(await can(rdHead, "rd.view", itUnit)).toBe(false);
    expect(await can(rdHead, "rd.project.manage", itTeam)).toBe(false);
    expect(await can(rdHead, "rd.gate.review", itUnit)).toBe(false);
  });

  it("never grants an rd.* permission without an IT counterpart on an IT record", async () => {
    const itHead = await createUser("Trưởng phòng IT");
    await grant(itHead, ["it.view", "it.project.manage", "it.gate.review", "it.software.release", "rd.idea.evaluate"]);
    expect(await can(itHead, "rd.gate.review", itUnit)).toBe(true);
    expect(await can(itHead, "rd.software.release", itUnit)).toBe(true);
    expect(await can(itHead, "rd.idea.evaluate", itUnit)).toBe(false);
  });
});
