import { afterAll, describe, expect, it } from "vitest";
import "../../__tests__/helpers";
import { closeFactoryPool, withTransaction } from "../db";
import { withIdempotency } from "../idempotency";
import { nextNumber } from "../numbering";

afterAll(closeFactoryPool);

const create = (key: string, body: unknown) =>
  withTransaction((tx) =>
    withIdempotency(tx, { userId: 1, endpoint: "test.create", key, body }, async () => ({ code: await nextNumber(tx, "DEVIATION") }))
  );

describe("withIdempotency", () => {
  it("returns the first result when the same request is sent again", async () => {
    const key = `k-${Date.now()}-a`;
    const first = await create(key, { title: "A" });
    const again = await create(key, { title: "A" });
    expect(first.replayed).toBe(false);
    expect(again.replayed).toBe(true);
    expect(again.result).toEqual(first.result);
  });

  it("creates one document for two simultaneous clicks", async () => {
    const key = `k-${Date.now()}-b`;
    const [a, b] = await Promise.all([create(key, { title: "B" }), create(key, { title: "B" })]);
    expect(a.result).toEqual(b.result);
    expect([a.replayed, b.replayed].sort()).toEqual([false, true]);
  });

  it("refuses a key reused for different content and a missing key", async () => {
    const key = `k-${Date.now()}-c`;
    await create(key, { title: "C" });
    await expect(create(key, { title: "khác" })).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
    await expect(create("", { title: "C" })).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REQUIRED" });
  });
});
