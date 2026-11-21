/**
 * Bộ tách trình tự Oligo dùng chung cho tính giá phía nhà máy (src/factory/oligo/pricing.ts)
 * và bộ báo giá theo mã SKU của Kinh doanh (src/frontend/utils/oligoCatalogPricing.ts).
 *
 * Thuần (không I/O), chạy được cả ở server lẫn trình duyệt.
 *
 * Quy tắc nhận diện:
 *  - Nhóm đánh dấu / biến đổi viết dạng /FAM/, [FAM], hoặc là một cụm tách bằng dấu gạch / khoảng trắng
 *    (FAM-ACGT-BHQ1, 5'-HEX-ACGT-3'). Tên đã biết luôn được nhận là nhóm đánh dấu trước, nên các ký tự
 *    A/C/G/T/M/R… trong tên (TAMRA, VIC, MGB…) KHÔNG bị tách thành base.
 *  - Base: A C G T U, base suy biến IUPAC (R Y S W K M B D H V N), I (inosine), +N (LNA), mN (2'-OMe),
 *    fN (2'-F), 5mC (5-methyl-dC). "m"/"f" chỉ là tiền tố biến đổi khi base phía sau viết HOA
 *    (giống analyzer.ts); "acgtmac" viết thường vẫn là base suy biến M.
 *  - Cụm không phải base và không phải tên đã biết được giữ nguyên là một nhóm đánh dấu chưa biết
 *    (không bao giờ bị rã thành base).
 *  - Vị trí: nhóm trước base đầu tiên là 5', sau base cuối là 3', còn lại là internal.
 */

export const FLUORESCENT_DYE_CODES = new Set([
  "FAM", "HEX", "TET", "JOE", "VIC", "ROX", "TXR", "TAMRA",
  "CY3", "CY5", "CY5.5", "CY7",
  "AF488", "AF568", "AF647", "ALEXA488", "ALEXA568", "ALEXA594", "ALEXA647",
  "FITC", "NED", "SUN", "YAKIMA", "QUASAR570", "QUASAR670", "CFR610",
  "ATTO488", "ATTO550", "ATTO647N",
]);

export const NON_FLUORESCENT_MOD_CODES = new Set([
  "BIOTIN", "NH2", "AMINO", "PHOS", "PO4", "THIOL", "SH", "INVDT",
  "SPACER", "C3", "C6", "C12", "5MC", "DIG", "ALK", "AZIDE", "DBCO",
]);

export const MOD_CATEGORY_MAP: Record<string, string> = {
  FAM: "dye", HEX: "dye", CY5: "dye", CY3: "dye", TAMRA: "dye", AF488: "dye", ALEXA594: "dye",
  JOE: "dye", VIC: "dye", ROX: "dye", TXR: "dye", "CY5.5": "dye", CY7: "dye", TET: "dye",
  AF568: "dye", AF647: "dye",
  BHQ0: "quencher", BHQ1: "quencher", BHQ2: "quencher", BHQ3: "quencher", MGB: "quencher", DABCYL: "quencher",
  BIOTIN: "biotin_nh2", NH2: "biotin_nh2", PHOS: "modified", THIOL: "modified", INVDT: "modified",
  SPACER: "modified", C3: "modified", C6: "modified", "5MC": "modified",
  "+A": "LNA", "+C": "LNA", "+G": "LNA", "+T": "LNA", "+U": "LNA",
  MA: "2-OMe", MC: "2-OMe", MG: "2-OMe", MT: "2-OMe", MU: "2-OMe",
};

export const MOD_ALIASES: Record<string, string> = {
  "5TEXRD-XN": "TXR", "3TEXRD-XN": "TXR", "TEXRD-XN": "TXR", TEXRD: "TXR", TEXASRED: "TXR", "TEXAS RED": "TXR", "TEXAS-RED": "TXR", TEXARED: "TXR",
  "5TXR": "TXR", "3TXR": "TXR", "5-TXR": "TXR", "3-TXR": "TXR",
  "3BHQ_2": "BHQ2", "5BHQ_2": "BHQ2", BHQ_2: "BHQ2", "3BHQ2": "BHQ2", "5BHQ2": "BHQ2", "3-BHQ2": "BHQ2", "5-BHQ2": "BHQ2", "BHQ-2": "BHQ2", "3-BHQ-2": "BHQ2",
  "3BHQ_1": "BHQ1", "5BHQ_1": "BHQ1", BHQ_1: "BHQ1", "3BHQ1": "BHQ1", "5BHQ1": "BHQ1", "3-BHQ1": "BHQ1", "5-BHQ1": "BHQ1", "BHQ-1": "BHQ1", "3-BHQ-1": "BHQ1",
  "3BHQ_3": "BHQ3", "5BHQ_3": "BHQ3", BHQ_3: "BHQ3", "3BHQ3": "BHQ3", "5BHQ3": "BHQ3", "3-BHQ3": "BHQ3", "5-BHQ3": "BHQ3", "BHQ-3": "BHQ3", "3-BHQ-3": "BHQ3",
  "3BHQ_0": "BHQ0", BHQ_0: "BHQ0", "BHQ-0": "BHQ0",
  "5FAM": "FAM", "3FAM": "FAM", "6-FAM": "FAM", "5-FAM": "FAM", "56-FAM": "FAM", "36-FAM": "FAM", "6FAM": "FAM", "5(6)-FAM": "FAM",
  "5HEX": "HEX", "3HEX": "HEX", "5-HEX": "HEX", "6-HEX": "HEX", "6HEX": "HEX", "56-HEX": "HEX",
  "5TET": "TET", "3TET": "TET", "5-TET": "TET",
  "5CY5": "CY5", "3CY5": "CY5", "5-CY5": "CY5", "3-CY5": "CY5",
  "5CY3": "CY3", "3CY3": "CY3", "5-CY3": "CY3", "3-CY3": "CY3",
  "5CY5.5": "CY5.5", "3CY5.5": "CY5.5", "5-CY5.5": "CY5.5", "3-CY5.5": "CY5.5",
  "5CY7": "CY7", "3CY7": "CY7", "5-CY7": "CY7", "3-CY7": "CY7",
  "5TAMRA": "TAMRA", "3TAMRA": "TAMRA", "5-TAMRA": "TAMRA", "3-TAMRA": "TAMRA", "56-TAMN": "TAMRA", "36-TAMSP": "TAMRA",
  "5ROXN": "ROX", "3ROXN": "ROX", "5JOEN": "JOE",
  "3MGB": "MGB", "5MGB": "MGB", "3-MGB": "MGB", "5-MGB": "MGB", MGBNFQ: "MGB", "MGB-NFQ": "MGB", MGB_NFQ: "MGB", "3MGBEC": "MGB",
  "5BIOTIN": "BIOTIN", "3BIOTIN": "BIOTIN", "5-BIOTIN": "BIOTIN", "3-BIOTIN": "BIOTIN", "BIOTIN-TEG": "BIOTIN", BIOTINTEG: "BIOTIN",
  "5BIOSG": "BIOTIN", BIOSG: "BIOTIN", "5BIOTEG": "BIOTIN", "3BIOTEG": "BIOTIN",
  "5AMINO": "NH2", "3AMINO": "NH2", "5-AMINO": "NH2", "3-AMINO": "NH2", "AMINO-C6": "NH2", AMINOC6: "NH2", "5-NH2": "NH2", "3-NH2": "NH2", "5NH2": "NH2", "3NH2": "NH2",
  "5AMMC6": "NH2", "3AMMO": "NH2", AMINO: "NH2",
  "5PHOS": "PHOS", "3PHOS": "PHOS", "5-PHOS": "PHOS", "3-PHOS": "PHOS", PHOSPHORYLATION: "PHOS",
  "5THIOL": "THIOL", "3THIOL": "THIOL", "5-THIOL": "THIOL", "3-THIOL": "THIOL", "THIOL-C6": "THIOL", THIOLC6: "THIOL",
  "3INVDT": "INVDT", "3-INVDT": "INVDT", "INVERTED-DT": "INVDT",
  "5MEDC": "5MC", "5-ME-DC": "5MC", "5-MEDC": "5MC", "5METHYLDC": "5MC", "5-METHYL-DC": "5MC", I5MEDC: "5MC",
};

/** Mã nhóm đánh dấu / biến đổi chuẩn đã biết (không gồm base biến đổi LNA / 2'-OMe). */
export const KNOWN_MOD_CODES: ReadonlySet<string> = new Set([
  ...FLUORESCENT_DYE_CODES,
  ...NON_FLUORESCENT_MOD_CODES,
  ...Object.keys(MOD_CATEGORY_MAP).filter((k) => !["LNA", "2-OMe"].includes(MOD_CATEGORY_MAP[k])),
  ...Object.values(MOD_ALIASES),
]);

export function normalizeModCode(raw: string): string {
  const up = raw.trim().toUpperCase();
  if (!up) return "";
  if (MOD_ALIASES[up]) return MOD_ALIASES[up];
  if (MOD_CATEGORY_MAP[up]) return up;
  for (const prefix of ["5-", "3-", "5", "3"]) {
    if (up.startsWith(prefix) && up.length > prefix.length) {
      const sub = up.slice(prefix.length);
      if (MOD_ALIASES[sub]) return MOD_ALIASES[sub];
      if (MOD_CATEGORY_MAP[sub] || KNOWN_MOD_CODES.has(sub)) return sub;
    }
  }
  return up;
}

export function isFluorescentDye(modCode: string): boolean {
  if (!modCode) return false;
  const up = normalizeModCode(modCode);
  if (NON_FLUORESCENT_MOD_CODES.has(up)) return false;
  if (FLUORESCENT_DYE_CODES.has(up) || /^(AF|ALEXA|CY|QUASAR|ATTO|CFR)/.test(up)) return true;
  if (MOD_CATEGORY_MAP[up] === "dye") return true;
  return false;
}

export function isQuencher(modCode: string): boolean {
  return MOD_CATEGORY_MAP[normalizeModCode(modCode)] === "quencher";
}

/**
 * Bảng mã SKU Probe đánh dấu kép (cặp 5' dye / 3' quencher) theo bảng giá ABT Ver 04_2026 (chỉ 100 nmol).
 */
export const ABT_PROBE_SKU_BY_PAIR: Readonly<Record<string, string>> = {
  "FAM/BHQ1": "FAM.100",
  "HEX/BHQ1": "HEX.100",
  "TXR/BHQ2": "TEX.100",
  "CY5/BHQ2": "CY5.100",
  "CY3/BHQ2": "Cy3-BHQ2.100",
  "ROX/BHQ2": "ROX-BHQ2.100",
  "VIC/BHQ1": "VIC-BHQ1.100",
  "AF568/BHQ2": "AF568-BHQ2.100",
  "AF647/BHQ2": "AF647-BHQ2.100",
  "FAM/TAMRA": "FAM-TAMRA.100",
  "HEX/TAMRA": "HEX-TAMRA.100",
  "VIC/TAMRA": "VIC-TAMRA.100",
  "FAM/MGB": "FAM-MGB.100",
  "HEX/MGB": "HEX-MGB.100",
  "VIC/MGB": "VIC-MGB.100",
};

/** Họ SKU Primer gắn huỳnh quang đầu 5' theo mã thuốc nhuộm. */
export const ABT_DYE_PRIMER_FAMILY_BY_DYE: Readonly<Record<string, string>> = {
  FAM: "FAM-Primer",
  HEX: "HEX-Primer",
  TXR: "Texasred-Primer",
  CY5: "Cy5-Primer",
  CY3: "Cy3-Primer",
  ROX: "ROX-Primer",
  VIC: "VIC-Primer",
  AF568: "AF568-Primer",
  AF647: "AF647-Primer",
};

export type OligoSeqToken =
  | { kind: "base"; code: string }
  | { kind: "mod"; code: string; known: boolean; raw: string; /** viết trong /…/ hoặc […] */ tagged: boolean };

const BASE_RUN = /^(?:\+[ACGTUacgtu]|[mf][ACGTU]|5[mM][Cc]|[ACGTURYSWKMBDHVNIacgturyswkmbdhvni])+$/;
const ORIENTATION_ONLY = /^(?:[53]'?|[53][-_ ]?(?:PRIME|END))$/i;
/** Ký hiệu trong /…/ hoặc […] thực chất là base (LNA, inosine, 5-methyl-dC). */
const TAG_AS_BASE: Record<string, string> = { I: "I", DI: "I", INOSINE: "I", DINOSINE: "I", "5MC": "5MC" };

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Bí danh nhiều phần (chứa dấu gạch, gạch dưới, khoảng trắng, ngoặc) — thay trước khi tách cụm. */
const MULTI_PART_ALIASES: [RegExp, string][] = Object.keys(MOD_ALIASES)
  .filter((k) => /[-_ ()]/.test(k))
  .sort((a, b) => b.length - a.length)
  .map((k) => [new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(k)}(?![A-Za-z0-9])`, "gi"), MOD_ALIASES[k]]);

function parseBaseRun(chunk: string, out: OligoSeqToken[]) {
  let i = 0;
  while (i < chunk.length) {
    const c = chunk[i];
    const next = chunk[i + 1];
    if (c === "+" && next) {
      out.push({ kind: "base", code: `+${next.toUpperCase()}` });
      i += 2;
    } else if ((c === "m" || c === "f") && next && "ACGTU".includes(next)) {
      out.push({ kind: "base", code: `${c.toUpperCase()}${next}` });
      i += 2;
    } else if (c === "5" && (next === "m" || next === "M") && chunk[i + 2]?.toUpperCase() === "C") {
      out.push({ kind: "base", code: "5MC" });
      i += 3;
    } else {
      out.push({ kind: "base", code: c.toUpperCase() });
      i += 1;
    }
  }
}

function modToken(raw: string, out: OligoSeqToken[], tagged = false) {
  const t = raw.trim();
  if (!t || ORIENTATION_ONLY.test(t)) return;
  const up = t.toUpperCase();
  if (/^\+[ACGTU]$/.test(up)) return void out.push({ kind: "base", code: up });
  if (/^LNA[-_ ]?[ACGTU]$/.test(up)) return void out.push({ kind: "base", code: `+${up.slice(-1)}` });
  const code = normalizeModCode(t);
  if (TAG_AS_BASE[code]) return void out.push({ kind: "base", code: TAG_AS_BASE[code] });
  out.push({ kind: "mod", code, known: KNOWN_MOD_CODES.has(code), raw: t, tagged });
}

function isKnownModChunk(chunk: string): boolean {
  const up = chunk.toUpperCase();
  if (MOD_ALIASES[up]) return true;
  const code = normalizeModCode(chunk);
  return KNOWN_MOD_CODES.has(code) && !TAG_AS_BASE[code];
}

/** Tên nhóm đánh dấu dính liền base, ví dụ "FAMACGT" hay "ACGTBHQ1": tách tên dài nhất ở đầu / cuối cụm. */
function peelKnownMod(chunk: string): { prefix?: string; bases: string; suffix?: string } | null {
  const up = chunk.toUpperCase();
  const names = [...new Set([...KNOWN_MOD_CODES, ...Object.keys(MOD_ALIASES)])]
    .filter((n) => !/[-_ ()]/.test(n))
    .sort((a, b) => b.length - a.length);
  for (const n of names) {
    if (up.length > n.length && up.startsWith(n) && BASE_RUN.test(chunk.slice(n.length))) {
      return { prefix: chunk.slice(0, n.length), bases: chunk.slice(n.length) };
    }
    if (up.length > n.length && up.endsWith(n) && BASE_RUN.test(chunk.slice(0, -n.length))) {
      return { bases: chunk.slice(0, -n.length), suffix: chunk.slice(-n.length) };
    }
  }
  return null;
}

function tokenizeText(text: string, out: OligoSeqToken[]) {
  for (const chunk of text.split(/[\s\-_:;,<>(){}]+/)) {
    if (!chunk || ORIENTATION_ONLY.test(chunk)) continue;
    if (isKnownModChunk(chunk)) {
      modToken(chunk, out);
    } else if (BASE_RUN.test(chunk)) {
      parseBaseRun(chunk, out);
    } else {
      const peeled = peelKnownMod(chunk);
      if (peeled) {
        if (peeled.prefix) modToken(peeled.prefix, out);
        parseBaseRun(peeled.bases, out);
        if (peeled.suffix) modToken(peeled.suffix, out);
      } else {
        // không phải base, không phải tên đã biết → giữ nguyên là nhóm đánh dấu chưa biết, không rã thành base
        modToken(chunk, out);
      }
    }
  }
}

/** Tách trình tự khách gửi (mọi kiểu viết thường gặp) thành dãy token base / nhóm đánh dấu. */
export function tokenizeOligoSequence(input: string): OligoSeqToken[] {
  if (!input) return [];
  let s = String(input)
    .replace(/ /g, " ")
    .replace(/[‘’′`´]/g, "'")
    .replace(/[–—]/g, "-")
    .trim()
    // […] → /…/ (ký hiệu OligoFlow cũ: [FAM]ACGT[BHQ1], [+A], [I])
    .replace(/\[([^[\]]*)\]/g, (_m, inner: string) => `/${inner}/`);

  const tokens: OligoSeqToken[] = [];
  const segments = s.split(/(\/[^/]*\/)/);
  const texts: string[] = [];
  for (const seg of segments) {
    if (seg.startsWith("/") && seg.endsWith("/") && seg.length > 1) {
      texts.push(seg);
      continue;
    }
    let t = seg.replace(/\//g, " ");
    // bí danh nhiều phần (6-FAM, BHQ-1, MGB-NFQ, Texas Red, Biotin-TEG, 5-Me-dC…) → /MÃ/
    for (const [re, code] of MULTI_PART_ALIASES) t = t.replace(re, ` /${code}/ `);
    t = t.replace(/(?<![A-Za-z0-9])([35][-_]?)?BHQ[-_ ]([0-3])(?![A-Za-z0-9])/gi, " /BHQ$2/ ");
    // ký hiệu đầu mút có dấu nháy: 5'- … -3'
    t = t.replace(/[([]?[53]'[)\]]?/g, " ").replace(/(?<![A-Za-z0-9])[53][-_ ]?(?:prime|end)(?![A-Za-z0-9])/gi, " ");
    texts.push(t);
  }
  s = texts.join("");
  // ký hiệu đầu mút không dấu nháy, chỉ khi đứng riêng ở hai đầu: "5-ACGT-3"
  s = s.replace(/^[\s\-:>]*5\s*[-:>]+/, " ").replace(/[-:<\s]+3[\s\-:<]*$/, " ");

  for (const seg of s.split(/(\/[^/]*\/)/)) {
    if (!seg) continue;
    if (seg.startsWith("/") && seg.endsWith("/") && seg.length > 1) modToken(seg.slice(1, -1), tokens, true);
    else tokenizeText(seg, tokens);
  }
  return tokens;
}

export interface ParsedOligoSequence {
  tokens: OligoSeqToken[];
  /** Base theo thứ tự: A C G T U, base suy biến, I, +A (LNA), MA (2'-OMe), FA (2'-F), 5MC. */
  bases: string[];
  mods5Prime: string[];
  mods3Prime: string[];
  modsInternal: string[];
  /** Nhóm đánh dấu không có trong danh mục đã biết (vẫn được tính là nhóm đánh dấu). */
  unknownMods: string[];
}

export function parseOligoSequence(input: string): ParsedOligoSequence {
  const tokens = tokenizeOligoSequence(input);
  const firstBase = tokens.findIndex((t) => t.kind === "base");
  let lastBase = -1;
  tokens.forEach((t, i) => {
    if (t.kind === "base") lastBase = i;
  });
  const out: ParsedOligoSequence = { tokens, bases: [], mods5Prime: [], mods3Prime: [], modsInternal: [], unknownMods: [] };
  tokens.forEach((t, i) => {
    if (t.kind === "base") return void out.bases.push(t.code);
    if (!t.known) out.unknownMods.push(t.code);
    if (firstBase < 0 || i < firstBase) out.mods5Prime.push(t.code);
    else if (i > lastBase) out.mods3Prime.push(t.code);
    else out.modsInternal.push(t.code);
  });
  return out;
}

/** Ký tự base khi hiển thị dạng chuẩn: +A, mA, fA, 5mC, I, A… */
export function baseTokenText(code: string): string {
  if (/^[MF][ACGTU]$/.test(code)) return `${code[0].toLowerCase()}${code[1]}`;
  if (code === "5MC") return "5mC";
  return code;
}

/** Chữ base gốc của một token base (LNA / 2'-OMe / 2'-F / 5mC → chữ base nền). */
export function baseLetterOf(code: string): string {
  if (code === "5MC") return "C";
  if (code.length === 2 && "+MF".includes(code[0])) return code[1];
  return code;
}
