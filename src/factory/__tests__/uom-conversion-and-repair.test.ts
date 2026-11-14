import { afterAll, describe, expect, it } from "vitest";
import { createUser, grant } from "./helpers";
import { closeFactoryPool, getFactoryPool, withTransaction } from "../core/db";
import { executeExcelBatchImport } from "../import/excelImport";
import { findBalanceMismatches } from "../inv/reconcile";
import { makeItem, makeSite, stockedLot } from "../inv/__tests__/fixtures";
import {
  deleteConversion,
  listConversions,
  listItems,
  setConversion,
  toBaseQty,
  updateItem,
} from "../master/service";

afterAll(closeFactoryPool);

describe("UOM normalization, base_uom repair/rebase, and conversion rules", () => {
  it("converts metric units bidirectionally and normalizes uL/μL/mL aliases", async () => {
    const site = await makeSite();
    const itemUl = await makeItem(site, { base_uom: "\u00b5L" });

    await withTransaction(async (tx) => {
      expect(await toBaseQty(tx, itemUl, 0.06, "mL")).toBeCloseTo(60, 6);
      expect(await toBaseQty(tx, itemUl, 60, "uL")).toBeCloseTo(60, 6);
      expect(await toBaseQty(tx, itemUl, 60, "\u03bcL")).toBeCloseTo(60, 6);
      expect(await toBaseQty(tx, itemUl, 0.06, "ml")).toBeCloseTo(60, 6);
    });
  });

  it("supports item-specific conversions and 2-hop metric bridges (mL -> µL -> tube)", async () => {
    const site = await makeSite();
    const tubeItem = await makeItem(site, { base_uom: "tube" });

    await withTransaction(async (tx) => {
      const saved = await setConversion(tx, site.admin, {
        item_id: tubeItem.id,
        from_uom: "tube",
        to_uom: "uL",
        factor: 500,
      });
      expect(saved.from_uom).toBe("tube");
      expect(saved.to_uom).toBe("\u00b5L");

      // Direct reverse: 250 µL = 0.5 tube
      expect(await toBaseQty(tx, tubeItem, 250, "\u00b5L")).toBeCloseTo(0.5, 6);
      // 2-hop transitive: 0.06 mL = 60 µL = 0.12 tube
      expect(await toBaseQty(tx, tubeItem, 0.06, "mL")).toBeCloseTo(0.12, 6);

      const listed = await listConversions(tx, site.admin, { item_id: tubeItem.id });
      expect(listed.some((r) => r.id === saved.id && !r.is_builtin_metric)).toBe(true);

      await deleteConversion(tx, site.admin, saved.id);
      const afterDel = await listConversions(tx, site.admin, { item_id: tubeItem.id });
      expect(afterDel.some((r) => r.id === saved.id)).toBe(false);
    });
  });

  it("repairs legacy base_uom='-' even when stock ledger entries already exist", async () => {
    const site = await makeSite();
    await getFactoryPool().query(
      "INSERT INTO master.uom (code, name, dimension, status) VALUES ('-', '-', 'COUNT', 'ACTIVE') ON CONFLICT (code) DO NOTHING"
    );
    const suffix = Math.random().toString(36).slice(2, 7).toUpperCase();
    const createdItem = await makeItem(site, { code: `LF203-${suffix}`, name: "Hyper Ladder 100bp", base_uom: "pcs" });
    await stockedLot(site, createdItem.id, 100, null, { uom: "pcs" });

    // Simulate legacy dirty Excel import that left base_uom = '-' and document lines with '-'
    await getFactoryPool().query("UPDATE master.item SET base_uom = '-' WHERE id = $1", [createdItem.id]);
    await getFactoryPool().query("UPDATE inv.stock_document_line SET uom = '-' WHERE item_id = $1", [createdItem.id]);
    const dirtyItem = (await getFactoryPool().query("SELECT * FROM master.item WHERE id = $1", [createdItem.id])).rows[0];

    await withTransaction(async (tx) => {
      // Before repair: clearly fails with NO_UOM_CONVERSION
      await expect(toBaseQty(tx, dirtyItem, 0.06, "mL")).rejects.toMatchObject({ code: "NO_UOM_CONVERSION" });

      // Missing UOM filter finds dirtyItem
      const missingRes = await listItems(tx, site.admin, { q: dirtyItem.code, missing_uom: "1" });
      expect(missingRes.rows.some((r) => r.id === dirtyItem.id)).toBe(true);
      expect(missingRes.missing_uom_count).toBeGreaterThanOrEqual(1);

      // Repair '-' -> 'µL' via updateItem (automatically allowed for placeholder '-')
      const repaired = await updateItem(tx, site.admin, dirtyItem.id, {
        version: dirtyItem.version,
        base_uom: "\u00b5L",
      });
      expect(repaired.base_uom).toBe("\u00b5L");

      // Document lines referencing '-' were cleaned up to 'µL'
      const badLines = await tx.query(
        "SELECT count(*)::int AS cnt FROM inv.stock_document_line WHERE item_id = $1 AND uom = '-'",
        [dirtyItem.id]
      );
      expect(badLines.rows[0].cnt).toBe(0);

      // Now 0.06 mL converts cleanly to 60 µL
      expect(await toBaseQty(tx, repaired, 0.06, "mL")).toBeCloseTo(60, 6);

      // Balance reconciliation stays 100% consistent
      const mismatches = await findBalanceMismatches(tx);
      expect(mismatches.filter((m) => m.item_id === dirtyItem.id)).toEqual([]);
    });
  });

  it("rebases stocked item quantity cleanly with RESCALE_STOCK and preserves ledger balance", async () => {
    const site = await makeSite();
    const item = await makeItem(site, { base_uom: "mL" });
    await stockedLot(site, item.id, 0.5, null, { uom: "mL" });

    await withTransaction(async (tx) => {
      const updated = await updateItem(tx, site.admin, item.id, {
        version: item.version,
        base_uom: "\u00b5L",
        uom_change_mode: "RESCALE_STOCK",
        reason: "Chuyen don vi goc tu mL sang uL de dong bo BOM",
      });
      expect(updated.base_uom).toBe("\u00b5L");

      const bal = await tx.query(
        "SELECT coalesce(sum(qty_on_hand), 0)::float AS q FROM inv.stock_balance WHERE item_id = $1",
        [item.id]
      );
      expect(bal.rows[0].q).toBeCloseTo(500, 6);

      const adj = await tx.query(
        "SELECT reason_code, status FROM inv.stock_document WHERE source_entity_type = 'ITEM' AND source_entity_id = $1",
        [item.id]
      );
      expect(adj.rows).toEqual([{ reason_code: "UOM_REBASE", status: "POSTED" }]);

      const mismatches = await findBalanceMismatches(tx);
      expect(mismatches.filter((m) => m.item_id === item.id)).toEqual([]);
    });
  });

  it("prevents Excel import from registering '-' as UOM and heals existing '-' items", async () => {
    const importer = await createUser("Import Admin");
    await grant(importer, [
      "master.item.manage",
      "inv.document.create",
      "inv.document.post",
      "inv.lot.release",
    ]);

    const suffix = Math.random().toString(36).slice(2, 7).toUpperCase();
    const itemCodeDash = `IMPDASH-${suffix}`;

    await withTransaction(async (tx) => {
      await executeExcelBatchImport(tx, importer, {
        template_key: "INVENTORY_STOCK",
        template_name: "Import Ton Kho",
        file_name: "test.xlsx",
        rows: [
          {
            item_code: itemCodeDash,
            item_name: "Test Dash Unit",
            base_uom: "-",
            qty_on_hand: 0,
          },
        ],
      });

      const created = (await tx.query("SELECT id, base_uom FROM master.item WHERE code = $1", [itemCodeDash])).rows[0];
      expect(created.base_uom).toBe("pcs");

      // Also verify healing an existing '-' item when re-imported with 'uL'
      await tx.query(
        "INSERT INTO master.uom (code, name, dimension, status) VALUES ('-', '-', 'COUNT', 'ACTIVE') ON CONFLICT (code) DO NOTHING"
      );
      const healCode = `IMPHEAL-${suffix}`;
      await tx.query(
        `INSERT INTO master.item (code, name, item_type, base_uom, tracking)
         VALUES ($1, 'Heal Item', 'REAGENT', '-', 'LOT')`,
        [healCode]
      );

      await executeExcelBatchImport(tx, importer, {
        template_key: "INVENTORY_STOCK",
        template_name: "Import Ton Kho",
        file_name: "heal.xlsx",
        rows: [
          {
            item_code: healCode,
            item_name: "Heal Item",
            base_uom: "uL",
            qty_on_hand: 0,
          },
        ],
      });

      const healed = (await tx.query("SELECT base_uom FROM master.item WHERE code = $1", [healCode])).rows[0];
      expect(healed.base_uom).toBe("\u00b5L");
    });
  });
});
