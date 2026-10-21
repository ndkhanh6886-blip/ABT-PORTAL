import { query } from "@/backend/db/db";
import { todayVN } from "@/backend/services/dates";

/**
 * Utility to strip Vietnamese accents and special characters
 */
export function removeVietnameseTones(str: string): string {
  if (!str) return "";
  let clean = str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  clean = clean.replace(/đ/g, "d").replace(/Đ/g, "D");
  clean = clean.replace(/[^a-zA-Z0-9\s-_]/g, "");
  return clean.trim();
}

/**
 * Extracts EXACTLY 2 concise capital letters from a Customer's Name or Code.
 * E.g.: "Bệnh viện Chợ Rẫy"                -> "CR"
 *       "Viện Pasteur TP.HCM"              -> "PA"
 *       "Bệnh viện Đại học Y Dược TP.HCM" -> "YD"
 *       "Bệnh viện Thống Nhất"             -> "TN"
 *       "Bệnh viện Từ Dũ"                  -> "TD"
 *       "Bệnh viện Hùng Vương"             -> "HV"
 *       "Bệnh viện Bạch Mai"               -> "BM"
 *       "Bệnh viện Nhi Đồng 1"             -> "N1"
 *       "Bệnh viện Nhi Đồng 2"             -> "N2"
 *       "Bệnh viện Bình Dân"               -> "BD"
 *       "Bệnh viện Ung Bướu"               -> "UB"
 *       "Phòng khám Đa khoa Hoàn Mỹ"       -> "HM"
 *       "Công ty CP Y tế Medilab"          -> "ML"
 *       "Công ty Dược phẩm Vimedimex"      -> "VM"
 *       "Trung tâm Y tế Quận 1"            -> "Q1"
 */
export function getShortCustCode(name?: string, code?: string, fallback = "KH"): string {
  // If explicit 2-letter uppercase alphabetic code provided (e.g. CR, YD, PA, TH, TS)
  if (code && !code.includes("LOCAL")) {
    const c = removeVietnameseTones(code).replace(/[^A-Z]/gi, "").toUpperCase();
    // Only use if it is a pure 2-letter alphabetic acronym and NOT a generic KH prefix
    if (c.length === 2 && c !== "KH") return c;
  }

  if (!name || !name.trim()) return fallback.slice(0, 2).toUpperCase();

  const upper = name.toUpperCase().trim();
  const knownEntities: Record<string, string> = {
    // Specific business brands & institutes
    "THỰC PHẨM SỮA TH": "TH", "SỮA TH": "TH", "TH TRUE MILK": "TH", "TH MILK": "TH",
    "AQUAMEKONG": "AM", "MINH PHÚ": "MP", "MINH PHU": "MP",
    "THỦY SẢN NAM BỘ": "NB", "THUỶ SẢN NAM BỘ": "NB",
    "NUÔI TRỒNG THỦY SẢN": "TS", "NUOI TRONG THUY SAN": "TS", "THỦY SẢN": "TS", "THUỶ SẢN": "TS",
    "THĂNG LONG": "TL", "THANG LONG": "TL",
    "KIM NGƯU": "KN", "KIM NGUU": "KN",
    "CEMACO": "CM",
    "BẠC LIÊU": "BL", "BAC LIEU": "BL",
    "CTMED": "CT",
    "DNA TESTINGS": "DN",
    "MIỀN ĐÔNG LAB": "MD", "MIEN DONG": "MD",
    "THUỶ NHI": "TN", "THUY NHI": "TN",
    "V FAMI": "VF",
    "BAF": "BF",

    // Hospitals & Health Organizations
    "JICA": "JC", "CDC": "CD", "WHO": "WH", "VINMEC": "VM",
    "TÂM ANH": "TA", "TAM ANH": "TA", "MEDLATEC": "MT",
    "CHỢ RẪY": "CR", "CHO RAY": "CR", "PASTEUR": "PA",
    "ĐẠI HỌC Y DƯỢC": "YD", "Y DƯỢC": "YD", "Y DUOC": "YD",
    "NHÂN DÂN 115": "15", "115": "15",
    "THỦ ĐỨC": "TĐ", "THU DUC": "TĐ",
    "THỐNG NHẤT": "TN", "THONG NHAT": "TN",
    "TỪ DŨ": "TD", "TU DU": "TD",
    "HÙNG VƯƠNG": "HV", "HUNG VUONG": "HV",
    "BẠCH MAI": "BM", "BACH MAI": "BM",
    "NHI ĐỒNG 1": "N1", "NHI DONG 1": "N1",
    "NHI ĐỒNG 2": "N2", "NHI DONG 2": "N2",
    "BÌNH DÂN": "BD", "BINH DAN": "BD",
    "UNG BƯỚU": "UB", "UNG BUOU": "UB",
    "HOÀN MỸ": "HM", "HOAN MY": "HM",
    "VIỆT ĐỨC": "VD", "VIET DUC": "VD",
    "VIỆN TIM": "VT", "VIEN TIM": "VT",
    "TRƯNG VƯƠNG": "TV", "TRUNG VUONG": "TV",
    "DA LIỄU": "DL", "DA LIEU": "DL",
    "TAI MŨI HỌNG": "TM", "TAI MUI HONG": "TM",
    "HUYẾT HỌC": "HH", "HUYET HOC": "HH",
    "MEDILAB": "ML",
    "VIMEDIMEX": "VX",
    "BIOLAB": "BL"
  };

  for (const [k, v] of Object.entries(knownEntities)) {
    if (upper.includes(k)) return v;
  }

  // Check if name has an explicit acronym in parentheses, e.g. "(JICA)", "(CDC)", "(WHO)", "(ABT)", "(BAF)"
  const parenMatch = upper.match(/\(([A-Z0-9]{2,})\)/);
  if (parenMatch && parenMatch[1]) {
    const acr = parenMatch[1];
    if (acr.length === 2) return acr;
    if (acr.length >= 3) {
      if (acr === "JICA") return "JC";
      if (acr === "BAF") return "BF";
      return (acr[0] + acr[acr.length - 1]).toUpperCase();
    }
  }

  // Check if string ends with a standalone 2-letter uppercase word (e.g. "... SỮA TH")
  const endsWithTwoLetterWord = upper.match(/\b([A-Z]{2})\s*$/);
  if (endsWithTwoLetterWord && endsWithTwoLetterWord[1] && !["CP", "TP", "BV", "TT", "PK"].includes(endsWithTwoLetterWord[1])) {
    return endsWithTwoLetterWord[1];
  }

  const clean = removeVietnameseTones(name).trim();
  const noise = [
    "CONG", "TY", "TNHH", "CP", "BENH", "VIEN", "BV", "TRUNG", "TAM", 
    "TT", "PHONG", "KHAM", "PK", "DA", "KHOA", "TPHCM", "TP", "HCM", "Y", "TE", 
    "DUOC", "TINH", "THANH", "PHO", "CHI", "CUC", "NGHIEN", "CUU", "DICH", "VU", "KY", "THUAT",
    "QUAN", "TRAC", "MOI", "TRUONG"
  ];
  const words = clean.split(/\s+/).filter(w => !noise.includes(w.toUpperCase()));

  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  if (words.length === 1) {
    const w = words[0].toUpperCase();
    return w.length >= 2 ? w.slice(0, 2) : (w + "X");
  }

  const alpha = clean.replace(/[^A-Z0-9]/gi, "").toUpperCase();
  return alpha.length >= 2 ? alpha.slice(0, 2) : (alpha.length === 1 ? `${alpha}X` : "KH");
}

/**
 * Extracts EXACTLY 2 concise capital letters from a Sales Rep's full name.
 * Takes initials of the middle name and given name (e.g. Diễm Trúc -> DT, Văn Hưng -> VH)
 * E.g.: "Đỗ Ngọc Diễm Trúc"   -> "DT"
 *       "Nguyễn Văn Hưng"     -> "VH"
 *       "Trần Thanh Long"     -> "TL"
 *       "Dương Phương Bảo Khoa" -> "BK"
 */
export function getShortRepCode(name?: string, fallback = "NV"): string {
  if (!name || !name.trim()) return fallback.slice(0, 2).toUpperCase();
  const clean = removeVietnameseTones(name).trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return fallback.slice(0, 2).toUpperCase();

  if (parts.length >= 2) {
    const penultimate = parts[parts.length - 2][0];
    const last = parts[parts.length - 1][0];
    return (penultimate + last).toUpperCase();
  }

  const single = parts[0].toUpperCase();
  return single.length >= 2 ? single.slice(0, 2) : (single + "X");
}

export interface GenerateCodeOptions {
  docType: "SO" | "BG" | "HD" | "PO" | "PR" | "PX" | "WF" | "TSK" | "FOR" | "RMA" | "PNK" | "PXK" | "RES" | "TRK" | "REC" | "SKU" | "NCC";
  customerName?: string;
  customerCode?: string;
  salesRepName?: string;
  customPrefix?: string;
  tagMode?: "CUSTOMER" | "SALE" | "GENERAL" | "STOCK";
}

/**
 * Enterprise Atomic Ticket Code Generator
 * Ưu tiên gắn liền 2 ký tự đại diện cho Khách hàng (hoặc Sale khi cần), độ dài chuẩn 12 ký tự:
 * 
 * Cấu trúc: [LOẠI PHIẾU 2 KÝ TỰ][NĂM 2 SỐ]-[MÃ KHÁCH 2 KÝ TỰ]-[SỐ TUẦN TỰ 4 SỐ]
 * 
 * Ví dụ thực tế:
 *   - SO26-CR-0001 (Đơn bán hàng năm 2026 cho BV Chợ Rẫy, đơn số 1)
 *   - BG26-PA-0005 (Báo giá năm 2026 cho Viện Pasteur, báo giá số 5)
 *   - HD26-YD-0002 (Hợp đồng năm 2026 với ĐH Y Dược, hợp đồng số 2)
 *   - PX26-CR-0001 (Phiếu xuất kho cho BV Chợ Rẫy)
 *   - PO26-TB-0012 (Đơn mua hàng PO của TBRs)
 *   - WF26-AP-0008 (Quy trình liên phòng ban Application)
 * 
 * Đảm bảo 100% không bao giờ trùng khi nhiều nhân viên làm song song nhờ Row-Level Lock Database.
 */
let isSequenceSchemaMigrated = false;
async function ensureSequenceTableSchema() {
  if (isSequenceSchemaMigrated) return;
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS document_sequences (
        doc_type VARCHAR(30) NOT NULL,
        prefix VARCHAR(50) NOT NULL,
        current_seq INTEGER DEFAULT 0 NOT NULL,
        updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (doc_type, prefix)
      );
    `);
    await query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint c
          JOIN pg_class t ON c.conrelid = t.oid
          WHERE t.relname = 'document_sequences' AND c.contype = 'p'
          AND pg_get_constraintdef(c.oid) LIKE '%prefix%'
        ) THEN
          ALTER TABLE document_sequences DROP CONSTRAINT IF EXISTS document_sequences_pkey;
          ALTER TABLE document_sequences ADD PRIMARY KEY (doc_type, prefix);
        END IF;
      END $$;
    `);
    await query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_document_sequences_composite ON document_sequences (doc_type, prefix);`);
    isSequenceSchemaMigrated = true;
  } catch (e: any) {
    try {
      await query(`ALTER TABLE document_sequences DROP CONSTRAINT IF EXISTS document_sequences_pkey;`);
      await query(`ALTER TABLE document_sequences ADD PRIMARY KEY (doc_type, prefix);`);
      await query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_document_sequences_composite ON document_sequences (doc_type, prefix);`);
      isSequenceSchemaMigrated = true;
    } catch (e2) {}
  }
}

export async function generateDocumentCode(opts: GenerateCodeOptions): Promise<string> {
  // Năm / tháng theo giờ Việt Nam (máy chủ chạy UTC: 0h–7h sáng ngày 1 từng bị tính vào tháng trước)
  const vn = todayVN(); // "2026-10-16"
  const year2 = vn.slice(2, 4); // "26"
  const month2 = vn.slice(5, 7); // "10"
  const docType = opts.docType.toUpperCase();

  // Phiếu xuất / giao hàng: một dãy số chung cho cả công ty theo tháng -> PX2610-0001, PX2610-0002...
  // Không trùng nhờ bộ đếm nguyên tử trong CSDL (2 người bấm cùng lúc nhận 2 số khác nhau), không phụ thuộc mã khách.
  if (docType === "PX") {
    await ensureSequenceTableSchema();
    const res = await query(
      `INSERT INTO document_sequences (doc_type, prefix, current_seq)
       VALUES ($1, $2, 1)
       ON CONFLICT (doc_type, prefix)
       DO UPDATE SET current_seq = document_sequences.current_seq + 1, updated_at = CURRENT_TIMESTAMP
       RETURNING current_seq`,
      ["PX", `PX${year2}${month2}`]
    );
    return `PX${year2}${month2}-${String(res.rows[0].current_seq).padStart(4, "0")}`;
  }

  // Ưu tiên cao nhất là Khách hàng (đúng 2 ký tự đại diện), hoặc STOCK nếu là đơn lưu kho
  let tag2 = "KH";

  if (opts.tagMode === "STOCK" || opts.customPrefix === "STOCK") {
    tag2 = "STOCK";
  } else if (opts.tagMode === "SALE" && opts.salesRepName) {
    tag2 = getShortRepCode(opts.salesRepName, "NV");
  } else if (opts.customerName || opts.customerCode) {
    tag2 = getShortCustCode(opts.customerName, opts.customerCode, "KH");
  } else if (opts.salesRepName) {
    tag2 = getShortRepCode(opts.salesRepName, "NV");
  } else if (opts.customPrefix) {
    const cp = removeVietnameseTones(opts.customPrefix).replace(/[^A-Z0-9]/gi, "").toUpperCase();
    tag2 = cp.length >= 2 ? cp.slice(0, 2) : (cp + "X");
  } else {
    tag2 = docType === "PO" || docType === "PR" ? "TB" : (docType === "WF" ? "AP" : "KH");
  }

  // Đảm bảo tag viết hoa; giữ nguyên STOCK nếu là đơn stock, ngược lại 2 ký tự
  if (tag2 !== "STOCK") {
    tag2 = tag2.slice(0, 2).toUpperCase();
  }

  // Key tracking atomic sequence theo từng khách hàng trong từng tháng
  const seqKey = `${docType}${year2}${month2}-${tag2}`;
  const prefix = `${docType}${year2}-${tag2}`;

  try {
    await ensureSequenceTableSchema();
    // Atomic Upsert with row-level lock ensuring sequential allocation
    const res = await query(
      `INSERT INTO document_sequences (doc_type, prefix, current_seq)
       VALUES ($1, $2, 1)
       ON CONFLICT (doc_type, prefix)
       DO UPDATE SET current_seq = document_sequences.current_seq + 1, updated_at = CURRENT_TIMESTAMP
       RETURNING current_seq`,
      [docType, seqKey]
    );

    const seq = res.rows[0].current_seq;
    // Cụm 4 số cuối: 2 chữ số tháng trong năm (MM) + 2 chữ số thứ tự tăng dần (01..99)
    // Ví dụ: Tháng 10, đơn 1 -> "1001"
    const formattedSeq = `${month2}${String(seq).padStart(2, "0")}`;
    return `${prefix}-${formattedSeq}`;
  } catch (err: any) {
    // Không tự bịa số ngẫu nhiên (dễ trùng mã): báo lỗi để người dùng thử lại
    console.error("[CODE_GENERATOR] Atomic sequence generation failed:", { docType, seqKey, err: err?.message || err });
    throw new Error("Không cấp được mã chứng từ (lỗi bộ đếm). Vui lòng thử lại.");
  }
}
