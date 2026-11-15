import { afterAll, describe, expect, it } from "vitest";
import { createUser, grant } from "../../__tests__/helpers";
import { closeFactoryPool, getFactoryPool, withTransaction } from "../../core/db";
import { makeItem, makeSite, stockedLot } from "../../inv/__tests__/fixtures";
import { cancelPrepOrder, createPrepOrder } from "../orders";
import { cancelPreparation, deleteFormula, listFormulas, prepare, saveFormula } from "../service";
import { ensureLegacyOligoDataSeeded } from "../../oligo/legacySync";
import "../../modules";

afterAll(closeFactoryPool);
const db = () => getFactoryPool();
const rnd = () => Math.random().toString(36).slice(2, 6).toUpperCase();
const onHand = async (lotId: string) => Number((await db().query("SELECT coalesce(sum(qty_on_hand), 0)::float AS h FROM inv.stock_balance WHERE lot_id = $1", [lotId])).rows[0].h);

describe("reagent preparation", () => {
  it("scales the formula, consumes ingredient lots, makes a lot that expires no later than its ingredients", async () => {
    const site = await makeSite();
    const lead = await createUser("Trưởng phòng pha chế");
    await grant(lead, ["prep.formula.manage", "prep.execute", "inv.stock.view"], site.dept);
    const tca = await makeItem(site, { name: "TCA", base_uom: "g" });
    const dcm = await makeItem(site, { name: "DCM", base_uom: "mL" });
    const deblock = await makeItem(site, { name: "Deblock 3% TCA/DCM", base_uom: "mL" });
    const tcaLot = await stockedLot(site, tca.id, 100, "2030-03-01", { uom: "g" });
    const dcmLot = await stockedLot(site, dcm.id, 5000, "2032-01-01", { uom: "mL" });

    const f = await withTransaction((tx) =>
      saveFormula(tx, lead, null, {
        code: `DEB-${rnd()}`, name: "Deblock 3%", category: "Tổng hợp", output_item_id: deblock.id, basis_qty: 1000, basis_uom: "mL", shelf_life_days: 3650,
        lines: [{ item_id: tca.id, qty: 30, uom: "g" }, { item_id: dcm.id, qty: 1000, uom: "mL" }],
      })
    );
    await expect(
      withTransaction((tx) => prepare(tx, lead, { formula_id: f.id, qty: 5000, uom: "mL", warehouse_id: site.warehouse, to_location_id: site.shelf }))
    ).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK" }); // 150 g TCA needed, 100 g in stock

    const p = await withTransaction((tx) => prepare(tx, lead, { formula_id: f.id, qty: 2, uom: "L", warehouse_id: site.warehouse, to_location_id: site.shelf }));
    expect(p.code).toMatch(/^PC\d{4}-\d{4}$/);
    expect(p.lot_code).toMatch(/^P\d{4}\d{3}$/);
    expect(p.expiry_date).toBe("2030-03-01"); // the TCA lot expires before today + 10 years
    expect(await onHand(tcaLot.id)).toBeCloseTo(40, 6);
    expect(await onHand(dcmLot.id)).toBeCloseTo(3000, 6);
    expect(await onHand(p.lot_id)).toBeCloseTo(2000, 6);
    expect((await db().query("SELECT status, origin FROM inv.lot WHERE id = $1", [p.lot_id])).rows[0]).toEqual({ status: "RELEASED", origin: "PREPARATION" });

    await expect(withTransaction((tx) => cancelPreparation(tx, lead, p.id, "x"))).rejects.toThrow(/lý do/);
    await withTransaction((tx) => cancelPreparation(tx, lead, p.id, "Pha sai tỉ lệ"));
    expect(await onHand(tcaLot.id)).toBeCloseTo(100, 6);
    expect(await onHand(p.lot_id)).toBe(0);
  });

  it("a formula with QC leaves the prepared lot in quarantine for QA/QC", async () => {
    const site = await makeSite();
    const lead = await createUser("KTV pha chế");
    await grant(lead, ["prep.formula.manage", "prep.execute"], site.dept);
    const salt = await makeItem(site, { name: "NaCl", base_uom: "g" });
    const buffer = await makeItem(site, { name: "Đệm TEAA", base_uom: "mL" });
    await stockedLot(site, salt.id, 50, null, { uom: "g" });
    const f = await withTransaction((tx) =>
      saveFormula(tx, lead, null, { code: `TEAA-${rnd()}`, name: "TEAA 0.1M", output_item_id: buffer.id, basis_qty: 100, basis_uom: "mL", requires_qc: true, lines: [{ item_id: salt.id, qty: 1, uom: "g" }] })
    );
    const p = await withTransaction((tx) => prepare(tx, lead, { formula_id: f.id, qty: 500, uom: "mL", warehouse_id: site.warehouse }));
    expect(p.qc_needed).toBe(true);
    const bal = (await db().query("SELECT b.location_id, l.status FROM inv.stock_balance b JOIN inv.lot l ON l.id = b.lot_id WHERE b.lot_id = $1", [p.lot_id])).rows[0];
    expect(bal).toEqual({ location_id: site.quarantine, status: "QUARANTINE" });
  });

  it("allows only Admin to delete unused formulas, writes audit log, blocks in-use formulas, and never re-seeds deleted legacy codes", async () => {
    const site = await makeSite();
    const lead = await createUser("Trưởng phòng pha chế");
    await grant(lead, ["prep.formula.manage", "prep.execute"], site.dept);
    const rootAdmin = { ...(await createUser("Root Admin")), isRootAdmin: true };

    const ing = await makeItem(site, { name: "Acetonitrile", base_uom: "mL" });
    const out = await makeItem(site, { name: "Wash ACN", base_uom: "mL" });
    await stockedLot(site, ing.id, 1000, "2030-01-01", { uom: "mL" });

    // 1. Unused formula: non-admin cannot delete even with prep.formula.manage + prep.execute
    const unused = await withTransaction((tx) =>
      saveFormula(tx, lead, null, {
        code: `DEL-${rnd()}`,
        name: "Công thức nháp",
        output_item_id: out.id,
        basis_qty: 100,
        basis_uom: "mL",
        lines: [{ item_id: ing.id, qty: 100, uom: "mL" }],
      })
    );
    await expect(
      withTransaction((tx) => deleteFormula(tx, lead, unused.id, { reason: "Thử xóa không phải admin" }))
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    // 2. Admin rejects missing/short reason
    await expect(
      withTransaction((tx) => deleteFormula(tx, rootAdmin, unused.id, { reason: "x" }))
    ).rejects.toThrow(/lý do/i);

    // 3. Formula with PLANNED order is blocked; once cancelled (no prep lot made), Admin can delete it cleanly
    const order = await withTransaction((tx) =>
      createPrepOrder(tx, lead, {
        formula_id: unused.id,
        qty: 100,
        uom: "mL",
        warehouse_id: site.warehouse,
        to_location_id: site.shelf,
        planned_date: "2026-12-01",
      })
    );
    await expect(
      withTransaction((tx) => deleteFormula(tx, rootAdmin, unused.id, { reason: "Xóa khi đang có lệnh chờ" }))
    ).rejects.toMatchObject({ code: "FORMULA_HAS_OPEN_ORDER" });

    await withTransaction((tx) => cancelPrepOrder(tx, lead, order.id, "Hủy lệnh chờ để xóa công thức"));
    const delRes = await withTransaction((tx) =>
      deleteFormula(tx, rootAdmin, unused.id, { reason: "Công thức nhập nhầm" })
    );
    expect(delRes.deleted).toBe(true);
    expect((await db().query("SELECT id FROM prep.formula WHERE id = $1", [unused.id])).rowCount).toBe(0);
    expect((await db().query("SELECT 1 FROM prep.formula_line WHERE formula_id = $1", [unused.id])).rowCount).toBe(0);
    const audit = (
      await db().query(
        "SELECT action, reason, changes FROM core.audit_log WHERE entity_type = 'prep_formula' AND entity_id = $1 AND action = 'delete'",
        [unused.id]
      )
    ).rows[0];
    expect(audit).toBeTruthy();
    expect(audit.reason).toBe("Công thức nhập nhầm");
    expect(audit.changes.code).toEqual([unused.code, null]);

    // 4. Formula with preparation history is permanently protected against hard delete
    const inUse = await withTransaction((tx) =>
      saveFormula(tx, lead, null, {
        code: `USE-${rnd()}`,
        name: "Công thức đã pha",
        output_item_id: out.id,
        basis_qty: 100,
        basis_uom: "mL",
        lines: [{ item_id: ing.id, qty: 100, uom: "mL" }],
      })
    );
    await withTransaction((tx) =>
      prepare(tx, lead, { formula_id: inUse.id, qty: 100, uom: "mL", warehouse_id: site.warehouse, to_location_id: site.shelf })
    );
    await expect(
      withTransaction((tx) => deleteFormula(tx, rootAdmin, inUse.id, { reason: "Thử xóa công thức đã pha" }))
    ).rejects.toMatchObject({ code: "FORMULA_IN_USE" });

    // 5. Legacy seeded formula (e.g., AMA) deleted by Admin is NOT resurrected on next listFormulas/seed (isolated via SAVEPOINT)
    await withTransaction(async (tx) => {
      await tx.query("SAVEPOINT sp_legacy_delete_test");
      await tx.query("UPDATE core.org_unit SET module_key = 'OLIGO' WHERE id = $1", [site.dept]);
      await ensureLegacyOligoDataSeeded(tx, false);
      const formulasBefore = await listFormulas(tx, rootAdmin);
      const ama = formulasBefore.find((x: { code: string }) => x.code === "AMA");
      expect(ama).toBeDefined();
      await deleteFormula(tx, rootAdmin, ama!.id, { reason: "Không dùng AMA mặc định" });
      await ensureLegacyOligoDataSeeded(tx, false);
      const formulasAfter = await listFormulas(tx, rootAdmin);
      expect(formulasAfter.some((x: { code: string }) => x.code === "AMA")).toBe(false);
      await tx.query("ROLLBACK TO SAVEPOINT sp_legacy_delete_test");
    });
  });
});
