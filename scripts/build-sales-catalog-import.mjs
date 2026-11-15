#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

const DEFAULT_INPUT =
  "C:/Users/ASUS/Downloads/Bang_Gia_ABT_Toan_Bo_Kem_Thong_Bao_Ver_04_2026_20261115.xlsx";
const DOWNLOADS_OUT =
  "C:/Users/ASUS/Downloads/Import_Danh_Muc_San_Pham_Kinh_Doanh_ABT_Ver_04_2026.xlsx";
const PUBLIC_OUT = path.resolve(
  process.cwd(),
  "public/templates/Import_Danh_Muc_San_Pham_Kinh_Doanh_ABT_Ver_04_2026.xlsx"
);

const PRODUCT_SHEETS = [
  "Thiết bị",
  "Kit test",
  "Hóa chất",
  "Vật tư",
  "Oligo",
  "Giải pháp tự pha",
];

function cleanStr(val) {
  if (val === undefined || val === null) return "";
  return String(val).replace(/\r\n/g, "\n").trim();
}

function parseExcelPrice(raw) {
  if (typeof raw === "number") {
    return { price: Number.isFinite(raw) ? raw : 0, unpricedNote: "" };
  }
  const s = cleanStr(raw);
  if (!s) return { price: 0, unpricedNote: "" };
  if (/chưa có giá/i.test(s)) {
    return { price: 0, unpricedNote: "Chưa có giá" };
  }
  const normalized = s.replace(/[^0-9.-]/g, "");
  const n = Number(normalized);
  return { price: Number.isFinite(n) ? n : 0, unpricedNote: "" };
}

function resolveCategory(sheetName, code, name, tech) {
  const cUp = code.toUpperCase();
  const text = `${name} ${tech}`.toLowerCase();
  switch (sheetName) {
    case "Thiết bị":
      return "Thiết bị Phòng Lab";
    case "Kit test": {
      if (
        /^(EXS|EXM|HE|HI|HM|AES)-/.test(cUp) ||
        ["tách chiết", "extraction", "toppure", "purification", "thu nhận"].some((k) =>
          text.includes(k)
        )
      ) {
        return "Kit Tách chiết";
      }
      if (
        text.includes("pcr") ||
        text.includes("topsensi") ||
        text.includes("master mix") ||
        text.includes("mastermix") ||
        /^(SQ|SD|SM|SH|SV|SP|SA|SC|SG|ST|TS|RT)[A-Z0-9-]*$/.test(cUp)
      ) {
        return "PCR Kit";
      }
      return "Kit Xét nghiệm";
    }
    case "Hóa chất":
      return "Hóa chất & Sinh phẩm";
    case "Vật tư":
      return "Vật tư tiêu hao";
    case "Oligo":
      return "Oligo";
    case "Giải pháp tự pha":
      return "Giải pháp tự pha";
    default:
      return sheetName;
  }
}

function inferOligoSubGroup(code) {
  const c = code.trim();
  if (/^PRI-/i.test(c)) return "Oligo - Primer tổng hợp theo base";
  if (/^PUR-/i.test(c)) return "Oligo - Dịch vụ tinh sạch";
  if (/^PRE-/i.test(c)) return "Oligo - Dịch vụ đông khô / xử lý";
  if (/^(FAM|HEX|TEX|CY5|Cy3|ROX|VIC|AF568|AF647)-?(BHQ|TAMRA|MGB)?\.100$/i.test(c) && !/-Primer\./i.test(c)) {
    return "Oligo - Probe đầu dò huỳnh quang (qPCR)";
  }
  if (/-Primer\./i.test(c)) return "Oligo - Primer gắn huỳnh quang đầu 5'";
  if (/^(LNA|BIOTIN|NH2|Inosine)\./i.test(c)) return "Oligo - Biến đổi (Modification)";
  if (/^(LinearDNA|CircleDNA|Plasmid\.)/i.test(c)) return "Oligo - Tổng hợp Gene / Plasmid";
  return "Oligo - Khác";
}

function inferUnit(sheetName, code, name, spec) {
  const cUp = code.toUpperCase();
  const sLow = spec.toLowerCase();
  const nLow = name.toLowerCase();
  if (sheetName === "Oligo") {
    if (cUp.startsWith("PRI-")) return "Base";
    if (cUp.startsWith("PUR-") || cUp.startsWith("PRE-")) return "Mẫu";
    if (/^(LNA|BIOTIN|NH2|INOSINE)\./.test(cUp)) return "Nhân";
    if (/^(LINEARDNA|CIRCLEDNA|PLASMID\.)/.test(cUp)) return "Mẫu";
    return "Tube";
  }
  if (sheetName === "Thiết bị") {
    if (sLow.includes("bộ") || nLow.includes("hệ thống")) return "Bộ";
    return "Cái";
  }
  if (sheetName === "Giải pháp tự pha") return "Bộ";
  if (sheetName === "Kit test") {
    if (sLow.includes("hộp") || sLow.includes("test") || nLow.includes("kit")) return "Hộp";
    if (sLow.includes("chai") || sLow.includes("ml")) return "Chai";
    if (sLow.includes("ống") || sLow.includes("tube")) return "Ống";
    return "Hộp";
  }
  if (sheetName === "Hóa chất") {
    if (sLow.includes("set")) return "Set";
    if (sLow.includes("chai") || sLow.includes("lit") || sLow.includes("ml")) return "Chai";
    if (sLow.includes("ống") || sLow.includes("tube")) return "Ống";
    if (sLow.includes("test") || sLow.includes("reaction")) return "Hộp";
    return "Chai";
  }
  if (sheetName === "Vật tư") {
    if (sLow.includes("hộp")) return "Hộp";
    if (sLow.includes("thùng")) return "Thùng";
    if (sLow.includes("gói")) return "Gói";
    if (sLow.includes("bộ")) return "Bộ";
    if (sLow.includes("cột") || sLow.includes("chày")) return "Hộp";
    return "Cái";
  }
  return "Cái";
}

function inferStorageCondition(sheetName, category, name) {
  const nLow = name.toLowerCase();
  if (sheetName === "Oligo" || sheetName === "Giải pháp tự pha") {
    return "-20°C (Đông lạnh - Sinh phẩm PCR, Enzyme)";
  }
  if (sheetName === "Thiết bị" || sheetName === "Vật tư") {
    return "15-25°C (Nhiệt độ phòng)";
  }
  if (category === "PCR Kit" || nLow.includes("enzyme") || nLow.includes("taq") || nLow.includes("polymerase")) {
    return "-20°C (Đông lạnh - Sinh phẩm PCR, Enzyme)";
  }
  if (sheetName === "Kit test" || sheetName === "Hóa chất") {
    if (nLow.includes("proteinase")) return "-20°C (Đông lạnh - Sinh phẩm PCR, Enzyme)";
    if (nLow.includes("ethanol") || nLow.includes("pbs") || nLow.includes("tris") || nLow.includes("buffer")) {
      return "15-25°C (Nhiệt độ phòng)";
    }
    return "2-8°C (Kho mát - Hóa chất, Kháng thể)";
  }
  return "15-25°C (Nhiệt độ phòng)";
}

function fixProductName(sheetName, code, rawName) {
  let name = cleanStr(rawName).replace(/\s+/g, " ");
  // Fix known source typo on AF568-Primer.50 where name accidentally said VIC
  if (sheetName === "Oligo" && code === "AF568-Primer.50" && name.includes("VIC")) {
    name = name.replace(/\bVIC\b/, "AF568");
  }
  return name;
}

function main() {
  const explicitInput = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
  const inputPath = explicitInput ? path.resolve(explicitInput) : DEFAULT_INPUT;
  if (!fs.existsSync(inputPath)) {
    console.error(`Input workbook not found: ${inputPath}`);
    process.exit(1);
  }

  const wb = XLSX.readFile(inputPath);
  const byCode = new Map();
  const orderOfCodes = [];
  const countsBySheet = {};
  const duplicateEvents = [];
  const oligoRowsForSheet = [];

  for (const sheetName of PRODUCT_SHEETS) {
    const ws = wb.Sheets[sheetName];
    if (!ws) {
      throw new Error(`Missing expected sheet "${sheetName}" in ${inputPath}`);
    }
    const rawRows = XLSX.utils.sheet_to_json(ws, { defval: "" });
    countsBySheet[sheetName] = 0;

    for (const r of rawRows) {
      const code = cleanStr(r["Mã SP"]);
      if (!code) continue;
      if (/^OLIGO-(PRIMER|PROBE|BASE|MOD|PUR|SVC)$/i.test(code) || code.toUpperCase() === "CUSTOM-ORDER") {
        throw new Error(`Unexpected legacy generic code ${code} found in ${sheetName}`);
      }

      const name = fixProductName(sheetName, code, r["Tên Sản Phẩm"]);
      const tech = cleanStr(
        r["Tinh Sạch Mặc Định"] !== undefined ? r["Tinh Sạch Mặc Định"] : r["Thông Tin Kỹ Thuật"]
      );
      const spec = cleanStr(r["Quy cách"]);
      const expiry = cleanStr(r["Hạn dùng"]);
      const dklh = cleanStr(r["Số ĐKLH"]);
      const cfs = cleanStr(r["CFS"]);
      const status = cleanStr(r["Tình trạng"]) || "Available";
      const retail = parseExcelPrice(r["Giá Bán Lẻ"]);
      const d1 = parseExcelPrice(r["Giá Dealer 1"]);
      const d2 = parseExcelPrice(r["Giá Dealer 2"]);
      const srcNote = cleanStr(r["Ghi chú (Ver 04_2026)"]);

      const category = resolveCategory(sheetName, code, name, tech);
      const subCategory = sheetName === "Oligo" ? inferOligoSubGroup(code) : sheetName;
      const unit = inferUnit(sheetName, code, name, spec);
      const storageCondition = inferStorageCondition(sheetName, category, name);
      const leadTime =
        sheetName === "Oligo"
          ? status.toLowerCase() === "coming soon"
            ? "Coming soon"
            : "Đặt tổng hợp 3-7 ngày"
          : status;

      const noteParts = [];
      if (tech) {
        noteParts.push(sheetName === "Oligo" ? `Tinh sạch mặc định: ${tech}` : tech);
      }
      if (expiry) noteParts.push(`HSD: ${expiry}`);
      if (dklh) noteParts.push(`ĐKLH: ${dklh}`);
      if (cfs) noteParts.push(`CFS: ${cfs}`);
      if (retail.unpricedNote) noteParts.push("Bảng giá: Chưa có giá");
      if (srcNote) noteParts.push(srcNote);

      const entry = {
        code,
        name,
        category,
        subCategory,
        sheetName,
        brand: "ABT",
        supplier:
          sheetName === "Oligo"
            ? "Phòng Tổng hợp Oligo"
            : sheetName === "Thiết bị"
            ? "Phòng Kỹ thuật - Thiết bị"
            : "Phòng Sản xuất Kit",
        unit,
        spec,
        storageCondition,
        costPrice: 0,
        price: retail.price,
        priceDealer1: d1.price,
        priceDealer2: d2.price,
        status,
        leadTime,
        minStock: sheetName === "Oligo" ? 0 : "",
        tech,
        expiry,
        dklh,
        cfs,
        srcNote,
        notes: noteParts.join(" | "),
      };

      const key = code.toUpperCase();
      if (byCode.has(key)) {
        const prev = byCode.get(key);
        if (prev.sheetName !== sheetName || prev.price !== entry.price) {
          throw new Error(
            `Conflicting duplicate SKU "${code}" across ${prev.sheetName} vs ${sheetName}`
          );
        }
        // Merge distinct tech descriptions (e.g., ADP-008)
        if (tech && !prev.tech.includes(tech)) {
          prev.tech = prev.tech ? `${prev.tech}; ${tech}` : tech;
          const parts = [];
          if (prev.tech) parts.push(prev.sheetName === "Oligo" ? `Tinh sạch mặc định: ${prev.tech}` : prev.tech);
          if (prev.expiry) parts.push(`HSD: ${prev.expiry}`);
          if (prev.dklh) parts.push(`ĐKLH: ${prev.dklh}`);
          if (prev.cfs) parts.push(`CFS: ${prev.cfs}`);
          if (prev.srcNote) parts.push(prev.srcNote);
          prev.notes = parts.join(" | ");
        }
        duplicateEvents.push({ code, sheetName });
        continue;
      }

      byCode.set(key, entry);
      orderOfCodes.push(key);
      countsBySheet[sheetName] += 1;
      if (sheetName === "Oligo") {
        oligoRowsForSheet.push(entry);
      }
    }
  }

  const consolidatedRows = orderOfCodes.map((key, idx) => {
    const e = byCode.get(key);
    return {
      "STT": idx + 1,
      "Mã SKU (*)": e.code,
      "Tên sản phẩm (*)": e.name,
      "Phân Loại Chính": e.category,
      "Nhóm Hàng Con": e.subCategory,
      "Hãng sản xuất (*)": e.brand,
      "Nhà Cung Cấp": e.supplier,
      "Đơn vị tính": e.unit,
      "Quy cách đóng gói": e.spec,
      "Điều kiện bảo quản chuẩn (*)": e.storageCondition,
      "Giá Vốn (VNĐ)": e.costPrice,
      "Giá niêm yết End-User (VNĐ)": e.price,
      "Giá Đại lý Cấp 1 (VNĐ)": e.priceDealer1,
      "Giá Đại lý Cấp 2 (VNĐ)": e.priceDealer2,
      "Tồn kho tối thiểu": e.minStock,
      "Tình Trạng Hàng": e.leadTime,
      "Tinh Sạch / Thông Tin Kỹ Thuật": e.tech,
      "Hạn dùng": e.expiry,
      "Số ĐKLH": e.dklh,
      "CFS": e.cfs,
      "Ghi Chú": e.notes,
    };
  });

  const oligoRefRows = oligoRowsForSheet.map((e, idx) => ({
    "STT": idx + 1,
    "Mã SKU (*)": e.code,
    "Tên sản phẩm (*)": e.name,
    "Nhóm Hàng Con": e.subCategory,
    "Tinh sạch mặc định": e.tech,
    "Quy cách đóng gói": e.spec,
    "Đơn vị tính": e.unit,
    "Tình trạng": e.status,
    "Giá Bán Lẻ (VNĐ)": e.price,
    "Giá Dealer 1 (VNĐ)": e.priceDealer1,
    "Giá Dealer 2 (VNĐ)": e.priceDealer2,
    "Ghi chú (Ver 04_2026)": e.srcNote,
  }));

  const noticeRows = wb.Sheets["THÔNG BÁO THAY ĐỔI"]
    ? XLSX.utils.sheet_to_json(wb.Sheets["THÔNG BÁO THAY ĐỔI"], { header: 1, defval: "" })
    : [];

  const guideRows = [
    ["HƯỚNG DẪN NHẬP DANH MỤC SẢN PHẨM KINH DOANH ABT VER 04_2026", ""],
    ["Phạm vi tổng hợp", `${consolidatedRows.length} mã SKU duy nhất từ 6 tab (Thiết bị: ${countsBySheet["Thiết bị"]}, Kit test: ${countsBySheet["Kit test"]}, Hóa chất: ${countsBySheet["Hóa chất"]}, Vật tư: ${countsBySheet["Vật tư"]}, Oligo: ${countsBySheet["Oligo"]}, Giải pháp tự pha: ${countsBySheet["Giải pháp tự pha"]})`],
    ["Thay đổi mã Oligo", "Đã thay thế toàn bộ 6 mã Oligo chung tự tạo (OLIGO-PRIMER, OLIGO-PROBE, OLIGO-BASE, OLIGO-MOD, OLIGO-PUR, OLIGO-SVC) bằng 130 mã Oligo chi tiết từ Tab Oligo."],
    ["Xử lý trùng lặp", `Đã gộp DD-060 (trùng lặp giống hệt trong tab Hóa chất) và gộp mô tả kỹ thuật ADP-008 (3 dòng trong tab Vật tư) — tổng ${duplicateEvents.length} dòng trùng được gộp sạch.`],
    ["Chuẩn hóa dữ liệu", "Sửa tên AF568-Primer.50 từ '1 VIC phosphoramidite đầu 5'' thành '1 AF568 phosphoramidite đầu 5''. Giá 'Chưa có giá' và Giá Dealer 1/2 = 0 được giữ nguyên là 0 (không tự nhân tỷ lệ)."],
    ["Cách import vào ERP", "Vào Kinh doanh -> Danh mục Hàng hóa Thương mại (?tab=sales&sub=products) -> Nhập Excel -> chọn file này. Hệ thống sẽ nạp đủ 874 mã từ Sheet 1 'Danh_Muc_San_Pham_KD' và tự dọn các mã OLIGO-* cũ."],
  ];

  const outWb = XLSX.utils.book_new();
  const wsMain = XLSX.utils.json_to_sheet(consolidatedRows);
  wsMain["!cols"] = [
    { wch: 6 },  // STT
    { wch: 20 }, // Mã SKU
    { wch: 48 }, // Tên sản phẩm
    { wch: 22 }, // Phân Loại Chính
    { wch: 30 }, // Nhóm Hàng Con
    { wch: 10 }, // Hãng SX
    { wch: 26 }, // NCC
    { wch: 10 }, // ĐVT
    { wch: 18 }, // Quy cách
    { wch: 34 }, // Bảo quản
    { wch: 14 }, // Giá Vốn
    { wch: 20 }, // End-User
    { wch: 18 }, // D1
    { wch: 18 }, // D2
    { wch: 14 }, // Tồn tối thiểu
    { wch: 22 }, // Tình trạng
    { wch: 36 }, // Thông tin KT
    { wch: 12 }, // HSD
    { wch: 22 }, // ĐKLH
    { wch: 22 }, // CFS
    { wch: 45 }, // Ghi chú
  ];
  // Name Sheet 2 with "Huong_Dan" so even older multi-sheet heuristics never treat Sheet 2 as BOM.
  const wsGuide = XLSX.utils.aoa_to_sheet(guideRows);
  wsGuide["!cols"] = [{ wch: 28 }, { wch: 110 }];

  const wsOligo = XLSX.utils.json_to_sheet(oligoRefRows);
  wsOligo["!cols"] = [
    { wch: 6 },
    { wch: 20 },
    { wch: 36 },
    { wch: 34 },
    { wch: 24 },
    { wch: 14 },
    { wch: 10 },
    { wch: 14 },
    { wch: 16 },
    { wch: 16 },
    { wch: 16 },
    { wch: 40 },
  ];

  const wsNotice = XLSX.utils.aoa_to_sheet(noticeRows);

  XLSX.utils.book_append_sheet(outWb, wsMain, "Danh_Muc_San_Pham_KD");
  XLSX.utils.book_append_sheet(outWb, wsGuide, "Huong_Dan_Import");
  XLSX.utils.book_append_sheet(outWb, wsOligo, "Danh_Muc_Oligo_130");
  if (noticeRows.length > 0) {
    XLSX.utils.book_append_sheet(outWb, wsNotice, "Thong_Bao_Ver_04_2026");
  }

  for (const outFile of [DOWNLOADS_OUT, PUBLIC_OUT]) {
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    XLSX.writeFile(outWb, outFile);
  }

  if (process.argv.includes("--emit-oligo-ts")) {
    const oligoTsItems = oligoRowsForSheet.map((e) => {
      const c = e.code;
      let group = "PROBE";
      if (/^PRI-/i.test(c)) group = "BASE_PRIMER";
      else if (/^PUR-/i.test(c)) group = "PURIFICATION";
      else if (/^PRE-/i.test(c)) group = "SERVICE";
      else if (/^(LNA|Inosine)\./i.test(c)) group = "MOD_INTERNAL";
      else if (/^(BIOTIN|NH2)\./i.test(c)) group = "MOD_END";
      else if (/-Primer\./i.test(c)) group = "DYE_PRIMER";
      else if (/^(LinearDNA|CircleDNA)/i.test(c)) group = "GENE_SYNTHESIS";
      else if (/^Plasmid\./i.test(c)) group = "PLASMID_VECTOR";
      const sm = String(e.spec || "").match(/(\d+)/);
      const scale = /nmol/i.test(String(e.spec || "")) && sm ? `${sm[1]} nmol` : "";
      return {
        code: e.code,
        name: e.name,
        group,
        scale,
        unit: e.unit,
        spec: e.spec,
        purification: e.tech,
        status: e.status,
        price: e.price,
        priceDealer1: e.priceDealer1,
        priceDealer2: e.priceDealer2,
        notes: e.srcNote,
      };
    });
    const tsOut = path.resolve(process.cwd(), "src/shared/oligoCatalog.ts");
    const tsContent = [
      "/**",
      " * Official ABT Ver 04_2026 Oligo Catalog (130 detailed SKUs).",
      " * Auto-generated from Bang_Gia_ABT_...xlsx (Tab Oligo) via scripts/build-sales-catalog-import.mjs --emit-oligo-ts.",
      " */",
      "",
      "export type OligoCatalogGroup =",
      '  | "BASE_PRIMER"',
      '  | "DYE_PRIMER"',
      '  | "PROBE"',
      '  | "MOD_END"',
      '  | "MOD_INTERNAL"',
      '  | "PURIFICATION"',
      '  | "SERVICE"',
      '  | "GENE_SYNTHESIS"',
      '  | "PLASMID_VECTOR";',
      "",
      "export interface OligoCatalogEntry {",
      "  code: string;",
      "  name: string;",
      "  group: OligoCatalogGroup;",
      "  scale: string;",
      "  unit: string;",
      "  spec: string;",
      "  purification: string;",
      "  status: string;",
      "  price: number;",
      "  priceDealer1: number;",
      "  priceDealer2: number;",
      "  notes: string;",
      "}",
      "",
      `export const ABT_OLIGO_130_CATALOG: readonly OligoCatalogEntry[] = ${JSON.stringify(oligoTsItems, null, 2)};`,
      "",
      "export const ABT_OLIGO_BY_CODE = new Map<string, OligoCatalogEntry>(",
      "  ABT_OLIGO_130_CATALOG.map((item) => [item.code.toUpperCase(), item])",
      ");",
      "",
      "export const ABT_OLIGO_CODE_SET = new Set<string>(ABT_OLIGO_BY_CODE.keys());",
      "",
      "export function getOligoCatalogEntry(code?: string | null): OligoCatalogEntry | undefined {",
      "  if (!code) return undefined;",
      "  return ABT_OLIGO_BY_CODE.get(String(code).trim().toUpperCase());",
      "}",
      "",
      "export function isDetailedOligoSkuCode(code?: string | null): boolean {",
      "  if (!code) return false;",
      "  return ABT_OLIGO_CODE_SET.has(String(code).trim().toUpperCase());",
      "}",
      "",
      "export function isOligoPrimarySku(code?: string | null): boolean {",
      "  const entry = getOligoCatalogEntry(code);",
      "  if (entry) {",
      "    return (",
      '      entry.group === "BASE_PRIMER" ||',
      '      entry.group === "DYE_PRIMER" ||',
      '      entry.group === "PROBE" ||',
      '      entry.group === "GENE_SYNTHESIS"',
      "    );",
      "  }",
      '  const cUp = String(code || "").trim().toUpperCase();',
      "  return /^(OLIGO-(PRIMER|PROBE|BASE)|PRI-\\d|LINEARDNA|CIRCLEDNA)/i.test(cUp);",
      "}",
      "",
      "export function isOligoAddonSku(code?: string | null): boolean {",
      "  const entry = getOligoCatalogEntry(code);",
      "  if (entry) {",
      "    return (",
      '      entry.group === "PURIFICATION" ||',
      '      entry.group === "SERVICE" ||',
      '      entry.group === "MOD_INTERNAL" ||',
      '      entry.group === "MOD_END" ||',
      '      entry.group === "PLASMID_VECTOR"',
      "    );",
      "  }",
      '  const cUp = String(code || "").trim().toUpperCase();',
      "  return /^(OLIGO-(MOD|PUR|SVC)|PUR-|PRE-|LNA\\.|INOSINE\\.|BIOTIN\\.|NH2\\.|PLASMID\\.)/i.test(cUp);",
      "}",
      "",
    ].join("\n");
    fs.mkdirSync(path.dirname(tsOut), { recursive: true });
    fs.writeFileSync(tsOut, tsContent, "utf8");
  }

  console.log(
    JSON.stringify(
      {
        totalUniqueSkus: consolidatedRows.length,
        countsBySheet,
        oligoCount: oligoRowsForSheet.length,
        duplicatesMerged: duplicateEvents,
        outputs: [DOWNLOADS_OUT, PUBLIC_OUT],
      },
      null,
      2
    )
  );
}

main();
