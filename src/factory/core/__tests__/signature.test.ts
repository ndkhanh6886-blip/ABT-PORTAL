import { afterAll, describe, expect, it } from "vitest";
import { createUser } from "../../__tests__/helpers";
import { closeFactoryPool, getFactoryPool, withTransaction } from "../db";
import { authenticateSigner, canonicalJson, isSignatureValid, recordHash, setPin } from "../signature";

afterAll(closeFactoryPool);

describe("record hash", () => {
  it("does not depend on key order", () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: null } })).toBe(canonicalJson({ a: { c: null, d: [1, { x: 1, y: 2 }] }, b: 1 }));
  });

  it("ignores version bookkeeping but not content", () => {
    const row = { id: "1", status: "APPROVED", qty: "10.000000", version: 3, updated_at: new Date() };
    const h = recordHash(row);
    expect(isSignatureValid(h, { ...row, version: 4, updated_at: new Date(0) })).toBe(true);
    expect(isSignatureValid(h, { ...row, qty: "11.000000" })).toBe(false);
  });
});

describe("PIN", () => {
  it("rejects weak PINs", async () => {
    const u = await createUser();
    for (const pin of ["12345", "111111", "123456", "987654", "12a456"]) {
      await expect(withTransaction((tx) => setPin(tx, u.userId, pin))).rejects.toThrow();
    }
    await withTransaction((tx) => setPin(tx, u.userId, "583920"));
  });

  it("counts wrong PINs and locks after the configured number", async () => {
    const u = await createUser("Ký thử", "583920");
    await authenticateSigner(u.userId, { method: "PIN", secret: "583920" });
    for (let i = 0; i < 4; i++) {
      await expect(authenticateSigner(u.userId, { method: "PIN", secret: "000001" })).rejects.toMatchObject({ code: "SIGNATURE_INVALID" });
    }
    const before = await getFactoryPool().query("SELECT pin_failed_attempts FROM core.user_profile WHERE user_id = $1", [u.userId]);
    expect(before.rows[0].pin_failed_attempts).toBe(4);
    await expect(authenticateSigner(u.userId, { method: "PIN", secret: "000001" })).rejects.toMatchObject({ code: "SIGNATURE_INVALID" });
    // locked now, even with the right PIN
    await expect(authenticateSigner(u.userId, { method: "PIN", secret: "583920" })).rejects.toMatchObject({ code: "SIGNATURE_LOCKED" });
  });

  it("asks to set a PIN first", async () => {
    const u = await createUser();
    await expect(authenticateSigner(u.userId, { method: "PIN", secret: "583920" })).rejects.toMatchObject({ code: "PIN_NOT_SET" });
  });
});
