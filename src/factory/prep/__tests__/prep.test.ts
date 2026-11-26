import { afterAll, describe, expect, it } from "vitest";
import { createUser, grant } from "../../__tests__/helpers";
import { closeFactoryPool, getFactoryPool, withTransaction } from "../../core/db";
import { makeItem, makeSite, stockedLot } from "../../inv/__tests__/fixtures";
import { executeExcelBatchImport } from "../../import/excelImport";
import { cancelPrepOrder, createPrepOrder, listPrepOrders } from "../orders";
import { cancelPreparation, confirmPreparationQc, deleteFormula, listFormulas, listPreparations, prepOptions, prepare, saveFormula } from "../service";
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

  it("isolates R&D and Oligo preparation formulas, orders, logs, warehouses, and Excel imports independently", async () => {
    const suffix = rnd();
    const oligoSite = await makeSite();
    const rdSite = await makeSite();
    await db().query("UPDATE core.org_unit SET module_key = 'OLIGO' WHERE id = $1", [oligoSite.dept]);
    await db().query("UPDATE core.org_unit SET module_key = 'RD' WHERE id = $1", [rdSite.dept]);
    await db().query("UPDATE master.warehouse SET purpose = 'OLIGO' WHERE id = $1", [oligoSite.warehouse]);
    await db().query("UPDATE master.warehouse SET purpose = 'RD' WHERE id = $1", [rdSite.warehouse]);

    const rootAdmin = { ...(await createUser("Root Admin")), isRootAdmin: true };
    const ingOligo = await makeItem(oligoSite, { name: `Oligo Sol ${suffix}`, base_uom: "mL" });
    const outOligo = await makeItem(oligoSite, { name: `Oligo Buffer ${suffix}`, base_uom: "mL" });
    await stockedLot(oligoSite, ingOligo.id, 1000, "2030-01-01", { uom: "mL" });

    const ingRd = await makeItem(rdSite, { name: `RD Reagent ${suffix}`, base_uom: "mL" });
    const outRd = await makeItem(rdSite, { name: `RD Lysis ${suffix}`, base_uom: "mL" });
    await stockedLot(rdSite, ingRd.id, 1000, "2030-01-01", { uom: "mL" });

    // 1. Both departments can reuse the exact same formula code independently without collision
    const sharedCode = `TE1X-${suffix}`;
    const fOligo = await withTransaction((tx) =>
      saveFormula(tx, rootAdmin, null, {
        code: sharedCode,
        name: "Đệm TE Oligo",
        dept_scope: "OLIGO",
        output_item_id: outOligo.id,
        basis_qty: 100,
        basis_uom: "mL",
        lines: [{ item_id: ingOligo.id, qty: 100, uom: "mL" }],
      })
    );
    const fRd = await withTransaction((tx) =>
      saveFormula(tx, rootAdmin, null, {
        code: sharedCode,
        name: "Đệm ly giải R&D",
        dept_scope: "RD",
        output_item_id: outRd.id,
        basis_qty: 100,
        basis_uom: "mL",
        lines: [{ item_id: ingRd.id, qty: 100, uom: "mL" }],
      })
    );
    expect(fOligo.dept_scope).toBe("OLIGO");
    expect(fRd.dept_scope).toBe("RD");

    // 2. Listing formulas by dept=RD never leaks OLIGO formulas and does not trigger legacy Oligo formula seeding
    const rdFormulas = await withTransaction((tx) => listFormulas(tx, rootAdmin, "RD"));
    expect(rdFormulas.every((f: any) => f.dept_scope === "RD")).toBe(true);
    expect(rdFormulas.some((f: any) => f.id === fRd.id)).toBe(true);
    expect(rdFormulas.some((f: any) => f.id === fOligo.id)).toBe(false);

    const oligoFormulas = await withTransaction((tx) => listFormulas(tx, rootAdmin, "OLIGO"));
    expect(oligoFormulas.every((f: any) => f.dept_scope === "OLIGO")).toBe(true);
    expect(oligoFormulas.some((f: any) => f.id === fOligo.id)).toBe(true);
    expect(oligoFormulas.some((f: any) => f.id === fRd.id)).toBe(false);

    // 3. Warehouse options are filtered cleanly per department
    const rdOpts = await withTransaction((tx) => prepOptions(tx, rootAdmin, "RD"));
    expect(rdOpts.some((w: any) => w.id === rdSite.warehouse)).toBe(true);
    expect(rdOpts.some((w: any) => w.id === oligoSite.warehouse)).toBe(false);

    const oligoOpts = await withTransaction((tx) => prepOptions(tx, rootAdmin, "OLIGO"));
    expect(oligoOpts.some((w: any) => w.id === oligoSite.warehouse)).toBe(true);
    expect(oligoOpts.some((w: any) => w.id === rdSite.warehouse)).toBe(false);

    // 4. Cross-department execution and planned order creation are blocked
    await expect(
      withTransaction((tx) =>
        prepare(tx, rootAdmin, {
          formula_id: fOligo.id,
          qty: 50,
          uom: "mL",
          warehouse_id: rdSite.warehouse,
          to_location_id: rdSite.shelf,
        })
      )
    ).rejects.toThrow(/bộ phận OLIGO/);
    await expect(
      withTransaction((tx) =>
        createPrepOrder(tx, rootAdmin, {
          formula_id: fRd.id,
          qty: 50,
          uom: "mL",
          warehouse_id: oligoSite.warehouse,
          planned_date: "2026-12-01",
        })
      )
    ).rejects.toThrow(/bộ phận RD/);

    // 5. Orders & preparation logs remain isolated by deptScope
    const ordRd = await withTransaction((tx) =>
      createPrepOrder(tx, rootAdmin, {
        formula_id: fRd.id,
        qty: 50,
        uom: "mL",
        warehouse_id: rdSite.warehouse,
        planned_date: "2026-12-01",
      })
    );
    const prepOligo = await withTransaction((tx) =>
      prepare(tx, rootAdmin, {
        formula_id: fOligo.id,
        qty: 50,
        uom: "mL",
        warehouse_id: oligoSite.warehouse,
        to_location_id: oligoSite.shelf,
      })
    );

    const rdOrders = await withTransaction((tx) => listPrepOrders(tx, rootAdmin, "RD"));
    const oligoOrders = await withTransaction((tx) => listPrepOrders(tx, rootAdmin, "OLIGO"));
    expect(rdOrders.some((o: any) => o.id === ordRd.id)).toBe(true);
    expect(oligoOrders.some((o: any) => o.id === ordRd.id)).toBe(false);

    const rdPreps = await withTransaction((tx) => listPreparations(tx, rootAdmin, "RD"));
    const oligoPreps = await withTransaction((tx) => listPreparations(tx, rootAdmin, "OLIGO"));
    expect(oligoPreps.some((p: any) => p.id === prepOligo.id)).toBe(true);
    expect(rdPreps.some((p: any) => p.id === prepOligo.id)).toBe(false);

    // 6. Excel formula import with target_dept_code = 'P-RD' writes dept_scope = 'RD'
    const xlCode = `XLRD-${suffix}`;
    const xlRes = await withTransaction((tx) =>
      executeExcelBatchImport(tx, rootAdmin, {
        template_key: "PREP_OLIGO_FORMULA",
        target_dept_code: "P-RD",
        file_name: `rd_prep_${suffix}.xlsx`,
        rows: [
          {
            formula_code: xlCode,
            formula_name: `Công thức RD Excel ${suffix}`,
            category: "Đệm ly giải & Tách chiết",
            basis_qty: 500,
            basis_uom: "mL",
            ingredient_code: ingRd.code,
            ingredient_name: ingRd.name,
            ingredient_qty: 100,
            ingredient_uom: "mL",
          },
        ],
      })
    );
    expect(xlRes.error_count).toBe(0);
    const rdAfterExcel = await withTransaction((tx) => listFormulas(tx, rootAdmin, "RD"));
    expect(rdAfterExcel.some((f: any) => f.code === xlCode && f.dept_scope === "RD")).toBe(true);
    const oligoAfterExcel = await withTransaction((tx) => listFormulas(tx, rootAdmin, "OLIGO"));
    expect(oligoAfterExcel.some((f: any) => f.code === xlCode)).toBe(false);
  });

  it("can prepare a child formula (STO021) using a parent formula's prepared lot (STO022) after QC pass or when duplicate output item codes exist", async () => {
    const suffix = rnd();
    const site = await makeSite();
    const lead = await createUser("Trưởng phòng pha chế");
    await grant(lead, ["prep.formula.manage", "prep.execute", "inv.stock.view", "master.item.manage"], site.dept);

    const sc13 = await makeItem(site, { code: `SC13-${suffix}`, name: "Copper (II) sulfate", base_uom: "g" });
    const lc22 = await makeItem(site, { code: `LC22-${suffix}`, name: "DMSO", base_uom: "mL" });
    const sto015 = await makeItem(site, { code: `STO015-${suffix}`, name: "TEAA 2.0M", base_uom: "mL" });
    await stockedLot(site, sc13.id, 10, "2028-01-01", { uom: "g" });
    await stockedLot(site, lc22.id, 1000, "2028-01-01", { uom: "mL" });
    await stockedLot(site, sto015.id, 100, "2028-01-01", { uom: "mL" });

    // Simulate STO022 having been imported with output item PREP-STO022 while STO021 references ingredient item STO022
    const sto022IngItem = await makeItem(site, { code: `STO022-${suffix}`, name: "10 mM Copper (II)-TBTA Stock", base_uom: "mL" });
    const sto022OutItem = await makeItem(site, { code: `PREP-STO022-${suffix}`, name: "10 mM Copper (II)-TBTA Stock", base_uom: "mL" });
    const sto021OutItem = await makeItem(site, { code: `STO021-${suffix}`, name: "Buffer Click Chemistry", base_uom: "mL" });

    const fSto022 = await withTransaction(async (tx) => {
      const f = await saveFormula(tx, lead, null, {
        code: `STO022-${suffix}`,
        name: "10 mM Copper (II)-TBTA Stock in 55% DMSO",
        output_item_id: sto022OutItem.id,
        basis_qty: 100,
        basis_uom: "mL",
        requires_qc: true,
        lines: [
          { item_id: sc13.id, qty: 0.25, uom: "g" },
          { item_id: lc22.id, qty: 55, uom: "mL" },
        ],
      });
      // Force output_item_id to sto022OutItem to mimic legacy Excel import divergence
      await tx.query("UPDATE prep.formula SET output_item_id = $2 WHERE id = $1", [f.id, sto022OutItem.id]);
      return f;
    });

    const fSto021 = await withTransaction(async (tx) => {
      const f = await saveFormula(tx, lead, null, {
        code: `STO021-${suffix}`,
        name: "Buffer Click Chemistry",
        output_item_id: sto021OutItem.id,
        basis_qty: 100,
        basis_uom: "mL",
        requires_qc: true,
        lines: [
          { item_id: sto022IngItem.id, qty: 15, uom: "mL" },
          { item_id: sto015.id, qty: 7.5, uom: "mL" },
          { item_id: lc22.id, qty: 77.5, uom: "mL" },
        ],
      });
      await tx.query("UPDATE prep.formula_line SET item_id = $2 WHERE formula_id = $1 AND line_no = 1", [f.id, sto022IngItem.id]);
      return f;
    });

    // 1. Prepare 100 mL of STO022 (requires_qc = true -> lands in quarantine)
    const prep022 = await withTransaction((tx) =>
      prepare(tx, lead, {
        formula_id: fSto022.id,
        qty: 100,
        uom: "mL",
        warehouse_id: site.warehouse,
      })
    );
    expect(prep022.qc_needed).toBe(true);

    // 2. Confirm QC PASS on STO022
    const qcRes = await withTransaction((tx) =>
      confirmPreparationQc(tx, lead, prep022.id, { result: "PASS", notes: "Đạt kiểm tra QC nội bộ sau pha chế" })
    );
    expect(qcRes.lot_status).toBe("RELEASED");

    // Even if a lot was somehow marked RELEASED while still sitting in quarantine location, preparing STO021 auto-heals and succeeds
    await db().query("UPDATE inv.stock_balance SET location_id = $2 WHERE lot_id = $1", [prep022.lot_id, site.quarantine]);

    // 3. Now prepare 100 mL of STO021 (needs 15 mL of STO022) -> must find the 100 mL lot of STO022 and consume 15 mL
    const prep021 = await withTransaction((tx) =>
      prepare(tx, lead, {
        formula_id: fSto021.id,
        qty: 100,
        uom: "mL",
        warehouse_id: site.warehouse,
      })
    );
    expect(prep021.lot_code).toMatch(/^P\d{4}\d{3}$/);
    expect(await onHand(prep022.lot_id)).toBeCloseTo(85, 6);
  });
});
