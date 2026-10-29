/**
 * Oligonucleotide sequence analyser (pure, no I/O). Formulas follow the former OligoFlow exactly (Q7):
 *  - MW = Σ token MW − 61.96 (RNA: +16.00 for standard A, C, G; degenerate bases = mean of their bases)
 *  - ε260 = nearest-neighbour DNA model on the bases (degenerate bases by expectation) + ε of modifications
 *  - Tm = SantaLucia 1998 nearest neighbour, [Na+] 50 mM, [oligo] 0.25 µM, self-complementary symmetry
 *  - nmol/OD = 10⁶ / ε260, µg/OD = MW / ε260 × 1000
 * Unlike OligoFlow, nothing is guessed: a modification must be in the catalogue (code or alias), otherwise
 * the sequence is refused with the unknown part named.
 */

export interface CatalogEntry {
  code: string;
  name: string;
  kind: "BASE" | "LNA" | "OME" | "F2" | "METHYL" | "DYE" | "QUENCHER" | "MODIFIER" | "SPACER";
  base_letter: string | null;
  nn_role: "BASE" | "MOD";
  mw: number | null;
  mw_delta: number | null;
  ext_coeff_260: number;
  aliases: string[];
  position_type: "ANY" | "5PRIME" | "3PRIME" | "INTERNAL";
}

export interface Token {
  code: string;
  /** Text in the normalised sequence: A, +A, mA, fA, 5mC, /FAM/ … */
  text: string;
  entry: CatalogEntry | null; // null = degenerate IUPAC base (R, Y, … N)
  base: string | null; // nucleotide letter for BASE-role tokens
}

export interface Analysis {
  normalized: string;
  tokens: Token[];
  length: number;
  gc_percent: number;
  molecule_type: "DNA" | "RNA";
  product_type: "PRIMER" | "PROBE" | "AMPLICON";
  mw: number;
  ext_coeff_260: number;
  nmol_per_od: number;
  ug_per_od: number;
  tm: number;
  self_complementary: boolean;
  modifications: string[];
  warnings: string[];
}

export class SequenceError extends Error {}

const DEGENERATE: Record<string, string[]> = {
  R: ["A", "G"], Y: ["C", "T"], S: ["G", "C"], W: ["A", "T"], K: ["G", "T"], M: ["A", "C"],
  B: ["C", "G", "T"], D: ["A", "G", "T"], H: ["A", "C", "T"], V: ["A", "C", "G"], N: ["A", "C", "G", "T"],
};
const NN_EPS: Record<string, number> = {
  AA: 27400, AC: 21200, AG: 25000, AT: 22800, CA: 21200, CC: 14600, CG: 18000, CT: 15200,
  GA: 25200, GC: 17600, GG: 21600, GT: 20000, TA: 23400, TC: 16200, TG: 19000, TT: 16800,
};
const SINGLE_EPS: Record<string, number> = { A: 15400, C: 7400, G: 11500, T: 8700 };
const THERMO: Record<string, [number, number]> = {
  AA: [-7.9, -22.2], TT: [-7.9, -22.2], AT: [-7.2, -20.4], TA: [-7.2, -21.3], CA: [-8.5, -22.7], TG: [-8.5, -22.7],
  GT: [-8.4, -22.4], AC: [-8.4, -22.4], CT: [-7.8, -21.0], AG: [-7.8, -21.0], GA: [-8.2, -22.2], TC: [-8.2, -22.2],
  CG: [-10.6, -27.2], GC: [-9.8, -24.4], GG: [-8.0, -19.9], CC: [-8.0, -19.9],
};
const BACKBONE_CORRECTION = 61.96;
const RNA_RIBOSE = 16.0;

/** Probability of each DNA base for a letter (U counts as T; inosine and N as any base). */
function probs(letter: string): Record<string, number> {
  if ("ACGT".includes(letter)) return { [letter]: 1 };
  if (letter === "U") return { T: 1 };
  const members = DEGENERATE[letter] ?? ["A", "C", "G", "T"];
  return Object.fromEntries(members.map((b) => [b, 1 / members.length]));
}

/** Python's round(): exact ties go to the even neighbour (OligoFlow used it). */
export function pyRound(x: number, digits: number): number {
  const m = 10 ** digits;
  const v = x * m;
  if (Math.abs(v - Math.trunc(v)) === 0.5) {
    const f = Math.floor(v);
    return Number(((f % 2 === 0 ? f : f + 1) / m).toFixed(digits));
  }
  return Number((Math.round(v) / m).toFixed(digits));
}

const ORIENTATION = /^(?:5|3)(?:'|PRIME|-?END)?$/i;

class Catalog {
  readonly byKey = new Map<string, CatalogEntry>();
  constructor(readonly entries: CatalogEntry[]) {
    for (const e of entries) {
      this.byKey.set(e.code.toUpperCase(), e);
      for (const a of e.aliases) this.byKey.set(a.toUpperCase(), e);
    }
  }
  base(letter: string) {
    return this.byKey.get(letter);
  }
}

/** Splits free text into tokens. Accepted: /CODE/ modifications, dash- or space-separated modification names,
 *  bases (IUPAC, U, I; lower case allowed), +N (LNA), mN (2'-OMe), fN (2'-F), 5mC. */
export function tokenize(input: string, catalog: CatalogEntry[]): Token[] {
  const cat = new Catalog(catalog);
  let s = (input ?? "")
    .replace(/ /g, " ")
    .replace(/[‘’′`´]/g, "'")
    .replace(/[–—]/g, "-")
    .trim()
    // orientation marks written around the sequence: 5'- … -3'
    .replace(/^[([]?5'[)\]]?\s*-?\s*/, "")
    .replace(/\s*-?\s*[([]?3'[)\]]?$/, "");
  const tokens: Token[] = [];
  const modToken = (raw: string) => {
    const key = raw.trim();
    if (!key || ORIENTATION.test(key)) return;
    const entry = cat.byKey.get(key.toUpperCase());
    if (!entry || entry.nn_role !== "MOD") throw new SequenceError(`Không nhận diện được modification "${key}". Dùng mã trong danh mục, ví dụ /FAM/, /BHQ1/.`);
    tokens.push({ code: entry.code, text: entry.kind === "METHYL" ? "5mC" : `/${entry.code}/`, entry, base: null });
  };
  const baseRun = (chunk: string) => {
    let i = 0;
    while (i < chunk.length) {
      const c = chunk[i];
      const next = chunk[i + 1];
      if (c === "+" && next && "ACGTU".includes(next.toUpperCase())) {
        const e = cat.base(`+${next.toUpperCase()}`)!;
        tokens.push({ code: e.code, text: e.code, entry: e, base: e.base_letter });
        i += 2;
      } else if ((c === "m" || c === "f") && next && "ACGTU".includes(next)) {
        const e = cat.base(`${c.toUpperCase()}${next}`)!;
        tokens.push({ code: e.code, text: `${c}${next}`, entry: e, base: e.base_letter });
        i += 2;
      } else if (c === "5" && (next === "m" || next === "M") && chunk[i + 2]?.toUpperCase() === "C") {
        const e = cat.base("5MC")!;
        tokens.push({ code: e.code, text: "5mC", entry: e, base: null });
        i += 3;
      } else if ("ACGTUI".includes(c.toUpperCase())) {
        const e = cat.base(c.toUpperCase())!;
        tokens.push({ code: e.code, text: e.code, entry: e, base: e.base_letter });
        i += 1;
      } else if (DEGENERATE[c.toUpperCase()]) {
        tokens.push({ code: c.toUpperCase(), text: c.toUpperCase(), entry: null, base: c.toUpperCase() });
        i += 1;
      } else {
        throw new SequenceError(`Ký tự "${c}" ở vị trí ${i + 1} của "${chunk}" không phải base hợp lệ.`);
      }
    }
  };
  const isBaseRun = (chunk: string) => /^(?:\+[ACGTUacgtu]|[mf][ACGTU]|5[mM][Cc]|[ACGTURYSWKMBDHVNIacgturyswkmbdhvni])+$/.test(chunk);

  for (const part of s.split(/(\/[^/]*\/)/)) {
    if (!part) continue;
    if (part.startsWith("/") && part.endsWith("/") && part.length > 1) {
      modToken(part.slice(1, -1));
      continue;
    }
    if (part.includes("/")) throw new SequenceError(`Dấu "/" không đóng: "${part}". Modification viết dạng /FAM/.`);
    for (const chunk of part.split(/[\s-]+/)) {
      if (!chunk || ORIENTATION.test(chunk)) continue;
      // a chunk is a known modification name first (e.g. "BHQ1", "6-FAM" pieces), then a run of bases
      const asMod = cat.byKey.get(chunk.toUpperCase());
      if (asMod && asMod.nn_role === "MOD" && asMod.kind !== "METHYL") modToken(chunk);
      else if (isBaseRun(chunk)) baseRun(chunk);
      else if (/[^A-Za-z0-9+._()]/.test(chunk)) {
        const bad = chunk.match(/[^A-Za-z0-9+._()]/)![0];
        throw new SequenceError(`Ký tự "${bad}" trong "${chunk}" không phải base hợp lệ.`);
      } else modToken(chunk);
    }
  }
  if (!tokens.some((t) => t.base)) throw new SequenceError("Trình tự không có base nào.");
  return tokens;
}

function baseMw(letter: string, rna: boolean, cat: Catalog): number {
  const members = DEGENERATE[letter] ?? [letter];
  const values = members.map((b0) => {
    const b = rna && b0 === "T" ? "U" : b0;
    const e = cat.base(b);
    const mw = e?.mw ?? 308.95;
    return rna && "ACG".includes(b) ? mw + RNA_RIBOSE : mw;
  });
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function tm(bases: string[]): { tm: number; selfComp: boolean } {
  const p = bases.map(probs);
  let H = 0;
  let S = 0;
  for (let i = 0; i < p.length - 1; i++) {
    for (const [b1, q1] of Object.entries(p[i])) {
      for (const [b2, q2] of Object.entries(p[i + 1])) {
        const t = THERMO[b1 + b2];
        if (t) {
          H += q1 * q2 * t[0];
          S += q1 * q2 * t[1];
        }
      }
    }
  }
  for (const end of [p[0], p[p.length - 1]]) {
    for (const [b, q] of Object.entries(end)) {
      H += q * (b === "G" || b === "C" ? 0.1 : 2.3);
      S += q * (b === "G" || b === "C" ? -2.8 : 4.1);
    }
  }
  const seq = bases.join("");
  const comp: Record<string, string> = { A: "T", T: "A", G: "C", C: "G", U: "A" };
  const selfComp = seq === [...seq].reverse().map((b) => comp[b] ?? b).join("");
  if (selfComp) S += -1.4;
  const sCorr = S + 0.368 * (bases.length - 1) * Math.log(0.05);
  const tmK = (H * 1000) / (sCorr + 1.9872 * Math.log(0.25e-6 / (selfComp ? 1 : 4)));
  return { tm: pyRound(tmK - 273.15, 1), selfComp };
}

/** Longest stretch of the sequence whose reverse complement also occurs in it (self-dimer / hairpin risk). */
function longestSelfComplementary(bases: string): number {
  const comp: Record<string, string> = { A: "T", T: "A", G: "C", C: "G", U: "A" };
  const rc = [...bases].reverse().map((b) => comp[b] ?? "N").join("");
  let best = 0;
  const prev = new Array(rc.length + 1).fill(0);
  for (let i = 1; i <= bases.length; i++) {
    let diag = 0;
    for (let j = 1; j <= rc.length; j++) {
      const tmp = prev[j];
      prev[j] = bases[i - 1] === rc[j - 1] && "ACGTU".includes(bases[i - 1]) ? diag + 1 : 0;
      if (prev[j] > best) best = prev[j];
      diag = tmp;
    }
  }
  return best;
}

export function analyze(input: string, catalog: CatalogEntry[]): Analysis {
  const cat = new Catalog(catalog);
  const tokens = tokenize(input, catalog);
  const rna = tokens.some((t) => t.base === "U");
  const baseLetters = tokens.filter((t) => t.base).map((t) => t.base as string);

  let mwSum = 0;
  let modEps = 0;
  for (const t of tokens) {
    const e = t.entry;
    if (!e) mwSum += baseMw(t.code, rna, cat);
    else if (e.mw_delta != null) mwSum += baseMw(e.base_letter!, rna, cat) + Number(e.mw_delta);
    else mwSum += Number(e.mw) + (e.kind === "BASE" && rna && "ACG".includes(e.code) ? RNA_RIBOSE : 0);
    if (e?.nn_role === "MOD") modEps += Number(e.ext_coeff_260);
  }
  const mw = pyRound(mwSum - BACKBONE_CORRECTION, 2);

  const p = baseLetters.map(probs);
  let pairs = 0;
  for (let i = 0; i < p.length - 1; i++) {
    for (const [b1, q1] of Object.entries(p[i])) for (const [b2, q2] of Object.entries(p[i + 1])) pairs += q1 * q2 * (NN_EPS[b1 + b2] ?? 0);
  }
  let internal = 0;
  for (let i = 1; i < p.length - 1; i++) for (const [b, q] of Object.entries(p[i])) internal += q * (SINGLE_EPS[b] ?? 10000);
  const ext = pyRound(pairs - internal + modEps, 0);

  const { tm: tmC, selfComp } = tm(baseLetters);
  const clean = baseLetters.join("");
  const gc = clean.length ? pyRound(([...clean].filter((b) => b === "G" || b === "C").length / clean.length) * 100, 1) : 0;
  const mods = tokens.filter((t) => t.entry?.nn_role === "MOD");

  const warnings: string[] = [];
  const firstBase = tokens.findIndex((t) => t.base);
  const lastBase = tokens.length - 1 - [...tokens].reverse().findIndex((t) => t.base);
  tokens.forEach((t, i) => {
    if (t.entry?.position_type === "3PRIME" && i < lastBase) warnings.push(`${t.code} thường đặt ở đầu 3', đang ở vị trí ${i + 1}.`);
    if (t.entry?.position_type === "5PRIME" && i > firstBase) warnings.push(`${t.code} thường đặt ở đầu 5', đang ở vị trí ${i + 1}.`);
  });
  if (selfComp) warnings.push("Trình tự tự bổ sung hoàn toàn (palindrome): dễ tự bắt cặp.");
  else {
    const run = longestSelfComplementary(clean);
    if (run >= 6) warnings.push(`Có đoạn tự bổ sung dài ${run} base: nguy cơ tạo dimer / kẹp tóc.`);
  }
  if (baseLetters.some((b) => DEGENERATE[b] || b === "I")) warnings.push("Có base suy biến / inosine: ε260 và Tm là giá trị kỳ vọng.");

  return {
    normalized: tokens.map((t) => t.text).join(""),
    tokens,
    length: clean.length,
    gc_percent: gc,
    molecule_type: rna ? "RNA" : "DNA",
    product_type: mods.length ? "PROBE" : clean.length > 60 ? "AMPLICON" : "PRIMER",
    mw,
    ext_coeff_260: ext,
    nmol_per_od: ext > 0 ? pyRound(1e6 / ext, 2) : 0,
    ug_per_od: ext > 0 ? pyRound((mw / ext) * 1000, 2) : 0,
    tm: tmC,
    self_complementary: selfComp,
    modifications: [...new Set(mods.map((m) => m.code))],
    warnings,
  };
}
