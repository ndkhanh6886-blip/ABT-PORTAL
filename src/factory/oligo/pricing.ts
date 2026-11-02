import { z } from "zod";
import type { Tx } from "../core/db";
import { writeAudit } from "../core/audit";
import { authorize, authorizeAnywhere, registerPermissions, type AuthzActor } from "../core/authz";
import { invalid } from "../core/errors";
import { parseInput } from "../core/records";

registerPermissions([
  { code: "oligo.pricing.manage", description: "Cấu hình bảng giá tổng hợp Oligo, phụ phí biến đổi, tinh sạch và danh mục mã hàng hóa đơn" },
]);

export interface PriceLine {
  key: string;
  code: string;
  name: string;
  unit: string;
  qty: number;
  unit_price: number;
  amount: number;
}

export interface PriceConfig {
  company_info: {
    name: string;
    description: string;
    address: string;
    email: string;
    phone: string;
  };
  scales: Record<
    string,
    {
      base_standard: Record<string, number> | number;
      base_modified: Record<string, number>;
    }
  >;
  modifications_5prime: Record<string, Record<string, number> | number>;
  modifications_3prime: Record<string, Record<string, number> | number>;
  modifications_internal: Record<string, Record<string, number> | number>;
  dual_modification_overhead: Record<string, number>;
  purification_default_by_length: { max_len: number; method: string }[];
  purification_pricing: Record<string, Record<string, number>>;
  lyophilization_pricing: number | Record<string, number>;
  dual_modification_scales_status: Record<string, "active" | "locked" | string>;
  amplicon_pricing: {
    "Amplicon (Linear)": number;
    "Amplicon (Plasmid)": number;
    max_length: number;
    [k: string]: number;
  };
  dual_modification_pricing: Record<string, Record<string, number>>;
  modification_purification_rules: Record<
    string,
    {
      default_purification: string;
      enforce_hplc: boolean;
    }
  >;
  item_codes?: Record<string, string>;
}

/**
 * Bảng giá chuẩn sao chép nguyên bản 100% từ phần mềm OligoFlow cũ (price_config.json)
 */
export const DEFAULT_PRICE_CONFIG: PriceConfig = {
  company_info: {
    name: "OligoX — ABT Biolab",
    description: "Hệ thống Quản lý và Sản xuất Oligonucleotide (MES)",
    address: "Số 1-3, Đường 13B, Phường Bình Trị Đông B, Quận Bình Tân, TP.HCM",
    email: "sales@abtvn.com",
    phone: "(028) 2216 0885",
  },
  scales: {
    "50nmol": {
      base_standard: { "6-14": 8250, "15-34": 7500, "35-60": 8250, "61-120": 8250 },
      base_modified: { "+A": 450000, "+C": 450000, "+G": 450000, "+T": 450000, MA: 15000, MC: 15000, MG: 15000, MT: 15000 },
    },
    "100nmol": {
      base_standard: { "6-14": 12100, "15-34": 11000, "35-60": 12100, "61-120": 12100 },
      base_modified: { "+A": 600000, "+C": 600000, "+G": 600000, "+T": 600000, MA: 18000, MC: 18000, MG: 18000, MT: 18000 },
    },
    "200nmol": {
      base_standard: { "6-14": 16500, "15-34": 15000, "35-60": 16500, "61-120": 16500 },
      base_modified: { "+A": 700000, "+C": 700000, "+G": 700000, "+T": 700000, MA: 22000, MC: 22000, MG: 22000, MT: 22000 },
    },
    "250nmol": {
      base_standard: { "6-14": 18900, "15-34": 18000, "35-60": 18900, "61-120": 18900 },
      base_modified: { "+A": 720000, "+C": 720000, "+G": 720000, "+T": 720000, MA: 24000, MC: 24000, MG: 24000, MT: 24000 },
    },
    "500nmol": {
      base_standard: { "6-14": 30800, "15-34": 28000, "35-60": 30800, "61-120": 30800 },
      base_modified: { "+A": 890000, "+C": 890000, "+G": 890000, "+T": 890000, MA: 30000, MC: 30000, MG: 30000, MT: 30000 },
    },
    "1000nmol": {
      base_standard: { "6-14": 48400, "15-34": 44000, "35-60": 48400, "61-120": 48400 },
      base_modified: { "+A": 960000, "+C": 960000, "+G": 960000, "+T": 960000, MA: 50000, MC: 50000, MG: 50000, MT: 50000 },
    },
  },
  modifications_5prime: {
    BIOTIN: { "50nmol": 960000, "100nmol": 1200000, "200nmol": 1500000, "250nmol": 1650000, "500nmol": 1950000, "1000nmol": 2440000 },
    CY3: { "50nmol": 2200000, "100nmol": 2900000, "200nmol": 3975000, "250nmol": 4372500, "500nmol": 5977000, "1000nmol": 8265400 },
    CY5: { "50nmol": 2200000, "100nmol": 2900000, "200nmol": 3975000, "250nmol": 4372500, "500nmol": 5977000, "1000nmol": 8265400 },
    FAM: { "50nmol": 1500000, "100nmol": 1980000, "200nmol": 2850000, "250nmol": 3135000, "500nmol": 4750000, "1000nmol": 7350000 },
    HEX: { "50nmol": 1830000, "100nmol": 2200000, "200nmol": 3150000, "250nmol": 3465000, "500nmol": 5691000, "1000nmol": 7700000 },
    NH2: { "50nmol": 1200000, "100nmol": 1584000, "200nmol": 2280000, "250nmol": 2508000, "500nmol": 2600000, "1000nmol": 3800000 },
    TAMRA: { "50nmol": 350000, "100nmol": 350000, "200nmol": 350000, "250nmol": 350000, "500nmol": 350000, "1000nmol": 350000 },
  },
  modifications_3prime: {
    BHQ1: { "50nmol": 350000, "100nmol": 350000, "200nmol": 350000, "250nmol": 350000, "500nmol": 350000, "1000nmol": 350000 },
    BHQ2: { "50nmol": 350000, "100nmol": 350000, "200nmol": 350000, "250nmol": 350000, "500nmol": 350000, "1000nmol": 350000 },
    MGB: { "50nmol": 1000000, "100nmol": 1000000, "200nmol": 1000000, "250nmol": 1000000, "500nmol": 1000000, "1000nmol": 1000000 },
    TAMRA: { "50nmol": 300000, "100nmol": 300000, "200nmol": 300000, "250nmol": 300000, "500nmol": 300000, "1000nmol": 300000 },
  },
  modifications_internal: {
    BIOTIN: { "50nmol": 400000, "100nmol": 400000, "200nmol": 400000, "250nmol": 400000, "500nmol": 400000, "1000nmol": 400000 },
    CY3: { "50nmol": 500000, "100nmol": 500000, "200nmol": 500000, "250nmol": 500000, "500nmol": 500000, "1000nmol": 500000 },
    CY5: { "50nmol": 500000, "100nmol": 500000, "200nmol": 500000, "250nmol": 500000, "500nmol": 500000, "1000nmol": 500000 },
    FAM: { "50nmol": 400000, "100nmol": 400000, "200nmol": 400000, "250nmol": 400000, "500nmol": 400000, "1000nmol": 400000 },
    HEX: { "50nmol": 450000, "100nmol": 450000, "200nmol": 450000, "250nmol": 450000, "500nmol": 450000, "1000nmol": 450000 },
    NH2: { "50nmol": 350000, "100nmol": 350000, "200nmol": 350000, "250nmol": 350000, "500nmol": 350000, "1000nmol": 350000 },
  },
  dual_modification_overhead: {
    "50nmol": 50000,
    "100nmol": 6600000,
    "200nmol": 60000,
    "250nmol": 60000,
    "500nmol": 70000,
    "1000nmol": 100000,
  },
  purification_default_by_length: [
    { max_len: 35, method: "Desalt" },
    { max_len: 60, method: "OPC" },
    { max_len: 120, method: "HPLC" },
  ],
  purification_pricing: {
    Desalt: { "50nmol": 0, "100nmol": 0, "200nmol": 0, "250nmol": 0, "500nmol": 0, "1000nmol": 0 },
    OPC: { "50nmol": 50000, "100nmol": 70000, "200nmol": 90000, "250nmol": 100000, "500nmol": 150000, "1000nmol": 250000 },
    PAGE: { "50nmol": 150000, "100nmol": 200000, "200nmol": 250000, "250nmol": 280000, "500nmol": 400000, "1000nmol": 600000 },
    HPLC: { "50nmol": 250000, "100nmol": 300000, "200nmol": 380000, "250nmol": 400000, "500nmol": 600000, "1000nmol": 950000 },
  },
  lyophilization_pricing: 30000,
  dual_modification_scales_status: {
    "50nmol": "locked",
    "100nmol": "active",
    "200nmol": "locked",
    "250nmol": "locked",
    "500nmol": "locked",
    "1000nmol": "locked",
  },
  amplicon_pricing: {
    "Amplicon (Linear)": 4400000,
    "Amplicon (Plasmid)": 5500000,
    max_length: 500,
  },
  dual_modification_pricing: {
    "AF568/BHQ2": { "50nmol": 50000, "100nmol": 6600000, "200nmol": 60000, "250nmol": 60000, "500nmol": 70000, "1000nmol": 100000 },
    "AF647/BHQ2": { "50nmol": 50000, "100nmol": 6600000, "200nmol": 60000, "250nmol": 60000, "500nmol": 70000, "1000nmol": 100000 },
    "CY3/BHQ2": { "50nmol": 50000, "100nmol": 6600000, "200nmol": 60000, "250nmol": 60000, "500nmol": 70000, "1000nmol": 100000 },
    "CY5/BHQ2": { "50nmol": 50000, "100nmol": 6600000, "200nmol": 60000, "250nmol": 60000, "500nmol": 70000, "1000nmol": 100000 },
    "FAM/BHQ1": { "50nmol": 50000, "100nmol": 4400000, "200nmol": 60000, "250nmol": 60000, "500nmol": 70000, "1000nmol": 100000 },
    "FAM/MGB": { "50nmol": 50000, "100nmol": 8814420, "200nmol": 60000, "250nmol": 60000, "500nmol": 70000, "1000nmol": 100000 },
    "FAM/TAMRA": { "50nmol": 50000, "100nmol": 4400000, "200nmol": 60000, "250nmol": 60000, "500nmol": 70000, "1000nmol": 100000 },
    "HEX/BHQ1": { "50nmol": 50000, "100nmol": 4840000, "200nmol": 60000, "250nmol": 60000, "500nmol": 70000, "1000nmol": 100000 },
    "HEX/MGB": { "50nmol": 50000, "100nmol": 8966100, "200nmol": 60000, "250nmol": 60000, "500nmol": 70000, "1000nmol": 100000 },
    "HEX/TAMRA": { "50nmol": 50000, "100nmol": 4400000, "200nmol": 60000, "250nmol": 60000, "500nmol": 70000, "1000nmol": 100000 },
    "ROX/BHQ2": { "50nmol": 50000, "100nmol": 6600000, "200nmol": 60000, "250nmol": 60000, "500nmol": 70000, "1000nmol": 100000 },
    "TXR/BHQ2": { "50nmol": 50000, "100nmol": 6600000, "200nmol": 60000, "250nmol": 60000, "500nmol": 70000, "1000nmol": 100000 },
    "VIC/BHQ1": { "50nmol": 50000, "100nmol": 6600000, "200nmol": 60000, "250nmol": 60000, "500nmol": 70000, "1000nmol": 100000 },
    "VIC/MGB": { "50nmol": 50000, "100nmol": 8966100, "200nmol": 60000, "250nmol": 60000, "500nmol": 70000, "1000nmol": 100000 },
    "VIC/TAMRA": { "50nmol": 50000, "100nmol": 4840000, "200nmol": 60000, "250nmol": 60000, "500nmol": 70000, "1000nmol": 100000 },
  },
  modification_purification_rules: {
    dye: { default_purification: "HPLC", enforce_hplc: true },
    quencher: { default_purification: "HPLC", enforce_hplc: true },
    modified: { default_purification: "HPLC", enforce_hplc: false },
    LNA: { default_purification: "Desalt", enforce_hplc: false },
    "2-OMe": { default_purification: "Desalt", enforce_hplc: false },
  },
};

export const FALLBACK_ITEM_CODE = "OLG-CHUA-CAU-HINH";
export const LENGTH_BAND_LABELS: Record<string, string> = {
  "6-14": "6-14 nt",
  "15-34": "15-34 nt",
  "35-60": "35-60 nt",
  "61-120": "61-120 nt",
};

const FLUORESCENT_DYE_CODES = new Set([
  "FAM", "HEX", "TET", "JOE", "VIC", "ROX", "TXR", "TAMRA",
  "CY3", "CY5", "CY5.5", "CY7",
  "AF488", "AF568", "AF647", "ALEXA488", "ALEXA568", "ALEXA594", "ALEXA647",
  "FITC", "NED", "SUN", "YAKIMA", "QUASAR570", "QUASAR670", "CFR610",
  "ATTO488", "ATTO550", "ATTO647N",
]);

const NON_FLUORESCENT_MOD_CODES = new Set([
  "BIOTIN", "NH2", "AMINO", "PHOS", "THIOL", "SH", "INVDT",
  "SPACER", "C3", "C6", "C12", "5MC", "DIG", "ALK", "AZIDE", "DBCO",
]);

const MOD_CATEGORY_MAP: Record<string, string> = {
  FAM: "dye", HEX: "dye", CY5: "dye", CY3: "dye", TAMRA: "dye", AF488: "dye", ALEXA594: "dye",
  JOE: "dye", VIC: "dye", ROX: "dye", TXR: "dye", "CY5.5": "dye", CY7: "dye", TET: "dye",
  AF568: "dye", AF647: "dye",
  BHQ0: "quencher", BHQ1: "quencher", BHQ2: "quencher", BHQ3: "quencher", MGB: "quencher", DABCYL: "quencher",
  BIOTIN: "modified", NH2: "modified", PHOS: "modified", THIOL: "modified", INVDT: "modified",
  SPACER: "modified", C3: "modified", C6: "modified", "5MC": "modified",
  "+A": "LNA", "+C": "LNA", "+G": "LNA", "+T": "LNA", "+U": "LNA",
  MA: "2-OMe", MC: "2-OMe", MG: "2-OMe", MT: "2-OMe", MU: "2-OMe",
};

const MOD_ALIASES: Record<string, string> = {
  "5TEXRD-XN": "TXR", "3TEXRD-XN": "TXR", "TEXRD-XN": "TXR", TEXASRED: "TXR", "TEXAS RED": "TXR", "TEXAS-RED": "TXR", TEXARED: "TXR",
  "5TXR": "TXR", "3TXR": "TXR", "5-TXR": "TXR", "3-TXR": "TXR",
  "3BHQ_2": "BHQ2", "5BHQ_2": "BHQ2", BHQ_2: "BHQ2", "3BHQ2": "BHQ2", "5BHQ2": "BHQ2", "3-BHQ2": "BHQ2", "5-BHQ2": "BHQ2", "BHQ-2": "BHQ2",
  "3BHQ_1": "BHQ1", "5BHQ_1": "BHQ1", BHQ_1: "BHQ1", "3BHQ1": "BHQ1", "5BHQ1": "BHQ1", "3-BHQ1": "BHQ1", "5-BHQ1": "BHQ1", "BHQ-1": "BHQ1",
  "3BHQ_3": "BHQ3", "5BHQ_3": "BHQ3", BHQ_3: "BHQ3", "3BHQ3": "BHQ3", "5BHQ3": "BHQ3", "3-BHQ3": "BHQ3", "5-BHQ3": "BHQ3", "BHQ-3": "BHQ3",
  "5FAM": "FAM", "3FAM": "FAM", "6-FAM": "FAM", "5-FAM": "FAM", "56-FAM": "FAM", "36-FAM": "FAM", "6FAM": "FAM", "5(6)-FAM": "FAM",
  "5HEX": "HEX", "3HEX": "HEX", "5-HEX": "HEX", "6-HEX": "HEX", "6HEX": "HEX", "56-HEX": "HEX",
  "5TET": "TET", "3TET": "TET", "5-TET": "TET",
  "5CY5": "CY5", "3CY5": "CY5", "5-CY5": "CY5", "3-CY5": "CY5",
  "5CY3": "CY3", "3CY3": "CY3", "5-CY3": "CY3", "3-CY3": "CY3",
  "5CY5.5": "CY5.5", "3CY5.5": "CY5.5", "5-CY5.5": "CY5.5", "3-CY5.5": "CY5.5",
  "5CY7": "CY7", "3CY7": "CY7", "5-CY7": "CY7", "3-CY7": "CY7",
  "5TAMRA": "TAMRA", "3TAMRA": "TAMRA", "5-TAMRA": "TAMRA", "3-TAMRA": "TAMRA",
  "3MGB": "MGB", "5MGB": "MGB", "3-MGB": "MGB", "5-MGB": "MGB", MGBNFQ: "MGB", "MGB-NFQ": "MGB", MGB_NFQ: "MGB",
  "5BIOTIN": "BIOTIN", "3BIOTIN": "BIOTIN", "5-BIOTIN": "BIOTIN", "3-BIOTIN": "BIOTIN", "BIOTIN-TEG": "BIOTIN", BIOTINTEG: "BIOTIN",
  "5AMINO": "NH2", "3AMINO": "NH2", "5-AMINO": "NH2", "3-AMINO": "NH2", "AMINO-C6": "NH2", AMINOC6: "NH2", "5-NH2": "NH2", "3-NH2": "NH2", "5NH2": "NH2", "3NH2": "NH2",
  "5PHOS": "PHOS", "3PHOS": "PHOS", "5-PHOS": "PHOS", "3-PHOS": "PHOS", PHOSPHORYLATION: "PHOS",
  "5THIOL": "THIOL", "3THIOL": "THIOL", "5-THIOL": "THIOL", "3-THIOL": "THIOL", "THIOL-C6": "THIOL", THIOLC6: "THIOL",
  "3INVDT": "INVDT", "3-INVDT": "INVDT", "INVERTED-DT": "INVDT",
  "5MEDC": "5MC", "5-ME-DC": "5MC", "5-MEDC": "5MC", "5METHYLDC": "5MC",
};

export function normalizeModCode(raw: string): string {
  const up = raw.trim().toUpperCase();
  if (!up) return "";
  if (MOD_ALIASES[up]) return MOD_ALIASES[up];
  if (MOD_CATEGORY_MAP[up]) return up;
  for (const prefix of ["5-", "3-", "5", "3"]) {
    if (up.startsWith(prefix) && up.length > prefix.length) {
      const sub = up.slice(prefix.length);
      if (MOD_ALIASES[sub]) return MOD_ALIASES[sub];
      if (MOD_CATEGORY_MAP[sub]) return sub;
    }
  }
  return up;
}

export function normalizeScale(scaleStr: string): string {
  if (!scaleStr) return "100nmol";
  const s = scaleStr.toLowerCase().replace(/\s+/g, "").replace(/_/g, "");
  if (["1umol", "1µmol", "1000nmol"].includes(s)) return "1000nmol";
  if (["10umol", "10µmol"].includes(s)) return "1000nmol";
  if (s === "25nmol") return "50nmol";
  const odMap: Record<string, string> = {
    "2-5od": "100nmol",
    "5-10od": "100nmol",
    "10-20od": "200nmol",
    "20-50od": "200nmol",
    "50-100od": "500nmol",
  };
  return odMap[s] ?? s;
}

export function scaleShort(scaleKey: string): string {
  const digits = String(scaleKey).replace(/\D/g, "");
  return digits || String(scaleKey).toUpperCase();
}

export function scaleLabel(scaleKey: string): string {
  const s = scaleShort(scaleKey);
  return /^\d+$/.test(s) ? `${s} nmol` : String(scaleKey);
}

function codeToken(text: string): string {
  const t = String(text).toUpperCase().replace(/\+/g, "LNA");
  return t
    .replace(/[^A-Z0-9]/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

export function modifiedBaseFamily(token: string): string {
  const t = String(token).trim();
  if (t.length === 2 && t[0] === "+" && "ACGTU".includes(t[1].toUpperCase())) return "LNA";
  if (t.length === 2 && (t[0] === "m" || t[0] === "M") && "ACGTU".includes(t[1].toUpperCase())) return "OME";
  return codeToken(t);
}

export function defaultItemCode(key: string): string {
  const parts = key.split("|");
  const kind = parts[0];
  if (kind === "std") return `OLG-B${scaleShort(parts[1])}-${parts[2].replace(/-/g, "")}`;
  if (kind === "modbase") return `OLG-MB${scaleShort(parts[1])}-${modifiedBaseFamily(parts[2])}`;
  if (kind === "m5" || kind === "m3" || kind === "mi") {
    const prefix = kind === "m5" ? "M5" : kind === "m3" ? "M3" : "MI";
    const suffix = parts[2] ? `-${scaleShort(parts[2])}` : "";
    return `OLG-${prefix}-${codeToken(parts[1])}${suffix}`;
  }
  if (kind === "dual") return `OLG-DM-${codeToken(parts[1])}-${scaleShort(parts[2])}`;
  if (kind === "dualoh") return `OLG-DMF-${scaleShort(parts[1])}`;
  if (kind === "pur") return `OLG-PUR-${codeToken(parts[1])}-${scaleShort(parts[2])}`;
  if (kind === "lyo") return `OLG-LYO${parts[1] ? `-${scaleShort(parts[1])}` : ""}`;
  if (kind === "amp") return parts[1]?.toLowerCase().includes("plasmid") ? "OLG-AMP-PLA" : "OLG-AMP-LIN";
  if (kind === "tt") return `OLG-TT-${scaleShort(parts[1])}`;
  if (kind === "ttg") return `OLG-TTG-${scaleShort(parts[1])}`;
  return FALLBACK_ITEM_CODE;
}

export function itemCodeFor(key: string, config?: Partial<PriceConfig> | null): string {
  const code = config?.item_codes?.[key];
  return code && String(code).trim() ? String(code).trim() : defaultItemCode(key);
}

export function isFluorescentDye(modCode: string): boolean {
  if (!modCode) return false;
  const up = normalizeModCode(modCode);
  if (NON_FLUORESCENT_MOD_CODES.has(up)) return false;
  if (FLUORESCENT_DYE_CODES.has(up) || /^(AF|ALEXA|CY|QUASAR|ATTO|CFR)/.test(up)) return true;
  if (MOD_CATEGORY_MAP[up] === "dye") return true;
  return false;
}

/**
 * Chuẩn hóa chuỗi trình tự từ các kiểu viết tắt (5'-FAM-ATGC-3'-BHQ1, /56-FAM/ATGC/3BHQ_1/, v.v.)
 * về dạng chuẩn /MOD/ATGC/MOD/ tương thích 100% với OligoFlow cũ.
 */
export function normalizeLegacySequence(sequenceStr: string): string {
  if (!sequenceStr) return "";
  let s = sequenceStr
    .replace(/\u00a0/g, " ")
    .replace(/[\u2018\u2019\u2032`´]/g, "'")
    .replace(/[\u2013\u2014]/g, "-")
    .trim();

  s = s.replace(/^(?:\(?5'?\)?|\[?5'?\]?|\/5'?\/|5-prime|5prime)\s*(?:[-:>]+|\s*-+\s*)*\s*/i, "").trim();
  s = s.replace(/\s*(?:[-:<]+|\s*-+\s*)*(?:\(?3'?\)?|\[?3'?\]?|\/3'?\/|3-prime|3prime)$/i, "").trim();
  s = s.replace(/\/[53]'?\//gi, "");

  // Chuẩn hóa 5' dyes đầu chuỗi nếu viết bằng dấu gạch ngang
  s = s.replace(/^\s*(?:5|6|56|5,6|5\(6\))?[-_]?FAM[-_/\s]+/i, "/FAM/");
  s = s.replace(/^\s*(?:5|6|56)?[-_]?HEX[-_/\s]+/i, "/HEX/");
  s = s.replace(/^\s*(?:5|6)?[-_]?TET[-_/\s]+/i, "/TET/");
  s = s.replace(/^\s*(?:TEXARED|TEXAS[-_ ]?RED|5?[-_]?TXR)[-_/\s]+/i, "/TXR/");
  s = s.replace(/^\s*(?:5?[-_]?CY5|CY5)[-_/\s]+/i, "/CY5/");
  s = s.replace(/^\s*(?:5?[-_]?CY3|CY3)[-_/\s]+/i, "/CY3/");
  s = s.replace(/^\s*(?:5?[-_]?ROX|ROX)[-_/\s]+/i, "/ROX/");
  s = s.replace(/^\s*(?:5?[-_]?VIC|VIC)[-_/\s]+/i, "/VIC/");
  s = s.replace(/^\s*(?:5?[-_]?JOE|JOE)[-_/\s]+/i, "/JOE/");
  s = s.replace(/^\s*(?:5?[-_]?BIOTIN(?:-TEG)?)[-_/\s]+/i, "/BIOTIN/");
  s = s.replace(/^\s*(?:5?[-_]?AMINO(?:-C6)?|5?[-_]?NH2)[-_/\s]+/i, "/NH2/");

  // Chuẩn hóa 3' quenchers cuối chuỗi
  s = s.replace(/[-_/\s]+(?:3[-_]?)?BHQ[-_ ]?([0123])\s*$/i, "/BHQ$1/");
  s = s.replace(/[-_/\s]+(?:3[-_]?)?MGB(?:[-_ ]?NFQ)?\s*$/i, "/MGB/");
  s = s.replace(/[-_/\s]+(?:3[-_]?)?TAMRA\s*$/i, "/TAMRA/");
  s = s.replace(/[-_/\s]+(?:3[-_]?)?INVDT\s*$/i, "/INVDT/");

  // Chuyển đổi ký hiệu [MOD] của OligoFlow cũ (ví dụ [FAM]ATGC[BHQ1]) sang /MOD/
  s = s.replace(/\[([^\[\]]+)\]/g, (_m, inner) => {
    const t = String(inner).trim();
    if (/^[53]'?$/i.test(t)) return "";
    const norm = normalizeModCode(t);
    return norm ? `/${norm}/` : "";
  });

  // Chuẩn hóa các token bên trong dấu /.../
  s = s.replace(/\/([^/]+)\//g, (_m, inner) => {
    const norm = normalizeModCode(String(inner));
    return norm ? `/${norm}/` : "";
  });

  return s.replace(/\s+/g, "");
}

export function extractSequenceModsAndBases(sequenceStr: string): {
  seqNorm: string;
  mods5Prime: string[];
  mods3Prime: string[];
  modsInternal: string[];
  bases: string[];
} {
  const seqNorm = normalizeLegacySequence(sequenceStr);
  const mods5Prime: string[] = [];
  const mods3Prime: string[] = [];
  const modsInternal: string[] = [];

  const regex = /\/([^/]+)\//g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(seqNorm)) !== null) {
    const cleanMod = normalizeModCode(m[1]);
    if (!cleanMod) continue;
    if (m.index === 0) {
      mods5Prime.push(cleanMod);
    } else if (m.index + m[0].length === seqNorm.length) {
      mods3Prime.push(cleanMod);
    } else {
      modsInternal.push(cleanMod);
    }
  }

  const seqNoSlashes = seqNorm.replace(/\/[^/]+\//g, "");
  const bases: string[] = [];
  let i = 0;
  while (i < seqNoSlashes.length) {
    const ch = seqNoSlashes[i];
    if (ch === "+" && i + 1 < seqNoSlashes.length) {
      bases.push(`+${seqNoSlashes[i + 1].toUpperCase()}`);
      i += 2;
      continue;
    }
    if ((ch === "m" || ch === "M") && i + 1 < seqNoSlashes.length && "ACGTU".includes(seqNoSlashes[i + 1].toUpperCase())) {
      // Lưu ý: chữ 'M' đơn lẻ cũng là mã IUPAC (A/C), nhưng trong OligoFlow 'mA', 'mC', 'mG', 'mT', 'mU' hoặc 'MA' khi đi kèm
      if (ch === "m") {
        bases.push(`M${seqNoSlashes[i + 1].toUpperCase()}`);
        i += 2;
        continue;
      }
    }
    if ((ch === "f" || ch === "F") && i + 1 < seqNoSlashes.length && "ACGTU".includes(seqNoSlashes[i + 1].toUpperCase())) {
      bases.push(`F${seqNoSlashes[i + 1].toUpperCase()}`);
      i += 2;
      continue;
    }
    if (seqNoSlashes.slice(i, i + 2).toLowerCase() === "5m" && i + 2 < seqNoSlashes.length && "ACGTU".includes(seqNoSlashes[i + 2].toUpperCase())) {
      bases.push(`5M${seqNoSlashes[i + 2].toUpperCase()}`);
      i += 3;
      continue;
    }
    const up = ch.toUpperCase();
    if ("ACGTRYSWKMBDHVNUTI".includes(up)) {
      bases.push(up);
    }
    i += 1;
  }

  return { seqNorm, mods5Prime, mods3Prime, modsInternal, bases };
}

/**
 * Quy tắc tính giá ABT:
 * - Probe đánh dấu huỳnh quang (đánh dấu kép 5'/3' có huỳnh quang hoặc cặp Probe trong dual_modification_pricing)
 *   và Primer đánh dấu huỳnh quang đầu 5' (5'-FAM, 5'-HEX, 5'-Cy3, 5'-Cy5, 5'-ROX, 5'-TXR, 5'-VIC, 5'-TAMRA...):
 *   KHÔNG tính tiền trình tự (base chuẩn = 0 đ, giá trọn gói theo mã Probe / 5' Dye; chỉ cộng phụ phí nếu có base biến đổi LNA / 2'-OMe).
 * - Còn lại Primer đánh dấu Biotin, NH2 (hoặc Phosphate, Thiol...) ở đầu 5' và Primer thường:
 *   ĐỀU tính tiền trình tự (số lượng base * đơn giá base chuẩn) + tiền biến đổi 5'.
 */
export function sequenceSkipsStandardBasePrice(sequenceStr: string, config: PriceConfig = DEFAULT_PRICE_CONFIG): boolean {
  if (!sequenceStr) return false;
  const { mods5Prime, mods3Prime, modsInternal } = extractSequenceModsAndBases(sequenceStr);
  if (!mods5Prime.length && !mods3Prime.length && !modsInternal.length) return false;

  if (mods5Prime.some((m) => isFluorescentDye(m))) return true;

  const hasAnyDye = [...mods5Prime, ...mods3Prime, ...modsInternal].some((m) => isFluorescentDye(m));
  if (mods5Prime.length > 0 && mods3Prime.length > 0) {
    const pairKey = `${mods5Prime[0].toUpperCase()}/${mods3Prime[0].toUpperCase()}`;
    if (hasAnyDye || pairKey in (config.dual_modification_pricing ?? {})) return true;
  }
  if (hasAnyDye && mods3Prime.length > 0) return true;
  return false;
}

function addLine(lines: PriceLine[], config: PriceConfig, key: string, name: string, unit: string, qty: number, unitPrice: number) {
  for (const ln of lines) {
    if (ln.key === key && ln.unit_price === unitPrice) {
      ln.qty += qty;
      ln.amount = ln.qty * ln.unit_price;
      return;
    }
  }
  lines.push({
    key,
    code: key.startsWith("fb|") ? FALLBACK_ITEM_CODE : itemCodeFor(key, config),
    name,
    unit,
    qty,
    unit_price: unitPrice,
    amount: qty * unitPrice,
  });
}

export function calculateSequencePriceLines(
  sequenceStr: string,
  scale: string,
  purification: string,
  format: string,
  classification = "DNA",
  config: PriceConfig = DEFAULT_PRICE_CONFIG,
  enforceLock = false
): PriceLine[] {
  if (!sequenceStr) return [];
  const lines: PriceLine[] = [];
  const { mods5Prime, mods3Prime, modsInternal, bases } = extractSequenceModsAndBases(sequenceStr);
  const seqLength = bases.length;

  // 0. Amplicon flat pricing
  const isAmpliconClass =
    classification === "Amplicon" ||
    classification === "Amplicon (Linear)" ||
    classification === "Amplicon (Plasmid)" ||
    classification === "AMPLICON_LINEAR" ||
    classification === "AMPLICON_PLASMID";

  if (isAmpliconClass) {
    const ampCls =
      classification === "Amplicon (Plasmid)" || classification === "AMPLICON_PLASMID"
        ? "Amplicon (Plasmid)"
        : "Amplicon (Linear)";
    const maxLen = config.amplicon_pricing?.max_length ?? 500;
    if (enforceLock && seqLength > maxLen) {
      throw invalid(`Chiều dài trình tự Amplicon (${seqLength} bp) vượt quá giới hạn tối đa cho phép là ${maxLen} bp.`);
    }
    const flatPrice = Number(
      config.amplicon_pricing?.[ampCls] ?? (ampCls === "Amplicon (Plasmid)" ? 5500000 : 4400000)
    );
    addLine(lines, config, `amp|${ampCls}`, ampCls, "chuỗi", 1, flatPrice);
    return lines;
  }

  const normalizedS = normalizeScale(scale);
  const scaleLbl = scaleLabel(normalizedS);
  const scaleConfig = config.scales?.[normalizedS] ?? config.scales?.["100nmol"];
  if (!scaleConfig) {
    throw invalid(`Chưa có bảng giá cho quy mô '${scale}'.`);
  }

  const band = seqLength <= 14 ? "6-14" : seqLength <= 34 ? "15-34" : seqLength <= 60 ? "35-60" : "61-120";
  const stdPriceConfig = scaleConfig.base_standard ?? 11000;
  const stdPrice =
    typeof stdPriceConfig === "object" ? Number(stdPriceConfig[band] ?? 11000) : Number(stdPriceConfig);
  const stdKey = `std|${normalizedS}|${band}`;
  const stdName = `Tổng hợp oligo base chuẩn ${LENGTH_BAND_LABELS[band] ?? band} - ${scaleLbl}`;

  const modifiedBasePrices = scaleConfig.base_modified ?? {};
  const skipStdBase = sequenceSkipsStandardBasePrice(sequenceStr, config);

  // 1. Base Price Calculation
  for (const b of bases) {
    if (b in modifiedBasePrices) {
      addLine(lines, config, `modbase|${normalizedS}|${b}`, `Base biến đổi ${b} - ${scaleLbl}`, "base", 1, Number(modifiedBasePrices[b]));
    } else {
      const isModBase = (b.length > 1 && (b.startsWith("+") || b.startsWith("M") || b.startsWith("F") || b.startsWith("5M"))) || b === "I";
      if (isModBase) {
        let price = stdPrice * 10;
        for (const [prefix, fallbackPrice] of [
          ["+", 600000],
          ["M", 18000],
          ["F", 20000],
          ["5M", 20000],
        ] as const) {
          if (b.startsWith(prefix)) {
            const vals = Object.entries(modifiedBasePrices)
              .filter(([k]) => k.startsWith(prefix))
              .map(([, v]) => Number(v));
            price = vals.length ? vals.reduce((a, c) => a + c, 0) / vals.length : fallbackPrice;
            break;
          }
        }
        if (b === "I") price = 60000;
        addLine(lines, config, `fb|modbase|${b}|${normalizedS}`, `Base biến đổi ${b} - ${scaleLbl}`, "base", 1, price);
      } else if (!skipStdBase) {
        addLine(lines, config, stdKey, stdName, "base", 1, stdPrice);
      }
    }
  }

  // 2. 5' & 3' Modification Price Calculation
  const addMod = (
    kind: "m5" | "m3" | "mi",
    label: string,
    pricesDict: Record<string, Record<string, number> | number>,
    mKey: string,
    fallback: number
  ) => {
    const val = pricesDict?.[mKey];
    if (val && typeof val === "object" && normalizedS in val) {
      addLine(lines, config, `${kind}|${mKey}|${normalizedS}`, `${label} ${mKey} - ${scaleLbl}`, "vị trí", 1, Number(val[normalizedS]));
    } else if (typeof val === "number") {
      addLine(lines, config, `${kind}|${mKey}|`, `${label} ${mKey}`, "vị trí", 1, val);
    } else {
      addLine(lines, config, `fb|${kind}|${mKey}|${normalizedS}`, `${label} ${mKey} (chưa cấu hình giá) - ${scaleLbl}`, "vị trí", 1, fallback);
    }
  };

  const isDual = mods5Prime.length > 0 && mods3Prime.length > 0;
  if (isDual) {
    if (enforceLock && config.dual_modification_scales_status?.[normalizedS] === "locked") {
      throw invalid(
        `Dạng sản phẩm đánh dấu 2 đầu (Dual-labeled Probe) hiện đang khóa nhận tổng hợp ở nồng độ ${scale} (chỉ nhận nồng độ 100 nmol).`
      );
    }
    const pairKey = `${mods5Prime[0].toUpperCase()}/${mods3Prime[0].toUpperCase()}`;
    const pairPrice =
      config.dual_modification_pricing?.[pairKey]?.[normalizedS] ??
      config.dual_modification_pricing?.[pairKey]?.["100nmol"];
    if (pairPrice != null) {
      addLine(lines, config, `dual|${pairKey}|${normalizedS}`, `Đầu dò đánh dấu kép ${pairKey} - ${scaleLbl}`, "chuỗi", 1, Number(pairPrice));
      for (const m of mods5Prime.slice(1)) addMod("m5", "Biến đổi đầu 5'", config.modifications_5prime, m, 250000);
      for (const m of mods3Prime.slice(1)) addMod("m3", "Biến đổi đầu 3'", config.modifications_3prime, m, 350000);
    } else {
      for (const m of mods5Prime) addMod("m5", "Biến đổi đầu 5'", config.modifications_5prime, m, 250000);
      for (const m of mods3Prime) addMod("m3", "Biến đổi đầu 3'", config.modifications_3prime, m, 350000);
      const overhead = config.dual_modification_overhead?.[normalizedS];
      if (overhead != null) {
        addLine(lines, config, `dualoh|${normalizedS}`, `Phí đánh dấu kép (cặp chưa có giá riêng) - ${scaleLbl}`, "chuỗi", 1, Number(overhead));
      } else {
        addLine(lines, config, `fb|dual|${pairKey}|${normalizedS}`, `Đầu dò đánh dấu kép ${pairKey} - ${scaleLbl}`, "chuỗi", 1, 50000);
      }
    }
  } else {
    for (const m of mods5Prime) addMod("m5", "Biến đổi đầu 5'", config.modifications_5prime, m, 250000);
    for (const m of mods3Prime) addMod("m3", "Biến đổi đầu 3'", config.modifications_3prime, m, 350000);
  }

  // 3. Internal Modification Price Calculation
  for (const m of modsInternal) {
    addMod("mi", "Biến đổi nội (internal)", config.modifications_internal, m, 400000);
  }

  // 4. Purification Fee
  const purifRanks: Record<string, number> = {
    desalt: 1,
    dst: 1,
    "khu muoi": 1,
    "khử muối": 1,
    opc: 2,
    page: 3,
    hplc: 4,
  };
  let purifNorm = (purification || "Desalt").trim();
  if (["DST", "DESALT", "KHỬ MUỐI", "KHU MUOI"].includes(purifNorm.toUpperCase())) {
    purifNorm = "Desalt";
  } else if (purifNorm.toUpperCase() === "HPLC") {
    purifNorm = "HPLC";
  } else if (purifNorm.toUpperCase() === "OPC") {
    purifNorm = "OPC";
  } else if (purifNorm.toUpperCase() === "PAGE") {
    purifNorm = "PAGE";
  }

  let lengthDefaultMethod = "Desalt";
  for (const rule of config.purification_default_by_length ?? []) {
    if (seqLength <= rule.max_len) {
      lengthDefaultMethod = rule.method;
      break;
    }
  }

  const allMods = [...mods5Prime, ...mods3Prime, ...modsInternal];
  const isModified = allMods.length > 0;
  let maxModRank = 1;
  let maxModMethod = "Desalt";
  for (const mod of allMods) {
    const cat = MOD_CATEGORY_MAP[mod] ?? "modified";
    const rule =
      config.modification_purification_rules?.[cat] ??
      config.modification_purification_rules?.[cat.toLowerCase()] ??
      config.modification_purification_rules?.[cat.toUpperCase()];
    if (rule) {
      const rank = purifRanks[rule.default_purification.toLowerCase()] ?? 1;
      if (rank > maxModRank) {
        maxModRank = rank;
        maxModMethod = rule.default_purification;
      }
      if (enforceLock && rule.enforce_hplc && purifNorm.toLowerCase() !== "hplc") {
        throw invalid(`Trình tự gắn biến đổi nhóm ${cat} (${mod}) bắt buộc phải tinh sạch bằng HPLC.`);
      }
    } else {
      maxModRank = 4;
      maxModMethod = "HPLC";
    }
  }
  const modDefaultMethod = isModified ? maxModMethod : "Desalt";
  const lengthRank = purifRanks[lengthDefaultMethod.toLowerCase()] ?? 1;
  const modRank = purifRanks[modDefaultMethod.toLowerCase()] ?? 1;
  const defaultRank = Math.max(lengthRank, modRank);
  const selectedRank = purifRanks[purifNorm.toLowerCase()] ?? 1;

  if (selectedRank > defaultRank) {
    const purifPricing = config.purification_pricing?.[purifNorm] ?? {};
    let priceScale = normalizedS;
    let purifPrice = Number(purifPricing[normalizedS] ?? 0);
    if (!purifPrice && normalizedS !== "100nmol") {
      purifPrice = Number(purifPricing["100nmol"] ?? 0);
      priceScale = "100nmol";
    }
    if (purifPrice > 0) {
      addLine(lines, config, `pur|${purifNorm}|${priceScale}`, `Tinh sạch ${purifNorm} - ${scaleLabel(priceScale)}`, "chuỗi", 1, purifPrice);
    }
  }

  // 5. Lyophilization Fee
  const isProbe = allMods.length > 0;
  const isAmplicon = seqLength > 60;
  const isHplc = purifNorm.toLowerCase() === "hplc";
  const isStandardPrimer = !isProbe && !isAmplicon && !isHplc;
  if (isStandardPrimer) {
    const isLyo = ["lyophilized", "đông khô", "dong kho", "lyo"].includes((format || "").toLowerCase());
    if (isLyo) {
      const lyoPricing = config.lyophilization_pricing ?? 30000;
      if (typeof lyoPricing === "object") {
        const p = Number(lyoPricing[normalizedS] ?? 30000);
        addLine(lines, config, `lyo|${normalizedS}`, `Đông khô - ${scaleLbl}`, "ống", 1, p);
      } else {
        addLine(lines, config, "lyo", "Đông khô", "ống", 1, Number(lyoPricing));
      }
    }
  }

  return lines;
}

export function orderSequenceLines(params: {
  sequenceStr: string;
  scale: string;
  purification: string;
  format: string;
  classification?: string;
  pricingType?: "auto" | "percentage" | "custom" | "demo" | string;
  pricePercentage?: number;
  customUnitPrice?: number | null;
  customTotal?: number | null;
  config?: PriceConfig;
  enforceLock?: boolean;
}): PriceLine[] {
  const {
    sequenceStr,
    scale,
    purification,
    format,
    classification = "DNA",
    pricingType = "auto",
    pricePercentage = 100,
    customUnitPrice = null,
    customTotal = null,
    config = DEFAULT_PRICE_CONFIG,
    enforceLock = false,
  } = params;

  const normalizedS = normalizeScale(scale);
  const isAmp = ["Amplicon", "Amplicon (Linear)", "Amplicon (Plasmid)", "AMPLICON_LINEAR", "AMPLICON_PLASMID"].includes(classification);

  if (customTotal != null && customTotal >= 0) {
    return [
      {
        key: `ttg|${normalizedS}`,
        code: itemCodeFor(`ttg|${normalizedS}`, config),
        name: `Tổng hợp oligo giá thỏa thuận trọn gói - ${scaleLabel(normalizedS)}`,
        unit: "chuỗi",
        qty: 1,
        unit_price: Number(customTotal),
        amount: Number(customTotal),
      },
    ];
  }

  const lines = calculateSequencePriceLines(sequenceStr, scale, purification, format, classification, config, enforceLock);

  if (pricingType === "demo") {
    return lines.map((ln) => ({ ...ln, unit_price: 0, amount: 0 }));
  }

  if (customUnitPrice != null && customUnitPrice >= 0) {
    const cu = Number(customUnitPrice);
    if (isAmp) {
      return lines.map((ln) => ({ ...ln, unit_price: cu, amount: cu * ln.qty }));
    }
    const stdLines = lines.filter((ln) => ln.key.startsWith("std|"));
    const stdPrice = stdLines[0]?.unit_price ?? 0;
    const baseLines = lines.filter((ln) => ln.key.startsWith("std|") || ln.key.startsWith("modbase|") || ln.key.startsWith("fb|modbase|"));
    const nBases = baseLines.reduce((s, ln) => s + ln.qty, 0);
    const out: PriceLine[] = [];
    if (nBases > 0) {
      out.push({
        key: `tt|${normalizedS}`,
        code: itemCodeFor(`tt|${normalizedS}`, config),
        name: `Tổng hợp oligo đơn giá thỏa thuận - ${scaleLabel(normalizedS)}`,
        unit: "base",
        qty: nBases,
        unit_price: cu,
        amount: cu * nBases,
      });
    }
    for (const ln of lines) {
      if (ln.key.startsWith("std|")) continue;
      if (ln.key.startsWith("modbase|") || ln.key.startsWith("fb|modbase|")) {
        const surcharge = ln.unit_price - stdPrice;
        if (surcharge !== 0) {
          out.push({
            ...ln,
            name: `${ln.name} (phụ phí so với base chuẩn)`,
            unit_price: surcharge,
            amount: surcharge * ln.qty,
          });
        }
        continue;
      }
      out.push(ln);
    }
    return out;
  }

  if (pricingType === "percentage") {
    const pct = Number(pricePercentage || 100) / 100;
    return lines.map((ln) => {
      const up = Math.round(ln.unit_price * pct);
      return { ...ln, unit_price: up, amount: up * ln.qty };
    });
  }

  return lines;
}

export function linesTotal(lines: PriceLine[]): number {
  return Math.round(lines.reduce((s, ln) => s + Number(ln.amount || 0), 0));
}

export function standardUnitPrice(lines: PriceLine[]): number {
  for (const prefix of ["tt|", "std|", "amp|", "ttg|"]) {
    const found = lines.find((ln) => ln.key.startsWith(prefix));
    if (found) return found.unit_price;
  }
  return 0;
}

export interface CatalogItemRow {
  key: string;
  group: string;
  item: string;
  scale: string;
  name: string;
  unit: string;
  price: number | null;
  default_code: string;
  code: string;
}

export function itemCatalog(config: PriceConfig = DEFAULT_PRICE_CONFIG): CatalogItemRow[] {
  const rows: CatalogItemRow[] = [];
  const scales = Object.keys(config.scales ?? {});
  const suffix = (sk: string) => (sk ? ` - ${scaleLabel(sk)}` : "");
  const add = (group: string, item: string, scaleKey: string, key: string, name: string, unit: string, price: number | null) => {
    rows.push({
      key,
      group,
      item,
      scale: scaleKey || "",
      name,
      unit,
      price,
      default_code: defaultItemCode(key),
      code: itemCodeFor(key, config),
    });
  };

  const gStd = "Tổng hợp base chuẩn (VND/base)";
  for (const band of ["6-14", "15-34", "35-60", "61-120"]) {
    const label = LENGTH_BAND_LABELS[band] ?? band;
    for (const sk of scales) {
      const std = config.scales[sk]?.base_standard;
      const price = typeof std === "object" ? Number(std[band] ?? 0) : Number(std ?? 0);
      add(gStd, label, sk, `std|${sk}|${band}`, `Tổng hợp oligo base chuẩn ${label}${suffix(sk)}`, "base", price);
    }
  }

  const gModBase = "Base biến đổi (VND/base)";
  const tokens: string[] = [];
  for (const sk of scales) {
    for (const tk of Object.keys(config.scales[sk]?.base_modified ?? {})) {
      if (!tokens.includes(tk)) tokens.push(tk);
    }
  }
  for (const tk of tokens) {
    for (const sk of scales) {
      const mod = config.scales[sk]?.base_modified ?? {};
      if (tk in mod) {
        add(gModBase, tk, sk, `modbase|${sk}|${tk}`, `Base biến đổi ${tk}${suffix(sk)}`, "base", Number(mod[tk]));
      }
    }
  }

  for (const [kind, sectionKey, label] of [
    ["m5", "modifications_5prime", "Biến đổi đầu 5'"],
    ["m3", "modifications_3prime", "Biến đổi đầu 3'"],
    ["mi", "modifications_internal", "Biến đổi nội (internal)"],
  ] as const) {
    const sec = (config[sectionKey] ?? {}) as Record<string, Record<string, number> | number>;
    for (const [mod, val] of Object.entries(sec)) {
      if (val && typeof val === "object") {
        for (const [sk, price] of Object.entries(val)) {
          add(label, mod, sk, `${kind}|${mod}|${sk}`, `${label} ${mod}${suffix(sk)}`, "vị trí", Number(price));
        }
      } else {
        add(label, mod, "", `${kind}|${mod}|`, `${label} ${mod}`, "vị trí", Number(val));
      }
    }
  }

  const gDual = "Đầu dò đánh dấu kép 5'/3'";
  for (const [pair, val] of Object.entries(config.dual_modification_pricing ?? {})) {
    for (const [sk, price] of Object.entries(val ?? {})) {
      add(gDual, pair, sk, `dual|${pair}|${sk}`, `Đầu dò đánh dấu kép ${pair}${suffix(sk)}`, "chuỗi", Number(price));
    }
  }
  for (const [sk, price] of Object.entries(config.dual_modification_overhead ?? {})) {
    add(gDual, "Phí đánh dấu kép (cặp chưa có giá riêng)", sk, `dualoh|${sk}`, `Phí đánh dấu kép (cặp chưa có giá riêng)${suffix(sk)}`, "chuỗi", Number(price));
  }

  const gPur = "Tinh sạch";
  for (const [method, val] of Object.entries(config.purification_pricing ?? {})) {
    for (const [sk, price] of Object.entries(val ?? {})) {
      add(gPur, method, sk, `pur|${method}|${sk}`, `Tinh sạch ${method}${suffix(sk)}`, "chuỗi", Number(price));
    }
  }

  const gOther = "Đông khô, Amplicon";
  const lyo = config.lyophilization_pricing ?? 30000;
  if (typeof lyo === "object") {
    for (const [sk, price] of Object.entries(lyo)) {
      add(gOther, "Đông khô", sk, `lyo|${sk}`, `Đông khô${suffix(sk)}`, "ống", Number(price));
    }
  } else {
    add(gOther, "Đông khô", "", "lyo", "Đông khô", "ống", Number(lyo));
  }
  for (const cls of ["Amplicon (Linear)", "Amplicon (Plasmid)"] as const) {
    add(gOther, cls, "", `amp|${cls}`, cls, "chuỗi", Number(config.amplicon_pricing?.[cls] ?? 0));
  }

  const gCustom = "Giá thỏa thuận (đơn giá tự do, giá trọn gói)";
  for (const sk of scales) {
    add(gCustom, "Đơn giá base thỏa thuận", sk, `tt|${sk}`, `Tổng hợp oligo đơn giá thỏa thuận${suffix(sk)}`, "base", null);
  }
  for (const sk of scales) {
    add(gCustom, "Giá trọn gói thỏa thuận", sk, `ttg|${sk}`, `Tổng hợp oligo giá thỏa thuận trọn gói${suffix(sk)}`, "chuỗi", null);
  }

  return rows;
}

let pricingSchemaEnsured = false;

export async function ensureOligoPricingSchema(tx: Tx): Promise<void> {
  if (pricingSchemaEnsured) return;
  await tx.query("SAVEPOINT oligo_pricing_schema_sp");
  try {
    await tx.query(`
      CREATE TABLE IF NOT EXISTS oligo.price_config (
        id integer PRIMARY KEY DEFAULT 1,
        config jsonb NOT NULL,
        version integer NOT NULL DEFAULT 1,
        updated_at timestamptz NOT NULL DEFAULT now(),
        updated_by integer
      )
    `);
    await tx.query(
      `INSERT INTO oligo.price_config (id, config)
       VALUES (1, $1::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [JSON.stringify(DEFAULT_PRICE_CONFIG)]
    );

    await tx.query(`
      ALTER TABLE oligo.oligo_order
        ADD COLUMN IF NOT EXISTS pricing_type text NOT NULL DEFAULT 'auto',
        ADD COLUMN IF NOT EXISTS price_percentage numeric(6,2) NOT NULL DEFAULT 100,
        ADD COLUMN IF NOT EXISTS vat_rate numeric(5,2) NOT NULL DEFAULT 8,
        ADD COLUMN IF NOT EXISTS total_price numeric(18,2) NOT NULL DEFAULT 0
    `);

    await tx.query(`
      ALTER TABLE oligo.oligo_sequence
        ADD COLUMN IF NOT EXISTS unit_price numeric(18,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS price numeric(18,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS price_lines_json jsonb NOT NULL DEFAULT '[]'::jsonb
    `);

    // Tự động tính giá cho các trình tự hiện có chưa có giá
    const unpricedSeqs = (
      await tx.query(
        `SELECT s.id, s.order_id, s.raw_sequence, s.normalized_sequence, s.scale_code, s.purification, s.format, s.product_type,
                o.pricing_type, o.price_percentage
           FROM oligo.oligo_sequence s
           LEFT JOIN oligo.oligo_order o ON o.id = s.order_id
          WHERE s.price = 0 AND s.status NOT IN ('CANCELLED', 'SPLIT')`
      )
    ).rows;

    if (unpricedSeqs.length > 0) {
      const cfg = await loadPriceConfig(tx);
      const affectedOrders = new Set<string>();
      for (const s of unpricedSeqs) {
        const cls =
          s.product_type === "AMPLICON_PLASMID"
            ? "Amplicon (Plasmid)"
            : s.product_type === "AMPLICON_LINEAR"
            ? "Amplicon (Linear)"
            : "DNA";
        const lines = orderSequenceLines({
          sequenceStr: s.normalized_sequence || s.raw_sequence,
          scale: s.scale_code || "100NMOL",
          purification: s.purification || "DESALT",
          format: s.format || "LYOPHILIZED",
          classification: cls,
          pricingType: s.pricing_type || "auto",
          pricePercentage: Number(s.price_percentage ?? 100),
          config: cfg,
          enforceLock: false,
        });
        const total = linesTotal(lines);
        const unit = standardUnitPrice(lines);
        await tx.query(
          `UPDATE oligo.oligo_sequence
              SET unit_price = $2, price = $3, price_lines_json = $4::jsonb
            WHERE id = $1`,
          [s.id, unit, total, JSON.stringify(lines)]
        );
        if (s.order_id) affectedOrders.add(s.order_id);
      }
      for (const ordId of affectedOrders) {
        await recomputeOrderTotalPrice(tx, ordId);
      }
    }

    await tx.query("RELEASE SAVEPOINT oligo_pricing_schema_sp");
    pricingSchemaEnsured = true;
  } catch (err) {
    await tx.query("ROLLBACK TO SAVEPOINT oligo_pricing_schema_sp").catch(() => {});
    console.warn("[ensureOligoPricingSchema] warning:", err);
  }
}

export async function loadPriceConfig(tx: Tx): Promise<PriceConfig> {
  const row = (await tx.query("SELECT config FROM oligo.price_config WHERE id = 1")).rows[0];
  if (!row?.config) return DEFAULT_PRICE_CONFIG;
  return { ...DEFAULT_PRICE_CONFIG, ...(row.config as Partial<PriceConfig>) };
}

export async function getPricingConfigResponse(tx: Tx, actor: AuthzActor) {
  await ensureOligoPricingSchema(tx);
  await authorize(tx, actor, "oligo.view");
  const row = (await tx.query("SELECT config, version, updated_at FROM oligo.price_config WHERE id = 1")).rows[0];
  const config: PriceConfig = { ...DEFAULT_PRICE_CONFIG, ...(row?.config ?? {}) };
  return {
    config,
    version: row?.version ?? 1,
    updated_at: row?.updated_at ?? null,
    catalog: itemCatalog(config),
  };
}

export async function savePricingConfig(tx: Tx, actor: AuthzActor, input: unknown) {
  await ensureOligoPricingSchema(tx);
  await authorizeAnywhere(tx, actor, "oligo.pricing.manage").catch((err) => {
    if (err?.code === "FORBIDDEN") return authorizeAnywhere(tx, actor, "oligo.catalog.manage");
    throw err;
  });
  const schema = z.object({
    config: z.record(z.unknown()),
    reason: z.string().trim().optional().nullable(),
  });
  const data = parseInput(schema, input);
  const merged: PriceConfig = {
    ...DEFAULT_PRICE_CONFIG,
    ...(data.config as Partial<PriceConfig>),
  };
  const upd = (
    await tx.query(
      `UPDATE oligo.price_config
          SET config = $1::jsonb, version = version + 1, updated_at = now(), updated_by = $2
        WHERE id = 1
        RETURNING version, updated_at`,
      [JSON.stringify(merged), actor.userId]
    )
  ).rows[0];
  await writeAudit(tx, actor, {
    entityType: "oligo_price_config",
    entityId: "1",
    action: "update_price_config",
    changes: { version: [(upd?.version ?? 2) - 1, upd?.version ?? 1] },
    reason: data.reason || "Cập nhật cấu hình bảng giá Oligo",
  });
  return {
    config: merged,
    version: upd?.version ?? 1,
    updated_at: upd?.updated_at ?? null,
    catalog: itemCatalog(merged),
  };
}

export async function recomputeOrderTotalPrice(tx: Tx, orderId: string): Promise<number> {
  const sumRow = (
    await tx.query(
      `SELECT coalesce(sum(price), 0)::float AS sub_total
         FROM oligo.oligo_sequence
        WHERE order_id = $1 AND status NOT IN ('CANCELLED', 'SPLIT')`,
      [orderId]
    )
  ).rows[0];
  const subTotal = Number(sumRow?.sub_total ?? 0);
  const ord = (await tx.query("SELECT vat_rate, internal_order_id FROM oligo.oligo_order WHERE id = $1", [orderId])).rows[0];
  const vatRate = Number(ord?.vat_rate ?? 8);
  const totalWithVat = Math.round(subTotal * (1 + vatRate / 100));
  await tx.query("UPDATE oligo.oligo_order SET total_price = $2 WHERE id = $1", [orderId, totalWithVat]);
  return totalWithVat;
}

export async function recalculateOrderPricing(
  tx: Tx,
  actor: AuthzActor,
  orderId: string,
  input: unknown
) {
  await ensureOligoPricingSchema(tx);
  const schema = z.object({
    pricing_type: z.enum(["auto", "percentage", "custom", "demo"]).default("auto"),
    price_percentage: z.coerce.number().min(0).max(500).default(100),
    vat_rate: z.coerce.number().min(0).max(30).default(8),
    custom_unit_price: z.coerce.number().min(0).optional().nullable(),
    sequence_overrides: z
      .array(
        z.object({
          sequence_id: z.string().uuid(),
          custom_unit_price: z.coerce.number().min(0).optional().nullable(),
          custom_total: z.coerce.number().min(0).optional().nullable(),
        })
      )
      .optional(),
  });
  const d = parseInput(schema, input);
  const ord = (await tx.query("SELECT * FROM oligo.oligo_order WHERE id = $1 FOR UPDATE", [orderId])).rows[0];
  if (!ord) throw invalid("Không tìm thấy đơn Oligo.");
  await authorize(tx, actor, "oligo.order.manage", ord.org_unit_id);

  await tx.query(
    `UPDATE oligo.oligo_order
        SET pricing_type = $2, price_percentage = $3, vat_rate = $4, updated_at = now(), updated_by = $5
      WHERE id = $1`,
    [orderId, d.pricing_type, d.price_percentage, d.vat_rate, actor.userId]
  );

  const cfg = await loadPriceConfig(tx);
  const seqs = (
    await tx.query(
      `SELECT id, raw_sequence, normalized_sequence, scale_code, purification, format, product_type
         FROM oligo.oligo_sequence
        WHERE order_id = $1 AND status NOT IN ('CANCELLED', 'SPLIT')`,
      [orderId]
    )
  ).rows;

  const overrideMap = new Map(
    (d.sequence_overrides ?? []).map((o) => [o.sequence_id, o])
  );

  for (const s of seqs) {
    const ov = overrideMap.get(s.id);
    const cls =
      s.product_type === "AMPLICON_PLASMID"
        ? "Amplicon (Plasmid)"
        : s.product_type === "AMPLICON_LINEAR"
        ? "Amplicon (Linear)"
        : "DNA";
    const lines = orderSequenceLines({
      sequenceStr: s.normalized_sequence || s.raw_sequence,
      scale: s.scale_code || "100NMOL",
      purification: s.purification || "DESALT",
      format: s.format || "LYOPHILIZED",
      classification: cls,
      pricingType: d.pricing_type,
      pricePercentage: d.price_percentage,
      customUnitPrice: ov?.custom_unit_price ?? (d.pricing_type === "custom" ? d.custom_unit_price : null),
      customTotal: ov?.custom_total ?? null,
      config: cfg,
      enforceLock: false,
    });
    const total = linesTotal(lines);
    const unit = standardUnitPrice(lines);
    await tx.query(
      `UPDATE oligo.oligo_sequence
          SET unit_price = $2, price = $3, price_lines_json = $4::jsonb
        WHERE id = $1`,
      [s.id, unit, total, JSON.stringify(lines)]
    );
  }

  const totalWithVat = await recomputeOrderTotalPrice(tx, orderId);
  await writeAudit(tx, actor, {
    entityType: "oligo_order",
    entityId: orderId,
    action: "recalculate_pricing",
    changes: {
      pricing_type: [ord.pricing_type, d.pricing_type],
      price_percentage: [ord.price_percentage, d.price_percentage],
      total_price: [ord.total_price, totalWithVat],
    },
  });
  return { order_id: orderId, total_price: totalWithVat };
}
