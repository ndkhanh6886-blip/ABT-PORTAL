/**
 * Quy cách đóng gói của kit PCR (mã hàng có khai báo phụ kiện): cùng một mã hàng, cùng giá, phân biệt theo SỐ LÔ.
 * Số lô gồm các đoạn cách nhau bởi dấu chấm, vd "B293092.D.IC.T01" hoặc "200635.C324800.IC":
 *  - Dạng: đoạn bắt đầu bằng "C" (".C") = chia sẵn vào tube PCR, KHÔNG kèm phụ kiện; không có = không chia sẵn,
 *    kèm phụ kiện theo định mức (BOM).
 *  - IC: có đoạn "IC" = sẵn IC; không có = không sẵn IC.
 *  - Loại tube: đoạn trùng một mã trong PCR_TUBE_CODES (vd ".T01"). Dạng chia sẵn: tube mà kit được chia vào;
 *    dạng không chia sẵn: tube PCR cấp kèm theo bộ.
 * Chỉ áp dụng cho kit PCR có khai báo phụ kiện (isPcrKitProduct); kit tách chiết, hóa chất khác không phân quy cách.
 */
export type PackagingForm = "PREALIQUOT" | "WITH_ACCESSORIES";
export type IcForm = "IC" | "NO_IC";

export const PACKAGING_LABEL: Record<PackagingForm, string> = {
  PREALIQUOT: "Chia sẵn",
  WITH_ACCESSORIES: "Không chia sẵn",
};

export const IC_LABEL: Record<IcForm, string> = {
  IC: "Sẵn IC",
  NO_IC: "Không sẵn IC",
};

/** Mã nhận diện tube PCR (ghi trong số lô). */
export const PCR_TUBE_CODES = ["T02", "T01", "S02", "S01", "LQ02", "MIC", "R01", "LP02"] as const;
export type TubeType = (typeof PCR_TUBE_CODES)[number];

/** Quy cách khách yêu cầu trên một dòng SO (cũng là quy cách đọc ra từ một số lô). */
export interface KitSpec {
  packagingForm?: PackagingForm;
  icForm?: IcForm;
  tubeType?: TubeType;
}

/** Mã kit PCR: SQ-, MQ-, SP-, MP- (kể cả có thêm 1 chữ trước dấu gạch: SQH-, SQS-...). */
const PCR_KIT_CODE = /^(SQ|MQ|SP|MP)[A-Z]?-/;

/**
 * Kit PCR (có quy cách chia sẵn / IC / loại tube), nhận biết theo MÃ HÀNG (Bảng mã đang để Kit PCR và Kit tách chiết
 * chung một nhóm) và chỉ hàng của nhà cung cấp / hãng ABT. Kit tách chiết (HI-, HE-, HM-...), kit hãng khác và hóa chất khác
 * không phân quy cách dù có khai báo phụ kiện.
 */
export function isPcrKitProduct(p: { code?: any; [k: string]: any } | null | undefined): boolean {
  const code = String(p?.code ?? p?.product_code ?? "").trim().toUpperCase();
  const cat = String(p?.bom_category ?? p?.category ?? "").trim().toLowerCase();
  if (!PCR_KIT_CODE.test(code) && cat !== "pcr kit") return false;
  // Chỉ kit PCR của ABT / Phòng Sản xuất Kit (hoặc chưa điền hãng nhưng đúng mã chuẩn SQ-/MQ-/SP-/MP-) mới phân quy cách
  const maker = [p?.manufacturer, p?.brand, p?.supplier, p?.supplier_name].map(v => String(v ?? "").trim()).filter(Boolean).join(" ");
  if (!maker) return PCR_KIT_CODE.test(code);
  return /(^|[^A-Z0-9])(ABT|TOPSENSI|P-KIT)([^A-Z0-9]|$)|sản xuất kit/i.test(maker);
}

/** Đọc quy cách Kit PCR từ chuỗi ghi chú hoặc quy cách (vd "[Dạng: Chia sẵn · Sẵn IC · chia vào tube T02]" hoặc "B2611001.C.IC.T02"). */
export function parseKitSpecFromText(rawText: any): KitSpec {
  const text = String(rawText ?? "").trim();
  if (!text) return {};
  const spec: KitSpec = {};
  const tagMatch = text.match(/\[Dạng:\s*([^\]]+)\]/i);
  const target = tagMatch ? tagMatch[1] : text;

  if (/không\s*chia\s*sẵn/i.test(target)) spec.packagingForm = "WITH_ACCESSORIES";
  else if (/chia\s*sẵn/i.test(target)) spec.packagingForm = "PREALIQUOT";

  if (/không\s*sẵn\s*ic/i.test(target)) spec.icForm = "NO_IC";
  else if (/sẵn\s*ic|có\s*ic/i.test(target)) spec.icForm = "IC";

  const tubeMatch = target.match(/\b(T02|T01|S02|S01|LQ02|MIC|R01|LP02)\b/i);
  if (tubeMatch) {
    spec.tubeType = tubeMatch[1].toUpperCase() as TubeType;
  }
  return spec;
}

export type FactorySupplyFormKey = "NO_SPLIT_NO_IC" | "NO_SPLIT_WITH_IC" | "SPLIT_NO_IC" | "SPLIT_WITH_IC";

/** Chuyển đổi KitSpec (Kinh doanh/Cung ứng) sang supply_form + tube_code của Nhà máy Sản xuất Kit. */
export function kitSpecToFactorySupplyAndTube(spec: KitSpec): {
  supply_form: FactorySupplyFormKey | null;
  tube_code: TubeType | null;
  variant_code: "BASE" | "IC" | "C" | "C.IC" | null;
} {
  const tube_code = spec.tubeType ?? null;
  if (!spec.packagingForm && !spec.icForm) {
    return { supply_form: null, tube_code, variant_code: null };
  }
  const isSplit = spec.packagingForm === "PREALIQUOT";
  const hasIc = spec.icForm === "IC";
  if (isSplit && hasIc) return { supply_form: "SPLIT_WITH_IC", tube_code, variant_code: "C.IC" };
  if (isSplit && !hasIc) return { supply_form: "SPLIT_NO_IC", tube_code, variant_code: "C" };
  if (!isSplit && hasIc) return { supply_form: "NO_SPLIT_WITH_IC", tube_code, variant_code: "IC" };
  return { supply_form: "NO_SPLIT_NO_IC", tube_code, variant_code: "BASE" };
}

/** Chuyển ngược từ supply_form + tube_code của Nhà máy sang KitSpec của Kinh doanh/Cung ứng. */
export function factorySupplyAndTubeToKitSpec(
  supplyForm?: string | null,
  tubeCode?: string | null
): KitSpec {
  const sf = String(supplyForm ?? "").trim().toUpperCase();
  const spec: KitSpec = {};
  if (sf === "SPLIT_WITH_IC") {
    spec.packagingForm = "PREALIQUOT";
    spec.icForm = "IC";
  } else if (sf === "SPLIT_NO_IC") {
    spec.packagingForm = "PREALIQUOT";
    spec.icForm = "NO_IC";
  } else if (sf === "NO_SPLIT_WITH_IC") {
    spec.packagingForm = "WITH_ACCESSORIES";
    spec.icForm = "IC";
  } else if (sf === "NO_SPLIT_NO_IC") {
    spec.packagingForm = "WITH_ACCESSORIES";
    spec.icForm = "NO_IC";
  }
  const t = normalizeTubeType(tubeCode);
  if (t) spec.tubeType = t;
  return spec;
}

const lotSegments = (lot: any): string[] =>
  String(lot ?? "").trim().toUpperCase().split(".").map(s => s.trim()).filter(Boolean);

/** Dạng đóng gói suy ra từ số lô (".C" = chia sẵn). Lô trống: không xác định. */
export function packagingFormOfLot(lot: any): PackagingForm | null {
  const s = String(lot ?? "").trim().toUpperCase();
  if (!s) return null;
  return /\.C/.test(s) ? "PREALIQUOT" : "WITH_ACCESSORIES";
}

/** IC suy ra từ số lô (đoạn ".IC"). Lô trống: không xác định. */
export function icFormOfLot(lot: any): IcForm | null {
  const segs = lotSegments(lot);
  if (segs.length === 0) return null;
  return segs.includes("IC") ? "IC" : "NO_IC";
}

/** Loại tube ghi trong số lô (vd ".T01"); lô không ghi loại tube: null. */
export function tubeTypeOfLot(lot: any): TubeType | null {
  const segs = lotSegments(lot);
  return (segs.find(s => (PCR_TUBE_CODES as readonly string[]).includes(s)) as TubeType | undefined) || null;
}

export function normalizePackagingForm(v: any): PackagingForm | null {
  const s = String(v ?? "").trim().toUpperCase();
  return s === "PREALIQUOT" || s === "WITH_ACCESSORIES" ? (s as PackagingForm) : null;
}

export function normalizeIcForm(v: any): IcForm | null {
  const s = String(v ?? "").trim().toUpperCase();
  return s === "IC" || s === "NO_IC" ? (s as IcForm) : null;
}

export function normalizeTubeType(v: any): TubeType | null {
  const s = String(v ?? "").trim().toUpperCase();
  return (PCR_TUBE_CODES as readonly string[]).includes(s) ? (s as TubeType) : null;
}

/** Quy cách đã chuẩn hóa của một dòng SO / PR / PO / phiếu giao (tự động đọc cả từ thẻ [Dạng: ...] nếu lưu ở ghi chú/quy cách). */
export function kitSpecOf(it: any): KitSpec {
  const fromFactory = factorySupplyAndTubeToKitSpec(it?.supply_form ?? it?.supplyForm, it?.tube_code ?? it?.tubeCode);
  const fromText = parseKitSpecFromText(`${it?.notes ?? ""} ${it?.specification ?? ""}`);
  const spec: KitSpec = {};
  const f = normalizePackagingForm(it?.packagingForm) || fromFactory.packagingForm || fromText.packagingForm;
  const ic = normalizeIcForm(it?.icForm) || fromFactory.icForm || fromText.icForm;
  const tube = normalizeTubeType(it?.tubeType) || fromFactory.tubeType || fromText.tubeType;
  if (f) spec.packagingForm = f;
  if (ic) spec.icForm = ic;
  if (tube) spec.tubeType = tube;
  return spec;
}

export const hasKitSpec = (spec: KitSpec) => Boolean(spec.packagingForm || spec.icForm || spec.tubeType);

/** Các mục quy cách còn thiếu (kit PCR phải chọn đủ dạng, IC và loại tube). */
export function missingKitSpec(spec: KitSpec): string[] {
  const miss: string[] = [];
  if (!spec.packagingForm) miss.push("chia sẵn / không chia sẵn");
  if (!spec.icForm) miss.push("sẵn IC / không sẵn IC");
  if (!spec.tubeType) miss.push(spec.packagingForm === "WITH_ACCESSORIES" ? "loại tube PCR cấp kèm" : spec.packagingForm === "PREALIQUOT" ? "loại tube chia sẵn" : "loại tube");
  return miss;
}

/** Ý nghĩa của loại tube theo dạng: chia sẵn = chia vào tube đó; không chia sẵn = cấp kèm tube đó. */
export function tubeLabel(spec: KitSpec): string {
  if (!spec.tubeType) return "";
  if (spec.packagingForm === "PREALIQUOT") return `chia vào tube ${spec.tubeType}`;
  if (spec.packagingForm === "WITH_ACCESSORIES") return `cấp kèm tube ${spec.tubeType}`;
  return `Tube ${spec.tubeType}`;
}

/** Vd "Chia sẵn · Sẵn IC · chia vào tube T01" / "Không chia sẵn · Không sẵn IC · cấp kèm tube T02". */
export function kitSpecLabel(spec: KitSpec): string {
  return [
    spec.packagingForm ? PACKAGING_LABEL[spec.packagingForm] : "",
    spec.icForm ? IC_LABEL[spec.icForm] : "",
    tubeLabel(spec),
  ].filter(Boolean).join(" · ");
}

/** Quy cách đọc ra từ số lô (lô không ghi loại tube thì bỏ phần tube). */
export function lotKitSpec(lot: any): KitSpec {
  const spec: KitSpec = {};
  const f = packagingFormOfLot(lot);
  const ic = icFormOfLot(lot);
  const tube = tubeTypeOfLot(lot);
  if (f) spec.packagingForm = f;
  if (ic) spec.icForm = ic;
  if (tube) spec.tubeType = tube;
  return spec;
}

/**
 * Những yêu cầu của dòng SO mà số lô KHÔNG đáp ứng (rỗng = lô đúng quy cách), vd ["Chia sẵn (lô: Không chia sẵn)"].
 * Chỉ xét các mục SO có yêu cầu; lô trống thì chưa xét.
 */
export function kitSpecMismatches(lot: any, spec: KitSpec): string[] {
  if (!String(lot ?? "").trim()) return [];
  const have = lotKitSpec(lot);
  const out: string[] = [];
  if (spec.packagingForm && have.packagingForm !== spec.packagingForm) {
    out.push(`${PACKAGING_LABEL[spec.packagingForm]} (lô: ${have.packagingForm ? PACKAGING_LABEL[have.packagingForm] : "?"})`);
  }
  if (spec.icForm && have.icForm !== spec.icForm) {
    out.push(`${IC_LABEL[spec.icForm]} (lô: ${have.icForm ? IC_LABEL[have.icForm] : "?"})`);
  }
  // Loại tube chỉ xét được khi số lô có ghi mã tube, và chỉ với dạng CHIA SẴN (kit chia vào tube đó). Dạng không chia sẵn:
  // tube là phụ kiện cấp kèm, không thể hiện trong số lô -> không loại lô (trước đây mọi lô SQS-112 bị ẩn vì "không ghi loại tube").
  const tubeMatters = spec.packagingForm !== "WITH_ACCESSORIES" && have.packagingForm !== "WITH_ACCESSORIES";
  if (spec.tubeType && tubeMatters && have.tubeType && have.tubeType !== spec.tubeType) {
    out.push(`Tube ${spec.tubeType} (lô: Tube ${have.tubeType})`);
  }
  return out;
}

export const lotMatchesKitSpec = (lot: any, spec: KitSpec) => kitSpecMismatches(lot, spec).length === 0;

/** Thẻ ghi trong ô Ghi chú của dòng SO, vd "[Dạng: Chia sẵn · Sẵn IC · Tube T01]". */
export const packagingNoteTag = (spec: KitSpec) => `[Dạng: ${kitSpecLabel(spec)}]`;

/** Đặt / bỏ thẻ quy cách ở đầu ghi chú, giữ nguyên phần ghi chú người dùng gõ. */
export function withPackagingNote(notes: any, spec: KitSpec | null): string {
  const rest = String(notes ?? "").replace(/^\s*\[Dạng:[^\]]*\]\s*/u, "");
  return spec && hasKitSpec(spec) ? `${packagingNoteTag(spec)}${rest ? " " + rest : ""}` : rest;
}
