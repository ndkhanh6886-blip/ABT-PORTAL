import { describe, expect, it } from "vitest";
import { allocate, sortFefo, type Candidate } from "../allocation";

const c = (id: string, available: number, expiry: string | null, received = "2026-01-01", lot = id): Candidate => ({
  balance_id: id,
  item_id: "i",
  lot_id: lot,
  lot_code: lot,
  container_id: null,
  location_id: "loc",
  available,
  expiry_date: expiry,
  received_date: received,
});

describe("FEFO → FIFO", () => {
  it("orders by earliest expiry, no-expiry last, then earliest receipt", () => {
    const order = sortFefo([
      c("none", 5, null),
      c("late", 5, "2027-06-01"),
      c("early-newer", 5, "2026-12-01", "2026-03-01"),
      c("early-older", 5, "2026-12-01", "2026-02-01"),
    ]).map((x) => x.balance_id);
    expect(order).toEqual(["early-older", "early-newer", "late", "none"]);
  });

  it("splits a demand over several lots and reports the shortfall", () => {
    const r = allocate([c("a", 3, "2026-12-01"), c("b", 4, "2027-01-01"), c("z", 0, "2026-01-01")], 5);
    expect(r.picks.map((p) => [p.candidate.balance_id, p.qty])).toEqual([["a", 3], ["b", 2]]);
    expect(r.shortfall).toBe(0);
    expect(allocate([c("a", 3, null)], 4.5).shortfall).toBe(1.5);
  });

  it("keeps decimal quantities exact to 6 places", () => {
    const r = allocate([c("a", 0.1, null), c("b", 0.2, null)], 0.3);
    expect(r.shortfall).toBe(0);
    expect(r.picks.map((p) => p.qty)).toEqual([0.1, 0.2]);
  });

  it("refuses a non-positive demand", () => {
    expect(() => allocate([], 0)).toThrow();
  });
});
