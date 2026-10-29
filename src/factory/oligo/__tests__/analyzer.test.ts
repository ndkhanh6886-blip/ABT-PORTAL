import fs from "fs";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import "../../__tests__/helpers";
import { closeFactoryPool, getFactoryPool } from "../../core/db";
import { analyze, pyRound, SequenceError, type CatalogEntry } from "../analyzer";

/**
 * Golden values computed by the former OligoFlow (calculations.get_properties with its built-in
 * parameters) on the same sequences — the new analyser must give identical numbers (Q7).
 */
const legacy: { input: string; mw: number; tm: number; ec: number; nmol_od: number; ug_od: number; length: number; gc: number; type: string }[] = JSON.parse(
  fs.readFileSync(path.join(__dirname, "legacy-oligoflow-fixtures.json"), "utf8")
);

let catalog: CatalogEntry[] = [];
beforeAll(async () => {
  catalog = (await getFactoryPool().query("SELECT code, name, kind, base_letter, nn_role, mw::float AS mw, mw_delta::float AS mw_delta, ext_coeff_260::float AS ext_coeff_260, aliases, position_type FROM oligo.modification WHERE status = 'ACTIVE'")).rows;
});
afterAll(closeFactoryPool);

describe("analyser matches OligoFlow", () => {
  for (const ref of legacy) {
    it(ref.input, () => {
      const a = analyze(ref.input, catalog);
      expect({ mw: a.mw, ec: a.ext_coeff_260, nmol_od: a.nmol_per_od, ug_od: a.ug_per_od, tm: a.tm, length: a.length, gc: a.gc_percent }).toEqual({
        mw: ref.mw,
        ec: ref.ec,
        nmol_od: ref.nmol_od,
        ug_od: ref.ug_od,
        tm: ref.tm,
        length: ref.length,
        gc: ref.gc,
      });
      const type = `${a.molecule_type === "RNA" ? "RNA " : ""}${a.product_type === "PROBE" ? "Probe" : a.product_type === "AMPLICON" ? "Amplicon" : "Primer"}`;
      expect(type).toBe(ref.type);
    });
  }
});

describe("parsing", () => {
  it("normalises common written forms to the same sequence", () => {
    const forms = ["5'-FAM-ATGCTTTAGCAGGAC-BHQ1-3'", "/56-FAM/ATGCTTTAGCAGGAC/3BHQ_1/", "FAM ATGCTTTAGCAGGAC BHQ1", "/FAM/atgctttagcaggac/BHQ1/"];
    const results = forms.map((f) => analyze(f, catalog));
    for (const r of results) expect(r.normalized).toBe("/FAM/ATGCTTTAGCAGGAC/BHQ1/");
    expect(new Set(results.map((r) => r.mw)).size).toBe(1);
  });

  it("keeps inline modified bases and names them", () => {
    const a = analyze("A+TGmCfA5mCGT", catalog);
    expect(a.normalized).toBe("A+TGmCfA5mCGT");
    expect(a.modifications).toEqual(["5MC"]);
  });

  it("refuses unknown modifications and stray characters instead of guessing", () => {
    expect(() => analyze("/FAMX/ATGC", catalog)).toThrow(SequenceError);
    expect(() => analyze("/FAMX/ATGC", catalog)).toThrow(/FAMX/);
    expect(() => analyze("ATG*C", catalog)).toThrow(/không phải base/);
    expect(() => analyze("/FAM/", catalog)).toThrow(/không có base/);
    expect(() => analyze("/FAM/ATGC/BHQ1", catalog)).toThrow(/không đóng/);
  });

  it("warns about self-complementarity, misplaced quenchers and degenerate bases", () => {
    expect(analyze("GAATTC", catalog).warnings.join(" ")).toMatch(/tự bổ sung hoàn toàn/);
    expect(analyze("ACGTGGATCCACGAAAA", catalog).warnings.join(" ")).toMatch(/đoạn tự bổ sung dài/);
    expect(analyze("/BHQ1/ACGTACGT/FAM/", catalog).warnings.join(" ")).toMatch(/BHQ1 thường đặt ở đầu 3'/);
    expect(analyze("ACGTNNACGT", catalog).warnings.join(" ")).toMatch(/suy biến/);
  });
});

describe("pyRound", () => {
  it("rounds exact ties to even like Python", () => {
    expect(pyRound(2.5, 0)).toBe(2);
    expect(pyRound(3.5, 0)).toBe(4);
    expect(pyRound(1.234, 2)).toBe(1.23);
    expect(pyRound(-42.15, 1)).toBe(-42.2);
  });
});
