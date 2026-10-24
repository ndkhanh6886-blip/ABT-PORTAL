import type { PoolClient } from "pg";
import { query } from "@/backend/db/db";
import type { StoragePatch } from "@/backend/services/storagePatch";

/**
 * Danh mục hàng thương mại (khóa `sales_commercial_products` cũ) lưu mỗi mặt hàng một dòng trong bảng
 * `catalog_items`, thay cho một khối JSON chứa cả danh mục. Sửa một giá chỉ ghi một dòng (trước đây ghi lại
 * cả khối ~1 MB cho 3.000 mã), không còn xung đột phiên bản giữa người dùng.
 *
 * Phía trình duyệt vẫn đọc / ghi qua /api/storage với khóa cũ; API chuyển sang bảng này.
 */
export const CATALOG_KEY = "sales_commercial_products";

type Queryable = Pick<PoolClient, "query">;
const COST_FIELDS = ["cost_price", "costPrice", "unit_cost", "unitCost", "purchase_price", "purchasePrice"];

const cleanCode = (v: any) => String(v ?? "").trim();

/** Chuẩn hóa chính tả tiếng Việt cho tên phân loại (đồng nhất oá/óa, uý/úy, Kít/Kit, NFC). */
export function normalizeVnCategoryText(raw?: string | null): string {
  if (!raw) return "";
  let s = String(raw).normalize("NFC").trim();
  const repls: Array<[string, string]> = [
    ["Hoá", "Hóa"], ["hoá", "hóa"], ["HOÁ", "HÓA"],
    ["oá", "óa"], ["oà", "òa"], ["oả", "ỏa"], ["oã", "õa"], ["oạ", "ọa"],
    ["OÁ", "ÓA"], ["OÀ", "ÒA"], ["OẢ", "ỎA"], ["OÃ", "ÕA"], ["OẠ", "ỌA"],
    ["uý", "úy"], ["uỳ", "ùy"], ["uỷ", "ủy"], ["uỹ", "ũy"], ["uỵ", "ụy"],
    ["UÝ", "ÚY"], ["UỲ", "ÙY"], ["UỶ", "ỦY"], ["UỸ", "ŨY"], ["UỴ", "ỤY"],
    ["Kít ", "Kit "], ["kít ", "kit "],
  ];
  for (const [a, b] of repls) {
    s = s.split(a).join(b);
  }
  return s.replace(/\s+/g, " ");
}

/**
 * Tự động suy luận phân loại thực tế khi mặt hàng đang mang phân loại mặc định chung chung
 * ("Hàng Thương Mại", "Vật tư y tế", "Sinh Phẩm & Nguyên Liệu"...) hoặc bị rơi vào mặc định "Thiết bị"
 * khi import file Excel không có cột phân loại ngành hàng.
 */
export function resolveActualProductCategory(item: { code?: string; name?: string; category?: string }): string {
  const cat = normalizeVnCategoryText(item?.category);
  const cUp = String(item?.code || "").trim().toUpperCase();
  const nLow = normalizeVnCategoryText(item?.name || "").toLowerCase();
  const catLow = cat.toLowerCase();

  const isGeneric =
    !catLow ||
    catLow === "hàng thương mại" ||
    catLow === "hàng thương mại mua ngoài" ||
    catLow === "vật tư y tế" ||
    catLow === "sinh phẩm & nguyên liệu" ||
    catLow === "vật tư & sinh phẩm" ||
    catLow === "hàng hóa";
  const isSuspectEquipmentFallback = catLow === "thiết bị";

  if (isGeneric || isSuspectEquipmentFallback) {
    // 1. Kit Tách chiết
    if (
      cUp.startsWith("EXS-") || cUp.startsWith("EXM-") || cUp.startsWith("HE-") || cUp.startsWith("HI-") || cUp.startsWith("HM-") ||
      ["toppure", "extraction", "tách chiết", "tach chiet", "purification kit", "co-extraction", "thu nhận dna", "thu nhận rna", "hạt từ tách chiết", "isolate ii"].some(k => nLow.includes(k))
    ) {
      return "Kit Tách chiết";
    }
    // 2. Kit PCR / qPCR
    if (
      cUp.startsWith("SQH-") || cUp.startsWith("SDS-") || cUp.startsWith("SDB-") || cUp.startsWith("SDV-") ||
      cUp.startsWith("SDP-") || cUp.startsWith("SDA-") || cUp.startsWith("SDC-") || cUp.startsWith("SDG-") ||
      cUp.startsWith("SDT-") || cUp.startsWith("TOPK") || cUp.startsWith("KIT-") ||
      ["topsensi", "qpcr", "real-time pcr", "realtime pcr", "pcr kit", "pcr-rdb", "genotype kit", "rt-pcr", "one-step", "master mix", "mastermix", "khuếch đại", "nucleic acid detection kit", "quantitative fluorescence diagnostic kit", "quantitative test kit", "pcr hbv", "pcr hcv", "pcr hiv"].some(k => nLow.includes(k))
    ) {
      return "PCR Kit";
    }
    // 3. Hóa chất & Sinh phẩm
    if (
      cUp.startsWith("LBC-") || cUp.startsWith("DD-") || cUp.startsWith("CH-") || cUp.startsWith("OLG-") || cUp.startsWith("PRI-") || cUp.startsWith("PRB-") || cUp.startsWith("MT-") ||
      ["oligo", "primer", "probe", "gram staining", "staining kit", "stain solution", "thuốc nhuộm", "nhuộm", "cytology", "preservation solution", "collection medium", "hóa chất", "môi trường", "agar", "broth", "buffer", "dung dịch", "chất thử", "nước cất", "nuclease-free", "nước không nuclease", "pbs", "ethanol", "methanol", "isopropanol", "chloroform", "formalin", "xylene", "cồn ", "axit ", "acid ", "taq ", "rtaq", "dntp", "enzyme", "proteinase", "rnase", "dnase", "ladder", "marker", "loading dye", "ethidium", "sybr", "chứng dương", "chứng âm", "positive control", "negative control", "thuốc thử", "kháng huyết thanh", "kháng thể", "huyết thanh", "sinh phẩm", "kit thử", "test nhanh", "assay kit", "jetseq"].some(k => nLow.includes(k))
    ) {
      return "Hóa chất & Sinh phẩm";
    }
    // 4. Vật tư tiêu hao
    if (
      cUp.startsWith("TCF") || cUp.startsWith("TCP") || cUp.startsWith("TCD") || cUp.startsWith("CS-") || cUp.startsWith("BSH") || cUp.startsWith("CAD") || cUp.startsWith("CSS") || cUp.startsWith("DIL") || cUp.startsWith("CA0") ||
      ["bình đựng mẫu", "đĩa đựng mẫu", "dĩa đựng mẫu", "ống nghiệm", "ồng nghiệm", "ống ly tâm", "ống pcr", "ống hút", "đầu côn", "đầu cone", "đầu tip", "đầu típ", "đầu tuýp", "filter tip", "pipette tip", "tuýp pcr", "tube", "plate", "strip 8", "lamel", "lammel", "phiến kính", "lam kính", "cuvette", "găng tay", "túi chứa", "que lấy mẫu", "que cấy", "tăm bông", "màng dán", "màng lọc", "đầu lọc", "phễu lọc", "cột lọc", "optical film", "sealing film", "microtube", "cryovial", "eppendorf", "falcon", "đĩa petri", "dĩa petri", "đĩa nuôi cấy", "petri", "nhựa tiêu hao", "plasticware", "bơm tiêm", "kim tiêm", "chai nhựa", "chai thủy tinh", "chai cấy mô", "lọ đựng", "hộp đựng", "hộp đầu", "hộp chứa tuýp", "hộp trữ lạnh", "khay đựng mẫu", "reagent reservoir", "lược mẫu", "vòng nhúng mô", "tấm xốp", "screw cap", "nắp vặn", "bao hấp", "bông gòn", "bông thấm", "bông không thấm", "bình tia", "can nhựa", "giấy lọc", "giấy lau", "khẩu trang", "áo choàng"].some(k => nLow.includes(k))
    ) {
      return "Vật tư tiêu hao";
    }
    // 5. Dụng cụ
    if (
      ["pipet", "pipette", "micropipette", "dụng cụ lấy mẫu", "giá đỡ", "giá để", "khay đỡ", "magnetic rack", "nhiệt kế", "ẩm kế", "đèn cồn", "cốc thấp thành", "cốc đốt", "bình tam giác", "bình định mức", "ống đong", "que trang", "kẹp ", "kéo ", "nhíp ", "timer"].some(k => nLow.includes(k))
    ) {
      return "Dụng cụ";
    }
    // 6. Chuyển đổi số
    if (["phần mềm", "lims", "bản quyền", "license", "chuyển đổi số"].some(k => nLow.includes(k))) {
      return "Chuyển đổi số";
    }
    // 7. Thiết bị
    if (
      ["máy ", "tủ ", "hệ thống ", "khúc xạ kế", "quang phổ", "ly tâm", "vortex", "nồi hấp", "bể điều nhiệt", "kính hiển vi", "cân ", "đầu đọc", "reader", "tester", "penetrometer", "thiết bị", "phụ kiện của máy", "rotor", "bộ lưu điện", "ups "].some(k => nLow.includes(k))
    ) {
      return isSuspectEquipmentFallback ? "Thiết bị" : "Thiết bị cơ bản";
    }
  }

  return cat || "Vật tư tiêu hao";
}

/** Toàn bộ danh mục theo thứ tự hiển thị (mới thêm ở trên). */
export async function readCatalog(c?: Queryable): Promise<any[]> {
  const q = c ? c.query.bind(c) : query;
  const res = await q("SELECT data FROM catalog_items ORDER BY sort_order ASC, code ASC");
  return res.rows.map((r: any) => {
    const d = r.data || {};
    return {
      ...d,
      category: resolveActualProductCategory(d),
    };
  });
}

/** Số phiên bản để trình duyệt nhận biết thay đổi (đổi mỗi khi có dòng được ghi). */
export async function catalogVersion(c?: Queryable): Promise<number> {
  const q = c ? c.query.bind(c) : query;
  const r = await q("SELECT COALESCE(EXTRACT(EPOCH FROM MAX(updated_at))::bigint, 0) AS v, COUNT(*)::int AS n FROM catalog_items");
  return Number(r.rows[0]?.v || 0) + Number(r.rows[0]?.n || 0);
}

/** Mã của mục theo định danh của bản vá ("code:X" hoặc "id:Y"). */
async function codesForIdentity(c: Queryable, ident: string): Promise<string[]> {
  const i = ident.indexOf(":");
  const field = ident.slice(0, i);
  const value = ident.slice(i + 1);
  if (field === "code") return [value];
  const r = await c.query("SELECT code FROM catalog_items WHERE data->>$1 = $2", [field, value]);
  return r.rows.map((x: any) => x.code);
}

/**
 * Ghi một bản vá danh mục: thêm / sửa từng mặt hàng, xóa các mặt hàng bị bỏ.
 * `keepCosts`: người không được xem giá vốn gửi lên mặt hàng không có giá vốn -> giữ giá vốn đang lưu.
 */
export async function applyCatalogPatch(c: Queryable, patch: StoragePatch, keepCosts: boolean): Promise<string[]> {
  if (patch.kind !== "array") throw new Error("Danh mục sản phẩm phải là danh sách");
  const byCode = new Map<string, any>();
  for (const item of patch.upserts || []) {
    const code = cleanCode(item?.code);
    if (code) {
      byCode.set(code, {
        ...item,
        code,
        category: resolveActualProductCategory({ ...item, code }),
      });
    }
  }
  const upserts = Array.from(byCode.values());
  if (upserts.length > 0) {
    // một câu lệnh cho cả lô; mục mới lên đầu danh sách (như trên trình duyệt), mục đã có giữ vị trí
    await c.query(
      `INSERT INTO catalog_items (code, data, sort_order, updated_at)
       SELECT e->>'code', e, $2::bigint + t.ord, now() FROM jsonb_array_elements($1::jsonb) WITH ORDINALITY AS t(e, ord)
       ON CONFLICT (code) DO UPDATE SET
         data = CASE WHEN $3::boolean
                     THEN (SELECT COALESCE(jsonb_object_agg(je.k, je.v), '{}'::jsonb) FROM jsonb_each(catalog_items.data) AS je(k, v) WHERE je.k = ANY($4::text[])) || EXCLUDED.data
                     ELSE EXCLUDED.data END,
         updated_at = now()`,
      [JSON.stringify(upserts), -Date.now(), keepCosts, COST_FIELDS]
    );
  }
  const delCodes: string[] = [];
  for (const ident of patch.deletes || []) delCodes.push(...(await codesForIdentity(c, ident)));
  if (delCodes.length > 0) await c.query("DELETE FROM catalog_items WHERE code = ANY($1::text[])", [delCodes]);
  return [...byCode.keys(), ...delCodes];
}

/**
 * Ghi đè cả danh sách (trình duyệt cũ / trường hợp không lập được bản vá). Không bao giờ xóa hàng loạt khi
 * người gửi không được xem giá vốn: chỉ thêm / sửa. Người được xem giá vốn: xóa các mã không còn trong danh sách.
 */
export async function replaceCatalog(c: Queryable, items: any[], canDelete: boolean, keepCosts: boolean): Promise<void> {
  const byCode = new Map<string, any>();
  for (const it of items) { const code = cleanCode(it?.code); if (code) byCode.set(code, { ...it, code }); }
  const upserts = Array.from(byCode.values());
  let deletes: string[] = [];
  if (canDelete) {
    const existing = (await c.query("SELECT code FROM catalog_items")).rows.map((r: any) => r.code);
    deletes = existing.filter((code: string) => !byCode.has(code)).map((code: string) => `code:${code}`);
  }
  await applyCatalogPatch(c, { kind: "array", upserts, deletes, order: [] } as any, keepCosts);
}

/**
 * Thêm mặt hàng mới về từ kho / PO; nếu mặt hàng đã tồn tại trong danh mục mà phiếu nhập kho / lô mới
 * có Đơn giá nhập (costPrice > 0) hoặc Giá bán mới (price > 0) thì tự động cập nhật Giá vốn hiện hành
 * (kèm lưu previousCostPrice nếu giá nhập thay đổi) và Giá bán (nếu có điền).
 */
export async function appendCatalogEntry(c: Queryable, entry: Record<string, any>): Promise<void> {
  const code = cleanCode(entry?.code);
  if (!code) return;
  const resolvedCategory = resolveActualProductCategory({ ...entry, code });
  const ins = await c.query(
    `INSERT INTO catalog_items (code, data, sort_order, updated_at) VALUES ($1, $2::jsonb, $3, now())
     ON CONFLICT (code) DO NOTHING
     RETURNING code`,
    [code, JSON.stringify({ ...entry, code, category: resolvedCategory }), -Date.now()]
  );
  if ((ins.rowCount || 0) > 0) return;

  const newCost = Number(entry?.costPrice ?? entry?.cost_price) || 0;
  const newPrice = Number(entry?.price ?? entry?.standard_price) || 0;
  const newStorage = String(entry?.storageCondition ?? entry?.storage_condition ?? "").trim();

  const existingRes = await c.query("SELECT data FROM catalog_items WHERE code = $1", [code]);
  if (existingRes.rows.length === 0) return;
  const curData = existingRes.rows[0]?.data || {};
  const patch: Record<string, any> = {};

  const curCatResolved = resolveActualProductCategory({ ...curData, code });
  if (resolvedCategory && resolvedCategory !== "Hàng Thương Mại" && (!curData.category || curData.category !== curCatResolved)) {
    patch.category = resolvedCategory;
  } else if (curData.category && curData.category !== curCatResolved) {
    patch.category = curCatResolved;
  }

  if (newCost > 0) {
    const oldCost = Number(curData.costPrice ?? curData.cost_price) || 0;
    if (oldCost > 0 && oldCost !== newCost) {
      patch.previousCostPrice = oldCost;
      patch.costChangedAt = new Date().toISOString();
    }
    patch.costPrice = newCost;
  }
  if (newPrice > 0) {
    const oldPrice = Number(curData.price) || 0;
    if (oldPrice > 0 && oldPrice !== newPrice) {
      patch.previousPrice = oldPrice;
    }
    patch.price = newPrice;
    patch.priceDealer1 = Number(entry?.priceDealer1) || Math.round(newPrice * 0.85);
    patch.priceDealer2 = Number(entry?.priceDealer2) || Math.round(newPrice * 0.8);
  }
  if (newStorage && !curData.storageCondition) {
    patch.storageCondition = newStorage;
  }

  if (Object.keys(patch).length > 0) {
    await c.query(
      "UPDATE catalog_items SET data = data || $2::jsonb, updated_at = now() WHERE code = $1",
      [code, JSON.stringify(patch)]
    );
  }
}

/** Cập nhật vài trường của một mặt hàng (vd. giá sửa từ trang Kho / Kinh doanh). */
export async function mergeCatalogFields(c: Queryable | null, code: string, fields: Record<string, any>): Promise<boolean> {
  const clean: Record<string, any> = {};
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) clean[k] = v;
  const q = c ? c.query.bind(c) : query;
  const r = await q("UPDATE catalog_items SET data = data || $2::jsonb, updated_at = now() WHERE code = $1", [cleanCode(code), JSON.stringify(clean)]);
  return (r.rowCount || 0) > 0;
}
