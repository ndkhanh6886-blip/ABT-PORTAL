import { afterAll, describe, expect, it } from "vitest";
import { createUser, grant } from "../../__tests__/helpers";
import { closeFactoryPool, getFactoryPool, withTransaction } from "../../core/db";
import { makeSite } from "../../inv/__tests__/fixtures";
import { executeExcelBatchImport, getExcelImportOverview } from "../../import/excelImport";
import { listFormulas } from "../../prep/service";
import { ensureLegacyOligoDataSeeded } from "../legacySync";
import { listSop, workflowFor } from "../postSop";
import "../../modules";

afterAll(closeFactoryPool);
const db = () => getFactoryPool();
const rnd = () => Math.random().toString(36).slice(2, 7).toUpperCase();

describe("legacy Oligo migration & Excel batch import", () => {
  it("seeds standard prep formulas (DEBLOCK, CAP_A, AMIDITE_DIL, AMA) even when FACTORY_ALLOW_DEMO_SEED is unset, without adding demo lots", async () => {
    const prevFlag = process.env.FACTORY_ALLOW_DEMO_SEED;
    delete process.env.FACTORY_ALLOW_DEMO_SEED;
    try {
      const site = await makeSite();
      await db().query("UPDATE core.org_unit SET module_key = 'OLIGO' WHERE id = $1", [site.dept]);
      const user = await createUser("Trưởng pha chế");
      await grant(user, ["prep.execute", "prep.formula.manage"]);

      // Remove DEBLOCK (and its child lines) if unreferenced so ensureLegacyOligoDataSeeded(tx, false) actively re-seeds it
      await db().query(
        `DELETE FROM prep.formula_line fl
          USING prep.formula f
          WHERE fl.formula_id = f.id
            AND f.code = 'DEBLOCK'
            AND NOT EXISTS (SELECT 1 FROM prep.preparation p WHERE p.formula_id = f.id)
            AND NOT EXISTS (SELECT 1 FROM prep.prep_order o WHERE o.formula_id = f.id)`
      );
      await db().query(
        `DELETE FROM prep.formula f
          WHERE f.code = 'DEBLOCK'
            AND NOT EXISTS (SELECT 1 FROM prep.preparation p WHERE p.formula_id = f.id)
            AND NOT EXISTS (SELECT 1 FROM prep.prep_order o WHERE o.formula_id = f.id)`
      );
      const beforeLots = Number((await db().query("SELECT count(*)::int AS c FROM inv.lot")).rows[0].c);
      await withTransaction((tx) => ensureLegacyOligoDataSeeded(tx, false));
      const afterLots = Number((await db().query("SELECT count(*)::int AS c FROM inv.lot")).rows[0].c);
      expect(afterLots).toBe(beforeLots);

      const formulas = await withTransaction((tx) => listFormulas(tx, user));

      const codes = new Set(formulas.map((f: any) => f.code));
      expect(codes.has("DEBLOCK")).toBe(true);
      expect(codes.has("CAP_A")).toBe(true);
      expect(codes.has("AMIDITE_DIL")).toBe(true);
      expect(codes.has("AMA")).toBe(true);
    } finally {
      if (prevFlag !== undefined) process.env.FACTORY_ALLOW_DEMO_SEED = prevFlag;
    }
  });

  it("imports OLIGO_POST_METHOD & OLIGO_POST_WORKFLOW (with carry-down), enriches item_code in listSop, and resolves workflowFor", async () => {
    const suffix = rnd();
    const site = await makeSite();
    await db().query("UPDATE core.org_unit SET module_key = 'OLIGO' WHERE id = $1", [site.dept]);
    const lead = await createUser("Quản lý SOP Oligo");
    await grant(lead, ["oligo.view", "oligo.sop.manage", "master.item.manage", "master.data.view"]);

    const cartMethodName = `Tinh sạch Cartridge ${suffix}`;
    const odMethodName = `Đo OD NanoDrop ${suffix}`;
    const cleaveMethodName = `Cắt giải bảo vệ AMA ${suffix}`;
    const wfName = `Quy trình Cartridge ${suffix}`;
    const cLc9 = `LC9_${suffix}`;
    const c24 = `ST0024_${suffix}`;
    const c26 = `ST0026_${suffix}`;
    const c27 = `ST0027_${suffix}`;

    const methodRes = await withTransaction((tx) =>
      executeExcelBatchImport(tx, lead, {
        template_key: "OLIGO_POST_METHOD",
        template_name: "Phương pháp SOP Oligo",
        file_name: "legacy_methods.xlsx",
        rows: [
          {
            category: "Cắt & Giải bảo vệ",
            method_name: cleaveMethodName,
            kind: "STANDARD",
            target_hours: 0.5,
            field_label: "Nhiệt độ ủ",
            field_type: "NUMBER",
            uom: "°C",
            required: "TRUE",
          },
          {
            category: "Tinh sạch",
            method_name: cartMethodName,
            kind: "STANDARD",
            target_hours: 1.0,
            field_label: "Dung dịch Acetonitrile",
            field_type: "REAGENT",
            item_code: cLc9,
            default_qty: 0.5,
            uom: "mL",
            required: "TRUE",
          },
          {
            // Carry-down category & method_name from previous row
            field_label: "Dung dịch TEAA 2.0M pH 7.0",
            field_type: "REAGENT",
            item_code: c24,
            default_qty: 2.0,
            uom: "mL",
          },
          {
            field_label: "Dung dịch rửa muối",
            field_type: "REAGENT",
            item_code: c26,
            default_qty: 2.0,
            uom: "mL",
          },
          {
            field_label: "Dung dịch TFA 2%",
            field_type: "REAGENT",
            item_code: c27,
            default_qty: 0,
            uom: "mL",
          },
          {
            category: "Đo OD",
            method_name: odMethodName,
            target_hours: 0.2,
            field_label: "Nồng độ A260",
            field_type: "NUMBER",
            uom: "OD",
          },
        ],
      })
    );

    expect(methodRes.error_count).toBe(0);
    expect(methodRes.created_count).toBe(3);

    const sopAfterMethods = await withTransaction((tx) => listSop(tx, lead));
    const cartMethod = sopAfterMethods.methods.find((m: any) => m.name === cartMethodName);
    expect(cartMethod).toBeDefined();
    expect(cartMethod.fields).toHaveLength(4);
    expect(cartMethod.fields.map((f: any) => f.item_code)).toEqual([cLc9, c24, c26, c27]);
    expect(cartMethod.fields[1].default_qty).toBe(2);

    const odMethod = sopAfterMethods.methods.find((m: any) => m.name === odMethodName);
    expect(odMethod?.kind).toBe("QUANTIFICATION");

    const wfRes = await withTransaction((tx) =>
      executeExcelBatchImport(tx, lead, {
        template_key: "OLIGO_POST_WORKFLOW",
        template_name: "Quy trình SOP Oligo",
        file_name: "legacy_workflows.xlsx",
        rows: [
          {
            workflow_name: wfName,
            purifications: "",
            description: "Quy trình migrate từ OligoFlow",
            step_order: 1,
            method_name: cleaveMethodName,
            step_name: "Giải bảo vệ AMA",
          },
          {
            step_order: 2,
            method_name: cartMethodName,
            step_name: "Tinh sạch Cartridge",
          },
          {
            step_order: 3,
            method_name: odMethodName,
            step_name: "Đo OD NanoDrop",
          },
        ],
      })
    );

    expect(wfRes.error_count).toBe(0);
    expect(wfRes.created_count).toBe(1);

    const overview = await withTransaction((tx) => getExcelImportOverview(tx, lead));
    expect(Number(overview.stats.oligo_methods_count)).toBeGreaterThanOrEqual(3);
    expect(Number(overview.stats.oligo_workflows_count)).toBeGreaterThanOrEqual(1);

    // Verify workflowFor resolves frozen steps when assigned to OPC inside an isolated savepoint
    await withTransaction(async (tx) => {
      await tx.query("SAVEPOINT sp_test_opc");
      await tx.query("UPDATE oligo.ps_workflow SET status = 'INACTIVE' WHERE 'OPC' = ANY(purifications)");
      const assignRes = await executeExcelBatchImport(tx, lead, {
        template_key: "OLIGO_POST_WORKFLOW",
        file_name: "assign_opc.xlsx",
        rows: [
          { workflow_name: wfName, purifications: "OPC", step_order: 1, method_name: cleaveMethodName },
          { step_order: 2, method_name: cartMethodName },
          { step_order: 3, method_name: odMethodName },
        ],
      });
      expect(assignRes.error_count).toBe(0);
      const resolved = await workflowFor(tx, "OPC");
      expect(resolved).not.toBeNull();
      expect(resolved!.steps.map((s) => s.name)).toEqual([cleaveMethodName, cartMethodName, odMethodName]);
      await tx.query("ROLLBACK TO SAVEPOINT sp_test_opc");
    });
  });

  it("imports PREP_OLIGO_FORMULA with legacy headers (name, material_code, ratio, unit, carry-down) and prevents output=ingredient collision", async () => {
    const suffix = rnd();
    const actor = await createUser("Trưởng pha chế Excel");
    await grant(actor, ["prep.formula.manage", "prep.execute", "master.item.manage", "master.data.view"]);

    const fName = `Đệm HPLC đặc biệt ${suffix}`;
    const ing1 = `TEA_${suffix}`;
    const ing2 = `ACOH_${suffix}`;
    const selfName = `COLLIDE_${suffix}`;

    const res = await withTransaction((tx) =>
      executeExcelBatchImport(tx, actor, {
        template_key: "PREP_OLIGO_FORMULA",
        file_name: "formulas_import_template.xlsx",
        rows: [
          {
            // No formula_code -> derived from legacy name; uses material_code/ratio/unit aliases
            name: fName,
            category: "Pha động HPLC",
            basis_qty: 1000,
            unit: "mL",
            description: "Pha và chỉnh pH 7.0",
            requires_qc: "TRUE",
            incubation_days: 1,
            material_code: ing1,
            ingredient_name: "Triethylamine",
            ratio: 13.95,
          },
          {
            // Carry-down formula header onto second ingredient
            material_code: ing2,
            ingredient_name: "Acid Acetic",
            ratio: 5.72,
            unit: "mL",
          },
          {
            // Collision guard: explicit output_item_code matches ingredient_code
            formula_code: selfName,
            formula_name: `Self collide ${suffix}`,
            output_item_code: ing1,
            basis_qty: 500,
            basis_uom: "mL",
            ingredient_code: ing1,
            ingredient_qty: 100,
            ingredient_uom: "mL",
          },
        ],
      })
    );

    expect(res.error_count).toBe(0);
    expect(res.created_count).toBe(2);

    const formulas = await withTransaction((tx) => listFormulas(tx, actor));
    const custom = formulas.find((f: any) => f.name === fName);
    expect(custom).toBeDefined();
    expect(custom.requires_qc).toBe(true);
    expect(custom.incubation_days).toBe(1);
    expect(custom.instructions).toBe("Pha và chỉnh pH 7.0");
    expect(custom.lines.map((l: any) => l.item_code)).toEqual([ing1, ing2]);
    expect(custom.lines.map((l: any) => l.qty)).toEqual([13.95, 5.72]);

    const collided = formulas.find((f: any) => f.code === selfName);
    expect(collided).toBeDefined();
    expect(collided.output_item_id).not.toBe(collided.lines[0].item_id);
  });

  it("imports INVENTORY_STOCK with legacy OligoFlow columns, accumulates multiple bottles per lot idempotently, and releases opening lots", async () => {
    const suffix = rnd();
    const site = await makeSite();
    const whCode = (await db().query("SELECT code FROM master.warehouse WHERE id = $1", [site.warehouse])).rows[0].code as string;
    const deptCode = (await db().query("SELECT code FROM core.org_unit WHERE id = $1", [site.dept])).rows[0].code as string;

    const actor = await createUser("Thủ kho Oligo");
    await grant(actor, [
      "master.item.manage",
      "master.data.view",
      "inv.document.post",
      "inv.lot.release",
    ]);

    const itemCode = `ACN_${suffix}`;
    const lotCode = `LOT-ACN-${suffix}`;
    const payloadRows = [
      {
        material_code: itemCode,
        material_name: "Acetonitrile HPLC Grade",
        category: "Dung môi",
        unit: "mL",
        lot_number: lotCode,
        manufacturer_lot: "MFR-ACN-01",
        expire_date: "2028-12-31",
        quantity: 2500,
        bottles_count: 1,
      },
      {
        // Second bottle sharing the exact same lot_number -> 2500 * 2 = 5000 mL (+ 2500 = 7500 mL)
        material_code: itemCode,
        material_name: "Acetonitrile HPLC Grade",
        category: "Dung môi",
        unit: "mL",
        lot_number: lotCode,
        manufacturer_lot: "MFR-ACN-01",
        expire_date: "2028-12-31",
        quantity: 2500,
        bottles_count: 2,
      },
    ];

    const res1 = await withTransaction((tx) =>
      executeExcelBatchImport(tx, actor, {
        template_key: "INVENTORY_STOCK",
        target_dept_code: deptCode,
        target_warehouse_code: whCode,
        is_audited_opening_balance: true,
        file_name: "reagent_import_template.xlsx",
        rows: payloadRows,
      })
    );

    expect(res1.error_count).toBe(0);

    const lotRow = (
      await db().query(
        `SELECT l.id, l.status, l.mfr_lot_no, coalesce(sum(sb.qty_on_hand), 0)::float AS total_qty
           FROM inv.lot l
           JOIN master.item i ON i.id = l.item_id
           LEFT JOIN inv.stock_balance sb ON sb.lot_id = l.id
          WHERE i.code = $1 AND l.code = $2
          GROUP BY l.id, l.status, l.mfr_lot_no`,
        [itemCode, lotCode]
      )
    ).rows[0];

    expect(lotRow).toBeDefined();
    expect(lotRow.status).toBe("RELEASED");
    expect(lotRow.mfr_lot_no).toBe("MFR-ACN-01");
    expect(lotRow.total_qty).toBe(7500);

    // Re-importing the exact same multi-bottle file must be idempotent (zero extra stock documents)
    const docCountBefore = Number(
      (await db().query("SELECT count(*)::int AS c FROM inv.stock_document WHERE notes LIKE '%reagent_import_template.xlsx%'")).rows[0].c
    );
    const res2 = await withTransaction((tx) =>
      executeExcelBatchImport(tx, actor, {
        template_key: "INVENTORY_STOCK",
        target_dept_code: deptCode,
        target_warehouse_code: whCode,
        is_audited_opening_balance: true,
        file_name: "reagent_import_template.xlsx",
        rows: payloadRows,
      })
    );
    expect(res2.error_count).toBe(0);
    const docCountAfter = Number(
      (await db().query("SELECT count(*)::int AS c FROM inv.stock_document WHERE notes LIKE '%reagent_import_template.xlsx%'")).rows[0].c
    );
    expect(docCountAfter).toBe(docCountBefore);

    const lotQtyAfter = Number(
      (await db().query("SELECT coalesce(sum(qty_on_hand), 0)::float AS q FROM inv.stock_balance WHERE lot_id = $1", [lotRow.id])).rows[0].q
    );
    expect(lotQtyAfter).toBe(7500);
  });
});
