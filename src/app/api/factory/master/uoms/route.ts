import { factoryRoute } from "@/factory/http";
import { onCommit } from "@/factory/core/db";

const STANDARD_UOMS: Array<[string, string, string]> = [
  ["µL", "Microlít (µL)", "VOLUME"],
  ["mL", "Mililít (mL)", "VOLUME"],
  ["L", "Lít (L)", "VOLUME"],
  ["µg", "Microgam (µg)", "MASS"],
  ["mg", "Miligam (mg)", "MASS"],
  ["g", "Gam (g)", "MASS"],
  ["kg", "Kilôgam (kg)", "MASS"],
  ["tube", "Ống Tube (tube)", "COUNT"],
  ["vial", "Lọ (vial)", "COUNT"],
  ["bottle", "Chai (bottle)", "COUNT"],
  ["pcs", "Cái / Chiếc (pcs)", "COUNT"],
  ["box", "Hộp (box)", "COUNT"],
  ["kit", "Bộ Kit (kit)", "COUNT"],
  ["set", "Bộ (set)", "COUNT"],
  ["plate", "Đĩa (plate)", "COUNT"],
  ["test", "Test xét nghiệm (test)", "COUNT"],
  ["Rxn", "Phản ứng (Reaction)", "COUNT"],
  ["OD", "Đơn vị mật độ quang (OD)", "OD"],
  ["U", "Đơn vị hoạt độ Enzyme (Unit)", "COUNT"],
  ["kU", "Nghìn đơn vị Enzyme (kU)", "COUNT"],
  ["nmol", "Nanomol (nmol)", "AMOUNT"],
  ["µmol", "Micromol (µmol)", "AMOUNT"],
  ["pmol", "Picomol (pmol)", "AMOUNT"],
  ["mol", "Mol (mol)", "AMOUNT"],
  ["m", "Mét (m)", "LENGTH"],
  ["cm", "Centimét (cm)", "LENGTH"],
  ["mm", "Milimét (mm)", "LENGTH"],
  ["Hộp", "Hộp (Box)", "COUNT"],
  ["Lọ", "Lọ (Vial / Bottle)", "COUNT"],
  ["Chai", "Chai (Bottle)", "COUNT"],
  ["Tube", "Ống Tube", "COUNT"],
  ["Ống", "Ống (Ampoule / Tube)", "COUNT"],
  ["Bộ", "Bộ (Set)", "COUNT"],
  ["Kit", "Bộ Kit", "COUNT"],
  ["Cái", "Cái (Piece)", "COUNT"],
  ["Chiếc", "Chiếc", "COUNT"],
  ["Gói", "Gói (Pack)", "COUNT"],
  ["Túi", "Túi (Bag)", "COUNT"],
  ["Bịch", "Bịch (Pouch)", "COUNT"],
  ["Thùng", "Thùng (Carton)", "COUNT"],
  ["Cuộn", "Cuộn (Roll)", "COUNT"],
  ["Tấm", "Tấm / Bản (Sheet / Plate)", "COUNT"],
  ["Đĩa", "Đĩa (Plate / Dish)", "COUNT"],
  ["Well", "Giếng (Well)", "COUNT"],
  ["Cột", "Cột sắc ký / Cột lọc (Column)", "COUNT"],
  ["Cây", "Cây", "COUNT"],
  ["Test", "Test xét nghiệm", "COUNT"],
];

let seededUomsOnce = false;

export const GET = factoryRoute(async (tx) => {
  if (!seededUomsOnce) {
    await tx.query("SAVEPOINT sp_relax_uom_check");
    try {
      await tx.query("ALTER TABLE master.uom DROP CONSTRAINT IF EXISTS uom_code_check");
      await tx.query("ALTER TABLE master.uom DROP CONSTRAINT IF EXISTS uom_dimension_check");
      await tx.query("RELEASE SAVEPOINT sp_relax_uom_check");
    } catch {
      await tx.query("ROLLBACK TO SAVEPOINT sp_relax_uom_check").catch(() => {});
    }

    for (const [code, name, dimension] of STANDARD_UOMS) {
      await tx.query("SAVEPOINT sp_seed_single_uom");
      try {
        await tx.query(
          `INSERT INTO master.uom (code, name, dimension, status)
           VALUES ($1, $2, $3, 'ACTIVE')
           ON CONFLICT (code) DO UPDATE SET status = 'ACTIVE'`,
          [code, name, dimension]
        );
        await tx.query("RELEASE SAVEPOINT sp_seed_single_uom");
      } catch {
        await tx.query("ROLLBACK TO SAVEPOINT sp_seed_single_uom").catch(() => {});
      }
    }
    onCommit(tx, () => {
      seededUomsOnce = true;
    });
  }
  return (
    await tx.query(
      `SELECT code, name, dimension
         FROM master.uom
        WHERE status = 'ACTIVE'
          AND code !~ '^[-\u2013\u2014]+$'
          AND upper(code) NOT IN ('N/A', 'NA', 'NONE', 'NULL', '?')
        ORDER BY
          CASE dimension
            WHEN 'VOLUME' THEN 1
            WHEN 'MASS' THEN 2
            WHEN 'COUNT' THEN 3
            WHEN 'AMOUNT' THEN 4
            WHEN 'OD' THEN 5
            WHEN 'LENGTH' THEN 6
            ELSE 9
          END,
          code`
    )
  ).rows;
});

