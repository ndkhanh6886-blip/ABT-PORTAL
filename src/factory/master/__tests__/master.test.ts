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

  it("supports page_size up to 2000 and ranks exact/prefix code searches first", async () => {
    const site = await makeSite();
    const tag = `LF${Math.floor(1000 + Math.random() * 8999)}`;
    await makeItem(site, { code: `AAA-${tag}`, name: `Đệm phụ ${tag}` });
    await makeItem(site, { code: `${tag}-ALT`, name: "Dung dịch thay thế" });
    await makeItem(site, { code: tag, name: "Hyper Ladder Test" });

    const largePage = await withTransaction((tx) => listItems(tx, site.admin, { page_size: 500 }));
    expect(largePage.page_size).toBe(500);

    const searchRes = await withTransaction((tx) => listItems(tx, site.admin, { q: tag, page_size: 50 }));
    expect(searchRes.rows.map((r: { code: string }) => r.code)).toEqual([tag, `${tag}-ALT`, `AAA-${tag}`]);
  });

  it("supports page_size up to 5000, item_type filtering, multi-token/symbol/accent-insensitive and formula/BOM alias search", async () => {
    const site = await makeSite();
    const tag = `QCS${Math.floor(1000 + Math.random() * 8999)}`;

    const kitItem = await makeItem(site, {
      code: `${tag}-AEP-01`,
      name: `TopSAFE ® AGAROSE ELECTROPHORESIS KIT ${tag}`,
      item_type: "FINISHED_KIT",
      base_uom: "kit",
    });
    const silicaItem = await makeItem(site, {
      code: `${tag}-CSD10`,
      name: `Cột silica DNA 10 ${tag}`,
      item_type: "CONSUMABLE",
      base_uom: "pcs",
    });
    const rawItem = await makeItem(site, {
      code: `${tag}-RAW`,
      name: `Hóa chất đầu vào ${tag}`,
      item_type: "RAW_MATERIAL",
      base_uom: "mL",
    });
    const prepOut = await makeItem(site, {
      code: `PREP-${tag}-OUT`,
      name: `Dung dịch thành phẩm ${tag}`,
      item_type: "SEMI_FINISHED",
      base_uom: "mL",
    });

    await getFactoryPool().query(
      `INSERT INTO prep.formula (code, name, dept_scope, output_item_id, basis_qty, basis_uom, status)
       VALUES ($1, $2, 'KIT', $3, 1000, 'mL', 'ACTIVE')`,
      [`${tag}-WB1-FORMULA`, `Công thức Đệm rửa WB1 ${tag}`, prepOut.id]
    );

    const maxPage = await withTransaction((tx) => listItems(tx, site.admin, { page_size: 5000 }));
    expect(maxPage.page_size).toBe(5000);

    const filteredTypes = await withTransaction((tx) =>
      listItems(tx, site.admin, { q: tag, item_type: "FINISHED_KIT,DEVICE", page_size: 5000 })
    );
    expect(filteredTypes.rows.map((r: { id: string }) => r.id)).toEqual([kitItem.id]);

    const symbolSplitSearch = await withTransaction((tx) =>
      listItems(tx, site.admin, { q: `TopSAFE Agarose ${tag}` })
    );
    expect(symbolSplitSearch.rows.map((r: { id: string }) => r.id)).toEqual([kitItem.id]);

    const accentInsensitiveSearch = await withTransaction((tx) =>
      listItems(tx, site.admin, { q: `cot silica ${tag}` })
    );
    expect(accentInsensitiveSearch.rows.map((r: { id: string }) => r.id)).toEqual([silicaItem.id]);

    const strippedHyphenSearch = await withTransaction((tx) =>
      listItems(tx, site.admin, { q: `${tag}AEP01` })
    );
    expect(strippedHyphenSearch.rows.map((r: { id: string }) => r.id)).toEqual([kitItem.id]);

    const formulaCodeSearch = await withTransaction((tx) =>
      listItems(tx, site.admin, { q: `${tag}-WB1-FORMULA` })
    );
    expect(formulaCodeSearch.rows.map((r: { id: string }) => r.id)).toEqual([prepOut.id]);

    const formulaNameSearch = await withTransaction((tx) =>
      listItems(tx, site.admin, { q: `dem rua wb1 ${tag}` })
    );
    expect(formulaNameSearch.rows.map((r: { id: string }) => r.id)).toEqual([prepOut.id]);

    expect(rawItem.id).toBeTruthy();
  });
});
