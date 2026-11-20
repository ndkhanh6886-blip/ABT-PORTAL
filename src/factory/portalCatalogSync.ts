import { query } from "@/backend/db/db";
import {
  isLegacyDemoOligoCode,
  isServiceProduct,
  readCatalog,
  resolveActualProductCategory,
} from "@/backend/services/catalogStore";
import type { Tx } from "./core/db";
import { isPlaceholderUom, normalizeUomAlias } from "./master/service";

const SYNC_TTL_MS = 300_000;
let lastSyncAt = 0;

interface SyncCandidate {
  code: string;
  name: string;
  item_type: string;
  base_uom: string;
  storage_condition: "RT" | "2-8" | "-20" | "-80";
  shelf_life_days: number | null;
  is_purchasable: boolean;
  is_saleable: boolean;
  is_manufacturable: boolean;
  kd_item_code: string | null;
}

const PORTAL_UOM_ALIASES: Record<string, string> = {
  tui: "pack",
  "túi": "pack",
  goi: "pack",
  "gói": "pack",
  bich: "pack",
  "bịch": "pack",
  cuon: "roll",
  "cuộn": "roll",
  cot: "col",
  "cột": "col",
  thung: "carton",
  "thùng": "carton",
  cap: "pair",
  "cặp": "pair",
  doi: "pair",
  "đôi": "pair",
  vi: "strip",
  "vỉ": "strip",
  to: "sheet",
  "tờ": "sheet",
  tam: "sheet",
  "tấm": "sheet",
  pu: "test",
  "pư": "test",
  "phản ứng": "test",
  test: "test",
  kit: "kit",
  "bộ kit": "kit",
};

function mapPortalUom(raw: unknown, itemType: string): string {
  const trimmed = String(raw ?? "").trim();
  const fallback = itemType === "FINISHED_KIT" ? "kit" : "pcs";
  if (isPlaceholderUom(trimmed)) return fallback;

  const portalHit = PORTAL_UOM_ALIASES[trimmed.toLowerCase()];
  const mapped = portalHit ?? normalizeUomAlias(trimmed);
  if (/^[A-Za-zµ0-9%/_-]{1,12}$/.test(mapped)) return mapped;
  return fallback;
}

function uomDimension(code: string): "MASS" | "VOLUME" | "AMOUNT" | "OD" | "LENGTH" | "COUNT" {
  if (/^(kg|g|mg|µg)$/i.test(code)) return "MASS";
  if (/^(L|mL|µL)$/i.test(code)) return "VOLUME";
  if (/^(mol|µmol|nmol)$/i.test(code)) return "AMOUNT";
  if (/^OD$/i.test(code)) return "OD";
  if (/^m$/i.test(code)) return "LENGTH";
  return "COUNT";
}

function mapPortalStorage(raw: unknown): "RT" | "2-8" | "-20" | "-80" {
  const s = String(raw ?? "").toUpperCase();
  if (s.includes("-80") || s.includes("−80")) return "-80";
  if (s.includes("-20") || s.includes("−20")) return "-20";
  if (s.includes("2-8") || s.includes("2–8") || s.includes("4°C") || s.includes("4C")) return "2-8";
  return "RT";
}

function mapPortalCategoryToItemType(cat: string, fallbackType: string): string {
  switch (cat) {
    case "PCR Kit":
    case "PCR":
    case "Kit Tách chiết":
    case "Kit tách chiết":
    case "Kit trên người":
    case "Kit thú y":
    case "Kit thủy sản":
    case "Kits vi sinh":
    case "Kits định danh loài":
    case "Kit Xét nghiệm":
      return "FINISHED_KIT";
    case "Giải pháp tự pha":
    case "Tự pha":
      return "SEMI_FINISHED";
    case "Hóa chất & Sinh phẩm":
    case "Reagent":
    case "Hóa chất SHPT":
    case "Hóa chất cơ bản":
    case "Tế bào học":
    case "Nhóm Sản Phẩm PAP-GPB":
    case "Oligo":
      return "REAGENT";
    case "Thiết bị":
    case "Thiết bị Phòng Lab":
    case "Thiết bị SHPT":
    case "Thiết bị cơ bản ABT":
    case "Thiết bị cơ bản":
    case "Thiết bị chuyên sâu":
    case "Thiết bị TM":
    case "Nội thất PTN ABT":
      return "DEVICE";
    case "Linh kiện":
    case "Linh kiện KT":
      return "COMPONENT";
    case "Vật tư tiêu hao":
    case "Vật tư tiêu hao SHPT":
    case "Dụng cụ":
      return "CONSUMABLE";
    default:
      return fallbackType;
  }
}

function isExcludedPortalCode(code: string, name?: string | null, category?: string | null): boolean {
  const cUp = code.trim().toUpperCase();
  if (!cUp || cUp.length > 80) return true;
  if (isLegacyDemoOligoCode(cUp)) return true;
  return isServiceProduct({ code: cUp, name: name ?? "", category: category ?? "" });
}

/**
 * Safely syncs missing products/materials/components from Portal catalogs (`products`, `catalog_items`,
 * `supplier_products`) and `kit.bom.parent_item_code` into factory `master.item` so QC Specs, BOMs,
 * and Stock lookups always see the complete enterprise catalog.
 */
export async function syncPortalCatalogToFactoryItems(tx: Tx, force = false): Promise<number> {
  if (process.env.VITEST && !force) return 0;
  const now = Date.now();
  if (!force && now - lastSyncAt < SYNC_TTL_MS) return 0;

  await tx.query("SAVEPOINT sp_portal_catalog_sync");
  try {
    const existingRes = await tx.query("SELECT code, kd_item_code FROM master.item");
    const existingCodes = new Set<string>();
    const existingKdCodes = new Set<string>();
    for (const r of existingRes.rows) {
      if (r.code) existingCodes.add(String(r.code).trim().toUpperCase());
      if (r.kd_item_code) existingKdCodes.add(String(r.kd_item_code).trim().toUpperCase());
    }

    const candidates = new Map<string, SyncCandidate>();
    const registerCandidate = (cand: SyncCandidate) => {
      const codeKey = cand.code.trim().toUpperCase();
      if (!codeKey || existingCodes.has(codeKey) || candidates.has(codeKey)) return;
      if (cand.kd_item_code && existingKdCodes.has(cand.kd_item_code.toUpperCase())) {
        cand.kd_item_code = null;
      }
      if (cand.kd_item_code) existingKdCodes.add(cand.kd_item_code.toUpperCase());
      candidates.set(codeKey, cand);
    };

    // 1. Missing parent SKUs referenced by kit.bom.parent_item_code
    const bomParents = await tx
      .query(
        `SELECT DISTINCT ON (upper(trim(b.parent_item_code)))
                trim(b.parent_item_code) AS code,
                b.name, b.bom_category, b.bom_type, b.storage_condition, b.shelf_life_days
           FROM kit.bom b
          WHERE b.parent_item_code IS NOT NULL
            AND trim(b.parent_item_code) <> ''
          ORDER BY upper(trim(b.parent_item_code)), (b.status = 'EFFECTIVE') DESC, b.bom_version DESC`
      )
      .then((r) => r.rows)
      .catch(() => [] as any[]);

    for (const bp of bomParents) {
      const code = String(bp.code || "").trim();
      if (!code) continue;
      const isSemi = bp.bom_type === "semi_finished";
      const itemType = isSemi ? "SEMI_FINISHED" : "FINISHED_KIT";
      const cleanName = String(bp.name || code).replace(/^Định mức\s+/i, "").trim() || code;
      const sDays = Number(bp.shelf_life_days);
      registerCandidate({
        code,
        name: cleanName,
        item_type: itemType,
        base_uom: isSemi ? "mL" : "kit",
        storage_condition: mapPortalStorage(bp.storage_condition),
        shelf_life_days: Number.isFinite(sDays) && sDays > 0 ? Math.round(sDays) : null,
        is_purchasable: false,
        is_saleable: !isSemi,
        is_manufacturable: true,
        kd_item_code: code,
      });
    }

    // 2. Portal `products` table (Kho & Kinh doanh)
    const portalProducts = await query(
      "SELECT code, name, category, unit, storage_condition FROM products WHERE code IS NOT NULL AND trim(code) <> ''"
    )
      .then((r) => r.rows)
      .catch(() => [] as any[]);

    for (const p of portalProducts) {
      const code = String(p.code || "").trim();
      const name = String(p.name || code).trim() || code;
      if (isExcludedPortalCode(code, name, p.category)) continue;
      const resolvedCat = resolveActualProductCategory({ code, name, category: p.category });
      const itemType = mapPortalCategoryToItemType(resolvedCat, "CONSUMABLE");
      registerCandidate({
        code,
        name,
        item_type: itemType,
        base_uom: mapPortalUom(p.unit, itemType),
        storage_condition: mapPortalStorage(p.storage_condition),
        shelf_life_days: null,
        is_purchasable: true,
        is_saleable: itemType === "FINISHED_KIT" || itemType === "DEVICE",
        is_manufacturable: itemType === "FINISHED_KIT" || itemType === "SEMI_FINISHED",
        kd_item_code: code,
      });
    }

    // 3. Portal `catalog_items` table (Danh mục sản phẩm Kinh doanh)
    const catalogItems = await readCatalog().catch(() => [] as any[]);
    for (const ci of catalogItems) {
      const code = String(ci?.code || "").trim();
      const name = String(ci?.name || ci?.product_name || code).trim() || code;
      if (!code || isExcludedPortalCode(code, name, ci?.category)) continue;
      const resolvedCat = resolveActualProductCategory({ code, name, category: ci?.category });
      const itemType = mapPortalCategoryToItemType(resolvedCat, "CONSUMABLE");
      registerCandidate({
        code,
        name,
        item_type: itemType,
        base_uom: mapPortalUom(ci?.unit, itemType),
        storage_condition: mapPortalStorage(ci?.storageCondition ?? ci?.storage_condition),
        shelf_life_days: null,
        is_purchasable: true,
        is_saleable: true,
        is_manufacturable: itemType === "FINISHED_KIT" || itemType === "SEMI_FINISHED",
        kd_item_code: code,
      });
    }

    // 4. Portal `supplier_products` (Nguyên liệu / Vật tư nhà cung cấp)
    const supplierProducts = await query(
      `SELECT DISTINCT ON (upper(trim(product_code)))
              trim(product_code) AS code, product_name AS name, unit
         FROM supplier_products
        WHERE product_code IS NOT NULL AND trim(product_code) <> ''
        ORDER BY upper(trim(product_code)), last_updated_at DESC`
    )
      .then((r) => r.rows)
      .catch(() => [] as any[]);

    for (const sp of supplierProducts) {
      const code = String(sp.code || "").trim();
      const name = String(sp.name || code).trim() || code;
      if (isExcludedPortalCode(code, name, "")) continue;
      const resolvedCat = resolveActualProductCategory({ code, name, category: "" });
      const itemType = mapPortalCategoryToItemType(resolvedCat, "RAW_MATERIAL");
      registerCandidate({
        code,
        name,
        item_type: itemType,
        base_uom: mapPortalUom(sp.unit, itemType),
        storage_condition: "RT",
        shelf_life_days: null,
        is_purchasable: true,
        is_saleable: false,
        is_manufacturable: false,
        kd_item_code: null,
      });
    }

    const list = Array.from(candidates.values());
    if (list.length > 0) {
      const uniqueUoms = Array.from(new Set(list.map((c) => c.base_uom)));
      await tx.query(
        `INSERT INTO master.uom (code, name, dimension, status)
         SELECT u, u, d, 'ACTIVE'
           FROM unnest($1::text[], $2::text[]) AS t(u, d)
         ON CONFLICT (code) DO NOTHING`,
        [uniqueUoms, uniqueUoms.map((u) => uomDimension(u))]
      );

      for (let i = 0; i < list.length; i += 400) {
        const chunk = list.slice(i, i + 400);
        await tx.query(
          `INSERT INTO master.item (
             code, name, item_type, base_uom, tracking,
             shelf_life_days, storage_condition, receipt_qc_required,
             is_purchasable, is_saleable, is_manufacturable, kd_item_code, status
           )
           SELECT c, n, it, u, 'LOT', sld, sc, true, ip, isa, im, kdc, 'ACTIVE'
             FROM unnest(
               $1::text[], $2::text[], $3::text[], $4::text[],
               $5::int[], $6::text[], $7::boolean[], $8::boolean[], $9::boolean[], $10::text[]
             ) AS t(c, n, it, u, sld, sc, ip, isa, im, kdc)
           ON CONFLICT DO NOTHING`,
          [
            chunk.map((x) => x.code),
            chunk.map((x) => x.name),
            chunk.map((x) => x.item_type),
            chunk.map((x) => x.base_uom),
            chunk.map((x) => x.shelf_life_days),
            chunk.map((x) => x.storage_condition),
            chunk.map((x) => x.is_purchasable),
            chunk.map((x) => x.is_saleable),
            chunk.map((x) => x.is_manufacturable),
            chunk.map((x) => x.kd_item_code),
          ]
        );
      }
    }

    await tx.query("RELEASE SAVEPOINT sp_portal_catalog_sync");
    lastSyncAt = Date.now();
    return list.length;
  } catch {
    await tx.query("ROLLBACK TO SAVEPOINT sp_portal_catalog_sync").catch(() => {});
    return 0;
  }
}
