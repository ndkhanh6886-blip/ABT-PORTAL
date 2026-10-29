import { afterAll, describe, expect, it } from "vitest";
import "../../__tests__/helpers";
import { closeFactoryPool, getFactoryPool, withTransaction } from "../db";
import { compilePattern, nextNumber, validatePattern } from "../numbering";

afterAll(closeFactoryPool);

describe("compilePattern", () => {
  const date = new Date("2026-10-29T03:00:00Z");

  it("renders date tokens and pads the counter", () => {
    const p = compilePattern("DN{YY}{MM}-{NNNN}", date);
    expect(p.scopeKey).toBe("DN2610-#");
    expect(p.format(7)).toBe("DN2610-0007");
    expect(p.format(12345)).toBe("DN2610-12345"); // grows, never wraps
  });

  it("uses the Vietnamese business date, not UTC", () => {
    // 31/10 18:30 UTC is already 01/11 in Hà Nội
    const p = compilePattern("R{YY}{MM}{DD}{NN}", new Date("2026-10-31T18:30:00Z"));
    expect(p.format(1)).toBe("R26110101");
  });

  it("puts parameters into the code and the counter scope", () => {
    const p = compilePattern("{MODEL}-{YY}{NNNN}", date, { MODEL: "qpcr48" });
    expect(p.scopeKey).toBe("QPCR48-26#");
    expect(p.format(31)).toBe("QPCR48-260031");
  });

  it("rejects missing or unsafe parameters", () => {
    expect(() => compilePattern("{MODEL}-{NNNN}", date)).toThrow(/Thiếu giá trị MODEL/);
    expect(() => compilePattern("{MODEL}-{NNNN}", date, { MODEL: "A/B" })).toThrow(/chỉ được gồm/);
  });

  it("requires exactly one counter", () => {
    expect(() => validatePattern("DN{YY}")).toThrow(/đúng một bộ đếm/);
    expect(() => validatePattern("{NN}-{NNN}")).toThrow(/đúng một bộ đếm/);
    expect(() => validatePattern("DN{yy}{NNN}")).toThrow(/ngoặc/);
  });
});

describe("nextNumber", () => {
  it("never hands out the same number to concurrent requests", async () => {
    const codes = await Promise.all(
      Array.from({ length: 40 }, () => withTransaction((tx) => nextNumber(tx, "INTERNAL_ORDER")))
    );
    expect(new Set(codes).size).toBe(40);
    const counters = codes.map((c) => Number(c.split("-")[1])).sort((a, b) => a - b);
    expect(counters[counters.length - 1] - counters[0]).toBe(39); // consecutive, no gaps
  });

  it("does not consume a number when the transaction rolls back", async () => {
    const first = await withTransaction((tx) => nextNumber(tx, "NCR"));
    await expect(
      withTransaction(async (tx) => {
        await nextNumber(tx, "NCR");
        throw new Error("rollback");
      })
    ).rejects.toThrow("rollback");
    const second = await withTransaction((tx) => nextNumber(tx, "NCR"));
    expect(Number(second.slice(-4))).toBe(Number(first.slice(-4)) + 1);
  });

  it("restarts per period and counts serials per model", async () => {
    const oct = await withTransaction((tx) => nextNumber(tx, "LOT_KIT", { date: new Date("2025-10-15T05:00:00Z") }));
    const nov = await withTransaction((tx) => nextNumber(tx, "LOT_KIT", { date: new Date("2025-11-15T05:00:00Z") }));
    expect(oct).toBe("K2510001");
    expect(nov).toBe("K2511001");
    const a = await withTransaction((tx) => nextNumber(tx, "DEVICE_SERIAL", { params: { MODEL: "TESTA" } }));
    const b = await withTransaction((tx) => nextNumber(tx, "DEVICE_SERIAL", { params: { MODEL: "TESTB" } }));
    expect(a.endsWith("0001")).toBe(true);
    expect(b.endsWith("0001")).toBe(true);
  });

  it("fails clearly for an unknown sequence", async () => {
    await expect(withTransaction((tx) => nextNumber(tx, "NOPE"))).rejects.toThrow(/Không tìm thấy cấu hình mã số/);
    expect((await getFactoryPool().query("SELECT 1")).rowCount).toBe(1);
  });
});
