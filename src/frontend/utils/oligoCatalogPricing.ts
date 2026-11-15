import {
  ABT_OLIGO_130_CATALOG,
  ABT_OLIGO_BY_CODE,
  ABT_OLIGO_CODE_SET,
  getOligoCatalogEntry,
  isDetailedOligoSkuCode,
  isOligoAddonSku,
  isOligoPrimarySku,
  type OligoCatalogEntry,
  type OligoCatalogGroup,
} from "@/shared/oligoCatalog";

export {
  ABT_OLIGO_130_CATALOG,
  ABT_OLIGO_BY_CODE,
  ABT_OLIGO_CODE_SET,
  getOligoCatalogEntry,
  isDetailedOligoSkuCode,
  isOligoAddonSku,
  isOligoPrimarySku,
  type OligoCatalogEntry,
  type OligoCatalogGroup,
};

export const ABT_OLIGO_SCALES = [
  "50 nmol",
  "100 nmol",
  "200 nmol",
  "250 nmol",
  "500 nmol",
  "1000 nmol",
] as const;

export type OligoScale = (typeof ABT_OLIGO_SCALES)[number];
export type OligoPriceTier = "price" | "priceDealer1" | "priceDealer2";
export type OligoPrimerFamily = "AUTO" | "PRI-01" | "PRI-02" | "PRI-03" | "PRI-04" | "PRI-05";
export type OligoProductMode =
  | "UNMODIFIED"
  | "BIOTIN_NH2"
  | "DYE_PRIMER"
  | "PROBE"
  | "GENE_SYNTHESIS";

export interface LiveCatalogProductLike {
  code?: string;
  name?: string;
  unit?: string;
  specification?: string;
  price?: number;
  priceDealer1?: number;
  priceDealer2?: number;
  leadTime?: string;
  notes?: string;
}

export interface ParsedOligoSequenceDetails {
  cleanSeq: string;
  formattedSeq: string;
  baseCount: number;
  lnaCount: number;
  inosineCount: number;
  detectedTags: string[];
  detectedMode?: OligoProductMode;
  detectedDyeOrProbeCode?: string;
}

export interface OligoExtraSkuInput {
  code: string;
  qtyPerTube?: number;
  unitPriceOverride?: number;
}

export interface OligoSkuCombinationInput {
  seqName?: string;
  rawSequence: string;
  mode: OligoProductMode;
  scale: OligoScale;
  tubes: number;
  baseCountOverride?: number;
  primerFamily?: OligoPrimerFamily;
  dyeOrProbeCode?: string;
  purificationCode?: "" | "PUR-01" | "PUR-02" | "PUR-03";
  lyophilized?: boolean;
  geneCode?: "LinearDNA" | "CircleDNA";
  plasmidCode?: "" | "Plasmid.1" | "Plasmid.2";
  includeLna?: boolean;
  lnaCountOverride?: number;
  includeInosine?: boolean;
  inosineCountOverride?: number;
  extraSkus?: OligoExtraSkuInput[];
  priceTier?: OligoPriceTier;
  liveCatalog?: LiveCatalogProductLike[];
  priceOverrides?: Record<string, number>;
}

export interface OligoSkuComponentItem {
  code: string;
  name: string;
  unit: string;
  specification: string;
  purification: string;
  role: "PRIMARY" | "ADDON";
  reason: string;
  qtyPerTube: number;
  totalQty: number;
  unitPrice: number;
  subtotal: number;
  perTubeSubtotal: number;
  isComingSoon: boolean;
  usedRetailFallback: boolean;
  note: string;
}

export interface OligoSkuCombinationResult {
  seqLabel: string;
  formattedSeq: string;
  parsed: ParsedOligoSequenceDetails;
  effectiveScale: OligoScale;
  tubes: number;
  bases: number;
  items: OligoSkuComponentItem[];
  totalPerTube: number;
  totalAmount: number;
  warnings: string[];
}

export const PROBE_CATALOG_OPTIONS = ABT_OLIGO_130_CATALOG.filter(
  (item) => item.group === "PROBE"
);

export const DYE_PRIMER_FAMILIES: ReadonlyArray<{ prefix: string; label: string }> = [
  { prefix: "FAM-Primer", label: "5'-FAM Primer (HPLC + Đông khô)" },
  { prefix: "HEX-Primer", label: "5'-HEX Primer (HPLC + Đông khô)" },
  { prefix: "VIC-Primer", label: "5'-VIC Primer (HPLC + Đông khô)" },
  { prefix: "ROX-Primer", label: "5'-ROX Primer (HPLC + Đông khô)" },
  { prefix: "Cy3-Primer", label: "5'-Cy3 Primer (HPLC + Đông khô)" },
  { prefix: "Cy5-Primer", label: "5'-Cy5 Primer (HPLC + Đông khô)" },
  { prefix: "Texasred-Primer", label: "5'-TexasRed Primer (HPLC + Đông khô)" },
  { prefix: "AF568-Primer", label: "5'-AF568 Primer (HPLC + Đông khô)" },
  { prefix: "AF647-Primer", label: "5'-AF647 Primer (HPLC + Đông khô)" },
];

export const PURIFICATION_OPTIONS = ABT_OLIGO_130_CATALOG.filter(
  (item) => item.group === "PURIFICATION"
);

export function parseScaleNumber(scale?: string | null): string {
  const m = String(scale || "").match(/(50|100|200|250|500|1000)/);
  return m ? m[1] : "50";
}

export function normalizeOligoScale(scale?: string | null): OligoScale {
  const num = parseScaleNumber(scale);
  return (`${num} nmol`) as OligoScale;
}

export function recommendBasePrimerCode(
  baseCount: number,
  scale: OligoScale,
  family: OligoPrimerFamily = "AUTO"
): string {
  const scaleNum = parseScaleNumber(scale);
  if (family && family !== "AUTO") {
    return `${family}.${scaleNum}`;
  }
  if (baseCount <= 14) return `PRI-01.${scaleNum}`;
  if (baseCount <= 34) return `PRI-02.${scaleNum}`;
  if (baseCount <= 60) return `PRI-03.${scaleNum}`;
  return `PRI-05.${scaleNum}`;
}

export function parseOligoSequenceDetails(rawSeq: string): ParsedOligoSequenceDetails {
  const src = String(rawSeq || "").trim();
  const detectedTags: string[] = [];

  // Normalize bracketed LNA / Inosine markers before stripping annotations
  let working = src;
  let lnaCount = 0;
  let inosineCount = 0;

  // Match bracketed LNA notations such as [+A], [LNA-A], [LNAA]
  working = working.replace(/\[(?:\+|LNA[-_ ]?|d?LNA)([ATGCU])\]/gi, (_, b: string) => {
    lnaCount += 1;
    return b.toUpperCase();
  });
  // Match curly brace LNA notation {A} or {G}
  working = working.replace(/\{([ATGCU])\}/gi, (_, b: string) => {
    lnaCount += 1;
    return b.toUpperCase();
  });
  // Match +A / +T / +G / +C / +U
  working = working.replace(/\+([ATGCU])/gi, (_, b: string) => {
    lnaCount += 1;
    return b.toUpperCase();
  });

  // Match bracketed/parenthesized/slashed Inosine: [I], [dI], (I), (dI), /dI/, [Inosine]
  working = working.replace(/(?:\[(?:dI|Inosine|I)\]|\((?:dI|Inosine|I)\)|\/(?:dI|Inosine|I)\/)/gi, () => {
    inosineCount += 1;
    return "I";
  });

  // Capture bracketed 5'/3' dye/quencher/mod tags (plus common 5'-TAG / 3'-TAG tokens)
  const tagRegex = /\[([^\]]+)\]|(?:5['’]|3['’])\s*-?\s*([A-Z0-9-]{2,15})/gi;
  let m: RegExpExecArray | null;
  while ((m = tagRegex.exec(working)) !== null) {
    const rawTag = (m[1] || m[2] || "").trim().toUpperCase();
    if (rawTag && !/^[0-9]+$/.test(rawTag) && !detectedTags.includes(rawTag)) {
      detectedTags.push(rawTag);
    }
  }

  const stripped = working
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\([^\)]*\)/g, "")
    .replace(/5'|3'|5’|3’/gi, "")
    .toUpperCase()
    .replace(/[^ATGCURYSWKMBDHVNI]/g, "");

  // Count 'I' bases from cleaned IUPAC string unless already counted via [dI]
  const rawICount = (stripped.match(/I/g) || []).length;
  if (rawICount > inosineCount) {
    inosineCount = rawICount;
  }

  // Suggest Oligo mode & SKU when 5'/3' dye or mod tags appear in sequence text
  const upperSrc = src.toUpperCase();
  let detectedMode: OligoProductMode | undefined;
  let detectedDyeOrProbeCode: string | undefined;

  const hasBhq1 = upperSrc.includes("BHQ1") || upperSrc.includes("BHQ-1");
  const hasBhq2 = upperSrc.includes("BHQ2") || upperSrc.includes("BHQ-2");
  const hasBhq3 = upperSrc.includes("BHQ3") || upperSrc.includes("BHQ-3");
  const hasTamra = upperSrc.includes("TAMRA");
  const hasMgb = upperSrc.includes("MGB");

  if (hasMgb) {
    detectedMode = "PROBE";
    if (upperSrc.includes("VIC")) detectedDyeOrProbeCode = "VIC-MGB.100";
    else if (upperSrc.includes("HEX")) detectedDyeOrProbeCode = "HEX-MGB.100";
    else detectedDyeOrProbeCode = "FAM-MGB.100";
  } else if (hasTamra) {
    detectedMode = "PROBE";
    if (upperSrc.includes("VIC")) detectedDyeOrProbeCode = "VIC-TAMRA.100";
    else if (upperSrc.includes("HEX")) detectedDyeOrProbeCode = "HEX-TAMRA.100";
    else detectedDyeOrProbeCode = "FAM-TAMRA.100";
  } else if (hasBhq1 || hasBhq2 || hasBhq3) {
    detectedMode = "PROBE";
    if (upperSrc.includes("AF647")) detectedDyeOrProbeCode = "AF647-BHQ2.100";
    else if (upperSrc.includes("AF568")) detectedDyeOrProbeCode = "AF568-BHQ2.100";
    else if (upperSrc.includes("TEXAS") || upperSrc.includes("TEX")) detectedDyeOrProbeCode = "TEX.100";
    else if (upperSrc.includes("CY5")) detectedDyeOrProbeCode = "CY5.100";
    else if (upperSrc.includes("CY3")) detectedDyeOrProbeCode = "Cy3-BHQ2.100";
    else if (upperSrc.includes("ROX")) detectedDyeOrProbeCode = "ROX-BHQ2.100";
    else if (upperSrc.includes("VIC")) detectedDyeOrProbeCode = "VIC-BHQ1.100";
    else if (upperSrc.includes("HEX")) detectedDyeOrProbeCode = "HEX.100";
    else detectedDyeOrProbeCode = "FAM.100";
  } else if (upperSrc.includes("BIOTIN")) {
    detectedMode = "BIOTIN_NH2";
    detectedDyeOrProbeCode = "BIOTIN";
  } else if (upperSrc.includes("NH2") || upperSrc.includes("AMINE")) {
    detectedMode = "BIOTIN_NH2";
    detectedDyeOrProbeCode = "NH2";
  } else {
    const dyeFamilies: Array<[string, string]> = [
      ["FAM", "FAM-Primer"],
      ["HEX", "HEX-Primer"],
      ["TEXASRED", "Texasred-Primer"],
      ["TEX", "Texasred-Primer"],
      ["CY5", "Cy5-Primer"],
      ["CY3", "Cy3-Primer"],
      ["ROX", "ROX-Primer"],
      ["VIC", "VIC-Primer"],
      ["AF568", "AF568-Primer"],
      ["AF647", "AF647-Primer"],
    ];
    for (const [kw, prefix] of dyeFamilies) {
      if (upperSrc.includes(`[${kw}]`) || upperSrc.includes(`5'-${kw}`) || upperSrc.includes(`5'${kw}`)) {
        detectedMode = "DYE_PRIMER";
        detectedDyeOrProbeCode = prefix;
        break;
      }
    }
  }

  return {
    cleanSeq: stripped,
    formattedSeq: stripped ? `5'-${stripped}-3'` : src || "5'-...-3'",
    baseCount: stripped.length,
    lnaCount,
    inosineCount,
    detectedTags,
    detectedMode,
    detectedDyeOrProbeCode,
  };
}

export function resolveOligoLiveUnitPrice(
  code: string,
  priceTier: OligoPriceTier = "price",
  liveCatalog?: LiveCatalogProductLike[],
  priceOverrides?: Record<string, number>
): {
  unitPrice: number;
  usedRetailFallback: boolean;
  liveItem?: LiveCatalogProductLike;
  catalogEntry?: OligoCatalogEntry;
  isComingSoon: boolean;
} {
  const cUp = String(code || "").trim().toUpperCase();
  const catalogEntry = getOligoCatalogEntry(cUp);
  const liveItem = liveCatalog?.find(
    (p) => String(p.code || "").trim().toUpperCase() === cUp
  );

  const retailPrice = Math.max(
    0,
    Number(liveItem?.price !== undefined ? liveItem.price : catalogEntry?.price ?? 0) || 0
  );
  const statusText = `${liveItem?.leadTime || ""} ${catalogEntry?.status || ""}`.toLowerCase();
  const isComingSoon =
    statusText.includes("coming soon") ||
    statusText.includes("đang chuyển giao") ||
    statusText.includes("đang nghiên cứu");

  if (priceOverrides && Object.prototype.hasOwnProperty.call(priceOverrides, code)) {
    return {
      unitPrice: Math.max(0, Number(priceOverrides[code]) || 0),
      usedRetailFallback: false,
      liveItem,
      catalogEntry,
      isComingSoon,
    };
  }
  if (priceOverrides && catalogEntry && Object.prototype.hasOwnProperty.call(priceOverrides, catalogEntry.code)) {
    return {
      unitPrice: Math.max(0, Number(priceOverrides[catalogEntry.code]) || 0),
      usedRetailFallback: false,
      liveItem,
      catalogEntry,
      isComingSoon,
    };
  }

  let selected = retailPrice;
  let usedRetailFallback = false;

  if (priceTier === "priceDealer1") {
    const d1 = Number(
      liveItem?.priceDealer1 !== undefined
        ? liveItem.priceDealer1
        : catalogEntry?.priceDealer1 ?? 0
    ) || 0;
    if (d1 > 0) {
      selected = d1;
    } else if (retailPrice > 0) {
      selected = retailPrice;
      usedRetailFallback = true;
    } else {
      selected = 0;
    }
  } else if (priceTier === "priceDealer2") {
    const d2 = Number(
      liveItem?.priceDealer2 !== undefined
        ? liveItem.priceDealer2
        : catalogEntry?.priceDealer2 ?? 0
    ) || 0;
    if (d2 > 0) {
      selected = d2;
    } else if (retailPrice > 0) {
      selected = retailPrice;
      usedRetailFallback = true;
    } else {
      selected = 0;
    }
  }

  return {
    unitPrice: selected,
    usedRetailFallback,
    liveItem,
    catalogEntry,
    isComingSoon,
  };
}

export function buildOligoSkuCombination(
  input: OligoSkuCombinationInput
): OligoSkuCombinationResult {
  const seqLabel =
    String(input.seqName || "").trim() ||
    `Seq-${Math.floor(100 + Math.random() * 900)}`;
  const parsed = parseOligoSequenceDetails(input.rawSequence);
  const tubes = Math.max(1, Math.floor(Number(input.tubes) || 1));
  const bases = Math.max(
    1,
    Math.floor(Number(input.baseCountOverride) || parsed.baseCount || 20)
  );
  const priceTier: OligoPriceTier = input.priceTier || "price";
  const warnings: string[] = [];
  const items: OligoSkuComponentItem[] = [];

  // Probes only exist at 100 nmol in ABT Ver 04_2026
  const requestedScale = normalizeOligoScale(input.scale);
  const effectiveScale: OligoScale =
    input.mode === "PROBE" && requestedScale !== "100 nmol"
      ? "100 nmol"
      : requestedScale;

  if (input.mode === "PROBE" && requestedScale !== "100 nmol") {
    warnings.push(
      `Probe đầu dò trong bảng giá ABT cố định quy cách 100 nmol (tự động điều chỉnh từ ${requestedScale} về 100 nmol).`
    );
  }

  const pushComponent = (
    rawCode: string,
    role: "PRIMARY" | "ADDON",
    qtyPerTube: number,
    reason: string,
    overridePrice?: number
  ) => {
    const entry = getOligoCatalogEntry(rawCode);
    const canonicalCode = entry?.code || rawCode;
    const priceInfo = resolveOligoLiveUnitPrice(
      canonicalCode,
      priceTier,
      input.liveCatalog,
      overridePrice !== undefined
        ? { ...input.priceOverrides, [canonicalCode]: overridePrice }
        : input.priceOverrides
    );
    const qPerTube = Math.max(1, Math.floor(qtyPerTube || 1));
    const totalQty = qPerTube * tubes;
    const perTubeSubtotal = qPerTube * priceInfo.unitPrice;
    const subtotal = totalQty * priceInfo.unitPrice;

    if (priceInfo.isComingSoon) {
      warnings.push(
        `Mã ${canonicalCode} đang ở trạng thái Coming soon (${
          priceInfo.unitPrice === 0 ? "chưa có đơn giá" : `${priceInfo.unitPrice.toLocaleString("vi-VN")}đ`
        }).`
      );
    } else if (priceInfo.unitPrice === 0) {
      warnings.push(`Mã ${canonicalCode} hiện có đơn giá 0đ.`);
    }

    items.push({
      code: canonicalCode,
      name: priceInfo.liveItem?.name || entry?.name || canonicalCode,
      unit: priceInfo.liveItem?.unit || entry?.unit || "Tube",
      specification: priceInfo.liveItem?.specification || entry?.spec || "",
      purification: entry?.purification || "",
      role,
      reason,
      qtyPerTube: qPerTube,
      totalQty,
      unitPrice: priceInfo.unitPrice,
      subtotal,
      perTubeSubtotal,
      isComingSoon: priceInfo.isComingSoon,
      usedRetailFallback: priceInfo.usedRetailFallback,
      note: entry?.notes || "",
    });
  };

  if (input.mode === "UNMODIFIED") {
    const priCode = recommendBasePrimerCode(bases, effectiveScale, input.primerFamily || "AUTO");
    pushComponent(priCode, "PRIMARY", bases, `Tổng hợp ${bases} base (${effectiveScale})`);
    const priEntry = getOligoCatalogEntry(priCode);
    if (input.purificationCode) {
      // Check if default purification already satisfies request
      const reqPur = input.purificationCode;
      const defPur = (priEntry?.purification || "").toLowerCase();
      if (reqPur === "PUR-01" && (defPur.includes("cartridge") || defPur.includes("hplc"))) {
        warnings.push(`${priCode} đã bao gồm tinh sạch mặc định (${priEntry?.purification}); kiểm tra trước khi cộng thêm PUR-01.`);
      }
      pushComponent(reqPur, "ADDON", 1, "Dịch vụ tinh sạch bổ sung theo yêu cầu");
    }
    if (input.lyophilized) {
      pushComponent("PRE-01", "ADDON", 1, "Đông khô mẫu trước khi giao");
    }
  } else if (input.mode === "BIOTIN_NH2") {
    const priCode = recommendBasePrimerCode(bases, effectiveScale, input.primerFamily || "AUTO");
    pushComponent(priCode, "PRIMARY", bases, `Tổng hợp ${bases} base nền (${effectiveScale})`);
    const modPrefix =
      String(input.dyeOrProbeCode || "BIOTIN").toUpperCase().startsWith("NH2")
        ? "NH2"
        : "BIOTIN";
    const scaleNum = parseScaleNumber(effectiveScale);
    const modCode = `${modPrefix}.${scaleNum}`;
    pushComponent(modCode, "ADDON", 1, `Gắn nhãn ${modPrefix} đầu 5' (${effectiveScale})`);
    if (input.purificationCode) {
      pushComponent(input.purificationCode, "ADDON", 1, "Dịch vụ tinh sạch nâng cấp (HPLC/PAGE/Cartridge)");
    }
    if (input.lyophilized) {
      pushComponent("PRE-01", "ADDON", 1, "Đông khô mẫu");
    }
  } else if (input.mode === "DYE_PRIMER") {
    const rawDye = String(input.dyeOrProbeCode || "FAM-Primer").replace(/\.\d+$/, "");
    const scaleNum = parseScaleNumber(effectiveScale);
    const dyeCode = `${rawDye}.${scaleNum}`;
    pushComponent(
      dyeCode,
      "PRIMARY",
      1,
      `Primer gắn huỳnh quang đầu 5' (${effectiveScale} — đã gồm base nền, HPLC & đông khô)`
    );
    if (input.purificationCode) {
      warnings.push(`${dyeCode} đã bao gồm Tinh sạch HPLC mặc định; chỉ chọn ${input.purificationCode} nếu cần tính thêm phí riêng.`);
      pushComponent(input.purificationCode, "ADDON", 1, "Phụ phí tinh sạch bổ sung");
    }
    if (input.lyophilized) {
      warnings.push(`${dyeCode} đã bao gồm đông khô mặc định; chỉ giữ PRE-01 nếu cần tính thêm lần chia/đông khô riêng.`);
      pushComponent("PRE-01", "ADDON", 1, "Phụ phí đông khô bổ sung");
    }
  } else if (input.mode === "PROBE") {
    const chosenProbe = String(input.dyeOrProbeCode || "FAM.100");
    const entry = getOligoCatalogEntry(chosenProbe);
    const probeCode = entry && entry.group === "PROBE" ? entry.code : "FAM.100";
    pushComponent(
      probeCode,
      "PRIMARY",
      1,
      "Probe đầu dò 2 nhãn (100 nmol — đã gồm tổng hợp base, HPLC & đông khô)"
    );
    if (input.purificationCode) {
      warnings.push(`${probeCode} đã bao gồm Tinh sạch HPLC mặc định.`);
      pushComponent(input.purificationCode, "ADDON", 1, "Phụ phí tinh sạch bổ sung");
    }
    if (input.lyophilized) {
      warnings.push(`${probeCode} đã bao gồm đông khô mặc định.`);
      pushComponent("PRE-01", "ADDON", 1, "Phụ phí đông khô bổ sung");
    }
  } else if (input.mode === "GENE_SYNTHESIS") {
    const geneCode = input.geneCode === "CircleDNA" ? "CircleDNA" : "LinearDNA";
    pushComponent(geneCode, "PRIMARY", 1, "Tổng hợp đoạn DNA/Gene dài theo trình tự");
    if (bases >= 500) {
      warnings.push(
        `${geneCode} áp dụng bảng giá chuẩn cho đoạn dưới 500 bp (trình tự hiện tại ${bases} bp — xác nhận lại đơn giá với Phòng Tổng hợp Oligo).`
      );
    }
    if (input.plasmidCode) {
      pushComponent(input.plasmidCode, "ADDON", 1, "Vector Plasmid chèn đoạn tổng hợp");
    }
    if (input.purificationCode) {
      pushComponent(input.purificationCode, "ADDON", 1, "Tinh sạch bổ sung");
    }
    if (input.lyophilized) {
      pushComponent("PRE-01", "ADDON", 1, "Đông khô bổ sung");
    }
  }

  // Internal modifications (LNA / Inosine)
  if (input.mode !== "GENE_SYNTHESIS") {
    const scaleNum = parseScaleNumber(effectiveScale);
    const wantLna =
      input.includeLna !== undefined ? input.includeLna : parsed.lnaCount > 0;
    if (wantLna) {
      const lnaQty = Math.max(
        1,
        Math.floor(Number(input.lnaCountOverride) || parsed.lnaCount || 1)
      );
      const lnaScaleNum = scaleNum === "50" ? "100" : scaleNum;
      if (scaleNum === "50") {
        warnings.push("LNA hỗ trợ quy cách từ 100 nmol trở lên -> tự chọn mã LNA.100.");
      }
      pushComponent(
        `LNA.${lnaScaleNum}`,
        "ADDON",
        lnaQty,
        `Gắn ${lnaQty} base biến đổi LNA (${lnaScaleNum} nmol)`
      );
    }

    const wantInosine =
      input.includeInosine !== undefined
        ? input.includeInosine
        : parsed.inosineCount > 0;
    if (wantInosine) {
      const inoQty = Math.max(
        1,
        Math.floor(Number(input.inosineCountOverride) || parsed.inosineCount || 1)
      );
      pushComponent(
        `Inosine.${scaleNum}`,
        "ADDON",
        inoQty,
        `Gắn ${inoQty} base Inosine (${scaleNum} nmol)`
      );
    }
  }

  // Manual extra SKUs combined into the same sequence
  if (Array.isArray(input.extraSkus)) {
    for (const ext of input.extraSkus) {
      const c = String(ext?.code || "").trim();
      if (!c) continue;
      pushComponent(
        c,
        "ADDON",
        Math.max(1, Math.floor(Number(ext.qtyPerTube) || 1)),
        "Mã Oligo phối hợp thêm",
        ext.unitPriceOverride
      );
    }
  }

  const totalPerTube = items.reduce((s, x) => s + x.perTubeSubtotal, 0);
  const totalAmount = items.reduce((s, x) => s + x.subtotal, 0);

  return {
    seqLabel,
    formattedSeq: parsed.formattedSeq,
    parsed,
    effectiveScale,
    tubes,
    bases,
    items,
    totalPerTube,
    totalAmount,
    warnings,
  };
}
