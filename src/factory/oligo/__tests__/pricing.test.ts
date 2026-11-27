import { afterAll, beforeAll, describe, expect, it } from "vitest";
import "../../__tests__/helpers";
import { closeFactoryPool, getFactoryPool } from "../../core/db";
import { analyze, type CatalogEntry } from "../analyzer";
import {
  calculateSequencePriceLines,
  DEFAULT_PRICE_CONFIG,
  extractSequenceModsAndBases,
  linesTotal,
  normalizeLegacySequence,
  orderSequenceLines,
  sequenceSkipsStandardBasePrice,
  type PriceConfig,
} from "../pricing";

const N20 = "ACGTTGCAAGTCCTGATGCA"; // 20 nt → band 15-34, mặc định Desalt
const N40 = N20 + N20; // 40 nt → band 35-60, mặc định OPC
const N70 = N40 + "ACGTTGCAAGTCCTGATGCAACGTTGCAAG"; // 70 nt → band 61-120, mặc định HPLC

const keys = (lines: { key: string }[]) => lines.map((l) => l.key);
const stdQty = (lines: { key: string; qty: number }[]) => lines.filter((l) => l.key.startsWith("std|")).reduce((s, l) => s + l.qty, 0);
const purLines = <T extends { key: string }>(lines: T[]) => lines.filter((l) => l.key.startsWith("pur|"));

describe("Quy tắc 1 — nhận diện base thường và nhóm đánh dấu", () => {
  it("trình tự thường: chỉ có base, không có nhóm đánh dấu", () => {
    const r = extractSequenceModsAndBases(`5'-${N20}-3'`);
    expect(r.bases.join("")).toBe(N20);
    expect([...r.mods5Prime, ...r.mods3Prime, ...r.modsInternal]).toEqual([]);
  });

  it.each([
    ["/56-FAM/ACGTACGTAC/3BHQ_1/", ["FAM"], ["BHQ1"], []],
    ["FAM-ACGTACGTAC-BHQ1", ["FAM"], ["BHQ1"], []],
    ["6-FAM-ACGTACGTAC-BHQ-1", ["FAM"], ["BHQ1"], []],
    ["5'-FAM-ACGTACGTAC-3'-BHQ1", ["FAM"], ["BHQ1"], []],
    ["[Cy5]ACGTACGTAC[BHQ2]", ["CY5"], ["BHQ2"], []],
    ["5'-HEX-ACGTACGTAC-3'", ["HEX"], [], []],
    ["ACGTACGTAC-ROX", [], ["ROX"], []],
    ["ACGTA/FAM/CGTAC", [], [], ["FAM"]],
    ["/BIOTIN/ACGTA/FAM/CGTAC/BHQ1/", ["BIOTIN"], ["BHQ1"], ["FAM"]],
    ["/BIOTIN//FAM/ACGTACGTAC", ["BIOTIN", "FAM"], [], []],
    ["/5Biosg/ACGTACGTAC", ["BIOTIN"], [], []],
    ["Texas Red-ACGTACGTAC-BHQ2", ["TXR"], ["BHQ2"], []],
  ])("%s → nhãn 5'/3'/internal đúng, đủ 10 base", (seq, m5, m3, mi) => {
    const r = extractSequenceModsAndBases(seq);
    expect(r.mods5Prime).toEqual(m5);
    expect(r.mods3Prime).toEqual(m3);
    expect(r.modsInternal).toEqual(mi);
    expect(r.bases.join("")).toBe("ACGTACGTAC");
  });

  it.each([
    ["TAMRA-ACGTACGTAC", "TAMRA"],
    ["VIC-ACGTACGTAC-MGB", "VIC"],
    ["TET-ACGTACGTAC-BHQ1", "TET"],
    ["MGB-NFQ", null],
  ])("tên nhãn chứa ký tự base (%s) không bị tách thành base", (seq, dye5) => {
    const r = extractSequenceModsAndBases(seq);
    if (dye5) {
      expect(r.mods5Prime).toEqual([dye5]);
      expect(r.bases.join("")).toBe("ACGTACGTAC");
    } else {
      expect(r.bases).toEqual([]);
      expect(r.mods5Prime).toEqual(["MGB"]);
    }
  });

  it("số đứng cuối tên nhãn / spacer không bị coi là ký hiệu đầu 3' (BHQ3, C3)", () => {
    const a = extractSequenceModsAndBases("FAM-ACGTACGTAC-BHQ3");
    expect(a.mods3Prime).toEqual(["BHQ3"]);
    expect(a.bases.join("")).toBe("ACGTACGTAC");
    const b = extractSequenceModsAndBases("ACGTACGTAC-C3");
    expect(b.mods3Prime).toEqual(["C3"]);
    expect(b.bases.join("")).toBe("ACGTACGTAC");
  });

  it("5mC đầu chuỗi là 5-methyl-dC, không bị cắt thành 2'-OMe C", () => {
    expect(extractSequenceModsAndBases("5mCACGT").bases).toEqual(["5MC", "A", "C", "G", "T"]);
    expect(extractSequenceModsAndBases("5-Me-dC-ACGT").bases).toEqual(["5MC", "A", "C", "G", "T"]);
  });

  it("base suy biến IUPAC được đếm là base thường và tính giá base chuẩn", () => {
    const r = extractSequenceModsAndBases("ACGTRYSWKMBDHVN");
    expect(r.bases.join("")).toBe("ACGTRYSWKMBDHVN");
    const lines = calculateSequencePriceLines("ACGTRYSWKMBDHVN", "100nmol", "Desalt", "LIQUID");
    expect(lines.map((l) => [l.key, l.qty])).toEqual([["std|100nmol|15-34", 15]]);
  });

  it("chữ m viết thường trong trình tự viết thường là base suy biến M, không phải 2'-OMe", () => {
    expect(extractSequenceModsAndBases("acgtmacg").bases.join("")).toBe("ACGTMACG");
    expect(extractSequenceModsAndBases("mAmCGT").bases).toEqual(["MA", "MC", "G", "T"]);
  });

  it("LNA / inosine viết trong ngoặc là base biến đổi, không phải nhóm đánh dấu", () => {
    const r = extractSequenceModsAndBases("ACG[+A]TG[I]CC");
    expect(r.bases).toEqual(["A", "C", "G", "+A", "T", "G", "I", "C", "C"]);
    expect(r.modsInternal).toEqual([]);
  });

  it("nhóm chưa có trong danh mục vẫn là nhóm đánh dấu, không rã thành base", () => {
    const r = extractSequenceModsAndBases("/56-FAM/ACGTAC/ZEN/GTAC/3IABkFQ/");
    expect(r.bases.join("")).toBe("ACGTACGTAC");
    expect(r.modsInternal).toEqual(["ZEN"]);
    expect(r.mods3Prime).toEqual(["3IABKFQ"]);
  });
});

describe("normalizeLegacySequence → analyzer (danh mục thật trong CSDL)", () => {
  let catalog: CatalogEntry[] = [];
  beforeAll(async () => {
    catalog = (
      await getFactoryPool().query(
        "SELECT code, name, kind, base_letter, nn_role, mw::float AS mw, mw_delta::float AS mw_delta, ext_coeff_260::float AS ext_coeff_260, aliases, position_type FROM oligo.modification WHERE status = 'ACTIVE'"
      )
    ).rows;
  });
  afterAll(closeFactoryPool);

  it.each([
    ["FAM-ACGTACGTAC-BHQ3", "/FAM/ACGTACGTAC/BHQ3/", 10],
    ["5'-FAM-ACGTACGTAC-3'-BHQ1", "/FAM/ACGTACGTAC/BHQ1/", 10],
    ["TAMRA-ACGTACGTAC", "/TAMRA/ACGTACGTAC", 10],
    ["ACGTACGTAC-C3", "ACGTACGTAC/C3/", 10],
    ["5mCACGTACGT", "5mCACGTACGT", 9],
    ["ACG[+A]TGGA(I)CC", "ACG+ATGGAICC", 11],
  ])("%s → %s, analyzer nhận được", (raw, norm, len) => {
    expect(normalizeLegacySequence(raw)).toBe(norm);
    const a = analyze(normalizeLegacySequence(raw), catalog);
    expect(a.length).toBe(len);
  });
});

describe("Quy tắc 2 — oligo đánh dấu huỳnh quang không tính phí base thường", () => {
  it("Primer 5'-FAM: không có dòng base chuẩn, chỉ tính giá 5'-FAM trọn gói", () => {
    const lines = calculateSequencePriceLines(`/FAM/${N20}`, "100nmol", "HPLC", "LYOPHILIZED");
    expect(stdQty(lines)).toBe(0);
    expect(lines.map((l) => [l.key, l.amount])).toEqual([["m5|FAM|100nmol", 1980000]]);
  });

  it("Probe FAM/BHQ1 (mọi kiểu viết): chỉ giá trọn gói cặp đánh dấu kép", () => {
    for (const seq of [`/FAM/${N20}/BHQ1/`, `FAM-${N20}-BHQ1`, `/56-FAM/${N20}/3BHQ_1/`, `5'-[FAM]-${N20}-[BHQ1]-3'`]) {
      const lines = calculateSequencePriceLines(seq, "100nmol", "HPLC", "LYOPHILIZED");
      expect(lines.map((l) => [l.key, l.amount])).toEqual([["dual|FAM/BHQ1|100nmol", 4400000]]);
    }
  });

  it("Probe có tên nhãn chứa ký tự base (VIC/MGB, FAM/TAMRA) không tính base", () => {
    expect(keys(calculateSequencePriceLines(`VIC-${N20}-MGB`, "100nmol", "HPLC", "LYOPHILIZED"))).toEqual(["dual|VIC/MGB|100nmol"]);
    expect(keys(calculateSequencePriceLines(`FAM-${N20}-TAMRA`, "100nmol", "HPLC", "LYOPHILIZED"))).toEqual(["dual|FAM/TAMRA|100nmol"]);
  });

  it("Dye đầu 3' viết dạng gạch nối vẫn được nhận và không tính base", () => {
    const lines = calculateSequencePriceLines(`${N20}-ROX`, "100nmol", "HPLC", "LYOPHILIZED");
    expect(stdQty(lines)).toBe(0);
    expect(sequenceSkipsStandardBasePrice(`${N20}-ROX`)).toBe(true);
  });

  it("Probe đánh dấu có base biến đổi: base thường miễn phí, base LNA vẫn tính phụ phí", () => {
    const lines = calculateSequencePriceLines("/FAM/ACG+ATGCAAGTCCTGATGCA/BHQ1/", "100nmol", "HPLC", "LYOPHILIZED");
    expect(stdQty(lines)).toBe(0);
    expect(lines.map((l) => [l.code, l.qty])).toEqual([
      ["LNA.100", 1],
      ["FAM.100", 1],
    ]);
  });

  it("Primer Biotin (không huỳnh quang) vẫn tính base chuẩn + phí Biotin", () => {
    const lines = calculateSequencePriceLines(`/BIOTIN/${N20}`, "100nmol", "HPLC", "LYOPHILIZED");
    expect(stdQty(lines)).toBe(20);
    expect(keys(lines)).toContain("m5|BIOTIN|100nmol");
  });

  it.each(["ACGTTGCAAG/FAM/TCCTGATGCA", "ACGTTGCAAG-HEX-TCCTGATGCA", "/BIOTIN/ACGTTGCAAG/CY5/TCCTGATGCA"])(
    "primer chỉ có dye internal (%s): miễn tiền base, chỉ tính phí nhãn",
    (seq) => {
      const lines = calculateSequencePriceLines(seq, "100nmol", "HPLC", "LYOPHILIZED");
      expect(sequenceSkipsStandardBasePrice(seq)).toBe(true);
      expect(stdQty(lines)).toBe(0);
      expect(lines.every((l) => /^(m5|mi)|/.test(l.key))).toBe(true);
    }
  );

  it("đơn giá base thỏa thuận không áp lên oligo đánh dấu huỳnh quang (không cộng chồng lên base LNA)", () => {
    const seq = "/FAM/ACG+ATGCAAGTCCTGATGCA/BHQ1/";
    const auto = orderSequenceLines({ sequenceStr: seq, scale: "100nmol", purification: "HPLC", format: "LYOPHILIZED" });
    const custom = orderSequenceLines({ sequenceStr: seq, scale: "100nmol", purification: "HPLC", format: "LYOPHILIZED", customUnitPrice: 9000 });
    expect(custom).toEqual(auto);
    expect(keys(custom).some((k) => k.startsWith("tt|"))).toBe(false);
  });
});

describe("Quy tắc 3 — chỉ tính phí tinh sạch khi cao hơn mặc định", () => {
  const pur = (seq: string, method: string, cfg?: PriceConfig) =>
    purLines(calculateSequencePriceLines(seq, "100nmol", method, "LIQUID", "DNA", cfg)).map((l) => [l.key, l.amount]);

  it("primer 20 nt (mặc định Desalt): Desalt miễn phí; OPC / PAGE / HPLC tính phí", () => {
    expect(pur(N20, "Desalt")).toEqual([]);
    expect(pur(N20, "DESALT")).toEqual([]);
    expect(pur(N20, "OPC")).toEqual([["pur|OPC|100nmol", 70000]]);
    expect(pur(N20, "Cartridge")).toEqual([["pur|OPC|100nmol", 70000]]);
    expect(pur(N20, "PAGE")).toEqual([["pur|PAGE|100nmol", 200000]]);
    expect(pur(N20, "HPLC")).toEqual([["pur|HPLC|100nmol", 300000]]);
  });

  it("primer 40 nt (mặc định OPC): Desalt (thấp hơn) và OPC (bằng) miễn phí; PAGE / HPLC tính phí", () => {
    expect(pur(N40, "Desalt")).toEqual([]);
    expect(pur(N40, "OPC")).toEqual([]);
    expect(pur(N40, "PAGE")).toEqual([["pur|PAGE|100nmol", 200000]]);
    expect(pur(N40, "HPLC")).toEqual([["pur|HPLC|100nmol", 300000]]);
  });

  it("trình tự 70 nt (mặc định HPLC): mọi cấp đều miễn phí", () => {
    for (const m of ["Desalt", "OPC", "PAGE", "HPLC"]) expect(pur(N70, m)).toEqual([]);
  });

  it("primer / probe đánh dấu (mặc định HPLC theo nhóm dye / quencher / modified): mọi cấp đều miễn phí", () => {
    for (const seq of [`/FAM/${N20}`, `/FAM/${N20}/BHQ1/`, `${N20}-ROX`, `ACGTTGCAAG/FAM/TCCTGATGCA`]) {
      for (const m of ["Desalt", "OPC", "PAGE", "HPLC"]) expect(pur(seq, m)).toEqual([]);
    }
  });

  it("cấu hình mặc định theo chiều dài lưu không theo thứ tự vẫn chọn đúng quy tắc", () => {
    const cfg: PriceConfig = {
      ...DEFAULT_PRICE_CONFIG,
      purification_default_by_length: [
        { max_len: 120, method: "HPLC" },
        { max_len: 35, method: "Desalt" },
        { max_len: 60, method: "OPC" },
      ],
    };
    expect(pur(N20, "OPC", cfg)).toEqual([["pur|OPC|100nmol", 70000]]);
    expect(pur(N40, "OPC", cfg)).toEqual([]);
  });

  it("trình tự dài hơn mọi max_len dùng cấp của quy tắc dài nhất (không rơi về Desalt)", () => {
    const long = "ACGT".repeat(33); // 132 nt
    expect(pur(long, "HPLC")).toEqual([]);
    expect(pur(long, "PAGE")).toEqual([]);
  });

  it("trình tự đúng 35 nt (PRI-03) mặc định Cartridge: OPC miễn phí; 34 nt vẫn mặc định Desalt", () => {
    const n35 = "ACGTTGCAAGTCCTGATGCAACGTTGCAAGTCCTG";
    expect(n35).toHaveLength(35);
    expect(pur(n35, "Desalt")).toEqual([]);
    expect(pur(n35, "OPC")).toEqual([]);
    expect(pur(n35, "PAGE")).toEqual([["pur|PAGE|100nmol", 200000]]);
    expect(pur(n35.slice(0, 34), "OPC")).toEqual([["pur|OPC|100nmol", 70000]]);
  });

  it.each([`/BIOTIN/${N20}`, `5'-NH2-${N20}-3'`, `/5AmMC6/${N20}`])(
    "primer Biotin/NH2 %s: Desalt / Cartridge miễn phí; PAGE / HPLC tính phí; vẫn tính tiền base",
    (seq) => {
      expect(pur(seq, "Desalt")).toEqual([]);
      expect(pur(seq, "OPC")).toEqual([]);
      expect(pur(seq, "Cartridge")).toEqual([]);
      expect(pur(seq, "PAGE")).toEqual([["pur|PAGE|100nmol", 200000]]);
      expect(pur(seq, "HPLC")).toEqual([["pur|HPLC|100nmol", 300000]]);
      expect(stdQty(calculateSequencePriceLines(seq, "100nmol", "HPLC", "LIQUID"))).toBe(20);
    }
  );

  it("cấu hình đã lưu chưa có nhóm biotin_nh2 vẫn dùng mặc định Cartridge của code", () => {
    const { biotin_nh2: _drop, ...savedRules } = DEFAULT_PRICE_CONFIG.modification_purification_rules;
    const cfg: PriceConfig = { ...DEFAULT_PRICE_CONFIG, modification_purification_rules: savedRules };
    expect(pur(`/BIOTIN/${N20}`, "OPC", cfg)).toEqual([]);
    expect(pur(`/BIOTIN/${N20}`, "HPLC", cfg)).toEqual([["pur|HPLC|100nmol", 300000]]);
  });

  it("tổng tiền primer 20 nt OPC = base + phí OPC", () => {
    const lines = calculateSequencePriceLines(N20, "100nmol", "OPC", "LIQUID");
    expect(linesTotal(lines)).toBe(20 * 11000 + 70000);
  });
});
