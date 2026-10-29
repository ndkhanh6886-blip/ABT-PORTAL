import { afterAll, describe, expect, it } from "vitest";
import { createOrgUnit, createUser, grant } from "../../__tests__/helpers";
import { closeFactoryPool, getFactoryPool, withTransaction } from "../db";
import type { AuthzActor } from "../authz";
import { defineMachine, listAllowedActions, preAuthenticate, runTransition, type TransitionRequest } from "../stateMachine";

afterAll(closeFactoryPool);

type Status = "DRAFT" | "SUBMITTED" | "APPROVED" | "CANCELLED";
interface Doc {
  id: string;
  status: Status;
  version: number;
  owner_org_unit_id: string | null;
  amount: string;
}

const machine = defineMachine<Status, Doc>({
  entityType: "test_doc",
  table: "test_fixture.doc",
  states: ["DRAFT", "SUBMITTED", "APPROVED", "CANCELLED"],
  terminal: ["APPROVED", "CANCELLED"],
  scopeOf: (row) => row.owner_org_unit_id,
  transitions: [
    {
      action: "submit",
      from: "DRAFT",
      to: "SUBMITTED",
      permission: "test.doc.submit",
      guards: [{ code: "AMOUNT", message: "Nhập số tiền lớn hơn 0.", check: ({ row }) => Number(row.amount) > 0 }],
    },
    { action: "approve", from: "SUBMITTED", to: "APPROVED", permission: "test.doc.approve", signature: "APPROVED" },
    { action: "cancel", from: ["DRAFT", "SUBMITTED"], to: "CANCELLED", permission: "test.doc.cancel", reasonRequired: true },
  ],
});

async function newDoc(amount = 100, orgUnit: string | null = null): Promise<Doc> {
  return (
    await getFactoryPool().query("INSERT INTO test_fixture.doc (status, amount, owner_org_unit_id) VALUES ('DRAFT', $1, $2) RETURNING *", [
      amount,
      orgUnit,
    ])
  ).rows[0];
}

/** What an API endpoint does: verify the signer first, then run the transition in its own transaction. */
async function act(actor: AuthzActor, doc: Doc, req: Omit<TransitionRequest, "id" | "expectedVersion">, version = doc.version) {
  const full = { ...req, id: doc.id, expectedVersion: version };
  await preAuthenticate(machine, doc.status, full, actor);
  return withTransaction((tx) => runTransition(tx, machine, actor, full, { signerAuthenticated: true }));
}

describe("defineMachine", () => {
  it("rejects unknown states, duplicates and moves out of a terminal state", () => {
    const base = { entityType: "x", table: "a.b", states: ["A", "B"] as const, terminal: ["B"] as const };
    expect(() => defineMachine({ ...base, transitions: [{ action: "go", from: "A", to: "Z" as any, permission: "p" }] } as any)).toThrow(/lạ/);
    expect(() =>
      defineMachine({ ...base, transitions: [{ action: "go", from: "A", to: "B", permission: "p" }, { action: "go", from: "A", to: "B", permission: "p" }] } as any)
    ).toThrow(/trùng/);
    expect(() => defineMachine({ ...base, transitions: [{ action: "back", from: "B", to: "A", permission: "p" }] } as any)).toThrow(/kết thúc/);
  });
});

describe("runTransition", () => {
  it("runs a valid path and writes audit, outbox and signature", async () => {
    const maker = await createUser("Người lập");
    const approver = await createUser("Người duyệt", "583920");
    await grant(maker, ["test.doc.submit"]);
    await grant(approver, ["test.doc.approve"]);
    const doc = await newDoc();

    const submitted = await act(maker, doc, { action: "submit" });
    expect(submitted.status).toBe("SUBMITTED");
    const approved = await act(approver, submitted, { action: "approve", credential: { method: "PIN", secret: "583920" } });
    expect(approved.status).toBe("APPROVED");
    expect(approved.version).toBe(2);

    const db = getFactoryPool();
    const audit = await db.query("SELECT action, user_id, changes FROM core.audit_log WHERE entity_id = $1 ORDER BY id", [doc.id]);
    expect(audit.rows.map((r) => r.action)).toEqual(["submit", "approve"]);
    expect(audit.rows[1].changes).toEqual({ status: ["SUBMITTED", "APPROVED"] });
    const sig = await db.query("SELECT meaning, signer_id, signer_name, entity_version FROM core.e_signature WHERE entity_id = $1", [doc.id]);
    expect(sig.rows).toEqual([{ meaning: "APPROVED", signer_id: approver.userId, signer_name: "Người duyệt", entity_version: 2 }]);
    const events = await db.query("SELECT event_type FROM core.outbox_event WHERE payload->>'id' = $1 ORDER BY created_at", [doc.id]);
    expect(events.rows.map((r) => r.event_type)).toEqual(["test_doc.submit", "test_doc.approve"]);
  });

  it("refuses a transition that is not declared", async () => {
    const u = await createUser();
    await grant(u, ["test.doc.approve"]);
    const doc = await newDoc();
    await expect(act(u, doc, { action: "approve", credential: { method: "PIN", secret: "x" } })).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });

  it("checks permissions in the backend, including the org unit scope", async () => {
    const dept = await createOrgUnit("OLIGO");
    const team = await createOrgUnit("OLIGO-SYN", dept);
    const other = await createOrgUnit("KIT");
    const noRole = await createUser();
    await expect(act(noRole, await newDoc(), { action: "submit" })).rejects.toMatchObject({ code: "FORBIDDEN" });

    const scoped = await createUser();
    await grant(scoped, ["test.doc.submit"], dept);
    expect((await act(scoped, await newDoc(100, team), { action: "submit" })).status).toBe("SUBMITTED"); // sub-unit inherits
    await expect(act(scoped, await newDoc(100, other), { action: "submit" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(act(scoped, await newDoc(100, null), { action: "submit" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("reports failed guards with what to do", async () => {
    const u = await createUser();
    await grant(u, ["test.doc.submit"]);
    await expect(act(u, await newDoc(0), { action: "submit" })).rejects.toMatchObject({
      code: "GUARD_FAILED",
      details: [{ code: "AMOUNT", message: "Nhập số tiền lớn hơn 0." }],
    });
  });

  it("requires a reason where declared", async () => {
    const u = await createUser();
    await grant(u, ["test.doc.cancel"]);
    const doc = await newDoc();
    await expect(act(u, doc, { action: "cancel", reason: "  " })).rejects.toMatchObject({ code: "REASON_REQUIRED" });
    const cancelled = await act(u, doc, { action: "cancel", reason: "Lập nhầm" });
    expect(cancelled.status).toBe("CANCELLED");
  });

  it("rejects a stale version (optimistic lock)", async () => {
    const u = await createUser();
    await grant(u, ["test.doc.submit", "test.doc.cancel"]);
    const doc = await newDoc();
    await act(u, doc, { action: "submit" });
    await expect(act(u, doc, { action: "cancel", reason: "x" }, 0)).rejects.toMatchObject({ code: "STALE_VERSION" });
  });

  it("does not change anything when the signature is missing or wrong", async () => {
    const maker = await createUser();
    const approver = await createUser("Duyệt", "583920");
    await grant(maker, ["test.doc.submit"]);
    await grant(approver, ["test.doc.approve"]);
    const submitted = await act(maker, await newDoc(), { action: "submit" });
    await expect(act(approver, submitted, { action: "approve" })).rejects.toMatchObject({ code: "SIGNATURE_REQUIRED" });
    await expect(act(approver, submitted, { action: "approve", credential: { method: "PIN", secret: "000001" } })).rejects.toMatchObject({
      code: "SIGNATURE_INVALID",
    });
    await expect(
      withTransaction((tx) => runTransition(tx, machine, approver, { id: submitted.id, action: "approve", expectedVersion: submitted.version }))
    ).rejects.toMatchObject({ code: "SIGNATURE_REQUIRED" });
    const row = (await getFactoryPool().query("SELECT status FROM test_fixture.doc WHERE id = $1", [submitted.id])).rows[0];
    expect(row.status).toBe("SUBMITTED");
  });

  it("lists only the actions the user may run, with blocking guards", async () => {
    const u = await createUser();
    await grant(u, ["test.doc.submit"]);
    const doc = await newDoc(0);
    const actions = await withTransaction((tx) => listAllowedActions(tx, machine, u, doc));
    expect(actions).toEqual([{ action: "submit", to: "SUBMITTED", signature: undefined, reasonRequired: false, blockedBy: ["Nhập số tiền lớn hơn 0."] }]);
  });
});

describe("append-only records", () => {
  it("rejects UPDATE and DELETE on audit_log and e_signature", async () => {
    const db = getFactoryPool();
    await expect(db.query("UPDATE core.audit_log SET reason = 'sửa'")).rejects.toThrow(/chỉ cho phép ghi thêm/);
    await expect(db.query("DELETE FROM core.audit_log")).rejects.toThrow(/chỉ cho phép ghi thêm/);
    await expect(db.query("DELETE FROM core.e_signature")).rejects.toThrow(/chỉ cho phép ghi thêm/);
  });
});
