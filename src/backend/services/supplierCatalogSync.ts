import { query } from "@/backend/db/db";
import { todayVN } from "@/backend/services/dates";

const PLACEHOLDER_SUPPLIERS = new Set([
  "",
  "-",
  "—",
  "--",
  "---",
  "n/a",
  "na",
  "null",
  "undefined",
  "none",
  "khác",
  "chưa rõ",
  "chưa cập nhật",
  "thương mại",
  "hàng thương mại",
  "vật tư y tế",
  "sinh phẩm & nguyên liệu",
  "hóa chất & sinh phẩm",
  "nhà cung cấp",
  "nhà cung cấp mới",
  "nhà cung cấp / hãng",
  "nhà cung cấp quốc tế",
  "hãng sản xuất",
  "hãng sản xuất / ncc phân phối",
  "chính hãng",
  "nhập khẩu",
  "nhập khẩu / chính hãng",
  "chính hãng / tiêu chuẩn iso",
  "tbr phân phối",
  "via phân phối",
  "tbr",
  "via",
  "tbr tech",
  "via tech",
  "nội bộ",
]);

export function isPlaceholderSupplierName(raw?: string | null): boolean {
  if (!raw) return true;
  const clean = String(raw).trim().replace(/\s+/g, " ");
  if (clean.length < 2) return true;
  return PLACEHOLDER_SUPPLIERS.has(clean.toLowerCase());
}

/** Rút gọn tiền tố pháp nhân Công ty và hậu tố Chi nhánh để so khớp tên cốt lõi */
export function stripCompanyLegalAffixes(name?: string | null): string {
  const full = String(name || "").trim();
  if (!full) return "";
  const stripped = full
    .replace(/\s*-\s*chi nhánh.*$/i, "")
    .replace(
      /^(công ty|cty)\s+(tnhh|cổ phần|cp)?\s*(một thành viên|mtv|hai thành viên trở lên)?\s*/i,
      ""
    )
    .trim();
  return stripped || full;
}

export interface CanonicalSupplierInfo {
  canonicalKey: string;
  shortName: string;
  defaultFullName: string;
  defaultProductLines?: string;
  preferredCode?: string;
}

export function resolveCanonicalSupplier(raw?: string | null): CanonicalSupplierInfo | null {
  if (isPlaceholderSupplierName(raw)) return null;
  const clean = String(raw).trim().replace(/\s+/g, " ");
  const upper = clean.toUpperCase();

  if (
    upper.includes("ABT") ||
    upper.includes("LONG HẬU") ||
    upper.includes("LONG HAU") ||
    upper.includes("Y SINH ABT") ||
    upper.includes("TOPPURE") ||
    upper.includes("TOPSPEC")
  ) {
    return {
      canonicalKey: "ABT",
      shortName: "ABT",
      // tên mẫu cũ "Thiết Bị & Hóa Chất ABT" (form nhập kho điền sẵn) không phải tên thật của ABT
      defaultFullName:
        (upper.startsWith("CÔNG TY") || upper.startsWith("CTY")) && !upper.includes("THIẾT BỊ & HÓA CHẤT ABT")
          ? clean
          : "CÔNG TY TNHH GIẢI PHÁP Y SINH ABT",
      defaultProductLines: "Sinh phẩm chẩn đoán PCR, Kit tách chiết DNA/RNA & Hóa chất y sinh",
      preferredCode: "NCC0001",
    };
  }
  if (upper.includes("PHÙ SA") || upper.includes("PHU SA")) {
    return {
      canonicalKey: "PHU_SA",
      shortName: "Phù Sa",
      defaultFullName:
        upper.startsWith("CÔNG TY") || upper.startsWith("CTY")
          ? clean
          : "CÔNG TY TNHH MỘT THÀNH VIÊN SINH HÓA PHÙ SA",
      defaultProductLines: "Sinh phẩm sinh học phân tử, Oligo & Hóa chất",
    };
  }
  if (upper.includes("HOÀNG KIM") || upper.includes("HOANG KIM")) {
    return {
      canonicalKey: "HOANG_KIM",
      shortName: "Hoàng Kim",
      defaultFullName:
        upper.startsWith("CÔNG TY") || upper.startsWith("CTY")
          ? clean
          : "CÔNG TY TNHH TRANG THIẾT BỊ Y TẾ HOÀNG KIM",
      defaultProductLines: "Trang thiết bị & Vật tư y tế",
    };
  }
  if (upper.includes("NAM YẾN") || upper.includes("NAM YEN")) {
    return {
      canonicalKey: "NAM_YEN",
      shortName: "Nam Yến",
      defaultFullName:
        upper.startsWith("CÔNG TY") || upper.startsWith("CTY")
          ? clean
          : "CÔNG TY TNHH QUỐC TẾ NAM YẾN",
      defaultProductLines: "Thiết bị & Vật tư phòng Lab",
    };
  }
  if (upper.includes("LÊ GIA") || upper.includes("LE GIA")) {
    return {
      canonicalKey: "LE_GIA",
      shortName: "Lê Gia",
      defaultFullName:
        upper.startsWith("CÔNG TY") || upper.startsWith("CTY")
          ? clean
          : "CÔNG TY TNHH SẢN XUẤT THƯƠNG MẠI LÊ GIA",
      defaultProductLines: "Thiết bị & Vật tư y tế",
    };
  }
  if (upper.includes("QMEDIC")) {
    return {
      canonicalKey: "QMEDIC",
      shortName: "QMedic",
      defaultFullName:
        upper.startsWith("CÔNG TY") || upper.startsWith("CTY")
          ? clean
          : "CÔNG TY TNHH THIẾT BỊ KHOA HỌC VÀ CÔNG NGHỆ QMEDIC",
      defaultProductLines: "Thiết bị khoa học & Công nghệ y sinh",
    };
  }
  if (upper.includes("HỒNG THIỆN MỸ") || upper.includes("HONG THIEN MY")) {
    return {
      canonicalKey: "HONG_THIEN_MY",
      shortName: "Hồng Thiện Mỹ",
      defaultFullName:
        upper.startsWith("CÔNG TY") || upper.startsWith("CTY")
          ? clean
          : "CÔNG TY CỔ PHẦN VẬT TƯ Y TẾ HỒNG THIỆN MỸ",
      defaultProductLines: "Vật tư y tế & Hóa chất xét nghiệm",
    };
  }
  if (upper.includes("LÂM VIỆT") || upper.includes("LAM VIET")) {
    return {
      canonicalKey: "LAM_VIET",
      shortName: "Lâm Việt",
      defaultFullName:
        upper.startsWith("CÔNG TY") || upper.startsWith("CTY")
          ? clean
          : "CÔNG TY TNHH THƯƠNG MẠI KHOA HỌC KỸ THUẬT LÂM VIỆT",
      defaultProductLines: "Thiết bị & Nội thất phòng Lab",
    };
  }
  if (upper.includes("NGÔ GIA PHÁT") || upper.includes("NGO GIA PHAT")) {
    return {
      canonicalKey: "NGO_GIA_PHAT",
      shortName: "Ngô Gia Phát",
      defaultFullName:
        upper.startsWith("CÔNG TY") || upper.startsWith("CTY")
          ? clean
          : "CÔNG TY TNHH THƯƠNG MẠI VẬT TƯ KHOA HỌC KỸ THUẬT NGÔ GIA PHÁT",
      defaultProductLines: "Vật tư khoa học kỹ thuật & Tiêu hao",
    };
  }
  if (upper.includes("NAM THÀNH") || upper.includes("NAM THANH")) {
    return {
      canonicalKey: "NAM_THANH",
      shortName: "Nam Thành",
      defaultFullName:
        upper.startsWith("CÔNG TY") || upper.startsWith("CTY")
          ? clean
          : "CÔNG TY TNHH THIẾT BỊ Y TẾ VÀ VẬT TƯ KHOA HỌC KỸ THUẬT NAM THÀNH",
      defaultProductLines: "Thiết bị y tế & Vật tư KHKT",
    };
  }
  if (upper.includes("PHƯƠNG ĐÔNG") || upper.includes("PHUONG DONG")) {
    return {
      canonicalKey: "PHUONG_DONG",
      shortName: "Phương Đông",
      defaultFullName:
        upper.startsWith("CÔNG TY") || upper.startsWith("CTY")
          ? clean
          : "CÔNG TY TNHH THIẾT BỊ Y TẾ PHƯƠNG ĐÔNG",
      defaultProductLines: "Thiết bị y tế & Sinh phẩm chẩn đoán",
    };
  }
  if (upper.includes("BIO BASIC") || upper.includes("BIOBASIC")) {
    return {
      canonicalKey: "BIO_BASIC",
      shortName: "Bio Basic",
      defaultFullName: clean.length > 9 ? clean : "Bio Basic Inc.",
      defaultProductLines: "Hóa chất sinh học phân tử & Sinh phẩm",
    };
  }
  if (upper.includes("BIOER")) {
    return {
      canonicalKey: "BIOER",
      shortName: "Bioer",
      defaultFullName: clean.length > 5 ? clean : "Bioer Technology Co., Ltd",
      defaultProductLines: "Thiết bị PCR, Real-time PCR & Máy tách chiết",
    };
  }
  if (upper.includes("BIOLINE")) {
    return {
      canonicalKey: "BIOLINE",
      shortName: "Bioline",
      defaultFullName: clean,
      defaultProductLines: "Enzyme PCR, Kit sinh học phân tử",
    };
  }
  if (upper.includes("HIMEDIA")) {
    return {
      canonicalKey: "HIMEDIA",
      shortName: "HiMedia",
      defaultFullName: clean,
      defaultProductLines: "Môi trường nuôi cấy vi sinh & Hóa chất",
    };
  }
  if (upper.includes("SIGMA")) {
    return {
      canonicalKey: "SIGMA_ALDRICH",
      shortName: "Sigma-Aldrich",
      defaultFullName: clean,
      defaultProductLines: "Hóa chất tinh khiết & Chất chuẩn phân tích",
    };
  }
  if (upper.includes("MERCK")) {
    return {
      canonicalKey: "MERCK",
      shortName: "Merck",
      defaultFullName: clean,
      defaultProductLines: "Hóa chất phân tích & Sinh phẩm phòng Lab",
    };
  }
  if (upper.includes("TIANLONG")) {
    return {
      canonicalKey: "TIANLONG",
      shortName: "Tianlong",
      defaultFullName: clean,
      defaultProductLines: "Thiết bị tách chiết & Real-time PCR",
    };
  }
  if (upper.includes("ALLSHENG")) {
    return {
      canonicalKey: "ALLSHENG",
      shortName: "Allsheng",
      defaultFullName: clean,
      defaultProductLines: "Thiết bị phòng thí nghiệm cơ bản & chuyên sâu",
    };
  }
  if (upper.includes("AXYGEN")) {
    return {
      canonicalKey: "AXYGEN",
      shortName: "Axygen",
      defaultFullName: clean,
      defaultProductLines: "Vật tư tiêu hao nhựa sinh học phân tử",
    };
  }
  if (upper.includes("EPPENDORF")) {
    return {
      canonicalKey: "EPPENDORF",
      shortName: "Eppendorf",
      defaultFullName: clean,
      defaultProductLines: "Thiết bị định lượng, Pipette & Máy ly tâm",
    };
  }
  if (upper.includes("THERMO")) {
    return {
      canonicalKey: "THERMO_FISHER",
      shortName: "Thermo Fisher",
      defaultFullName: clean,
      defaultProductLines: "Thiết bị khoa học & Sinh phẩm sinh học phân tử",
    };
  }
  if (upper.includes("QIAGEN")) {
    return {
      canonicalKey: "QIAGEN",
      shortName: "Qiagen",
      defaultFullName: clean,
      defaultProductLines: "Kit tách chiết & Sinh phẩm chẩn đoán",
    };
  }
  if (upper.includes("BIO-RAD") || upper.includes("BIORAD")) {
    return {
      canonicalKey: "BIORAD",
      shortName: "Bio-Rad",
      defaultFullName: clean,
      defaultProductLines: "Thiết bị & Hóa chất xét nghiệm sinh học",
    };
  }

  const core = stripCompanyLegalAffixes(clean);
  return {
    canonicalKey: core.toUpperCase().replace(/\s+/g, " "),
    shortName: core.length <= 35 ? core : core.slice(0, 35).trim(),
    defaultFullName: clean,
  };
}

const SYNC_CACHE_TTL_MS = 5 * 60 * 1000;
let lastSyncTime = 0;
let lastSyncResult: SyncSuppliersResult = {
  newSuppliersCreated: 0,
  newProductsLinked: 0,
  pricesUpdated: 0,
};
let activeSyncPromise: Promise<SyncSuppliersResult> | null = null;

export function invalidateSupplierCatalogCache() {
  lastSyncTime = 0;
}

/** Ghi nhận NCC đã bị xóa thủ công để không tự tạo lại ngoài ý muốn (trừ khi bấm đồng bộ cưỡng bức) */
export async function markSupplierDeleted(supplierName?: string, shortName?: string) {
  try {
    invalidateSupplierCatalogCache();
    const keysToMark: string[] = [];
    const r1 = resolveCanonicalSupplier(supplierName);
    if (r1) keysToMark.push(r1.canonicalKey);
    const r2 = resolveCanonicalSupplier(shortName);
    if (r2 && !keysToMark.includes(r2.canonicalKey)) keysToMark.push(r2.canonicalKey);
    if (keysToMark.length === 0) return;

    const cur = await query("SELECT data FROM app_storage WHERE key = 'deleted_procurement_suppliers'");
    const list: string[] = Array.isArray(cur.rows[0]?.data) ? cur.rows[0].data : [];
    const merged = Array.from(new Set([...list, ...keysToMark]));
    await query(
      `INSERT INTO app_storage (key, data, version, updated_at)
       VALUES ('deleted_procurement_suppliers', $1::jsonb, 1, NOW())
       ON CONFLICT (key) DO UPDATE SET data = $1::jsonb, updated_at = NOW()`,
      [JSON.stringify(merged)]
    );
  } catch (e: any) {
    console.warn("markSupplierDeleted warning:", e?.message);
  }
}

export async function unmarkSupplierDeleted(supplierName?: string, shortName?: string) {
  try {
    invalidateSupplierCatalogCache();
    const keysToRemove = new Set<string>();
    const r1 = resolveCanonicalSupplier(supplierName);
    if (r1) keysToRemove.add(r1.canonicalKey);
    const r2 = resolveCanonicalSupplier(shortName);
    if (r2) keysToRemove.add(r2.canonicalKey);
    if (keysToRemove.size === 0) return;

    const cur = await query("SELECT data FROM app_storage WHERE key = 'deleted_procurement_suppliers'");
    const list: string[] = Array.isArray(cur.rows[0]?.data) ? cur.rows[0].data : [];
    const next = list.filter((k) => !keysToRemove.has(k));
    if (next.length !== list.length) {
      await query(
        `UPDATE app_storage SET data = $1::jsonb, updated_at = NOW() WHERE key = 'deleted_procurement_suppliers'`,
        [JSON.stringify(next)]
      );
    }
  } catch (e: any) {
    console.warn("unmarkSupplierDeleted warning:", e?.message);
  }
}

export interface SyncSuppliersResult {
  newSuppliersCreated: number;
  newProductsLinked: number;
  pricesUpdated: number;
}

/**
 * Tự động đồng bộ Nhà cung cấp / Hãng sản xuất và Danh mục hàng & Giá mua
 * từ Danh mục sản phẩm (bảng `products` + `app_storage.sales_commercial_products`)
 * và từ lịch sử đơn đặt hàng PO (`procurement_orders`).
 */
export async function syncCatalogSuppliersAndProducts(
  options?: { forceIncludeDeleted?: boolean; force?: boolean } | boolean
): Promise<SyncSuppliersResult> {
  const opts = typeof options === "boolean" ? { force: options } : options;
  const force = Boolean(opts?.force || opts?.forceIncludeDeleted);

  if (!force && lastSyncTime > 0 && Date.now() - lastSyncTime < SYNC_CACHE_TTL_MS) {
    return lastSyncResult;
  }
  if (!force && activeSyncPromise) {
    return activeSyncPromise;
  }

  const runSync = async (): Promise<SyncSuppliersResult> => {
    const result: SyncSuppliersResult = {
      newSuppliersCreated: 0,
      newProductsLinked: 0,
      pricesUpdated: 0,
    };

    try {
      if (opts?.forceIncludeDeleted) {
        await query("DELETE FROM app_storage WHERE key = 'deleted_procurement_suppliers'").catch(() => {});
      }

      const [suppliersRes, dbProductsRes, commStorageRes, deletedStorageRes, supplierProductsRes, ordersRes] =
        await Promise.all([
          query("SELECT * FROM procurement_suppliers ORDER BY id ASC"),
          query("SELECT code, name, manufacturer, category, specification, unit, cost_price, standard_price FROM products ORDER BY code ASC"),
          query("SELECT COALESCE(jsonb_agg(data ORDER BY sort_order, code), '[]'::jsonb) AS data FROM catalog_items"),
          query("SELECT data FROM app_storage WHERE key = 'deleted_procurement_suppliers'"),
          query("SELECT id, supplier_id, product_code, product_name, specification, unit, purchase_price, price_history FROM supplier_products"),
          query("SELECT id, po_code, supplier_id, supplier_name, items, order_date FROM procurement_orders WHERE COALESCE(status, '') <> 'CANCELLED' ORDER BY id ASC"),
        ]);

      const suppliers: any[] = suppliersRes.rows || [];
      const dbProducts: any[] = dbProductsRes.rows || [];
      const commProducts: any[] = Array.isArray(commStorageRes.rows[0]?.data)
        ? commStorageRes.rows[0].data
        : [];
      const deletedKeys = new Set<string>(
        opts?.forceIncludeDeleted
          ? []
          : Array.isArray(deletedStorageRes.rows[0]?.data)
          ? deletedStorageRes.rows[0].data
          : []
      );

      // 1. Build unified product catalog map by uppercase code
      interface UnifiedCatalogItem {
        code: string;
        name: string;
        category: string;
        specification: string | null;
        unit: string;
        costPrice: number;
        supplierRaw: string | null;
        brandRaw: string | null;
        dbManufacturerRaw: string | null;
      }

      const catalogMap = new Map<string, UnifiedCatalogItem>();

      for (const p of dbProducts) {
        const code = String(p.code || "").trim();
        if (!code) continue;
        const key = code.toUpperCase();
        catalogMap.set(key, {
          code,
          name: String(p.name || code).trim(),
          category: String(p.category || "Sinh phẩm & Thiết bị y tế").trim(),
          specification: p.specification ? String(p.specification).trim() : null,
          unit: String(p.unit || "Hộp").trim(),
          costPrice: parseFloat(p.cost_price) || 0,
          supplierRaw: null,
          brandRaw: null,
          dbManufacturerRaw: p.manufacturer ? String(p.manufacturer).trim() : null,
        });
      }

      for (const c of commProducts) {
        if (!c || typeof c !== "object") continue;
        const code = String(c.code || "").trim();
        if (!code) continue;
        const key = code.toUpperCase();
        const prev = catalogMap.get(key);
        const cCost = parseFloat(c.costPrice ?? c.cost_price) || 0;
        const cSup = c.supplier ? String(c.supplier).trim() : null;
        const cBrand = c.brand || c.manufacturer ? String(c.brand || c.manufacturer).trim() : null;

        if (prev) {
          catalogMap.set(key, {
            code: prev.code,
            name: String(c.name || prev.name || code).trim(),
            category: String(c.category || prev.category || "Sinh phẩm & Thiết bị y tế").trim(),
            specification: c.specification ? String(c.specification).trim() : prev.specification,
            unit: String(c.unit || prev.unit || "Hộp").trim(),
            costPrice: cCost > 0 ? cCost : prev.costPrice,
            supplierRaw: !isPlaceholderSupplierName(cSup) ? cSup : prev.supplierRaw,
            brandRaw: !isPlaceholderSupplierName(cBrand) ? cBrand : prev.brandRaw,
            dbManufacturerRaw: prev.dbManufacturerRaw,
          });
        } else {
          catalogMap.set(key, {
            code,
            name: String(c.name || code).trim(),
            category: String(c.category || "Sinh phẩm & Thiết bị y tế").trim(),
            specification: c.specification ? String(c.specification).trim() : null,
            unit: String(c.unit || "Hộp").trim(),
            costPrice: cCost,
            supplierRaw: !isPlaceholderSupplierName(cSup) ? cSup : null,
            brandRaw: !isPlaceholderSupplierName(cBrand) ? cBrand : null,
            dbManufacturerRaw: null,
          });
        }
      }

      // 2. Index existing suppliers by canonicalKey, name, short_name, and supplier_code
      const supplierByCanonical = new Map<string, any>();
      const supplierById = new Map<number, any>();
      const usedCodes = new Set<string>();
      let maxNccNumber = 116;

      const indexSupplier = (s: any) => {
        supplierById.set(Number(s.id), s);
        if (s.supplier_code) {
          const codeUpper = String(s.supplier_code).trim().toUpperCase();
          usedCodes.add(codeUpper);
          const m = codeUpper.match(/^NCC0*(\d+)$/);
          if (m) {
            const n = parseInt(m[1], 10);
            if (Number.isFinite(n) && n > maxNccNumber) maxNccNumber = n;
          }
        }
        const c1 = resolveCanonicalSupplier(s.name);
        if (c1 && !supplierByCanonical.has(c1.canonicalKey)) {
          supplierByCanonical.set(c1.canonicalKey, s);
        }
        const c2 = resolveCanonicalSupplier(s.short_name);
        if (c2 && !supplierByCanonical.has(c2.canonicalKey)) {
          supplierByCanonical.set(c2.canonicalKey, s);
        }
        const stripped = stripCompanyLegalAffixes(s.name).toUpperCase();
        if (stripped && !supplierByCanonical.has(stripped)) {
          supplierByCanonical.set(stripped, s);
        }
        if (s.short_name) {
          const snUpper = String(s.short_name).trim().toUpperCase();
          if (snUpper && !supplierByCanonical.has(snUpper)) {
            supplierByCanonical.set(snUpper, s);
          }
        }
      };

      for (const s of suppliers) {
        indexSupplier(s);
      }

      // 3. Group catalog products by their resolved canonical supplier
      interface PendingSupplierGroup {
        info: CanonicalSupplierInfo;
        bestFullName: string;
        categories: Set<string>;
        items: UnifiedCatalogItem[];
      }

      const groupsByCanonical = new Map<string, PendingSupplierGroup>();

      for (const item of catalogMap.values()) {
        const supInfo = resolveCanonicalSupplier(item.supplierRaw);
        const brandInfo = resolveCanonicalSupplier(item.brandRaw);
        const mfgInfo = resolveCanonicalSupplier(item.dbManufacturerRaw);

        let chosen: CanonicalSupplierInfo | null = supInfo || brandInfo || mfgInfo;
        if (!chosen) continue;

        const candidateRawNames = [item.supplierRaw, item.brandRaw, item.dbManufacturerRaw].filter(
          (r): r is string => Boolean(r && !isPlaceholderSupplierName(r))
        );

        let bestRawName = chosen.defaultFullName;
        for (const raw of candidateRawNames) {
          const rInfo = resolveCanonicalSupplier(raw);
          if (rInfo && rInfo.canonicalKey === chosen.canonicalKey) {
            const upperRaw = raw.toUpperCase();
            const upperBest = bestRawName.toUpperCase();
            if (
              (upperRaw.startsWith("CÔNG TY") && !upperBest.startsWith("CÔNG TY")) ||
              (upperRaw.startsWith("CÔNG TY") === upperBest.startsWith("CÔNG TY") && raw.length > bestRawName.length)
            ) {
              bestRawName = raw;
            }
          }
        }

        const existingGroup = groupsByCanonical.get(chosen.canonicalKey);
        if (!existingGroup) {
          groupsByCanonical.set(chosen.canonicalKey, {
            info: chosen,
            bestFullName: bestRawName,
            categories: new Set(item.category ? [item.category] : []),
            items: [item],
          });
        } else {
          const upperNew = bestRawName.toUpperCase();
          const upperCur = existingGroup.bestFullName.toUpperCase();
          if (
            (upperNew.startsWith("CÔNG TY") && !upperCur.startsWith("CÔNG TY")) ||
            (upperNew.startsWith("CÔNG TY") === upperCur.startsWith("CÔNG TY") &&
              bestRawName.length > existingGroup.bestFullName.length)
          ) {
            existingGroup.bestFullName = bestRawName;
          }
          if (item.category) existingGroup.categories.add(item.category);
          existingGroup.items.push(item);
        }
      }

      // 4. Ensure each supplier group exists in procurement_suppliers
      const nextSupplierCode = (preferred?: string): string => {
        if (preferred && !usedCodes.has(preferred.toUpperCase())) {
          usedCodes.add(preferred.toUpperCase());
          return preferred.toUpperCase();
        }
        while (true) {
          maxNccNumber++;
          const candidate = `NCC${String(maxNccNumber).padStart(4, "0")}`;
          if (!usedCodes.has(candidate)) {
            usedCodes.add(candidate);
            return candidate;
          }
        }
      };

      for (const [canonicalKey, group] of groupsByCanonical.entries()) {
        let sup =
          supplierByCanonical.get(canonicalKey) ||
          supplierByCanonical.get(group.info.shortName.toUpperCase()) ||
          supplierByCanonical.get(stripCompanyLegalAffixes(group.bestFullName).toUpperCase());

        if (!sup) {
          if (deletedKeys.has(canonicalKey)) {
            continue;
          }
          const newCode = nextSupplierCode(group.info.preferredCode);
          const catList = Array.from(group.categories).slice(0, 3).join(", ");
          const productLines =
            group.info.defaultProductLines || catList || "Sinh phẩm & Thiết bị y tế";

          const insRes = await query(
            `INSERT INTO procurement_suppliers (
               supplier_code, name, short_name, contact_person, phone, email, address, product_lines, payment_terms, rating
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             ON CONFLICT (supplier_code) DO UPDATE
               SET short_name = COALESCE(NULLIF(procurement_suppliers.short_name, ''), EXCLUDED.short_name)
             RETURNING *`,
            [
              newCode,
              group.bestFullName,
              group.info.shortName,
              "Phòng Kinh Doanh / Cung Ứng",
              "",
              "",
              "",
              productLines,
              "Công nợ 30 ngày",
              5,
            ]
          );
          if (insRes.rows.length > 0) {
            sup = insRes.rows[0];
            suppliers.push(sup);
            indexSupplier(sup);
            result.newSuppliersCreated++;
          }
        } else {
          if ((!sup.short_name || !String(sup.short_name).trim()) && group.info.shortName) {
            await query(
              "UPDATE procurement_suppliers SET short_name = $1 WHERE id = $2",
              [group.info.shortName, sup.id]
            );
            sup.short_name = group.info.shortName;
          }
        }
      }

      // 5. Build lookup of existing supplier_products: key = `${supplier_id}:${product_code.toLowerCase()}`
      const existingSpMap = new Map<string, any>();
      for (const sp of supplierProductsRes.rows || []) {
        const k = `${sp.supplier_id}:${String(sp.product_code || "").trim().toLowerCase()}`;
        existingSpMap.set(k, sp);
      }

      const today = todayVN();

      // 6. Sync all grouped catalog items into supplier_products
      for (const [canonicalKey, group] of groupsByCanonical.entries()) {
        const sup =
          supplierByCanonical.get(canonicalKey) ||
          supplierByCanonical.get(group.info.shortName.toUpperCase()) ||
          supplierByCanonical.get(stripCompanyLegalAffixes(group.bestFullName).toUpperCase());
        if (!sup || !sup.id) continue;

        for (const item of group.items) {
          const spKey = `${sup.id}:${item.code.toLowerCase()}`;
          const existingSp = existingSpMap.get(spKey);

          if (!existingSp) {
            const initHist = [
              {
                date: today,
                old_price: 0,
                new_price: item.costPrice || 0,
                changed_by: "Hệ thống (Đồng bộ Danh mục HH)",
                reason: `Tự động đồng bộ từ Danh mục hàng hóa (${sup.short_name || sup.name})`,
                source: "CATALOG_AUTO",
              },
            ];
            const insSp = await query(
              `INSERT INTO supplier_products (
                 supplier_id, product_code, product_name, specification, unit, purchase_price, price_history, last_updated_at
               ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW())
               ON CONFLICT (supplier_id, product_code) DO NOTHING
               RETURNING id, supplier_id, product_code, purchase_price, price_history`,
              [
                sup.id,
                item.code,
                item.name,
                item.specification,
                item.unit || "Hộp",
                item.costPrice || 0,
                JSON.stringify(initHist),
              ]
            );
            if (insSp.rows.length > 0) {
              existingSpMap.set(spKey, insSp.rows[0]);
              result.newProductsLinked++;
            }
          } else {
            const oldP = parseFloat(existingSp.purchase_price) || 0;
            const newP = item.costPrice || 0;
            if (oldP === 0 && newP > 0) {
              let history: any[] = [];
              try {
                history =
                  typeof existingSp.price_history === "string"
                    ? JSON.parse(existingSp.price_history)
                    : Array.isArray(existingSp.price_history)
                    ? existingSp.price_history
                    : [];
              } catch {
                history = [];
              }
              history.push({
                date: today,
                old_price: 0,
                new_price: newP,
                changed_by: "Hệ thống (Đồng bộ Giá vốn Danh mục HH)",
                reason: "Cập nhật giá mua từ giá vốn Danh mục hàng hóa",
                source: "CATALOG_AUTO",
              });
              await query(
                `UPDATE supplier_products
                    SET purchase_price = $1,
                        product_name = COALESCE(NULLIF($2, ''), product_name),
                        specification = COALESCE(NULLIF($3, ''), specification),
                        unit = COALESCE(NULLIF($4, ''), unit),
                        price_history = $5::jsonb,
                        last_updated_at = NOW()
                  WHERE id = $6`,
                [newP, item.name, item.specification || "", item.unit || "", JSON.stringify(history), existingSp.id]
              );
              existingSp.purchase_price = newP;
              result.pricesUpdated++;
            }
          }
        }
      }

      // 7. Also sync products from historical POs (procurement_orders) into supplier_products
      for (const po of ordersRes.rows || []) {
        let sup = po.supplier_id ? supplierById.get(Number(po.supplier_id)) : null;
        if (!sup && po.supplier_name) {
          const cInfo = resolveCanonicalSupplier(po.supplier_name);
          if (cInfo) {
            sup =
              supplierByCanonical.get(cInfo.canonicalKey) ||
              supplierByCanonical.get(cInfo.shortName.toUpperCase());
          }
        }
        if (!sup || !sup.id) continue;

        let items: any[] = [];
        try {
          items =
            typeof po.items === "string"
              ? JSON.parse(po.items)
              : Array.isArray(po.items)
              ? po.items
              : [];
        } catch {
          items = [];
        }

        for (const it of items) {
          const pCode = String(it.product_code || "").trim();
          if (!pCode) continue;
          const spKey = `${sup.id}:${pCode.toLowerCase()}`;
          if (!existingSpMap.has(spKey)) {
            const catItem = catalogMap.get(pCode.toUpperCase());
            const pName = String(it.product_name || catItem?.name || pCode)
              .replace(/^\[(?:PR|WF)[^\]]*\]\s*/, "")
              .trim();
            const uPrice = parseFloat(it.unit_price) || catItem?.costPrice || 0;
            const initHist = [
              {
                date: po.order_date || today,
                old_price: 0,
                new_price: uPrice,
                changed_by: `Hệ thống (PO: ${po.po_code})`,
                reason: `Thu thập tự động từ đơn đặt hàng PO ${po.po_code}`,
                source: "PO_AUTO",
              },
            ];
            const insPoSp = await query(
              `INSERT INTO supplier_products (
                 supplier_id, product_code, product_name, specification, unit, purchase_price, price_history, last_updated_at
               ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW())
               ON CONFLICT (supplier_id, product_code) DO NOTHING
               RETURNING id, supplier_id, product_code, purchase_price, price_history`,
              [
                sup.id,
                pCode,
                pName,
                it.specification || catItem?.specification || null,
                it.unit || catItem?.unit || "Hộp",
                uPrice,
                JSON.stringify(initHist),
              ]
            );
            if (insPoSp.rows.length > 0) {
              existingSpMap.set(spKey, insPoSp.rows[0]);
              result.newProductsLinked++;
            }
          }
        }
      }
      lastSyncTime = Date.now();
      lastSyncResult = result;
    } catch (err: any) {
      console.warn("[syncCatalogSuppliersAndProducts] warning:", err?.message || err);
    }

    return result;
  };

  activeSyncPromise = runSync().finally(() => {
    activeSyncPromise = null;
  });

  return activeSyncPromise;
}
