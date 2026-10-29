import { afterAll, describe, expect, it } from "vitest";
import crypto from "crypto";
import { createUser, grant } from "../../__tests__/helpers";
import { SYSTEM_ACTOR } from "../../core/authz";
import { closeFactoryPool, getFactoryPool, withTransaction } from "../../core/db";
import { runDailyJobs } from "../../core/worker";
import { preAuthenticate, runTransition } from "../../core/stateMachine";
import { lotMachine, QC_PENDING_GUARD, registerLotQualityGuards } from "../lots";
import { reserve, releaseDemandReservations } from "../reservations";
import { issue, makeItem, makeSite, stockedLot } from "./fixtures";
import "../jobs";

afterAll(closeFactoryPool);

const demand = () => ({ demand_entity_type: "PRODUCTION_ORDER" as const, demand_entity_id: crypto.randomUUID() });

describe("reservations", () => {
  it("reserves by FEFO and protects reserved stock from other issues", async () => {
    const site = await makeSite();
    const item = await makeItem(site);
    const late = await stockedLot(site, item.id, 10, "2031-01-01");
    const early = await stockedLot(site, item.id, 10, "2030-01-01");
    const res = await withTransaction((tx) => reserve(tx, site.admin, { item_id: item.id, qty_base: 12, warehouse_ids: [site.warehouse], ...demand() }));
    expect(res.map((r) => [r.lot_id, r.qty_base])).toEqual([[early.id, 10], [late.id, 2]]);
    // 8 left on the late lot are free, 10 on the early lot are all reserved
    await expect(issue(site, site.admin, item.id, early.id, 1)).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK" });
    // issuing against the reservation consumes it
    const r0 = res[0];
    await issue(site, site.admin, item.id, early.id, 10, { reservation_id: r0.reservation_id });
    const row = (await getFactoryPool().query("SELECT status FROM inv.reservation WHERE id = $1", [r0.reservation_id])).rows[0];
    expect(row.status).toBe("CONSUMED");
  });

  it("is all or nothing and safe under concurrency", async () => {
    const site = await makeSite();
    const item = await makeItem(site);
    await stockedLot(site, item.id, 10, null);
    await expect(
      withTransaction((tx) => reserve(tx, site.admin, { item_id: item.id, qty_base: 11, warehouse_ids: [site.warehouse], ...demand() }))
    ).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK" });
    const race = await Promise.allSettled(
      [1, 2].map(() => withTransaction((tx) => reserve(tx, site.admin, { item_id: item.id, qty_base: 7, warehouse_ids: [site.warehouse], ...demand() })))
    );
    expect(race.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  it("uses only QA-approved substitutes, by priority and ratio", async () => {
    const site = await makeSite();
    const main = await makeItem(site);
    const sub = await makeItem(site);
    await stockedLot(site, main.id, 4, null);
    const subLot = await stockedLot(site, sub.id, 100, null);
    await getFactoryPool().query("INSERT INTO master.item_substitute (item_id, substitute_item_id, ratio) VALUES ($1, $2, 2)", [main.id, sub.id]);
    const req = { item_id: main.id, qty_base: 10, warehouse_ids: [site.warehouse], allow_substitutes: true, ...demand() };
    await expect(withTransaction((tx) => reserve(tx, site.admin, req))).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK" });
    await getFactoryPool().query("UPDATE master.item_substitute SET change_request_id = $2 WHERE item_id = $1", [main.id, crypto.randomUUID()]);
    const res = await withTransaction((tx) => reserve(tx, site.admin, req));
    expect(res.map((r) => [r.lot_id === subLot.id, r.qty_base])).toEqual([[false, 4], [true, 12]]);
  });

  it("releases reservations when the demand is cancelled", async () => {
    const site = await makeSite();
    const item = await makeItem(site);
    await stockedLot(site, item.id, 10, null);
    const d = demand();
    await withTransaction((tx) => reserve(tx, site.admin, { item_id: item.id, qty_base: 10, warehouse_ids: [site.warehouse], ...d }));
    const n = await withTransaction((tx) => releaseDemandReservations(tx, site.admin, d.demand_entity_type, d.demand_entity_id));
    expect(n).toBe(1);
    await withTransaction((tx) => reserve(tx, site.admin, { item_id: item.id, qty_base: 10, warehouse_ids: [site.warehouse], ...demand() }));
  });
});

describe("lot quality status", () => {
  it("holding a lot frees its reservations and blocks allocation", async () => {
    const site = await makeSite();
    const item = await makeItem(site);
    const lot = await stockedLot(site, item.id, 10, null);
    await withTransaction((tx) => reserve(tx, site.admin, { item_id: item.id, qty_base: 5, warehouse_ids: [site.warehouse], ...demand() }));
    const current = (await getFactoryPool().query("SELECT version FROM inv.lot WHERE id = $1", [lot.id])).rows[0];
    await withTransaction((tx) => runTransition(tx, lotMachine, site.admin, { id: lot.id, action: "hold", expectedVersion: current.version, reason: "Nghi nhiễm" }));
    const active = await getFactoryPool().query("SELECT count(*)::int AS n FROM inv.reservation WHERE lot_id = $1 AND status = 'ACTIVE'", [lot.id]);
    expect(active.rows[0].n).toBe(0);
    await expect(
      withTransaction((tx) => reserve(tx, site.admin, { item_id: item.id, qty_base: 1, warehouse_ids: [site.warehouse], ...demand() }))
    ).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK" });
  });

  it("never releases a lot without QC evidence, and the releaser must sign", async () => {
    const site = await makeSite();
    const item = await makeItem(site, { receipt_qc_required: true });
    const lot = await stockedLot(site, item.id, 10, null, { release: false });
    await expect(
      withTransaction((tx) => runTransition(tx, lotMachine, SYSTEM_ACTOR, { id: lot.id, action: "skip_qc", expectedVersion: lot.version }))
    ).rejects.toMatchObject({ code: "GUARD_FAILED" });
    const sampled = await withTransaction((tx) => runTransition(tx, lotMachine, site.admin, { id: lot.id, action: "sample", expectedVersion: lot.version }));
    const qa = await createUser("QA", "583920");
    await grant(qa, ["inv.lot.release"]);
    const req = { id: lot.id, action: "release", expectedVersion: sampled.version, credential: { method: "PIN" as const, secret: "583920" } };
    await preAuthenticate(lotMachine, sampled.status, req, qa);
    await expect(withTransaction((tx) => runTransition(tx, lotMachine, qa, req, { signerAuthenticated: true }))).rejects.toThrow(/Chưa có phiếu QC đạt/);
    // once QMS registers its checks, release goes through with a RELEASED signature
    registerLotQualityGuards({ release: [{ code: "QC", message: "QC", check: () => true }], unhold: [] });
    try {
      const released = await withTransaction((tx) => runTransition(tx, lotMachine, qa, req, { signerAuthenticated: true }));
      expect(released.status).toBe("RELEASED");
      const sig = await getFactoryPool().query("SELECT meaning FROM core.e_signature WHERE entity_id = $1", [lot.id]);
      expect(sig.rows).toEqual([{ meaning: "RELEASED" }]);
    } finally {
      registerLotQualityGuards({ release: [QC_PENDING_GUARD], unhold: [] });
    }
  });

  it("a person cannot run system-only transitions", async () => {
    const site = await makeSite();
    const item = await makeItem(site);
    const lot = await stockedLot(site, item.id, 1, null, { release: false });
    await expect(
      withTransaction((tx) => runTransition(tx, lotMachine, site.admin, { id: lot.id, action: "skip_qc", expectedVersion: lot.version }))
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("the daily job expires released lots once per day", async () => {
    const site = await makeSite();
    const item = await makeItem(site);
    const lot = await stockedLot(site, item.id, 5, "2030-01-01");
    const day = "2030-01-02";
    const first = await runDailyJobs(day);
    expect((first["inv.expire_lots"] as any).expired).toBeGreaterThanOrEqual(1);
    expect((await getFactoryPool().query("SELECT status FROM inv.lot WHERE id = $1", [lot.id])).rows[0].status).toBe("EXPIRED");
    expect((await runDailyJobs(day))["inv.expire_lots"]).toBe("đã chạy hôm nay");
  });
});
