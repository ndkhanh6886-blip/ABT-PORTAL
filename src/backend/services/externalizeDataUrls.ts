import fs from "fs";
import path from "path";
import crypto from "crypto";

/**
 * Tệp nhúng dạng base64 (ảnh biên bản giao hàng, hóa đơn, ảnh sản phẩm) trong dữ liệu dùng chung được tách ra thành
 * tệp trong thư mục uploads, dữ liệu chỉ giữ đường dẫn /api/upload. Trước đây mỗi ảnh vài trăm KB nằm ngay trong danh
 * sách đơn hàng: danh sách phình hàng MB, mọi trình duyệt phải tải về và localStorage đầy.
 * Cùng một nội dung luôn ra cùng một tên tệp (theo mã băm), nên tách lại nhiều lần không sinh tệp trùng.
 */
export const EMBEDDED_FILE_KEYS = new Set([
  "sales_factory_orders",
  "sales_delivery_slips",
  "sales_quotations",
  "legal_contracts",
  "legal_licenses",
  "legal_documents",
  "legal_tenders",
]);

const UPLOAD_DIR = path.join(process.cwd(), "uploads");
const MIN_EMBED_LENGTH = 2048;
const DATA_URL_RE = /^data:([a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+)?((?:;[^;,]*)*);base64,/;

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/bmp": ".bmp",
  "image/heic": ".heic",
  "image/heif": ".heif",
  "image/svg+xml": ".svg",
  "image/tiff": ".tiff",
  "application/pdf": ".pdf",
  "application/xml": ".xml",
  "text/xml": ".xml",
};

function safeDisplayName(name: unknown, fallback: string): string {
  const s = String(name || "").trim();
  return s && !s.startsWith("data:") ? s.slice(0, 200) : fallback;
}

function externalizeOne(dataUrl: string, displayName: unknown): string | null {
  const m = DATA_URL_RE.exec(dataUrl);
  if (!m) return null;
  const mime = String(m[1] || "").toLowerCase();
  const buf = Buffer.from(dataUrl.slice(m[0].length), "base64");
  if (buf.length === 0) return null;
  const ext = EXT_BY_MIME[mime] || path.extname(String(displayName || "")).toLowerCase() || ".bin";
  const fileName = `emb-${crypto.createHash("sha256").update(buf).digest("hex").slice(0, 32)}${ext}`;
  const filePath = path.join(UPLOAD_DIR, fileName);
  if (!fs.existsSync(filePath)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    fs.writeFileSync(filePath, buf);
  }
  return `/api/upload?file=${encodeURIComponent(fileName)}&name=${encodeURIComponent(safeDisplayName(displayName, fileName))}`;
}

/** Trả về bản sao đã thay mọi chuỗi data:...;base64 lớn bằng đường dẫn tệp, cùng số tệp đã tách. */
export function externalizeDataUrls<T>(value: T): { value: T; count: number } {
  let count = 0;
  const walk = (v: any, parentName?: unknown): any => {
    if (typeof v === "string") {
      if (v.length >= MIN_EMBED_LENGTH && v.startsWith("data:")) {
        const url = externalizeOne(v, parentName);
        if (url) { count++; return url; }
      }
      return v;
    }
    if (Array.isArray(v)) {
      let changed = false;
      const out = v.map((x) => { const y = walk(x); if (y !== x) changed = true; return y; });
      return changed ? out : v;
    }
    if (v && typeof v === "object") {
      const name = v.name ?? v.fileName ?? v.label;
      let out: any = null;
      for (const k of Object.keys(v)) {
        const y = walk(v[k], name);
        if (y !== v[k]) { if (!out) out = { ...v }; out[k] = y; }
      }
      return out || v;
    }
    return v;
  };
  const next = walk(value);
  return { value: next, count };
}
