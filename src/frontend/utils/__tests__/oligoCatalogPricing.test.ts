import { describe, expect, it } from "vitest";
import {
  ABT_OLIGO_130_CATALOG,
  buildOligoSkuCombination,
  getOligoCatalogEntry,
  parseOligoSequenceDetails,
} from "../oligoCatalogPricing";
import {
  isLegacyDemoOligoCode,
  isNonPricedPipelineStatus,
  isOligoMtoProduct,
  LEGACY_DEMO_OLIGO_CODES,
} from "@/backend/services/catalogRules";
import { calculateSequencePriceLines, DEFAULT_ABT_OLIGO_ITEM_CODES } from "@/factory/oligo/pricing";

describe("ABT 130-SKU Oligo Catalog & Sequence Combinator", () => {
  it("contains all 130 unique official SKUs with zero legacy codes and AF568 typo fixed", () => {
    expect(ABT_OLIGO_130_CATALOG).toHaveLength(130);
    const uniqueCodes = new Set(ABT_OLIGO_130_CATALOG.map((e) => e.code));
    expect(uniqueCodes.size).toBe(130);

    for (const legacyCode of LEGACY_DEMO_OLIGO_CODES) {
      expect(uniqueCodes.has(legacyCode)).toBe(false);
      expect(isLegacyDemoOligoCode(legacyCode)).toBe(true);
    }

    for (const entry of ABT_OLIGO_130_CATALOG) {
      expect(entry.code.startsWith("OLIGO-")).toBe(false);
      expect(isOligoMtoProduct({ code: entry.code, name: entry.name })).toBe(true);
    }

    const af568 = getOligoCatalogEntry("AF568-Primer.50");
    expect(af568).toBeDefined();
    expect(af568?.name).toContain("AF568");
    expect(af568?.name).not.toContain("VIC");

    const pri04 = getOligoCatalogEntry("PRI-04.100");
    expect(pri04?.status).toBe("Coming soon");
    expect(isNonPricedPipelineStatus(pri04?.status)).toBe(true);
  });

  it("Scenario A: Unmodified 20-nt Primer at 100 nmol + Lyophilized (PRE-01)", () => {
    const combo = buildOligoSkuCombination({
      seqName: "SARS-F1",
      rawSequence: "5'-ACGTTGCAAGTCCTGATGCA-3'",
      mode: "UNMODIFIED",
      scale: "100 nmol",
      tubes: 1,
      lyophilized: true,
    });

    expect(combo.bases).toBe(20);
    expect(combo.seqLabel).toBe("SARS-F1");
    expect(combo.items.map((x) => [x.code, x.role, x.totalQty, x.subtotal])).toEqual([
      ["PRI-02.100", "PRIMARY", 20, 220000],
      ["PRE-01", "ADDON", 1, 30000],
    ]);
    expect(combo.totalPerTube).toBe(250000);
    expect(combo.totalAmount).toBe(250000);
  });

  it("Scenario B: Biotin 22-nt Primer at 50 nmol, 2 tubes + HPLC purification (PUR-02)", () => {
    const combo = buildOligoSkuCombination({
      seqName: "HBV-BIO",
      rawSequence: "5'-ACGTTGCAAGTCCTGATGCAAC-3'",
      mode: "BIOTIN_NH2",
      dyeOrProbeCode: "BIOTIN",
      scale: "50 nmol",
      tubes: 2,
      purificationCode: "PUR-02",
    });

    expect(combo.bases).toBe(22);
    expect(combo.items.map((x) => [x.code, x.role, x.qtyPerTube, x.totalQty, x.subtotal])).toEqual([
      ["PRI-02.50", "PRIMARY", 22, 44, 330000],
      ["BIOTIN.50", "ADDON", 1, 2, 1920000],
      ["PUR-02", "ADDON", 1, 2, 880000],
    ]);
    expect(combo.totalPerTube).toBe(1565000);
    expect(combo.totalAmount).toBe(3130000);
  });

  it("Scenario C: Dual-labeled Probe with +A LNA & (I) Inosine auto-locks scale to 100 nmol and avoids base double-charge", () => {
    const parsed = parseOligoSequenceDetails("5'-[FAM]-ACG+ATGGGA(I)CC-[BHQ1]-3'");
    expect(parsed.baseCount).toBe(12);
    expect(parsed.lnaCount).toBe(1);
    expect(parsed.inosineCount).toBe(1);
    expect(parsed.detectedMode).toBe("PROBE");

    const combo = buildOligoSkuCombination({
      seqName: "FLU-P",
      rawSequence: "5'-[FAM]-ACG+ATGGGA(I)CC-[BHQ1]-3'",
      mode: "PROBE",
      dyeOrProbeCode: "FAM.100",
      scale: "50 nmol",
      tubes: 1,
    });

    expect(combo.effectiveScale).toBe("100 nmol");
    expect(combo.items.map((x) => [x.code, x.role, x.subtotal])).toEqual([
      ["FAM.100", "PRIMARY", 4400000],
      ["LNA.100", "ADDON", 450000],
      ["Inosine.100", "ADDON", 620000],
    ]);
    expect(combo.totalAmount).toBe(5470000);
    expect(combo.warnings.some((w) => w.includes("100 nmol"))).toBe(true);
  });

  it("Scenario D: 5'-Dye Primer (HEX 200 nmol) uses packaged SKU without adding base primer or double-charging HPLC", () => {
    const combo = buildOligoSkuCombination({
      seqName: "SSR-HEX-F",
      rawSequence: "5'-[HEX]-GCTAGCTAGCATCGATCGA-3'",
      mode: "DYE_PRIMER",
      dyeOrProbeCode: "HEX-Primer",
      scale: "200 nmol",
      tubes: 1,
    });

    expect(combo.items.map((x) => [x.code, x.role, x.subtotal])).toEqual([
      ["HEX-Primer.200", "PRIMARY", 3150000],
    ]);
    expect(combo.totalAmount).toBe(3150000);
  });

  it("Scenario E: Gene Synthesis + Plasmid Vector + Extra SKU + Dealer price behavior", () => {
    const dealerCombo = buildOligoSkuCombination({
      seqName: "SYN-G1",
      rawSequence: "ATG".repeat(100),
      mode: "GENE_SYNTHESIS",
      geneCode: "CircleDNA",
      plasmidCode: "Plasmid.1",
      scale: "100 nmol",
      tubes: 1,
      extraSkus: [{ code: "PUR-03", qtyPerTube: 1 }],
      priceTier: "priceDealer1",
    });

    expect(dealerCombo.items.map((x) => [x.code, x.unitPrice, x.usedRetailFallback])).toEqual([
      ["CircleDNA", 2750000, false],
      ["Plasmid.1", 650000, true],
      ["PUR-03", 440000, true],
    ]);
    expect(dealerCombo.totalAmount).toBe(3840000);

    // Explicit dealer price from live catalog overrides fallback when > 0
    const liveDealer = buildOligoSkuCombination({
      seqName: "PR-D1",
      rawSequence: "ACGTTGCAAGTCCTGATGCA",
      mode: "UNMODIFIED",
      scale: "100 nmol",
      tubes: 1,
      priceTier: "priceDealer1",
      liveCatalog: [{ code: "PRI-02.100", price: 11000, priceDealer1: 9500 }],
    });
    expect(liveDealer.items[0].unitPrice).toBe(9500);
    expect(liveDealer.items[0].usedRetailFallback).toBe(false);
    expect(liveDealer.totalAmount).toBe(190000);
  });
});

describe("Factory Oligo Pricing 130-SKU Mapping", () => {
  it("maps every DEFAULT_ABT_OLIGO_ITEM_CODES value to an official ABT 130 catalog SKU", () => {
    const validSet = new Set(ABT_OLIGO_130_CATALOG.map((e) => e.code));
    for (const sku of Object.values(DEFAULT_ABT_OLIGO_ITEM_CODES)) {
      expect(validSet.has(sku)).toBe(true);
      expect(sku.startsWith("OLG-")).toBe(false);
    }
  });

  it("emits official ABT SKUs from calculateSequencePriceLines for Primers, LNA/Inosine, and Dual Probes", () => {
    const primerLines = calculateSequencePriceLines("ACGTTGCAAGTCCTGATGCA", "100nmol", "HPLC", "LYOPHILIZED");
    expect(primerLines.map((l) => [l.code, l.qty, l.amount])).toEqual([
      ["PRI-02.100", 20, 220000],
      ["PUR-02", 1, 300000],
    ]);

    const probeLines = calculateSequencePriceLines("/FAM/ACGTTGCAAGTCCTGATGCA/BHQ1/", "100nmol", "HPLC", "LYOPHILIZED");
    expect(probeLines.map((l) => [l.code, l.amount])).toEqual([["FAM.100", 4400000]]);

    const lnaInoLines = calculateSequencePriceLines("ACG+ATGGAICC", "100nmol", "Desalt", "LYOPHILIZED");
    const codes = lnaInoLines.map((l) => l.code);
    expect(codes).toContain("PRI-01.100");
    expect(codes).toContain("LNA.100");
    expect(codes).toContain("Inosine.100");
    expect(codes).toContain("PRE-01");
  });
});

describe("Báo giá Kinh doanh — nhận diện trình tự (quy tắc 1, 2)", () => {
  it.each([
    ["/56-FAM/ACGTACGTAC/3BHQ_1/", "PROBE", "FAM.100"],
    ["FAM-ACGTACGTAC-BHQ1", "PROBE", "FAM.100"],
    ["5'-[VIC]-ACGTACGTAC-[MGB]-3'", "PROBE", "VIC-MGB.100"],
    ["HEX-ACGTACGTAC-TAMRA", "PROBE", "HEX-TAMRA.100"],
    ["Texas Red-ACGTACGTAC-BHQ2", "PROBE", "TEX.100"],
    ["/FAM/ACGTACGTAC", "DYE_PRIMER", "FAM-Primer"],
    ["5'-Cy5-ACGTACGTAC-3'", "DYE_PRIMER", "Cy5-Primer"],
    ["/5Biosg/ACGTACGTAC", "BIOTIN_NH2", "BIOTIN"],
    ["5'-ACGTACGTAC-3'", undefined, undefined],
  ])("%s → 10 base, chế độ %s / %s", (seq, mode, code) => {
    const p = parseOligoSequenceDetails(seq);
    expect(p.cleanSeq).toBe("ACGTACGTAC");
    expect(p.baseCount).toBe(10);
    expect(p.detectedMode).toBe(mode);
    expect(p.detectedDyeOrProbeCode).toBe(code);
  });

  it("tên nhãn chứa ký tự base (TAMRA) không cộng vào số base", () => {
    expect(parseOligoSequenceDetails("TAMRA-ACGTACGTAC").baseCount).toBe(10);
  });

  it("base suy biến IUPAC được đếm; LNA / 2'-OMe đếm 1 base", () => {
    expect(parseOligoSequenceDetails("ACGTRYSWKMBDHVN").baseCount).toBe(15);
    const p = parseOligoSequenceDetails("ACG+AmCGT{T}");
    expect(p.cleanSeq).toBe("ACGACGTT");
    expect(p.lnaCount).toBe(2);
  });
});

describe("Báo giá Kinh doanh — tinh sạch chỉ cộng phí khi cao hơn mặc định (quy tắc 3)", () => {
  const purCodes = (input: Parameters<typeof buildOligoSkuCombination>[0]) =>
    buildOligoSkuCombination(input).items.filter((x) => x.code.startsWith("PUR-")).map((x) => x.code);
  const base = { scale: "100 nmol" as const, tubes: 1 };
  const seq20 = "ACGTTGCAAGTCCTGATGCA";
  const seq40 = seq20 + seq20;
  const seq70 = seq40 + "ACGTTGCAAGTCCTGATGCAACGTTGCAAG";

  it("primer 20 nt (PRI-02, mặc định Desalt): Cartridge / HPLC / PAGE đều cao hơn → tính phí", () => {
    for (const pur of ["PUR-01", "PUR-02", "PUR-03"] as const) {
      expect(purCodes({ ...base, rawSequence: seq20, mode: "UNMODIFIED", purificationCode: pur })).toEqual([pur]);
    }
  });

  it("primer 40 nt (PRI-03, mặc định Cartridge): Cartridge bằng mặc định → không phí; PAGE / HPLC → tính phí", () => {
    const combo = buildOligoSkuCombination({ ...base, rawSequence: seq40, mode: "UNMODIFIED", purificationCode: "PUR-01" });
    expect(combo.items.map((x) => x.code)).toEqual(["PRI-03.100"]);
    expect(combo.warnings.some((w) => w.includes("không cộng phí"))).toBe(true);
    expect(purCodes({ ...base, rawSequence: seq40, mode: "UNMODIFIED", purificationCode: "PUR-03" })).toEqual(["PUR-03"]);
    expect(purCodes({ ...base, rawSequence: seq40, mode: "UNMODIFIED", purificationCode: "PUR-02" })).toEqual(["PUR-02"]);
  });

  it("primer 70 nt (PRI-05, mặc định HPLC): không cấp nào cộng phí", () => {
    for (const pur of ["PUR-01", "PUR-02", "PUR-03"] as const) {
      expect(purCodes({ ...base, rawSequence: seq70, mode: "UNMODIFIED", purificationCode: pur })).toEqual([]);
    }
  });

  it("primer / probe huỳnh quang (đã gồm HPLC): không cấp nào cộng phí", () => {
    for (const pur of ["PUR-01", "PUR-02", "PUR-03"] as const) {
      expect(purCodes({ ...base, rawSequence: seq20, mode: "DYE_PRIMER", dyeOrProbeCode: "FAM-Primer", purificationCode: pur })).toEqual([]);
      expect(purCodes({ ...base, rawSequence: seq20, mode: "PROBE", dyeOrProbeCode: "FAM.100", purificationCode: pur })).toEqual([]);
    }
  });

  it("primer Biotin (mặc định Cartridge): Cartridge không phí; HPLC tính phí", () => {
    expect(purCodes({ ...base, rawSequence: seq20, mode: "BIOTIN_NH2", dyeOrProbeCode: "BIOTIN", purificationCode: "PUR-01" })).toEqual([]);
    expect(purCodes({ ...base, rawSequence: seq20, mode: "BIOTIN_NH2", dyeOrProbeCode: "BIOTIN", purificationCode: "PUR-02" })).toEqual(["PUR-02"]);
  });
});

describe("Báo giá Kinh doanh — các quyết định nghiệp vụ 11/2026", () => {
  const base = { scale: "100 nmol" as const, tubes: 1 };
  const purCodes = (input: Parameters<typeof buildOligoSkuCombination>[0]) =>
    buildOligoSkuCombination(input).items.filter((x) => x.code.startsWith("PUR-")).map((x) => x.code);

  it("primer chỉ có dye internal được nhận là primer huỳnh quang (giá trọn gói, không tính base)", () => {
    const p = parseOligoSequenceDetails("ACGTTGCAAG/FAM/TCCTGATGCA");
    expect(p.detectedMode).toBe("DYE_PRIMER");
    expect(p.detectedDyeOrProbeCode).toBe("FAM-Primer");
    expect(p.baseCount).toBe(20);
  });

  it("trình tự đúng 35 nt dùng PRI-03 (Cartridge): Cartridge không cộng phí", () => {
    const seq35 = "ACGTTGCAAGTCCTGATGCAACGTTGCAAGTCCTG";
    const combo = buildOligoSkuCombination({ ...base, rawSequence: seq35, mode: "UNMODIFIED", purificationCode: "PUR-01" });
    expect(combo.items.map((x) => x.code)).toEqual(["PRI-03.100"]);
  });

  it("primer Biotin/NH2: vẫn tính base; Desalt/Cartridge không phí; PAGE/HPLC tính phí", () => {
    for (const code of ["BIOTIN", "NH2"]) {
      const input = { ...base, rawSequence: "ACGTTGCAAGTCCTGATGCA", mode: "BIOTIN_NH2" as const, dyeOrProbeCode: code };
      const combo = buildOligoSkuCombination({ ...input, purificationCode: "PUR-01" });
      expect(combo.items.map((x) => [x.code, x.totalQty])).toEqual([
        ["PRI-02.100", 20],
        [`${code}.100`, 1],
      ]);
      expect(purCodes({ ...input, purificationCode: "PUR-03" })).toEqual(["PUR-03"]);
      expect(purCodes({ ...input, purificationCode: "PUR-02" })).toEqual(["PUR-02"]);
    }
  });
});
