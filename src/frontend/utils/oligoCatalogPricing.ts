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
import {
  ABT_DYE_PRIMER_FAMILY_BY_DYE,
  ABT_PROBE_SKU_BY_PAIR,
  baseLetterOf,
  isFluorescentDye,
  isQuencher,
  parseOligoSequence,
} from "@/shared/oligoSequence";

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

/** Thứ bậc cấp tinh sạch, theo cùng thứ tự với tính giá nhà máy (pricing.ts): Desalt < Cartridge(OPC) < PAGE < HPLC. 0 = không rõ. */
export const OLIGO_PURIFICATION_RANK: Readonly<Record<string, number>> = {
  "PUR-01": 2,
  "PUR-03": 3,
  "PUR-02": 4,
};

export function purificationRank(codeOrText?: string | null): number {
  const raw = String(codeOrText || "").trim();
  if (!raw) return 0;
  const byCode = OLIGO_PURIFICATION_RANK[raw.toUpperCase()];
  if (byCode) return byCode;
  const t = raw.toLowerCase();
  if (t.includes("hplc")) return 4;
  if (t.includes("page")) return 3;
  if (t.includes("cartridge") || t.includes("opc")) return 2;
  if (t.includes("desalt") || t.includes("muối") || t.includes("muoi")) return 1;
  return 0;
}

export function parseOligoSequenceDetails(rawSeq: string): ParsedOligoSequenceDetails {
  const src = String(rawSeq || "").trim();

  // Ký hiệu riêng của Kinh doanh trước khi đưa vào bộ tách dùng chung:
  // LNA viết [LNA-A] / [LNAA] / {A}; Inosine viết (I), (dI), [Inosine]
  const working = src
    .replace(/\[(?:LNA[-_ ]?|d?LNA)([ATGCU])\]/gi, (_m, b: string) => `+${b.toUpperCase()}`)
    .replace(/\{([ATGCU])\}/gi, (_m, b: string) => `+${b.toUpperCase()}`)
    .replace(/(?:\[(?:dI|Inosine|I)\]|\((?:dI|Inosine|I)\)|\/(?:dI|Inosine)\/)/gi, "I");

  const parsed = parseOligoSequence(working);
  const cleanSeq = parsed.bases.map(baseLetterOf).join("");
  const lnaCount = parsed.bases.filter((b) => b.startsWith("+")).length;
  const inosineCount = parsed.bases.filter((b) => b === "I").length;
  const allMods = [...parsed.mods5Prime, ...parsed.modsInternal, ...parsed.mods3Prime];
  const detectedTags = [...new Set(allMods)];

  // Gợi ý chế độ & mã SKU từ nhóm đánh dấu đã nhận diện (không dò chuỗi con trong toàn bộ text,
  // để ký tự base không bị hiểu nhầm thành tên nhãn và ngược lại).
  let detectedMode: OligoProductMode | undefined;
  let detectedDyeOrProbeCode: string | undefined;

  const dyes = allMods.filter((m) => isFluorescentDye(m));
  const quenchers3 = parsed.mods3Prime.filter((m) => isQuencher(m) || m === "TAMRA");
  const dye5 = parsed.mods5Prime.find((m) => isFluorescentDye(m)) ?? dyes.find((m) => !quenchers3.includes(m));

  if (quenchers3.length > 0) {
    detectedMode = "PROBE";
    const dye = dye5 ?? "FAM";
    const q = quenchers3[0];
    detectedDyeOrProbeCode =
      ABT_PROBE_SKU_BY_PAIR[`${dye}/${q}`] ??
      (q === "MGB" ? "FAM-MGB.100" : q === "TAMRA" ? "FAM-TAMRA.100" : "FAM.100");
  } else if (dye5 && ABT_DYE_PRIMER_FAMILY_BY_DYE[dye5]) {
    detectedMode = "DYE_PRIMER";
    detectedDyeOrProbeCode = ABT_DYE_PRIMER_FAMILY_BY_DYE[dye5];
  } else if (allMods.includes("BIOTIN")) {
    detectedMode = "BIOTIN_NH2";
    detectedDyeOrProbeCode = "BIOTIN";
  } else if (allMods.includes("NH2")) {
    detectedMode = "BIOTIN_NH2";
    detectedDyeOrProbeCode = "NH2";
  }

  return {
    cleanSeq,
    formattedSeq: cleanSeq ? `5'-${cleanSeq}-3'` : src || "5'-...-3'",
    baseCount: cleanSeq.length,
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

  /**
   * Tinh sạch: chỉ cộng phí PUR-xx khi cấp yêu cầu CAO HƠN cấp mặc định đã gồm trong mã chính
   * (Desalt < Cartridge/OPC < PAGE < HPLC). Bằng hoặc thấp hơn mặc định → không cộng phí.
   */
  const pushPurificationAboveDefault = (defaultSkuCodes: string[], reason: string) => {
    const reqPur = input.purificationCode;
    if (!reqPur) return;
    const defaultText = defaultSkuCodes
      .map((c) => getOligoCatalogEntry(c)?.purification || "")
      .reduce((best, t) => (purificationRank(t) > purificationRank(best) ? t : best), "");
    const reqRank = purificationRank(reqPur);
    const defRank = purificationRank(defaultText);
    if (defRank > 0 && reqRank <= defRank) {
      warnings.push(
        `${defaultSkuCodes[0]} đã gồm tinh sạch mặc định (${defaultText}); ${reqPur} không cao hơn mặc định nên không cộng phí.`
      );
      return;
    }
    pushComponent(reqPur, "ADDON", 1, reason);
  };

  if (input.mode === "UNMODIFIED") {
    const priCode = recommendBasePrimerCode(bases, effectiveScale, input.primerFamily || "AUTO");
    pushComponent(priCode, "PRIMARY", bases, `Tổng hợp ${bases} base (${effectiveScale})`);
    pushPurificationAboveDefault([priCode], "Dịch vụ tinh sạch bổ sung theo yêu cầu");
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
    pushPurificationAboveDefault([priCode, modCode], "Dịch vụ tinh sạch nâng cấp (HPLC/PAGE/Cartridge)");
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
    pushPurificationAboveDefault([dyeCode], "Phụ phí tinh sạch bổ sung");
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
    pushPurificationAboveDefault([probeCode], "Phụ phí tinh sạch bổ sung");
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
