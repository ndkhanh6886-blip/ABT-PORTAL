import { afterAll, describe, expect, it } from "vitest";
import { createUser } from "../../__tests__/helpers";
import { closeFactoryPool, getFactoryPool, withTransaction } from "../../core/db";
import { createPartner, listItems, toBaseQty, updateItem } from "../service";
import { makeItem, makeSite, stockedLot } from "../../inv/__tests__/fixtures";

afterAll(closeFactoryPool);

describe("master data", () => {
  it("issues item codes from the server and audits creation", async () => {
    const site = await makeSite();
    const item = await makeItem(site);
    expect(item.code).toMatch(/^VT\d{5}$/);
    const audit = await getFactoryPool().query("SELECT action FROM core.audit_log WHERE entity_type = 'item' AND entity_id = $1", [item.id]);
    expect(audit.rows).toEqual([{ action: "create" }]);
  });

  it("validates input with field-level Vietnamese messages", async () => {
    const site = await makeSite();
    await expect(makeItem(site, { item_type: "BANANA" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(makeItem(site, { base_uom: "thùng-lạ" })).rejects.toThrow(/không có trong danh mục/);
  });

  it("freezes base unit and tracking once stock exists", async () => {
    const site = await makeSite();
    const item = await makeItem(site);
    const renamed = await withTransaction((tx) => updateItem(tx, site.admin, item.id, { version: item.version, name: "Tên mới", base_uom: "mL" }));
    expect(renamed.base_uom).toBe("mL");
    const item2 = await makeItem(site);
    await stockedLot(site, item2.id, 1, null);
    await expect(withTransaction((tx) => updateItem(tx, site.admin, item2.id, { version: item2.version, base_uom: "mL" }))).rejects.toThrow(
      /đã phát sinh tồn kho/
    );
    await expect(withTransaction((tx) => updateItem(tx, site.admin, item.id, { version: 0, name: "x" }))).rejects.toMatchObject({ code: "STALE_VERSION" });
  });

  it("converts with item-specific factors first and refuses unknown pairs", async () => {
    const site = await makeSite();
    const kit = await makeItem(site, { base_uom: "test", item_type: "FINISHED_KIT" });
    await getFactoryPool().query("INSERT INTO master.uom_conversion (from_uom, to_uom, factor, item_id) VALUES ('kit', 'test', 96, $1)", [kit.id]);
    await withTransaction(async (tx) => {
      expect(await toBaseQty(tx, kit, 2, "kit")).toBe(192);
      await expect(toBaseQty(tx, kit, 1, "box")).rejects.toMatchObject({ code: "NO_UOM_CONVERSION" });
    });
  });

  it("rejects a duplicate tax code and checks permissions", async () => {
    const site = await makeSite();
    const tax = `0${Math.floor(Math.random() * 1e9).toString().padStart(9, "0")}`;
    await withTransaction((tx) => createPartner(tx, site.admin, { name: "NCC A", tax_code: tax, is_supplier: true }));
    await expect(withTransaction((tx) => createPartner(tx, site.admin, { name: "NCC B", tax_code: tax, is_supplier: true }))).rejects.toMatchObject({
      code: "DUPLICATE_TAX_CODE",
    });
    const outsider = await createUser();
    await expect(withTransaction((tx) => listItems(tx, outsider, {}))).rejects.toMatchObject({ code: "FORBIDDEN" });
    const page = await withTransaction((tx) => listItems(tx, site.admin, { page_size: 2 }));
    expect(page.rows.length).toBeLessThanOrEqual(2);
    expect(page.total).toBeGreaterThan(0);
  });
});
