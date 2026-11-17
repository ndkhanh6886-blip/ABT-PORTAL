/**
 * Mã phụ của Kit tách chiết máy (HI-..., HM-...): mỗi mã chính có nhiều mã phụ (B, T, R, B32, KF, K96...), mỗi mã phụ
 * tương ứng một bộ vật tư cấp kèm kit (đĩa deep plate, tube strip, tipcomb...). Chọn mã phụ khi tạo SO -> chuyển sang
 * sản xuất -> lệnh sản xuất tự giữ chỗ và trừ kho đúng các mã vật tư của bộ đó.
 *
 * Một mã phụ có thể trùng tên ở hai nhóm mã chính khác nhau nhưng bộ vật tư khác nhau (vd B6 của HI khác B6 của HM), nên
 * khóa lưu là `${nhóm}:${mã phụ}` (vd "HI.B:B6"). Định mức mỗi bộ kit mặc định 1 đơn vị cho mỗi mã vật tư (qty).
 */
export interface AccessoryItem {
  /** Mã NVL trong danh mục vật tư. */
  code: string;
  name: string;
  /** Số lượng cấp kèm cho mỗi 1 bộ kit (đơn vị cơ bản của vật tư). */
  qty: number;
}

export interface AccessorySet {
  /** Khóa lưu trên SO / lệnh sản xuất, vd "HI.A:B32". */
  key: string;
  group: string;
  /** Mã phụ hiển thị, vd "B32". */
  variant: string;
  items: AccessoryItem[];
}

export interface AccessoryGroup {
  code: string;
  label: string;
  /** Các mã chính (kit tách chiết) dùng nhóm mã phụ này. */
  products: string[];
  sets: { variant: string; items: [string, string][] }[];
}

const NVL: Record<string, string> = {
  DPA: "Deep Plate 96 ABT",
  TCBI32: "Tipcomb Bioer 32",
  TCBI96: "Tipcomb Bioer 96",
  DPTB: "Deep plate Tanbead (Note: dùng cho Robo)",
  TCTB32: "Tipcomb Tanbead 32",
  TCTB48: "Tipcomb Tanbead 48",
  TCTB96: "Tipcomb Tanbead 96",
  TCRB32: "Tipcom RoboPrep 32",
  TSBIA: "Tube strip Bioer 6",
  TSTB6: "Tube strip Tanbead 6",
  DPK: "Deep plate Kingfisher",
  SPKF: "Standard plate Kingfisher Flex",
  TCKF96: "Tipcom Kingfisher Flex",
};

const pairs = (...codes: string[]): [string, string][] => codes.map((c) => [c, NVL[c]] as [string, string]);

export const EXTRACTION_ACCESSORY_GROUPS: AccessoryGroup[] = [
  {
    code: "HI.A",
    label: "HI (nhóm .A)",
    products: ["HI-002", "HI-002.A", "HI-003", "HI-003.A", "HI-007", "HI-007.A", "HI-812", "HI-812.A", "HI-612", "HI-612.A", "HI-612.N"],
    sets: [
      { variant: "B", items: pairs("DPA", "TCBI32") },
      { variant: "T", items: pairs("DPTB", "TCTB32") },
      { variant: "R", items: pairs("DPTB", "TCRB32") },
      { variant: "B32", items: pairs("TSBIA", "TCBI32") },
      { variant: "T32", items: pairs("TSTB6", "TCTB32") },
      { variant: "R32", items: pairs("TSTB6", "TCRB32") },
    ],
  },
  {
    code: "HI.B",
    label: "HI (nhóm .B)",
    products: ["HI-002", "HI-002.B", "HI-003", "HI-003.B", "HI-007", "HI-007.B", "HI-812", "HI-812.B", "HI-612", "HI-612.B", "HI-612.NB"],
    sets: [
      { variant: "KF", items: pairs("DPK", "SPKF", "TCKF96") },
      { variant: "B96", items: pairs("DPA", "TCBI96") },
      { variant: "T96", items: pairs("DPTB", "TCTB96") },
      { variant: "KF6", items: pairs("TSBIA", "TCKF96") },
      { variant: "B6", items: pairs("TSBIA", "TCBI96") },
      { variant: "T48", items: pairs("TSTB6", "TCTB48") },
      { variant: "T6.2", items: pairs("TSTB6", "TCTB96") },
    ],
  },
  {
    code: "HM.A",
    label: "HM (nhóm .A)",
    products: [
      "HM-001.A", "HM-002.A", "HM-003.A", "HM-004.A", "HM-005.A", "HM-006.A", "HM-007.A", "HM-007", "HM-008.A", "HM-008",
    ],
    sets: [
      { variant: "B32", items: pairs("DPA", "TCBI32") },
      { variant: "T32", items: pairs("DPTB", "TCTB32") },
      { variant: "R32", items: pairs("DPTB", "TCRB32") },
      { variant: "B6", items: pairs("TSBIA", "TCBI32") },
      { variant: "T6", items: pairs("TSTB6", "TCTB32") },
      { variant: "R6", items: pairs("TSTB6", "TCRB32") },
    ],
  },
  {
    code: "HM.B",
    label: "HM (nhóm .B)",
    products: [
      "HM-001.B", "HM-002.B", "HM-003.B", "HM-004.B", "HM-005.B", "HM-006.B", "HM-007.B", "HM-007", "HM-008.B", "HM-008",
    ],
    sets: [
      { variant: "K96", items: pairs("DPK", "SPKF", "TCKF96") },
      { variant: "B96", items: pairs("DPA", "TCBI96") },
      { variant: "T96", items: pairs("DPTB", "TCTB96") },
      { variant: "B6", items: pairs("TSBIA", "TCBI96") },
      { variant: "T6", items: pairs("TSTB6", "TCTB96") },
      { variant: "K6", items: pairs("TSBIA", "TCKF96") },
    ],
  },
];

const ALL_SETS: AccessorySet[] = EXTRACTION_ACCESSORY_GROUPS.flatMap((g) =>
  g.sets.map((s) => ({
    key: `${g.code}:${s.variant}`,
    group: g.code,
    variant: s.variant,
    items: s.items.map(([code, name]) => ({ code, name, qty: 1 })),
  }))
);

const norm = (v: any) => String(v ?? "").trim().toUpperCase();

/** Toàn bộ mã phụ (mọi nhóm) với định mức mặc định. */
export function listAllAccessorySets(): AccessorySet[] {
  return ALL_SETS;
}

/** Kit tách chiết máy có mã phụ (mã chính nằm trong danh mục mã phụ ở trên). */
export function isExtractionAccessoryProduct(code: any): boolean {
  const c = norm(code);
  if (!c) return false;
  return EXTRACTION_ACCESSORY_GROUPS.some((g) => g.products.includes(c));
}

/** Các mã phụ được phép chọn cho một mã chính. */
export function accessorySetsForProduct(code: any): AccessorySet[] {
  const c = norm(code);
  if (!c) return [];
  const groups = EXTRACTION_ACCESSORY_GROUPS.filter((g) => g.products.includes(c)).map((g) => g.code);
  return ALL_SETS.filter((s) => groups.includes(s.group));
}

export function findAccessorySet(key: any): AccessorySet | null {
  const k = norm(key);
  return ALL_SETS.find((s) => s.key === k) ?? null;
}

/** Mã phụ có hợp lệ với mã chính đã chọn không. */
export function isAccessorySetValidForProduct(code: any, key: any): boolean {
  const set = findAccessorySet(key);
  if (!set) return false;
  return accessorySetsForProduct(code).some((s) => s.key === set.key);
}

export function normalizeAccessorySetKey(v: any): string | null {
  return findAccessorySet(v)?.key ?? null;
}

/** Nhãn ngắn, vd "B32 (HI.A)" — dùng khi cả hai nhóm cùng hiện trong một danh sách. */
export function accessorySetLabel(set: AccessorySet): string {
  return `${set.variant} · ${set.items.map((i) => i.code).join(" + ")}`;
}
