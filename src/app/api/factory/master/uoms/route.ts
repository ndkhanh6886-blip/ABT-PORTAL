import { factoryRoute } from "@/factory/http";

const STANDARD_UOMS: Array<[string, string, string]> = [
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
  ["pcs", "Pieces (pcs)", "COUNT"],
  ["Test", "Test xét nghiệm", "ASSAY"],
  ["Rxn", "Phản ứng (Reaction)", "ASSAY"],
  ["OD", "Đơn vị mật độ quang (OD)", "ASSAY"],
  ["U", "Đơn vị hoạt độ Enzyme (Unit)", "ASSAY"],
  ["kU", "Nghìn đơn vị Enzyme (kU)", "ASSAY"],
  ["mL", "Mililít (mL)", "VOLUME"],
  ["µL", "Microlít (µL)", "VOLUME"],
  ["L", "Lít (L)", "VOLUME"],
  ["g", "Gam (g)", "MASS"],
  ["mg", "Miligam (mg)", "MASS"],
  ["µg", "Microgam (µg)", "MASS"],
  ["kg", "Kilôgam (kg)", "MASS"],
  ["nmol", "Nanomol (nmol)", "AMOUNT"],
  ["µmol", "Micromol (µmol)", "AMOUNT"],
  ["pmol", "Picomol (pmol)", "AMOUNT"],
  ["m", "Mét (m)", "LENGTH"],
  ["cm", "Centimét (cm)", "LENGTH"],
  ["mm", "Milimét (mm)", "LENGTH"],
];

let seededUomsOnce = false;

export const GET = factoryRoute(async (tx) => {
  if (!seededUomsOnce) {
    try {
      for (const [code, name, dimension] of STANDARD_UOMS) {
        await tx.query(
          `INSERT INTO master.uom (code, name, dimension, status)
           VALUES ($1, $2, $3, 'ACTIVE')
           ON CONFLICT (code) DO NOTHING`,
          [code, name, dimension]
        );
      }
      seededUomsOnce = true;
    } catch {
      // ignore if read-only transaction or conflict
    }
  }
  return (
    await tx.query(
      `SELECT code, name, dimension
         FROM master.uom
        WHERE status = 'ACTIVE'
          AND code !~ '^[-\u2013\u2014]+$'
          AND upper(code) NOT IN ('N/A', 'NA', 'NONE', 'NULL', '?')
        ORDER BY dimension, code`
    )
  ).rows;
});

