import type { Tx } from "../core/db";
import { authorizeAnywhere, type AuthzActor } from "../core/authz";
import { ensureOligoPricingSchema } from "./pricing";

let legacyOligoDataEnsured = false;

/**
 * Đồng bộ & khởi tạo toàn bộ dữ liệu tương thích 100% với phần mềm OligoFlow cũ (abt-portal.online):
 * - Thiết bị tổng hợp (OligoMaker 96-I, Dr. Oligo 48, K&A H-16) & Thiết bị Lab/HPLC (HPLC-01 Shimadzu LC-20, HPLC-02 Agilent 1260, CENT-01 Beckman Coulter, SPEC-01 NanoDrop One, DRY-01 Lyobeta)
 * - 7 Cột sắc ký HPLC Waters XBridge Oligonucleotide BEH C18 (BTL-00838 .. BTL-00844) kèm Lot, Mã Catalog (186008212, 186010692, 186003953), Hãng Waters, Lượt chạy & Còn lại
 * - 43 Tham số Amidite / Modification & Thang tổng hợp (50nmol..1000nmol, 2-5 OD..50-100 OD)
 * - Nguyên liệu, Hóa chất, Định mức tiêu hao (oligo.reagent_rule) & Lô chai hóa chất trong kho KHO-OLIGO
 * - 4 Công thức pha chế chuẩn (DEBLOCK, CAP_A, AMIDITE_DIL, AMA)
 * - 8 Phương pháp & 4 Quy trình SOP Sau tổng hợp (HPLC, OPC, PAGE, Desalt)
 * - 3 Plasmid chuẩn (pUC19, pBR322, pET-28a)
 * - Bảng giá & Công thức tính tiền tổng hợp Oligo (price_config.json)
 */
export async function ensureLegacyOligoDataSeeded(tx: Tx, force = false): Promise<{
  synthesizers: number;
  equipments: number;
  columns: number;
  modifications: number;
  reagents: number;
  formulas: number;
  methods: number;
  workflows: number;
  plasmids: number;
}> {
  const counts = {
    synthesizers: 0,
    equipments: 0,
    columns: 0,
    modifications: 0,
    reagents: 0,
    formulas: 0,
    methods: 0,
    workflows: 0,
    plasmids: 0,
  };

  if (legacyOligoDataEnsured && !force) return counts;

  await ensureOligoPricingSchema(tx);

  await tx.query("SAVEPOINT legacy_oligo_seed_sp");
  try {
    const oligoUnit = (
      await tx.query("SELECT id FROM core.org_unit WHERE code = 'P-OLIGO' OR module_key = 'OLIGO' ORDER BY code LIMIT 1")
    ).rows[0];
    if (!oligoUnit) {
      await tx.query("RELEASE SAVEPOINT legacy_oligo_seed_sp");
      legacyOligoDataEnsured = true;
      return counts;
    }

    const wh = (
      await tx.query(
        "SELECT w.id AS warehouse_id, l.id AS location_id FROM master.warehouse w JOIN master.location l ON l.warehouse_id = w.id WHERE (w.owner_org_unit_id = $1 OR w.code = 'KHO-OLIGO') AND NOT l.is_quarantine ORDER BY w.code, l.code LIMIT 1",
        [oligoUnit.id]
      )
    ).rows[0];

    // 1. Thang tổng hợp (Scales)
    const legacyScales = [
      { code: "25NMOL", label: "25 nmol", nmol: 25, od_min: 0.5, od_max: 2, sort_order: 5 },
      { code: "50NMOL", label: "50 nmol", nmol: 50, od_min: 1, od_max: 3, sort_order: 10 },
      { code: "100NMOL", label: "100 nmol", nmol: 100, od_min: 2, od_max: 5, sort_order: 20 },
      { code: "200NMOL", label: "200 nmol", nmol: 200, od_min: 4, od_max: 10, sort_order: 30 },
      { code: "250NMOL", label: "250 nmol", nmol: 250, od_min: 5, od_max: 12, sort_order: 35 },
      { code: "500NMOL", label: "500 nmol", nmol: 500, od_min: 10, od_max: 25, sort_order: 40 },
      { code: "1000NMOL", label: "1000 nmol (1 µmol)", nmol: 1000, od_min: 20, od_max: 50, sort_order: 50 },
      { code: "1UMOL", label: "1 µmol", nmol: 1000, od_min: 20, od_max: 50, sort_order: 55 },
      { code: "2-5OD", label: "2-5 OD", nmol: 100, od_min: 2, od_max: 5, sort_order: 60 },
      { code: "5-10OD", label: "5-10 OD", nmol: 100, od_min: 5, od_max: 10, sort_order: 65 },
      { code: "10-20OD", label: "10-20 OD", nmol: 200, od_min: 10, od_max: 20, sort_order: 70 },
      { code: "20-50OD", label: "20-50 OD", nmol: 200, od_min: 20, od_max: 50, sort_order: 75 },
      { code: "50-100OD", label: "50-100 OD", nmol: 500, od_min: 50, od_max: 100, sort_order: 80 },
    ];
    for (const sc of legacyScales) {
      await tx.query(
        `INSERT INTO oligo.scale (code, label, synth_nmol, od_min, od_max, sort_order, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE')
         ON CONFLICT (code) DO UPDATE SET label = EXCLUDED.label, status = 'ACTIVE'`,
        [sc.code, sc.label, sc.nmol, sc.od_min, sc.od_max, sc.sort_order]
      );
    }

    const allowDemoSeed = process.env.FACTORY_ALLOW_DEMO_SEED === "1" || force;

    // 2. Máy tổng hợp Oligo chuẩn từ OligoFlow (Honya HY-15: 8 cột, Honya HY-12: 12 cột, K&A H-16: 16 cột)
    // Dọn dẹp các mã máy giả định cũ (OM-96, DO-48, SYN-COL-08, SYN-COL-48) nếu đã từng sinh ra
    await tx.query(`
      UPDATE asset.asset
         SET status = 'RETIRED'
       WHERE code IN ('OM-96', 'DO-48', 'SYN-COL-08', 'SYN-COL-48')
         AND status <> 'RETIRED'
    `);
    await tx.query(`
      DELETE FROM oligo.synthesizer
       WHERE asset_id IN (
         SELECT a.id FROM asset.asset a
          WHERE a.code IN ('OM-96', 'DO-48', 'SYN-COL-08', 'SYN-COL-48')
            AND NOT EXISTS (SELECT 1 FROM oligo.synthesis_batch b WHERE b.synthesizer_id = a.id)
       )
    `);

    const legacySynthesizers = [
      {
        code: "HY-15",
        name: "Honya HY-15",
        manufacturer: "Honya Biotech",
        model: "HY-15",
        serial_no: "HY15-ABT-001",
        positions: 8,
        scales: ["25NMOL", "50NMOL", "100NMOL", "200NMOL", "250NMOL", "500NMOL", "1000NMOL"],
      },
      {
        code: "HY-12",
        name: "Honya HY-12",
        manufacturer: "Honya Biotech",
        model: "HY-12",
        serial_no: "HY12-ABT-002",
        positions: 12,
        scales: ["25NMOL", "50NMOL", "100NMOL", "200NMOL", "250NMOL", "500NMOL", "1000NMOL"],
      },
      {
        code: "KA-16",
        name: "K&A H-16",
        manufacturer: "K&A Labs GmbH",
        model: "KA-16",
        serial_no: "KA16-ABT-003",
        positions: 16,
        scales: ["25NMOL", "50NMOL", "100NMOL", "200NMOL", "250NMOL", "500NMOL", "1000NMOL"],
      },
    ];
    for (const syn of legacySynthesizers) {
      let a = (await tx.query("SELECT id FROM asset.asset WHERE code = $1 LIMIT 1", [syn.code])).rows[0];
      if (!a) {
        a = (
          await tx.query(
            `INSERT INTO asset.asset
               (code, name, asset_type, owner_org_unit_id, manufacturer, model, serial_no, status, calibration_interval_days, next_calibration_due)
             VALUES ($1, $2, 'SYNTHESIZER', $3, $4, $5, $6, 'IN_SERVICE', 180, '2027-06-30')
             RETURNING id`,
            [syn.code, syn.name, oligoUnit.id, syn.manufacturer, syn.model, syn.serial_no]
          )
        ).rows[0];
        counts.synthesizers += 1;
      } else {
        await tx.query("UPDATE asset.asset SET owner_org_unit_id = $2 WHERE id = $1 AND owner_org_unit_id <> $2", [a.id, oligoUnit.id]);
      }
      await tx.query(
        `INSERT INTO oligo.synthesizer (asset_id, column_positions, supported_scales)
         VALUES ($1, $2, $3)
         ON CONFLICT (asset_id) DO UPDATE SET column_positions = EXCLUDED.column_positions, supported_scales = EXCLUDED.supported_scales`,
        [a.id, syn.positions, syn.scales]
      );
    }

    // 3. Thiết bị Lab / Sau tổng hợp riêng của Phòng Oligo từ OligoFlow cũ (HPLC-01, HPLC-02, CENT-01, SPEC-01, DRY-01)
    const legacyEquipments = [
      {
        code: "HPLC-01",
        name: "Hệ thống HPLC Shimadzu LC-20",
        asset_type: "HPLC",
        manufacturer: "Shimadzu",
        model: "Prominence LC-20AD",
        serial_no: "SHM-LC20-001",
      },
      {
        code: "HPLC-02",
        name: "Hệ thống HPLC Agilent 1260",
        asset_type: "HPLC",
        manufacturer: "Agilent Technologies",
        model: "1260 Infinity",
        serial_no: "AG-1260-002",
      },
      {
        code: "CENT-01",
        name: "Máy ly tâm Beckman Coulter",
        asset_type: "CENTRIFUGE",
        manufacturer: "Beckman Coulter",
        model: "Allegra X-30R",
        serial_no: "BC-X30R-001",
      },
      {
        code: "SPEC-01",
        name: "Máy đo OD NanoDrop One",
        asset_type: "SPECTROPHOTOMETER",
        manufacturer: "Thermo Scientific",
        model: "NanoDrop One",
        serial_no: "ND-ONE-001",
      },
      {
        code: "DRY-01",
        name: "Máy đông khô Lyobeta",
        asset_type: "FREEZER",
        manufacturer: "Telstar",
        model: "LyoBeta 15",
        serial_no: "TS-LYO-001",
      },
    ];
    let hplc01Id: string | null = null;
    for (const eq of legacyEquipments) {
      let a = (await tx.query("SELECT id FROM asset.asset WHERE code = $1 LIMIT 1", [eq.code])).rows[0];
      if (!a) {
        a = (
          await tx.query(
            `INSERT INTO asset.asset
               (code, name, asset_type, owner_org_unit_id, manufacturer, model, serial_no, status, calibration_interval_days, next_calibration_due)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'IN_SERVICE', 365, '2027-06-30')
             RETURNING id`,
            [eq.code, eq.name, eq.asset_type, oligoUnit.id, eq.manufacturer, eq.model, eq.serial_no]
          )
        ).rows[0];
        counts.equipments += 1;
      } else {
        await tx.query("UPDATE asset.asset SET owner_org_unit_id = $2 WHERE id = $1 AND owner_org_unit_id <> $2", [a.id, oligoUnit.id]);
      }
      if (eq.code === "HPLC-01") hplc01Id = a.id;
    }

    // 4. 7 Cột sắc ký HPLC Waters XBridge Oligonucleotide BEH C18 từ trang abt-portal.online (BTL-00838 .. BTL-00844)
    const legacyHplcColumns = [
      {
        code: "BTL-00838",
        lot_code: "240201.0",
        catalog_code: "186008212",
        brand: "Waters",
        name: "Cột XBridge Oligonucleotide BEH C18 (OBD TM Prep Column, 130Å, 2.5 µm,) 10 mm x 50 mm, 1/pkg (186008212)",
        price_vnd: 0,
        design_runs: 1000,
        used_runs: 1,
        remaining_runs: 949,
      },
      {
        code: "BTL-00839",
        lot_code: "260401.0",
        catalog_code: "186010692",
        brand: "Waters",
        name: "Cột XBridge Oligonucleotide BEH C18 (OBD TM Prep Column, 130Å, 2.5 µm,) 4.6 mm x 100mm, 1/pkg (186010692)",
        price_vnd: 0,
        design_runs: 1000,
        used_runs: 0,
        remaining_runs: 900,
      },
      {
        code: "BTL-00840",
        lot_code: "260401.1",
        catalog_code: "186003953",
        brand: "Waters",
        name: "XBridge Oligonucleotide BEH C18 Column, 130Å, 2.5 µm, 4.6 mm X 50 mm (186003953)",
        price_vnd: 0,
        design_runs: 1000,
        used_runs: 11,
        remaining_runs: 479,
      },
      {
        code: "BTL-00841",
        lot_code: "260401.2",
        catalog_code: "186003953",
        brand: "Waters",
        name: "XBridge Oligonucleotide BEH C18 Column, 130Å, 2.5 µm, 4.6 mm X 50 mm (186003953)",
        price_vnd: 0,
        design_runs: 1000,
        used_runs: 0,
        remaining_runs: 1000,
      },
      {
        code: "BTL-00842",
        lot_code: "250201.2",
        catalog_code: "186003953",
        brand: "Waters",
        name: "XBridge Oligonucleotide BEH C18 Column, 130Å, 2.5 µm, 4.6 mm X 50 mm (186003953)",
        price_vnd: 0,
        design_runs: 1000,
        used_runs: 9,
        remaining_runs: 281,
      },
      {
        code: "BTL-00843",
        lot_code: "240201.0",
        catalog_code: "186003953",
        brand: "Waters",
        name: "XBridge Oligonucleotide BEH C18 Column, 130Å, 2.5 µm, 4.6 mm X 50 mm (186003953)",
        price_vnd: 0,
        design_runs: 1000,
        used_runs: 0,
        remaining_runs: 300,
      },
      {
        code: "BTL-00844",
        lot_code: "260401.4",
        catalog_code: "186003953",
        brand: "Waters",
        name: "XBridge Oligonucleotide BEH C18 Column, 130Å, 2.5 µm, 4.6 mm X 50 mm (186003953)",
        price_vnd: 0,
        design_runs: 1000,
        used_runs: 0,
        remaining_runs: 1000,
      },
    ];

    for (const col of legacyHplcColumns) {
      let existing = (await tx.query("SELECT id FROM asset.lc_column WHERE upper(code) = upper($1) LIMIT 1", [col.code])).rows[0];
      if (!existing) {
        existing = (
          await tx.query(
            `INSERT INTO asset.lc_column
               (code, name, asset_id, price_vnd, design_runs, status, lot_code, catalog_code, brand, initial_used_runs, remaining_runs_override)
             VALUES ($1, $2, $3, $4, $5, 'ACTIVE', $6, $7, $8, $9, $10)
             RETURNING id`,
            [
              col.code,
              col.name,
              hplc01Id,
              col.price_vnd,
              col.design_runs,
              col.lot_code,
              col.catalog_code,
              col.brand,
              col.used_runs,
              col.remaining_runs,
            ]
          )
        ).rows[0];
        counts.columns += 1;

        // Ghi nhận lịch sử lượt chạy mẫu tương ứng nếu cột đã có used_runs > 0
        for (let rIdx = 1; rIdx <= col.used_runs; rIdx++) {
          await tx.query(
            `INSERT INTO asset.lc_column_run (column_id, sequence_code, step_name, cost_vnd, run_at)
             VALUES ($1, $2, 'Tinh sạch HPLC (Sắc ký lỏng)', 0, now() - ($3 || ' hours')::interval)`,
            [existing.id, `OLG-SEQ-${col.code.slice(-2)}-${String(rIdx).padStart(2, "0")}`, String(rIdx * 4)]
          );
        }
      } else {
        await tx.query(
          `UPDATE asset.lc_column
              SET lot_code = COALESCE(lot_code, $2),
                  catalog_code = COALESCE(catalog_code, $3),
                  brand = COALESCE(brand, $4),
                  initial_used_runs = $5,
                  remaining_runs_override = COALESCE(remaining_runs_override, $6)
            WHERE id = $1`,
          [existing.id, col.lot_code, col.catalog_code, col.brand, col.used_runs, col.remaining_runs]
        );
      }
    }

    // 5. Danh mục 43 Amidite / Modification Parameters từ OligoFlow cũ
    const legacyMods: {
      code: string;
      name: string;
      kind: string;
      base_letter: string | null;
      nn_role: string | null;
      mw: number;
      ext_coeff_260: number;
      aliases: string[];
      position_type: "ANY" | "5PRIME" | "3PRIME" | "INTERNAL";
    }[] = [
      { code: "+A", name: "LNA Adenine (+A)", kind: "LNA", base_letter: "A", nn_role: "A", mw: 341.21, ext_coeff_260: 15400, aliases: ["LNA-A", "LNAA"], position_type: "ANY" },
      { code: "+C", name: "LNA Cytosine (+C)", kind: "LNA", base_letter: "C", nn_role: "C", mw: 317.18, ext_coeff_260: 7300, aliases: ["LNA-C", "LNAC"], position_type: "ANY" },
      { code: "+G", name: "LNA Guanine (+G)", kind: "LNA", base_letter: "G", nn_role: "G", mw: 357.21, ext_coeff_260: 11700, aliases: ["LNA-G", "LNAG"], position_type: "ANY" },
      { code: "+T", name: "LNA Thymine (+T)", kind: "LNA", base_letter: "T", nn_role: "T", mw: 332.2, ext_coeff_260: 8800, aliases: ["LNA-T", "LNAT"], position_type: "ANY" },
      { code: "+U", name: "LNA Uracil (+U)", kind: "LNA", base_letter: "U", nn_role: "U", mw: 318.2, ext_coeff_260: 8800, aliases: ["LNA-U"], position_type: "ANY" },
      { code: "MA", name: "2'-OMe Adenine (mA)", kind: "OME", base_letter: "A", nn_role: "A", mw: 343.24, ext_coeff_260: 15400, aliases: ["2OME-A"], position_type: "ANY" },
      { code: "MC", name: "2'-OMe Cytosine (mC)", kind: "OME", base_letter: "C", nn_role: "C", mw: 319.21, ext_coeff_260: 7300, aliases: ["2OME-C"], position_type: "ANY" },
      { code: "MG", name: "2'-OMe Guanine (mG)", kind: "OME", base_letter: "G", nn_role: "G", mw: 359.24, ext_coeff_260: 11700, aliases: ["2OME-G"], position_type: "ANY" },
      { code: "MT", name: "2'-OMe Thymine (mT)", kind: "OME", base_letter: "T", nn_role: "T", mw: 334.23, ext_coeff_260: 8800, aliases: ["2OME-T"], position_type: "ANY" },
      { code: "MU", name: "2'-OMe Uracil (mU)", kind: "OME", base_letter: "U", nn_role: "U", mw: 320.2, ext_coeff_260: 8800, aliases: ["2OME-U"], position_type: "ANY" },
      { code: "FAM", name: "5-Carboxyfluorescein (6-FAM)", kind: "DYE", base_letter: null, nn_role: null, mw: 537.5, ext_coeff_260: 21000, aliases: ["5FAM", "6FAM", "6-FAM", "56-FAM"], position_type: "ANY" },
      { code: "HEX", name: "HEX Dye", kind: "DYE", base_letter: null, nn_role: null, mw: 744.1, ext_coeff_260: 31580, aliases: ["5HEX", "6-HEX", "56-HEX"], position_type: "ANY" },
      { code: "CY5", name: "Cyanine 5 (Cy5)", kind: "DYE", base_letter: null, nn_role: null, mw: 532.6, ext_coeff_260: 10000, aliases: ["5CY5", "3CY5"], position_type: "ANY" },
      { code: "CY3", name: "Cyanine 3 (Cy3)", kind: "DYE", base_letter: null, nn_role: null, mw: 506.6, ext_coeff_260: 4900, aliases: ["5CY3", "3CY3"], position_type: "ANY" },
      { code: "CY5.5", name: "Cyanine 5.5 (Cy5.5)", kind: "DYE", base_letter: null, nn_role: null, mw: 1128.0, ext_coeff_260: 10000, aliases: ["5CY5.5"], position_type: "ANY" },
      { code: "CY7", name: "Cyanine 7 (Cy7)", kind: "DYE", base_letter: null, nn_role: null, mw: 648.8, ext_coeff_260: 199000, aliases: ["5CY7"], position_type: "ANY" },
      { code: "TAMRA", name: "TAMRA Dye", kind: "DYE", base_letter: null, nn_role: null, mw: 1008.9, ext_coeff_260: 31980, aliases: ["5TAMRA", "3TAMRA"], position_type: "ANY" },
      { code: "ROX", name: "ROX Dye", kind: "DYE", base_letter: null, nn_role: null, mw: 643.0, ext_coeff_260: 22500, aliases: ["5ROX", "3ROX"], position_type: "ANY" },
      { code: "TXR", name: "Texas Red (Sulforhodamine 101)", kind: "DYE", base_letter: null, nn_role: null, mw: 881.0, ext_coeff_260: 14400, aliases: ["TEXARED", "TEXASRED", "5TEXRD-XN", "5TXR"], position_type: "ANY" },
      { code: "VIC", name: "VIC Dye", kind: "DYE", base_letter: null, nn_role: null, mw: 677.0, ext_coeff_260: 16000, aliases: ["5VIC"], position_type: "ANY" },
      { code: "JOE", name: "JOE Dye", kind: "DYE", base_letter: null, nn_role: null, mw: 637.0, ext_coeff_260: 12000, aliases: ["5JOE"], position_type: "ANY" },
      { code: "TET", name: "TET Dye", kind: "DYE", base_letter: null, nn_role: null, mw: 675.2, ext_coeff_260: 16250, aliases: ["5TET"], position_type: "ANY" },
      { code: "AF488", name: "Alexa Fluor 488", kind: "DYE", base_letter: null, nn_role: null, mw: 643.0, ext_coeff_260: 10000, aliases: ["ALEXA488"], position_type: "ANY" },
      { code: "AF568", name: "Alexa Fluor 568", kind: "DYE", base_letter: null, nn_role: null, mw: 792.0, ext_coeff_260: 14000, aliases: ["ALEXA568"], position_type: "ANY" },
      { code: "AF647", name: "Alexa Fluor 647", kind: "DYE", base_letter: null, nn_role: null, mw: 1155.0, ext_coeff_260: 10000, aliases: ["ALEXA647"], position_type: "ANY" },
      { code: "ALEXA594", name: "Alexa Fluor 594", kind: "DYE", base_letter: null, nn_role: null, mw: 820.0, ext_coeff_260: 14000, aliases: ["AF594"], position_type: "ANY" },
      { code: "BHQ0", name: "Black Hole Quencher 0 (BHQ0)", kind: "QUENCHER", base_letter: null, nn_role: null, mw: 700.0, ext_coeff_260: 21400, aliases: ["3BHQ0", "BHQ-0"], position_type: "ANY" },
      { code: "BHQ1", name: "Black Hole Quencher 1 (BHQ1)", kind: "QUENCHER", base_letter: null, nn_role: null, mw: 491.5, ext_coeff_260: 8000, aliases: ["3BHQ1", "3BHQ_1", "BHQ-1"], position_type: "ANY" },
      { code: "BHQ2", name: "Black Hole Quencher 2 (BHQ2)", kind: "QUENCHER", base_letter: null, nn_role: null, mw: 556.5, ext_coeff_260: 8000, aliases: ["3BHQ2", "3BHQ_2", "BHQ-2"], position_type: "ANY" },
      { code: "BHQ3", name: "Black Hole Quencher 3 (BHQ3)", kind: "QUENCHER", base_letter: null, nn_role: null, mw: 890.0, ext_coeff_260: 21400, aliases: ["3BHQ3", "3BHQ_3", "BHQ-3"], position_type: "ANY" },
      { code: "MGB", name: "Minor Groove Binder (MGB-NFQ)", kind: "QUENCHER", base_letter: null, nn_role: null, mw: 973.0, ext_coeff_260: 0, aliases: ["3MGB", "MGBNFQ", "MGB-NFQ"], position_type: "3PRIME" },
      { code: "DABCYL", name: "DABCYL Quencher", kind: "QUENCHER", base_letter: null, nn_role: null, mw: 423.5, ext_coeff_260: 32000, aliases: ["3DABCYL"], position_type: "ANY" },
      { code: "BIOTIN", name: "Biotin Modifier", kind: "MODIFIER", base_letter: null, nn_role: null, mw: 482.0, ext_coeff_260: 0, aliases: ["5BIOTIN", "3BIOTIN", "BIOTIN-TEG"], position_type: "ANY" },
      { code: "NH2", name: "Amino Modifier C6 (NH2)", kind: "MODIFIER", base_letter: null, nn_role: null, mw: 179.21, ext_coeff_260: 0, aliases: ["5AMINO", "3AMINO", "AMINO-C6", "5NH2", "3NH2"], position_type: "ANY" },
      { code: "PHOS", name: "Phosphate (Phosphorylation)", kind: "MODIFIER", base_letter: null, nn_role: null, mw: 79.98, ext_coeff_260: 0, aliases: ["5PHOS", "3PHOS", "PHOSPHORYLATION"], position_type: "ANY" },
      { code: "THIOL", name: "Thiol Modifier C6 S-S", kind: "MODIFIER", base_letter: null, nn_role: null, mw: 297.4, ext_coeff_260: 0, aliases: ["5THIOL", "3THIOL", "THIOL-C6"], position_type: "ANY" },
      { code: "INVDT", name: "Inverted dT (3'-InvdT)", kind: "MODIFIER", base_letter: null, nn_role: null, mw: 304.2, ext_coeff_260: 8700, aliases: ["3INVDT", "INVERTED-DT"], position_type: "3PRIME" },
      { code: "SPACER", name: "C3 Spacer (Propanediol)", kind: "SPACER", base_letter: null, nn_role: null, mw: 138.1, ext_coeff_260: 0, aliases: ["C3-SPACER"], position_type: "ANY" },
      { code: "C3", name: "C3 Spacer", kind: "SPACER", base_letter: null, nn_role: null, mw: 138.1, ext_coeff_260: 0, aliases: ["3C3", "5C3"], position_type: "ANY" },
      { code: "C6", name: "C6 Spacer", kind: "SPACER", base_letter: null, nn_role: null, mw: 180.2, ext_coeff_260: 0, aliases: ["3C6", "5C6"], position_type: "ANY" },
      { code: "5MC", name: "5-Methyl-dC (5mC)", kind: "METHYL", base_letter: "C", nn_role: "C", mw: 303.2, ext_coeff_260: 7300, aliases: ["5MEDC", "5-ME-DC"], position_type: "ANY" },
    ];

    for (const m of legacyMods) {
      const ex = (await tx.query("SELECT id FROM oligo.modification WHERE upper(code) = upper($1) LIMIT 1", [m.code])).rows[0];
      if (!ex) {
        const nnRole = m.base_letter ? "BASE" : "MOD";
        await tx.query(
          `INSERT INTO oligo.modification
             (code, name, kind, base_letter, nn_role, mw, ext_coeff_260, aliases, position_type, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'ACTIVE')
           ON CONFLICT (code) DO NOTHING`,
          [m.code, m.name, m.kind, m.base_letter, nnRole, m.mw, m.ext_coeff_260, m.aliases, m.position_type]
        );
        counts.modifications += 1;
      }
    }

    // 6. Nguyên liệu, Hóa chất, Lô chai & Định mức tiêu hao (Reagent Inventories & Mappings)
    const legacyMaterials: {
      code: string;
      name: string;
      item_type: string;
      uom: string;
      lot_code: string;
      qty_on_hand: number;
      role?: string;
      rule_basis?: "PER_CYCLE" | "PER_COUPLING" | "PER_MOD";
      rule_qty?: number;
    }[] = [
      { code: "TCA", name: "Trichloroacetic acid (TCA)", item_type: "RAW_MATERIAL", uom: "g", lot_code: "BTL-TCA-001", qty_on_hand: 5000 },
      { code: "DCM", name: "Dichloromethane (DCM)", item_type: "RAW_MATERIAL", uom: "mL", lot_code: "BTL-DCM-001", qty_on_hand: 25000 },
      { code: "AA", name: "Acetic Anhydride (Ac2O)", item_type: "RAW_MATERIAL", uom: "mL", lot_code: "BTL-AA-001", qty_on_hand: 2500 },
      { code: "THF", name: "Tetrahydrofuran (THF)", item_type: "RAW_MATERIAL", uom: "mL", lot_code: "BTL-THF-001", qty_on_hand: 10000 },
      { code: "PYR", name: "Pyridine", item_type: "RAW_MATERIAL", uom: "mL", lot_code: "BTL-PYR-001", qty_on_hand: 5000 },
      { code: "NH4OH", name: "Ammonium hydroxide (aq) 28-30%", item_type: "RAW_MATERIAL", uom: "mL", lot_code: "BTL-NH4OH-001", qty_on_hand: 5000 },
      { code: "MeNH2", name: "Methylamine (aq) 40%", item_type: "RAW_MATERIAL", uom: "mL", lot_code: "BTL-MENH2-001", qty_on_hand: 5000 },
      { code: "AMA", name: "AMA Solution (1:1 NH4OH:MeNH2)", item_type: "REAGENT", uom: "mL", lot_code: "BTL-AMA-001", qty_on_hand: 2000 },
      { code: "dA-PWD", name: "dA-Phosphoramidite Powder (Bột thô)", item_type: "RAW_MATERIAL", uom: "g", lot_code: "BTL-DAPWD-001", qty_on_hand: 50 },
      { code: "dC-PWD", name: "dC-Phosphoramidite Powder (Bột thô)", item_type: "RAW_MATERIAL", uom: "g", lot_code: "BTL-DCPWD-001", qty_on_hand: 50 },
      { code: "dG-PWD", name: "dG-Phosphoramidite Powder (Bột thô)", item_type: "RAW_MATERIAL", uom: "g", lot_code: "BTL-DGPWD-001", qty_on_hand: 50 },
      { code: "dT-PWD", name: "dT-Phosphoramidite Powder (Bột thô)", item_type: "RAW_MATERIAL", uom: "g", lot_code: "BTL-DTPWD-001", qty_on_hand: 50 },
      { code: "dA", name: "dA Phosphoramidite (Solution 0.1M)", item_type: "REAGENT", uom: "mL", lot_code: "BTL-DA-001", qty_on_hand: 1000, role: "dA", rule_basis: "PER_COUPLING", rule_qty: 0.15 },
      { code: "dC", name: "dC Phosphoramidite (Solution 0.1M)", item_type: "REAGENT", uom: "mL", lot_code: "BTL-DC-001", qty_on_hand: 1000, role: "dC", rule_basis: "PER_COUPLING", rule_qty: 0.15 },
      { code: "dG", name: "dG Phosphoramidite (Solution 0.1M)", item_type: "REAGENT", uom: "mL", lot_code: "BTL-DG-001", qty_on_hand: 1000, role: "dG", rule_basis: "PER_COUPLING", rule_qty: 0.15 },
      { code: "dT", name: "dT Phosphoramidite (Solution 0.1M)", item_type: "REAGENT", uom: "mL", lot_code: "BTL-DT-001", qty_on_hand: 1000, role: "dT", rule_basis: "PER_COUPLING", rule_qty: 0.15 },
      { code: "rA", name: "rA Phosphoramidite (Solution 0.1M)", item_type: "REAGENT", uom: "mL", lot_code: "BTL-RA-001", qty_on_hand: 500, role: "rA", rule_basis: "PER_COUPLING", rule_qty: 0.15 },
      { code: "rC", name: "rC Phosphoramidite (Solution 0.1M)", item_type: "REAGENT", uom: "mL", lot_code: "BTL-RC-001", qty_on_hand: 500, role: "rC", rule_basis: "PER_COUPLING", rule_qty: 0.15 },
      { code: "rG", name: "rG Phosphoramidite (Solution 0.1M)", item_type: "REAGENT", uom: "mL", lot_code: "BTL-RG-001", qty_on_hand: 500, role: "rG", rule_basis: "PER_COUPLING", rule_qty: 0.15 },
      { code: "rU", name: "rU Phosphoramidite (Solution 0.1M)", item_type: "REAGENT", uom: "mL", lot_code: "BTL-RU-001", qty_on_hand: 500, role: "rU", rule_basis: "PER_COUPLING", rule_qty: 0.15 },
      { code: "DEBLOCK", name: "Deblocking Solution (3% TCA in DCM)", item_type: "REAGENT", uom: "mL", lot_code: "BTL-DEB-001", qty_on_hand: 10000, role: "DEBLOCK", rule_basis: "PER_CYCLE", rule_qty: 2.0 },
      { code: "CAP_A", name: "Cap A (THF/Pyridine/Ac2O)", item_type: "REAGENT", uom: "mL", lot_code: "BTL-CAPA-001", qty_on_hand: 5000, role: "CAP_A", rule_basis: "PER_CYCLE", rule_qty: 0.5 },
      { code: "CAP_B", name: "Cap B Solution (10% NMI in THF)", item_type: "REAGENT", uom: "mL", lot_code: "BTL-CAPB-001", qty_on_hand: 5000, role: "CAP_B", rule_basis: "PER_CYCLE", rule_qty: 0.5 },
      { code: "OXIDATION", name: "Oxidation Solution (0.02M Iodine)", item_type: "REAGENT", uom: "mL", lot_code: "BTL-OXI-001", qty_on_hand: 5000, role: "OXIDATION", rule_basis: "PER_CYCLE", rule_qty: 1.0 },
      { code: "ACTIVATOR", name: "Activator Solution (0.25M ETT in ACN)", item_type: "REAGENT", uom: "mL", lot_code: "BTL-ACT-001", qty_on_hand: 5000, role: "ACTIVATOR", rule_basis: "PER_CYCLE", rule_qty: 0.5 },
      { code: "ACN", name: "Acetonitrile (Anhydrous)", item_type: "REAGENT", uom: "mL", lot_code: "BTL-ACN-001", qty_on_hand: 25000, role: "ACN", rule_basis: "PER_CYCLE", rule_qty: 3.0 },
      { code: "LNA-A", name: "5'-DMTr-LNA-A(N-Bz) CE Phosphoramidite", item_type: "REAGENT", uom: "mL", lot_code: "BTL-LNAA-001", qty_on_hand: 100 },
      { code: "LNA-C", name: "5'-DMTr-LNA-5-Me-C(N-Bz) CE Phosphoramidite", item_type: "REAGENT", uom: "mL", lot_code: "BTL-LNAC-001", qty_on_hand: 100 },
      { code: "LNA-G", name: "5'-DMTr-LNA-G(N-dmf)-CE Phosphoramidite", item_type: "REAGENT", uom: "mL", lot_code: "BTL-LNAG-001", qty_on_hand: 100 },
      { code: "LNA-T", name: "5'-DMTr-LNA-T CE Phosphoramidite", item_type: "REAGENT", uom: "mL", lot_code: "BTL-LNAT-001", qty_on_hand: 100 },
      { code: "FAM-AMIDITE", name: "6-FAM Phosphoramidite", item_type: "REAGENT", uom: "mL", lot_code: "BTL-FAM-001", qty_on_hand: 100 },
      { code: "HEX-AMIDITE", name: "HEX Phosphoramidite", item_type: "REAGENT", uom: "mL", lot_code: "BTL-HEX-001", qty_on_hand: 100 },
      { code: "CY5-AMIDITE", name: "Cyanine5 Phosphoramidite", item_type: "REAGENT", uom: "mL", lot_code: "BTL-CY5-001", qty_on_hand: 100 },
      { code: "AMINO-C6", name: "5'-DMS(O)MT-Amino-Modifier C6", item_type: "REAGENT", uom: "mL", lot_code: "BTL-NH2-001", qty_on_hand: 100 },
      { code: "ALKYL-AMIDITE", name: "Alkyl Phosphoramidite", item_type: "REAGENT", uom: "mL", lot_code: "BTL-ALK-001", qty_on_hand: 100, role: "ALKYL", rule_basis: "PER_MOD", rule_qty: 0.15 },
    ];

    const itemByCode = new Map<string, string>();
    for (const mat of legacyMaterials) {
      let item = (await tx.query("SELECT id FROM master.item WHERE upper(code) = upper($1) LIMIT 1", [mat.code])).rows[0];
      if (!item) {
        item = (
          await tx.query(
            `INSERT INTO master.item (code, name, item_type, base_uom, tracking, receipt_qc_required, status)
             VALUES ($1, $2, $3, $4, 'LOT', false, 'ACTIVE')
             RETURNING id`,
            [mat.code, mat.name, mat.item_type, mat.uom]
          )
        ).rows[0];
        counts.reagents += 1;
      }
      itemByCode.set(mat.code, item.id);

      if (allowDemoSeed) {
        let lot = (await tx.query("SELECT id FROM inv.lot WHERE item_id = $1 AND code = $2 LIMIT 1", [item.id, mat.lot_code])).rows[0];
        if (!lot) {
          lot = (
            await tx.query(
              `INSERT INTO inv.lot (code, item_id, origin, status, received_date, expiry_date)
               VALUES ($1, $2, 'PURCHASE', 'RELEASED', '2026-10-01', '2027-12-31')
               RETURNING id`,
              [mat.lot_code, item.id]
            )
          ).rows[0];
        }
        if (wh && lot) {
          const bal = (
            await tx.query(
              "SELECT id FROM inv.stock_balance WHERE item_id = $1 AND location_id = $2 AND lot_id = $3 LIMIT 1",
              [item.id, wh.location_id, lot.id]
            )
          ).rows[0];
          if (!bal) {
            await tx.query(
              `INSERT INTO inv.stock_balance (item_id, location_id, lot_id, qty_on_hand, qty_reserved)
               VALUES ($1, $2, $3, $4, 0)`,
              [item.id, wh.location_id, lot.id, mat.qty_on_hand]
            );
          }
        }
      }

      if (mat.role && mat.rule_basis && mat.rule_qty != null) {
        await tx.query(
          `INSERT INTO oligo.reagent_rule (role, name, display_name, is_visible, basis, qty, uom, item_id, status)
           VALUES ($1, $2, $2, true, $3, $4, $5, $6, 'ACTIVE')
           ON CONFLICT (role) DO UPDATE
             SET item_id = COALESCE(oligo.reagent_rule.item_id, EXCLUDED.item_id),
                 display_name = COALESCE(oligo.reagent_rule.display_name, EXCLUDED.display_name)`,
          [mat.role, mat.name, mat.rule_basis, mat.rule_qty, mat.uom, item.id]
        );
      }
    }

    // 7. 4 Công thức pha chế chuẩn từ OligoFlow cũ (DEBLOCK, CAP_A, AMIDITE_DIL, AMA)
    const legacyFormulas = [
      {
        code: "DEBLOCK",
        name: "Deblock Solution (3% TCA in DCM)",
        category: "Khử bảo vệ / Cắt mạch",
        output_code: "DEBLOCK",
        basis_qty: 1000,
        basis_uom: "mL",
        shelf_life_days: 180,
        instructions: "Dung dịch khử bảo vệ DMT trong chu kỳ tổng hợp (Pha 30g TCA trong 970mL DCM khan).",
        lines: [
          { code: "TCA", qty: 30, uom: "g" },
          { code: "DCM", qty: 970, uom: "mL" },
        ],
      },
      {
        code: "CAP_A",
        name: "Cap A (THF/Pyridine/Ac2O)",
        category: "Khử bảo vệ / Cắt mạch",
        output_code: "CAP_A",
        basis_qty: 1000,
        basis_uom: "mL",
        shelf_life_days: 180,
        instructions: "Dung dịch khóa đầu CAP A (Acetic Anhydride 100mL + THF 800mL + Pyridine 100mL).",
        lines: [
          { code: "AA", qty: 100, uom: "mL" },
          { code: "THF", qty: 800, uom: "mL" },
          { code: "PYR", qty: 100, uom: "mL" },
        ],
      },
      {
        code: "AMIDITE_DIL",
        name: "Amidite Dilution (0.1M in ACN)",
        category: "Hòa tan Amidite",
        output_code: "dA",
        basis_qty: 10,
        basis_uom: "mL",
        shelf_life_days: 180,
        instructions: "Pha chế dung dịch loãng amidite tiêu chuẩn 0.1M từ bột thô trong Acetonitrile khan.",
        lines: [
          { code: "dA-PWD", qty: 1, uom: "g" },
          { code: "ACN", qty: 10, uom: "mL" },
        ],
      },
      {
        code: "AMA",
        name: "AMA Solution (1:1 NH4OH:MeNH2)",
        category: "Khử bảo vệ / Cắt mạch",
        output_code: "AMA",
        basis_qty: 1000,
        basis_uom: "mL",
        shelf_life_days: 180,
        instructions: "Dung dịch giải bảo vệ AMA (Ammonium hydroxide và Methylamine tỷ lệ 1:1).",
        lines: [
          { code: "NH4OH", qty: 500, uom: "mL" },
          { code: "MeNH2", qty: 500, uom: "mL" },
        ],
      },
    ];

    for (const fm of allowDemoSeed ? legacyFormulas : []) {
      const outId = itemByCode.get(fm.output_code);
      if (!outId) continue;
      const ex = (await tx.query("SELECT id FROM prep.formula WHERE upper(code) = upper($1) LIMIT 1", [fm.code])).rows[0];
      if (!ex) {
        const fRow = (
          await tx.query(
            `INSERT INTO prep.formula
               (code, name, category, output_item_id, basis_qty, basis_uom, shelf_life_days, requires_qc, incubation_days, instructions, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, false, 0, $8, 'ACTIVE')
             RETURNING id`,
            [fm.code, fm.name, fm.category, outId, fm.basis_qty, fm.basis_uom, fm.shelf_life_days, fm.instructions]
          )
        ).rows[0];
        for (let i = 0; i < fm.lines.length; i++) {
          const ln = fm.lines[i];
          const ingId = itemByCode.get(ln.code);
          if (ingId) {
            await tx.query(
              `INSERT INTO prep.formula_line (formula_id, line_no, item_id, qty, uom)
               VALUES ($1, $2, $3, $4, $5)`,
              [fRow.id, i + 1, ingId, ln.qty, ln.uom]
            );
          }
        }
        counts.formulas += 1;
      }
    }

    // 8. 8 Phương pháp & 4 Quy trình SOP Sau tổng hợp từ OligoFlow cũ
    const legacyMethods: {
      category: string;
      name: string;
      kind: "STANDARD" | "QUANTIFICATION";
      target_hours: number;
      fields: { key: string; label: string; type: "NUMBER" | "TEXT" | "EQUIPMENT" | "REAGENT" | "COLUMN"; unit?: string; required: boolean }[];
    }[] = [
      {
        category: "Cắt & Khử bảo vệ",
        name: "AMA (65°C, 10 phút)",
        kind: "STANDARD",
        target_hours: 0.5,
        fields: [
          { key: "temp_c", label: "Nhiệt độ (°C)", type: "NUMBER", unit: "°C", required: true },
          { key: "duration_min", label: "Thời gian (phút)", type: "NUMBER", unit: "phút", required: true },
          { key: "reagent_note", label: "Hóa chất (AMA Ratio)", type: "TEXT", required: false },
        ],
      },
      {
        category: "Cắt & Khử bảo vệ",
        name: "NH4OH tiêu chuẩn (55°C, 8 giờ)",
        kind: "STANDARD",
        target_hours: 8.0,
        fields: [
          { key: "temp_c", label: "Nhiệt độ (°C)", type: "NUMBER", unit: "°C", required: true },
          { key: "duration_hr", label: "Thời gian (giờ)", type: "NUMBER", unit: "giờ", required: true },
          { key: "reagent_nh4oh", label: "Hóa chất (NH4OH)", type: "TEXT", required: false },
        ],
      },
      {
        category: "Tinh sạch",
        name: "Cột lọc OPC (OPC Cartridge)",
        kind: "STANDARD",
        target_hours: 1.0,
        fields: [
          { key: "cartridge_type", label: "Loại cột lọc", type: "TEXT", required: true },
          { key: "elution_vol_ml", label: "Thể tích rửa giải (mL)", type: "NUMBER", unit: "mL", required: true },
          { key: "operator_note", label: "Kỹ thuật viên thực hiện", type: "TEXT", required: false },
        ],
      },
      {
        category: "Tinh sạch",
        name: "Sắc ký lỏng HPLC",
        kind: "STANDARD",
        target_hours: 2.0,
        fields: [
          { key: "hplc_column_id", label: "Cột sắc ký sử dụng (Khấu hao)", type: "COLUMN", required: true },
          { key: "purity_pct", label: "Độ tinh khiết thu hoạch (%)", type: "NUMBER", unit: "%", required: true },
          { key: "fraction_vol_ml", label: "Thể tích phân đoạn (mL)", type: "NUMBER", unit: "mL", required: true },
        ],
      },
      {
        category: "Tinh sạch",
        name: "Điện di PAGE",
        kind: "STANDARD",
        target_hours: 3.0,
        fields: [
          { key: "gel_conc_pct", label: "Nồng độ Acrylamide Gel (%)", type: "NUMBER", unit: "%", required: true },
          { key: "voltage_v", label: "Điện áp chạy (V)", type: "NUMBER", unit: "V", required: true },
          { key: "run_time_min", label: "Thời gian chạy (phút)", type: "NUMBER", unit: "phút", required: true },
        ],
      },
      {
        category: "Đo OD",
        name: "Đo quang phổ Nanodrop",
        kind: "QUANTIFICATION",
        target_hours: 0.5,
        fields: [
          { key: "sample_vol_ul", label: "Thể tích mẫu đo (uL)", type: "NUMBER", unit: "uL", required: true },
          { key: "od260_val", label: "Giá trị hấp thụ OD260", type: "NUMBER", required: true },
        ],
      },
      {
        category: "Đo OD",
        name: "Đầu đọc đĩa Microplate Reader",
        kind: "QUANTIFICATION",
        target_hours: 0.5,
        fields: [
          { key: "dilution_factor", label: "Hệ số pha loãng", type: "NUMBER", required: true },
          { key: "od260_val", label: "Giá trị hấp thụ OD260", type: "NUMBER", required: true },
        ],
      },
      {
        category: "Click chemistry",
        name: "Phản ứng Click (Click Chemistry)",
        kind: "STANDARD",
        target_hours: 4.0,
        fields: [
          { key: "temp_c", label: "Nhiệt độ (°C)", type: "NUMBER", unit: "°C", required: true },
          { key: "duration_hr", label: "Thời gian (giờ)", type: "NUMBER", unit: "giờ", required: true },
          { key: "catalyst", label: "Chất xúc tác sử dụng", type: "TEXT", required: true },
        ],
      },
      {
        category: "Đông khô",
        name: "Đông khô (Lyophilization)",
        kind: "STANDARD",
        target_hours: 4.0,
        fields: [
          { key: "lyo_hours", label: "Thời gian đông khô (giờ)", type: "NUMBER", unit: "giờ", required: true },
          { key: "visual_state", label: "Trạng thái cảm quan", type: "TEXT", required: false },
        ],
      },
    ];

    const methodIdByName = new Map<string, string>();
    for (const m of legacyMethods) {
      let row = (await tx.query("SELECT id FROM oligo.ps_method WHERE lower(name) = lower($1) LIMIT 1", [m.name])).rows[0];
      if (!row) {
        row = (
          await tx.query(
            `INSERT INTO oligo.ps_method (category, name, kind, target_hours, fields, status)
             VALUES ($1, $2, $3, $4, $5::jsonb, 'ACTIVE')
             RETURNING id`,
            [m.category, m.name, m.kind, m.target_hours, JSON.stringify(m.fields)]
          )
        ).rows[0];
        counts.methods += 1;
      }
      methodIdByName.set(m.name, row.id);
    }

    const legacyWorkflows = [
      {
        name: "Quy trình Cắt và Tinh sạch HPLC",
        description: "Quy trình tiêu chuẩn cho oligonucleotides chất lượng cao cần tinh sạch bằng HPLC.",
        purification: "HPLC",
        steps: [
          { methodName: "AMA (65°C, 10 phút)", label: "Cắt & Giải bảo vệ (Cleavage & Deprotection)" },
          { methodName: "Sắc ký lỏng HPLC", label: "Tinh sạch HPLC (HPLC Purification)" },
          { methodName: "Đo quang phổ Nanodrop", label: "Khử muối & Đo OD (Desalting & OD)" },
          { methodName: "Đông khô (Lyophilization)", label: "Đông khô (Lyophilization)" },
        ],
      },
      {
        name: "Quy trình Cắt và Tinh sạch OPC",
        description: "Quy trình tinh sạch trung bình bằng cột lọc OPC, thích hợp cho mẻ trung bình.",
        purification: "OPC",
        steps: [
          { methodName: "NH4OH tiêu chuẩn (55°C, 8 giờ)", label: "Cắt & Giải bảo vệ (Cleavage & Deprotection)" },
          { methodName: "Cột lọc OPC (OPC Cartridge)", label: "Tinh sạch OPC (OPC Purification)" },
          { methodName: "Đo quang phổ Nanodrop", label: "Đo OD & Khử muối" },
          { methodName: "Đông khô (Lyophilization)", label: "Đông khô (Lyophilization)" },
        ],
      },
      {
        name: "Quy trình Cắt và Tinh sạch PAGE",
        description: "Quy trình tinh sạch độ phân giải cao bằng phương pháp điện di PAGE.",
        purification: "PAGE",
        steps: [
          { methodName: "NH4OH tiêu chuẩn (55°C, 8 giờ)", label: "Cắt & Giải bảo vệ (Cleavage & Deprotection)" },
          { methodName: "Điện di PAGE", label: "Tinh sạch PAGE (PAGE Purification)" },
          { methodName: "Đo quang phổ Nanodrop", label: "Khử muối & Đo OD" },
          { methodName: "Đông khô (Lyophilization)", label: "Đông khô (Lyophilization)" },
        ],
      },
      {
        name: "Quy trình Giải nhanh Desalt",
        description: "Quy trình cắt giải bảo vệ nhanh và khử muối, phù hợp với primer thường không biến đổi.",
        purification: "DESALT",
        steps: [
          { methodName: "AMA (65°C, 10 phút)", label: "Cắt nhanh (Rapid Cleavage)" },
          { methodName: "Đo quang phổ Nanodrop", label: "Khử muối & Đo OD" },
          { methodName: "Đông khô (Lyophilization)", label: "Đông khô (Lyophilization)" },
        ],
      },
    ];

    for (const wf of legacyWorkflows) {
      const ex = (await tx.query("SELECT id FROM oligo.ps_workflow WHERE lower(name) = lower($1) LIMIT 1", [wf.name])).rows[0];
      if (!ex) {
        const clash = (
          await tx.query("SELECT id FROM oligo.ps_workflow WHERE status = 'ACTIVE' AND $1 = ANY(purifications) LIMIT 1", [wf.purification])
        ).rows[0];
        const purifs = clash ? [] : [wf.purification];
        const steps = wf.steps
          .map((s) => {
            const mid = methodIdByName.get(s.methodName);
            return mid ? { method_id: mid, name: s.label } : null;
          })
          .filter(Boolean);
        if (steps.length > 0) {
          await tx.query(
            `INSERT INTO oligo.ps_workflow (name, description, purifications, steps, status)
             VALUES ($1, $2, $3, $4::jsonb, 'ACTIVE')`,
            [wf.name, wf.description, purifs, JSON.stringify(steps)]
          );
          counts.workflows += 1;
        }
      }
    }

    // 9. 3 Plasmid chuẩn từ OligoFlow cũ (pUC19, pBR322, pET-28a)
    const legacyPlasmids = [
      { name: "pUC19", length_bp: 2686, notes: "Vector nhân dòng tiêu chuẩn E. coli (AmpR, lacZα)" },
      { name: "pBR322", length_bp: 4361, notes: "Vector plasmid chuẩn E. coli (AmpR, TetR)" },
      { name: "pET-28a", length_bp: 5369, notes: "Vector biểu현 protein T7 His-Tag (KanR)" },
    ];
    for (const pl of legacyPlasmids) {
      const ex = (await tx.query("SELECT id FROM oligo.plasmid WHERE lower(name) = lower($1) LIMIT 1", [pl.name])).rows[0];
      if (!ex) {
        await tx.query(
          `INSERT INTO oligo.plasmid (name, length_bp, notes, status)
           VALUES ($1, $2, $3, 'ACTIVE')`,
          [pl.name, pl.length_bp, pl.notes]
        );
        counts.plasmids += 1;
      }
    }

    await tx.query("RELEASE SAVEPOINT legacy_oligo_seed_sp");
    legacyOligoDataEnsured = true;
  } catch (err) {
    await tx.query("ROLLBACK TO SAVEPOINT legacy_oligo_seed_sp").catch(() => {});
    console.warn("[ensureLegacyOligoDataSeeded] warning:", err);
  }

  return counts;
}

/**
 * Khởi tạo dữ liệu chuẩn Oligo (nội bộ, đã ngắt hoàn toàn kết nối đồng bộ với máy chủ cũ).
 */
export async function syncFromLiveOligoFlowServer(tx: Tx, actor: AuthzActor, _input: unknown) {
  await authorizeAnywhere(tx, actor, "oligo.view");
  const baseCounts = await ensureLegacyOligoDataSeeded(tx, false);
  return {
    ok: true,
    remote_reachable: false,
    summary: "Dữ liệu chuẩn Oligo đã được lưu trữ độc lập trong cơ sở dữ liệu nội bộ.",
    counts: baseCounts,
  };
}
