import { afterAll, describe, expect, it } from "vitest";
import { closeFactoryPool, getFactoryPool, isRetryableTxError, onCommit, withTransaction } from "../db";

afterAll(closeFactoryPool);

describe("onCommit", () => {
  it("runs the hook only after the transaction commits", async () => {
    const seen: string[] = [];
    await withTransaction(async (tx) => {
      onCommit(tx, () => seen.push("hook"));
      seen.push("body");
    });
    expect(seen).toEqual(["body", "hook"]);
  });

  it("drops the hook when the transaction rolls back", async () => {
    let ran = false;
    await expect(
      withTransaction(async (tx) => {
        onCommit(tx, () => {
          ran = true;
        });
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
    expect(ran).toBe(false);
  });

  it("runs at once for a client outside withTransaction", async () => {
    const client = await getFactoryPool().connect();
    try {
      let ran = false;
      onCommit(client, () => {
        ran = true;
      });
      expect(ran).toBe(true);
    } finally {
      client.release();
    }
  });
});

describe("isRetryableTxError", () => {
  it("retries deadlocks and serialization failures only", () => {
    expect(isRetryableTxError({ code: "40P01" })).toBe(true);
    expect(isRetryableTxError({ code: "40001" })).toBe(true);
    expect(isRetryableTxError({ code: "23505" })).toBe(false);
    expect(isRetryableTxError(new Error("x"))).toBe(false);
  });
});
