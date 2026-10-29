import { afterAll, describe, expect, it } from "vitest";
import { createOrgUnit, createUser, grant } from "../../__tests__/helpers";
import { closeFactoryPool, getFactoryPool, withTransaction } from "../../core/db";
import { runTransition } from "../../core/stateMachine";
import { createStockDocument, postStockDocument, stockDocumentMachine } from "../documents";
import { createLot } from "../lots";
import { findBalanceMismatches, findReservationMismatches } from "../reconcile";
import { issue, makeItem, makeSite, stockedLot } from "./fixtures";

afterAll(closeFactoryPool);

async function balance(itemId: string, lotId: string | null, locationId: string) {
  const r = await getFactoryPool().query(
    "SELECT qty_on_hand::float AS on_hand, qty_reserved::float AS reserved FROM inv.stock_balance WHERE item_id = $1 AND lot_id IS NOT DISTINCT FROM $2 AND location_id = $3",
    [itemId, lotId, locationId]
  );
  return r.rows[0] ?? { on_hand: 0, reserved: 0 };
}

describe("posting stock documents", () => {
  it("keeps balance equal to the ledger through receipt, put-away and issue", async () => {
    const site = await makeSite();
    const item = await makeItem(site);
    const lot = await stockedLot(site, item.id, 100, "2030-01-01");
    expect(await balance(item.id, lot.id, site.quarantine)).toMatchObject({ on_hand: 0 });
    expect(await balance(item.id, lot.id, site.shelf)).toMatchObject({ on_hand: 100 });
    await issue(site, site.admin, item.id, lot.id, 30);
    expect(await balance(item.id, lot.id, site.shelf)).toMatchObject({ on_hand: 70 });
    const ledger = await getFactoryPool().query("SELECT sum(qty_delta_base)::float AS s FROM inv.stock_ledger WHERE lot_id = $1", [lot.id]);
    expect(ledger.rows[0].s).toBe(70);
    await withTransaction(async (tx) => {
      expect(await findBalanceMismatches(tx)).toEqual([]);
      expect(await findReservationMismatches(tx)).toEqual([]);
    });
  });

  it("converts units to the base unit", async () => {
    const site = await makeSite();
    const item = await makeItem(site);
    const lot = await stockedLot(site, item.id, 5000, null);
    await withTransaction(async (tx) => {
      const doc = await createStockDocument(tx, site.admin, {
        doc_type: "ISSUE",
        reason_code: "PRODUCTION",
        warehouse_id: site.warehouse,
        lines: [{ item_id: item.id, lot_id: lot.id, from_location_id: site.shelf, qty: 1.5, uom: "mL" }],
      });
      await postStockDocument(tx, site.admin, doc.id, doc.version);
    });
    expect((await balance(item.id, lot.id, site.shelf)).on_hand).toBe(3500);
    await expect(
      withTransaction((tx) =>
        createStockDocument(tx, site.admin, {
          doc_type: "ISSUE",
          reason_code: "PRODUCTION",
          warehouse_id: site.warehouse,
          lines: [{ item_id: item.id, lot_id: lot.id, from_location_id: site.shelf, qty: 1, uom: "g" }],
        })
      )
    ).rejects.toMatchObject({ code: "NO_UOM_CONVERSION" });
  });

  it("never lets stock go negative and leaves no trace of the failed document", async () => {
    const site = await makeSite();
    const item = await makeItem(site);
    const lot = await stockedLot(site, item.id, 10, null);
    await expect(issue(site, site.admin, item.id, lot.id, 11)).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK" });
    expect((await balance(item.id, lot.id, site.shelf)).on_hand).toBe(10);
  });

  it("lets only one of two simultaneous issues take the last stock", async () => {
    const site = await makeSite();
    const item = await makeItem(site);
    const lot = await stockedLot(site, item.id, 10, null);
    const results = await Promise.allSettled([issue(site, site.admin, item.id, lot.id, 6), issue(site, site.admin, item.id, lot.id, 6)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await balance(item.id, lot.id, site.shelf)).on_hand).toBe(4);
  });

  it("blocks unreleased or expired lots from being issued or shelved", async () => {
    const site = await makeSite();
    const item = await makeItem(site, { receipt_qc_required: true });
    const lot = await stockedLot(site, item.id, 10, null, { release: false });
    await withTransaction(async (tx) => {
      const doc = await createStockDocument(tx, site.admin, {
        doc_type: "TRANSFER",
        reason_code: "PUTAWAY",
        warehouse_id: site.warehouse,
        lines: [{ item_id: item.id, lot_id: lot.id, from_location_id: site.quarantine, to_location_id: site.shelf, qty: 10, uom: "µL" }],
      });
      await expect(postStockDocument(tx, site.admin, doc.id, doc.version)).rejects.toThrow(/vị trí biệt trữ/);
    });
    await withTransaction(async (tx) => {
      const doc = await createStockDocument(tx, site.admin, {
        doc_type: "ISSUE",
        reason_code: "PRODUCTION",
        warehouse_id: site.warehouse,
        lines: [{ item_id: item.id, lot_id: lot.id, from_location_id: site.quarantine, qty: 1, uom: "µL" }],
      });
      await expect(postStockDocument(tx, site.admin, doc.id, doc.version)).rejects.toThrow(/chỉ lô đã giải phóng/);
    });
    const freeItem = await makeItem(site);
    const old = await stockedLot(site, freeItem.id, 5, "2020-01-01");
    await expect(issue(site, site.admin, freeItem.id, old.id, 1)).rejects.toThrow(/hết hạn/);
  });

  it("requires a lot for lot-tracked items and checks line direction", async () => {
    const site = await makeSite();
    const item = await makeItem(site);
    await withTransaction(async (tx) => {
      const doc = await createStockDocument(tx, site.admin, {
        doc_type: "RECEIPT",
        reason_code: "OPENING",
        warehouse_id: site.warehouse,
        lines: [{ item_id: item.id, to_location_id: site.quarantine, qty: 1, uom: "µL" }],
      });
      await expect(postStockDocument(tx, site.admin, doc.id, doc.version)).rejects.toThrow(/phải chọn lô/);
    });
    await withTransaction(async (tx) => {
      const lot = await createLot(tx, site.admin, { item_id: item.id, origin: "OPENING" });
      const doc = await createStockDocument(tx, site.admin, {
        doc_type: "RECEIPT",
        reason_code: "OPENING",
        warehouse_id: site.warehouse,
        lines: [{ item_id: item.id, lot_id: lot.id, from_location_id: site.shelf, qty: 1, uom: "µL" }],
      });
      await expect(postStockDocument(tx, site.admin, doc.id, doc.version)).rejects.toThrow(/chỉ có vị trí nhập/);
    });
  });

  it("reverses a posted document with a linked counter-document, never by editing", async () => {
    const site = await makeSite();
    const item = await makeItem(site);
    const lot = await stockedLot(site, item.id, 50, null);
    const posted = await issue(site, site.admin, item.id, lot.id, 20);
    await expect(
      withTransaction((tx) => runTransition(tx, stockDocumentMachine, site.admin, { id: posted.id, action: "reverse", expectedVersion: posted.version }))
    ).rejects.toMatchObject({ code: "REASON_REQUIRED" });
    await withTransaction((tx) =>
      runTransition(tx, stockDocumentMachine, site.admin, { id: posted.id, action: "reverse", expectedVersion: posted.version, reason: "Xuất nhầm lô" })
    );
    expect((await balance(item.id, lot.id, site.shelf)).on_hand).toBe(50);
    const docs = await getFactoryPool().query("SELECT status, reason_code, reversal_of_id FROM inv.stock_document WHERE id = $1 OR reversal_of_id = $1 ORDER BY created_at", [posted.id]);
    expect(docs.rows).toEqual([
      { status: "REVERSED", reason_code: "PRODUCTION", reversal_of_id: null },
      { status: "POSTED", reason_code: "REVERSAL", reversal_of_id: posted.id },
    ]);
  });

  it("refuses a reversal when the received stock was already used", async () => {
    const site = await makeSite();
    const item = await makeItem(site);
    const lot = await stockedLot(site, item.id, 10, null);
    await issue(site, site.admin, item.id, lot.id, 8);
    const putaway = (await getFactoryPool().query(
      "SELECT d.id, d.version FROM inv.stock_document d JOIN inv.stock_document_line l ON l.document_id = d.id WHERE l.lot_id = $1 AND d.doc_type = 'TRANSFER'",
      [lot.id]
    )).rows[0];
    await expect(
      withTransaction((tx) => runTransition(tx, stockDocumentMachine, site.admin, { id: putaway.id, action: "reverse", expectedVersion: putaway.version, reason: "x" }))
    ).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK" });
  });

  it("scopes warehouse permissions to the owning department", async () => {
    const site = await makeSite();
    const item = await makeItem(site);
    const lot = await stockedLot(site, item.id, 10, null);
    const otherDeptUser = await createUser("Phòng khác");
    await grant(otherDeptUser, ["inv.document.create", "inv.document.post"], await createOrgUnit("OLIGO"));
    await expect(issue(site, otherDeptUser, item.id, lot.id, 1)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const ownDeptUser = await createUser("Cùng phòng");
    await grant(ownDeptUser, ["inv.document.create", "inv.document.post"], site.dept);
    expect((await issue(site, ownDeptUser, item.id, lot.id, 1)).status).toBe("POSTED");
  });

  it("rejects editing or deleting ledger rows", async () => {
    await expect(getFactoryPool().query("UPDATE inv.stock_ledger SET qty_delta_base = 1")).rejects.toThrow(/chỉ cho phép ghi thêm/);
    await expect(getFactoryPool().query("DELETE FROM inv.stock_ledger")).rejects.toThrow(/chỉ cho phép ghi thêm/);
  });
});
