import type { Token } from "./analyzer";

/**
 * Expected reagent consumption of a synthesis batch, with the former OligoFlow model:
 *  - every coupling (each token of each sequence) uses PER_CYCLE quantities of the ancillary reagents;
 *  - a base coupling uses its amidite (dA dC dG dT, or rA rC rG rU for RNA); degenerate bases share
 *    the quantity equally between their bases;
 *  - any other token (modification, LNA, 2'-OMe, 2'-F, 5mC, inosine) uses its own rule if one exists
 *    with that code, otherwise MOD_DEFAULT; a dye that is not the last token uses the ALKYL amidite.
 */

export interface ReagentRule {
  role: string;
  name: string;
  basis: "PER_CYCLE" | "PER_COUPLING" | "PER_MOD";
  qty: number;
  uom: string;
  item_id: string | null;
  status: string;
}

export interface SequenceForConsumption {
  code: string;
  molecule_type: "DNA" | "RNA";
  tokens: Token[];
}

export interface ConsumptionLine {
  role: string;
  label: string;
  qty: number; // in `uom`
  uom: string;
  item_id: string | null;
  /** Modification amidites: the item mapped on the modification itself (used when the rule has none). */
  catalog_item_id?: string | null;
}

const DEGENERATE: Record<string, string[]> = {
  A: ["A"], C: ["C"], G: ["G"], T: ["T"], U: ["U"],
  R: ["A", "G"], Y: ["C", "T"], S: ["G", "C"], W: ["A", "T"], K: ["G", "T"], M: ["A", "C"],
  B: ["C", "G", "T"], D: ["A", "G", "T"], H: ["A", "C", "T"], V: ["A", "C", "G"], N: ["A", "C", "G", "T"],
};

export function estimateConsumption(
  sequences: SequenceForConsumption[],
  rules: ReagentRule[],
  amiditeOf: (modificationCode: string) => string | null = () => null
): ConsumptionLine[] {
  const active = new Map(rules.filter((r) => r.status === "ACTIVE").map((r) => [r.role, r]));
  const totals = new Map<string, ConsumptionLine>();
  const add = (role: string, qty: number, fallback?: ReagentRule, modCode?: string) => {
    const rule = active.get(role) ?? fallback;
    if (!rule) throw new Error(`Thiếu định mức hóa chất "${role}" trong cấu hình.`);
    const key = rule === fallback && modCode ? `MOD:${modCode}` : role;
    const cur = totals.get(key) ?? {
      role: key,
      label: rule === fallback && modCode ? `${rule.name} — ${modCode}` : rule.name,
      qty: 0,
      uom: rule.uom,
      item_id: rule.item_id,
      catalog_item_id: modCode ? amiditeOf(modCode) : undefined,
    };
    cur.qty += qty;
    totals.set(key, cur);
  };

  const perCycle = rules.filter((r) => r.status === "ACTIVE" && r.basis === "PER_CYCLE");
  const modDefault = active.get("MOD_DEFAULT");
  for (const s of sequences) {
    const cycles = s.tokens.length;
    for (const r of perCycle) add(r.role, cycles * Number(r.qty));
    s.tokens.forEach((t, idx) => {
      const isPlainBase = !t.entry ? true : t.entry.kind === "BASE" && t.entry.code !== "I";
      if (isPlainBase && t.base) {
        const members = DEGENERATE[t.base] ?? [t.base];
        for (const b of members) {
          const role = s.molecule_type === "RNA" ? (b === "T" || b === "U" ? "rU" : `r${b}`) : b === "T" || b === "U" ? "dT" : `d${b}`;
          const rule = active.get(role);
          if (!rule) throw new Error(`Thiếu định mức amidite "${role}" trong cấu hình.`);
          add(role, Number(rule.qty) / members.length);
        }
        return;
      }
      const code = t.code;
      if (t.entry?.kind === "DYE" && idx !== s.tokens.length - 1) {
        const alkyl = active.get("ALKYL");
        if (!alkyl) throw new Error('Thiếu định mức "ALKYL" trong cấu hình.');
        add("ALKYL", Number(alkyl.qty));
        return;
      }
      const own = active.get(code);
      if (own) add(code, Number(own.qty));
      else {
        if (!modDefault) throw new Error('Thiếu định mức "MOD_DEFAULT" trong cấu hình.');
        add("MOD_DEFAULT", Number(modDefault.qty), modDefault, code);
      }
    });
  }
  return [...totals.values()].map((l) => ({ ...l, qty: Math.round(l.qty * 1e6) / 1e6 }));
}
