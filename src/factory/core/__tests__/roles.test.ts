import { afterAll, describe, expect, it } from "vitest";
import { createOrgUnit, createUser, grant } from "../../__tests__/helpers";
import { closeFactoryPool, getFactoryPool, withTransaction } from "../db";
import { hasFactoryPermission, type AuthzActor } from "../authz";
import { ensureDefaultRoles } from "../defaultRoles";
import { heldPermissions } from "../org";
import { createDelegation, createRole, grantRole, listUsersWithGrants, revokeRole, setOwnPin, setUserCustomPermission, updateRole, type UserDirectory } from "../roles";
import { authenticateSigner } from "../signature";
import "../../permissions";

afterAll(closeFactoryPool);

/** Fake ABT Portal directory: users exist as soon as they have a factory profile in the test. */
const directory: UserDirectory = {
  async search(q) {
    const r = await getFactoryPool().query("SELECT user_id AS id, display_name FROM core.user_profile WHERE ('u' || user_id) = $1 OR $1 = '' LIMIT 5", [q]);
    return r.rows.map((u) => ({ id: u.id, username: `u${u.id}`, full_name: u.display_name, department: null, is_active: true }));
  },
  async get(id) {
    return { id, username: `u${id}`, full_name: `Người ${id}`, department: null, is_active: id !== 13 };
  },
};

async function admin(): Promise<AuthzActor> {
  const a = await createUser("Quản trị");
  await grant(a, ["core.role.manage"]);
  return a;
}
const code = () => `R_${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

describe("roles and grants", () => {
  it("creates a role, grants it with a department scope and takes it back", async () => {
    const a = await admin();
    const dept = await createOrgUnit("OLIGO");
    const role = await withTransaction((tx) => createRole(tx, a, { code: code(), name: "Thủ kho Oligo", permissions: ["inv.stock.view", "inv.document.create"] }));
    const user = await createUser("Nhân viên");
    const g = await withTransaction((tx) => grantRole(tx, a, directory, { user_id: user.userId, role_id: role.id, scope_org_unit_id: dept }));
    await withTransaction(async (tx) => {
      expect(await hasFactoryPermission(tx, user, "inv.stock.view", dept)).toBe(true);
      expect(await hasFactoryPermission(tx, user, "inv.stock.view", await createOrgUnit("KIT"))).toBe(false);
    });
    await expect(withTransaction((tx) => grantRole(tx, a, directory, { user_id: user.userId, role_id: role.id, scope_org_unit_id: dept }))).rejects.toMatchObject({
      code: "ALREADY_GRANTED",
    });
    await expect(withTransaction((tx) => revokeRole(tx, a, g.id, ""))).rejects.toMatchObject({ code: "VALIDATION" });
    await withTransaction((tx) => revokeRole(tx, a, g.id, "Chuyển phòng"));
    await withTransaction(async (tx) => expect(await hasFactoryPermission(tx, user, "inv.stock.view", dept)).toBe(false));
    const audit = await getFactoryPool().query("SELECT action FROM core.audit_log WHERE entity_type = 'user_role' AND entity_id = $1 ORDER BY id", [g.id]);
    expect(audit.rows.map((r) => r.action)).toEqual(["grant", "revoke"]);
  });

  it("refuses self-grants, system-only permissions, inactive portal accounts and non-managers", async () => {
    const a = await admin();
    const role = await withTransaction((tx) => createRole(tx, a, { code: code(), name: "X", permissions: ["inv.stock.view"] }));
    await expect(withTransaction((tx) => grantRole(tx, a, directory, { user_id: a.userId, role_id: role.id }))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(withTransaction((tx) => createRole(tx, a, { code: code(), name: "Y", permissions: ["inv.lot.system"] }))).rejects.toThrow(/chỉ dành cho hệ thống/);
    await expect(withTransaction((tx) => grantRole(tx, a, directory, { user_id: 13, role_id: role.id }))).rejects.toThrow(/đang bị khóa/);
    const nobody = await createUser();
    await expect(withTransaction((tx) => createRole(tx, nobody, { code: code(), name: "Z", permissions: [] }))).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("changes a role's permissions with a reason and an old → new audit entry", async () => {
    const a = await admin();
    const role = await withTransaction((tx) => createRole(tx, a, { code: code(), name: "Đổi quyền", permissions: ["inv.stock.view"] }));
    await expect(withTransaction((tx) => updateRole(tx, a, role.id, { version: role.version, permissions: ["inv.stock.view", "inv.document.post"] }))).rejects.toMatchObject({
      code: "VALIDATION",
    });
    await withTransaction((tx) => updateRole(tx, a, role.id, { version: role.version, permissions: ["inv.document.post", "inv.stock.view"], reason: "Bổ sung ghi sổ" }));
    const audit = await getFactoryPool().query("SELECT changes, reason FROM core.audit_log WHERE entity_type = 'role' AND entity_id = $1 AND action = 'update'", [role.id]);
    expect(audit.rows[0]).toEqual({ changes: { permissions: [["inv.stock.view"], ["inv.document.post", "inv.stock.view"]] }, reason: "Bổ sung ghi sổ" });
    await expect(withTransaction((tx) => updateRole(tx, a, role.id, { version: role.version, name: "x", reason: "abc" }))).rejects.toMatchObject({ code: "STALE_VERSION" });
  });

  it("delegates a held role for a limited period only", async () => {
    const a = await admin();
    const role = await withTransaction((tx) => createRole(tx, a, { code: code(), name: "QA", permissions: ["inv.lot.hold"] }));
    const boss = await createUser("Trưởng QA");
    const deputy = await createUser("Phó QA");
    const now = Date.now();
    const period = { valid_from: new Date(now - 60_000).toISOString(), valid_to: new Date(now + 86_400_000).toISOString() };
    await expect(
      withTransaction((tx) => createDelegation(tx, boss, directory, { from_user_id: boss.userId, to_user_id: deputy.userId, role_id: role.id, reason: "Nghỉ phép", ...period }))
    ).rejects.toThrow(/không giữ vai trò/);
    await withTransaction((tx) => grantRole(tx, a, directory, { user_id: boss.userId, role_id: role.id }));
    await withTransaction((tx) => createDelegation(tx, boss, directory, { from_user_id: boss.userId, to_user_id: deputy.userId, role_id: role.id, reason: "Nghỉ phép", ...period }));
    await withTransaction(async (tx) => expect(await hasFactoryPermission(tx, deputy, "inv.lot.hold")).toBe(true));
    await expect(
      withTransaction((tx) =>
        createDelegation(tx, boss, directory, { from_user_id: boss.userId, to_user_id: deputy.userId, role_id: role.id, reason: "Dài", valid_from: period.valid_from, valid_to: new Date(now + 100 * 86_400_000).toISOString() })
      )
    ).rejects.toThrow(/tối đa 90 ngày/);
  });

  it("lists directory users with their grants", async () => {
    const a = await admin();
    const rows = await withTransaction((tx) => listUsersWithGrants(tx, a, directory, `u${a.userId}`));
    expect(rows.find((r) => r.id === a.userId)?.grants.length).toBeGreaterThan(0);
  });

  it("creates default roles once and never overwrites them", async () => {
    const first = await withTransaction(ensureDefaultRoles);
    const again = await withTransaction(ensureDefaultRoles);
    expect(first.length + again.length).toBeGreaterThan(0);
    expect(again).toEqual([]);
  });
});

describe("own PIN", () => {
  it("needs the login password first, then stores a strong PIN", async () => {
    const u = await createUser("Ký");
    const verifier = async (_id: number, pw: string) => pw === "đúng-mật-khẩu";
    await expect(authenticateSigner(u.userId, { method: "PASSWORD", secret: "sai" }, verifier)).rejects.toMatchObject({ code: "SIGNATURE_INVALID" });
    await authenticateSigner(u.userId, { method: "PASSWORD", secret: "đúng-mật-khẩu" }, verifier);
    await withTransaction((tx) => setOwnPin(tx, u, "583920"));
    await authenticateSigner(u.userId, { method: "PIN", secret: "583920" });
  });
});

describe("root administrator", () => {
  it("holds every grantable permission in every department, never a system-only one", async () => {
    const root = { ...(await createUser("Root")), isRootAdmin: true };
    const dept = await createOrgUnit("OLIGO");
    await withTransaction(async (tx) => {
      expect(await hasFactoryPermission(tx, root, "inv.lot.release")).toBe(true);
      expect(await hasFactoryPermission(tx, root, "purchase.pr.approve", dept)).toBe(true);
      expect(await hasFactoryPermission(tx, root, "inv.lot.system")).toBe(false);
      const { heldPermissions } = await import("../org");
      const held = await heldPermissions(tx, root);
      expect(held).toContain("qms.ncr.approve_bod");
      expect(held).not.toContain("inv.lot.system");
    });
  });

  it("grants roles to others but is still bound by separation of duties on a record", async () => {
    const root = { ...(await createUser("Root", "583920")), isRootAdmin: true };
    const role = await withTransaction((tx) => createRole(tx, root, { code: code(), name: "Thủ kho", permissions: ["inv.stock.view"] }));
    const staff = await createUser("Nhân viên");
    await withTransaction((tx) => grantRole(tx, root, directory, { user_id: staff.userId, role_id: role.id }));
    await withTransaction(async (tx) => expect(await hasFactoryPermission(tx, staff, "inv.stock.view")).toBe(true));

    const own = await withTransaction((tx) =>
      createRole(tx, root, { code: code(), name: "Bản nháp của root", permissions: [] })
    );
    expect(own.code).toBeTruthy();
    const { createSpecDraft, specMachine } = await import("../../qms/specs");
    const { makeItem, makeSite } = await import("../../inv/__tests__/fixtures");
    const { preAuthenticate, runTransition } = await import("../stateMachine");
    const site = await makeSite();
    const item = await makeItem(site);
    const draft = await withTransaction((tx) =>
      createSpecDraft(tx, root, { name: "TC", applies_to: "ITEM", item_id: item.id, parameters: [{ name: "a", value_type: "PASS_FAIL" }] })
    );
    const req = { id: draft.id, action: "approve", expectedVersion: draft.version, credential: { method: "PIN" as const, secret: "583920" } };
    await preAuthenticate(specMachine, "DRAFT", req, root);
    await expect(withTransaction((tx) => runTransition(tx, specMachine, root, req, { signerAuthenticated: true }))).rejects.toThrow(/khác người soạn/);
  });

  it("enforces scope honesty, cross-dept QA rights, per-user exclusions on inherited permissions, bulk toggles & reset", async () => {
    const a = await admin();
    const qaDept = (
      await getFactoryPool().query(
        "INSERT INTO core.org_unit (code, name, unit_type, module_key) VALUES ($1, 'Phòng QA Test', 'DEPARTMENT', 'QA') RETURNING id",
        [`QA-${Math.random().toString(36).slice(2, 8).toUpperCase()}`]
      )
    ).rows[0].id as string;
    const kitDept = (
      await getFactoryPool().query(
        "INSERT INTO core.org_unit (code, name, unit_type, module_key) VALUES ($1, 'Phòng Kit Test', 'DEPARTMENT', 'KIT') RETURNING id",
        [`KIT-${Math.random().toString(36).slice(2, 8).toUpperCase()}`]
      )
    ).rows[0].id as string;

    // A role containing both cross-dept QA permissions AND a Kit-only manufacturing permission, granted scoped to P-QA
    const qaRole = await withTransaction((tx) =>
      createRole(tx, a, {
        code: code(),
        name: "QA Scope Test",
        permissions: ["qms.qc.view", "kit.view", "kit.bom.approve", "kit.order.release", "kit.order.manage"],
      })
    );
    const qaUser1 = await createUser("QA Lead 1");
    const qaUser2 = await createUser("QA Lead 2");
    await withTransaction((tx) => grantRole(tx, a, directory, { user_id: qaUser1.userId, role_id: qaRole.id, scope_org_unit_id: qaDept }));
    await withTransaction((tx) => grantRole(tx, a, directory, { user_id: qaUser2.userId, role_id: qaRole.id, scope_org_unit_id: qaDept }));

    // 1. Cross-dept QA perms work on P-KIT, while unreachable kit.order.manage is false & hidden from heldPermissions
    await withTransaction(async (tx) => {
      expect(await hasFactoryPermission(tx, qaUser1, "kit.view", kitDept)).toBe(true);
      expect(await hasFactoryPermission(tx, qaUser1, "kit.bom.approve", kitDept)).toBe(true);
      expect(await hasFactoryPermission(tx, qaUser1, "kit.order.release", kitDept)).toBe(true);
      expect(await hasFactoryPermission(tx, qaUser1, "kit.order.manage", kitDept)).toBe(false);
      const held1 = await heldPermissions(tx, qaUser1);
      expect(held1).toContain("kit.view");
      expect(held1).toContain("kit.order.release");
      expect(held1).not.toContain("kit.order.manage");
    });

    // 2. Uncheck inherited permission `kit.order.release` for qaUser1 ONLY -> qaUser1 loses it, qaUser2 still keeps it
    await withTransaction((tx) =>
      setUserCustomPermission(tx, a, directory, qaUser1.userId, {
        permission_code: "kit.order.release",
        enabled: false,
        reason: "Tắt lẻ quyền giải phóng lô trên tài khoản QA 1",
      })
    );
    await withTransaction(async (tx) => {
      expect(await hasFactoryPermission(tx, qaUser1, "kit.order.release", kitDept)).toBe(false);
      expect(await hasFactoryPermission(tx, qaUser2, "kit.order.release", kitDept)).toBe(true);
      const held1 = await heldPermissions(tx, qaUser1);
      expect(held1).not.toContain("kit.order.release");
      const users = await listUsersWithGrants(tx, a, directory, `u${qaUser1.userId}`);
      expect(users.find((u) => u.id === qaUser1.userId)?.excluded_permissions).toContain("kit.order.release");
    });

    // 3. Check `kit.order.manage` individually for qaUser1 -> now actually grants cross-dept access on P-KIT!
    await withTransaction((tx) =>
      setUserCustomPermission(tx, a, directory, qaUser1.userId, {
        permission_code: "kit.order.manage",
        enabled: true,
        reason: "Cấp bổ sung quyền lập lệnh SX Kit cho QA 1",
      })
    );
    await withTransaction(async (tx) => {
      expect(await hasFactoryPermission(tx, qaUser1, "kit.order.manage", kitDept)).toBe(true);
      expect(await hasFactoryPermission(tx, qaUser2, "kit.order.manage", kitDept)).toBe(false);
    });

    // 4. Bulk group disable then reset_overrides restores base role cleanly with audit trail
    await withTransaction((tx) =>
      setUserCustomPermission(tx, a, directory, qaUser1.userId, {
        permission_codes: ["kit.view", "kit.bom.approve"],
        enabled: false,
        reason: "Bỏ chọn nhóm quyền Kit",
      })
    );
    await withTransaction(async (tx) => {
      expect(await hasFactoryPermission(tx, qaUser1, "kit.view", kitDept)).toBe(false);
      expect(await hasFactoryPermission(tx, qaUser1, "kit.bom.approve", kitDept)).toBe(false);
    });

    await withTransaction((tx) =>
      setUserCustomPermission(tx, a, directory, qaUser1.userId, {
        reset_overrides: true,
        reason: "Khôi phục vai trò gốc",
      })
    );
    await withTransaction(async (tx) => {
      expect(await hasFactoryPermission(tx, qaUser1, "kit.view", kitDept)).toBe(true);
      expect(await hasFactoryPermission(tx, qaUser1, "kit.order.release", kitDept)).toBe(true);
      expect(await hasFactoryPermission(tx, qaUser1, "kit.order.manage", kitDept)).toBe(false);
    });

    const auditActions = (
      await getFactoryPool().query(
        "SELECT action FROM core.audit_log WHERE entity_type = 'user_custom_permission' AND entity_id = $1 ORDER BY id",
        [String(qaUser1.userId)]
      )
    ).rows.map((r) => r.action);
    expect(auditActions).toEqual(["revoke_permission", "grant_permission", "revoke_permission", "reset_overrides"]);

    // 5. Locking implicit `intake.order.view` removes it from heldPermissions & blocks permission checks, until reset
    await withTransaction(async (tx) => {
      expect(await heldPermissions(tx, qaUser1)).toContain("intake.order.view");
    });
    await withTransaction((tx) =>
      setUserCustomPermission(tx, a, directory, qaUser1.userId, {
        permission_codes: ["intake.order.view"],
        enabled: false,
        reason: "Khóa tab Đơn Nội Bộ",
      })
    );
    await withTransaction(async (tx) => {
      expect(await heldPermissions(tx, qaUser1)).not.toContain("intake.order.view");
      expect(await hasFactoryPermission(tx, qaUser1, "intake.order.view")).toBe(false);
    });
    await withTransaction((tx) =>
      setUserCustomPermission(tx, a, directory, qaUser1.userId, {
        reset_overrides: true,
        reason: "Mở lại mặc định",
      })
    );
    await withTransaction(async (tx) => {
      expect(await heldPermissions(tx, qaUser1)).toContain("intake.order.view");
    });
  });
});
