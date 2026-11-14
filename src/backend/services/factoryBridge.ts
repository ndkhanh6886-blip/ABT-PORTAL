import { query, withTransaction, HttpError, logAudit } from "@/backend/db/db";
import { AuthorizedUser, isAdminUser } from "@/backend/services/authz";
import { hasPermission } from "@/backend/services/permissions";
import { handleKdEvent, getFactoryInternalOrderSummary } from "@/factory/intake/kdEvents";
import type { BridgeEvent } from "@/factory/intake/gateway";

/**
 * Kinh doanh side of the bridge to the factory (docs/nha-may/00 §4, §7). The factory is an internal
 * supplier: a PO to it is sent as KdPoIssued; the factory answers with acceptance, progress and
 * shipments. Messages go through an outbox / inbox pair in this database, so a lost or repeated
 * delivery never loses or doubles an effect.
 */

export const FACTORY_UNITS = {
  OLIGO: "Phòng Tổng hợp Oligo",
  KIT: "Phòng Sản xuất Kit",
  DEVICE: "Phòng Kỹ thuật - Thiết bị",
} as const;
export type FactoryUnit = keyof typeof FACTORY_UNITS;

export interface DefaultInternalSupplierSpec {
  factory_unit: FactoryUnit;
  preferred_code: string;
  name: string;
  short_name: string;
  legacy_names: string[];
  contact_person: string;
  phone: string;
  email: string;
  address: string;
  product_lines: string;
  payment_terms: string;
  rating: number;
  notes: string;
}

export const DEFAULT_INTERNAL_SUPPLIERS: readonly DefaultInternalSupplierSpec[] = [
  {
    factory_unit: "OLIGO",
    preferred_code: "NCC-NB-OLIGO",
    name: "Phòng Tổng hợp Oligo",
    short_name: "Phòng Tổng hợp Oligo",
    legacy_names: [
      "Nhà cung cấp tổng hợp Oligo",
      "Phòng Tổng Hợp Oligo",
      "Nhà máy Nội bộ ABT - Tổng hợp Oligo",
      "Tổng hợp Oligo",
    ],
    contact_person: "Phòng Tổng hợp Oligo (Khối Kỹ thuật)",
    phone: "",
    email: "",
    address: "Khối Kỹ thuật & Sản xuất ABT — Phòng Tổng hợp Oligo",
    product_lines: "Tổng hợp Oligo (Primer, Probe, Amplicon & Dịch vụ tinh sạch/điều chế)",
    payment_terms: "Đối soát nội bộ",
    rating: 5,
    notes: "Nhà cung cấp nội bộ mặc định của Phòng Cung ứng Khối Kinh doanh — PO tự động chuyển sang Đơn hàng nội bộ (Phòng Tổng hợp Oligo).",
  },
  {
    factory_unit: "KIT",
    preferred_code: "NCC-NB-KIT",
    name: "Phòng Sản xuất Kit",
    short_name: "Phòng Sản xuất Kit",
    legacy_names: [
      "Phòng SX Kit",
      "Phòng Sản Xuất Kit",
      "Nhà máy Nội bộ ABT - Sản xuất Kit",
      "Sản xuất Kit",
    ],
    contact_person: "Phòng Sản xuất Kit (Khối Kỹ thuật)",
    phone: "",
    email: "",
    address: "Khối Kỹ thuật & Sản xuất ABT — Phòng Sản xuất Kit",
    product_lines: "Kit PCR, Kit tách chiết DNA/RNA, Hóa chất & Vật tư do Phòng Sản xuất cung cấp",
    payment_terms: "Đối soát nội bộ",
    rating: 5,
    notes: "Nhà cung cấp nội bộ mặc định của Phòng Cung ứng Khối Kinh doanh — PO tự động chuyển sang Đơn hàng nội bộ (Phòng Sản xuất Kit).",
  },
  {
    factory_unit: "DEVICE",
    preferred_code: "NCC-NB-DEVICE",
    name: "Phòng Kỹ thuật - Thiết bị",
    short_name: "Phòng Kỹ thuật - Thiết bị",
    legacy_names: [
      "Phòng Kỹ thuật-thiết bị",
      "Phòng Kỹ thuật - Công nghệ",
      "Phòng Kỹ thuật-Công nghệ (thiết bị)",
      "Phòng Kỹ thuật Thiết bị",
      "Kỹ thuật - Thiết bị",
    ],
    contact_person: "Phòng Kỹ thuật - Thiết bị (Khối Kỹ thuật)",
    phone: "",
    email: "",
    address: "Khối Kỹ thuật & Sản xuất ABT — Phòng Kỹ thuật - Thiết bị",
    product_lines: "Thiết bị chẩn đoán, Máy PCR, Máy tách chiết & Phụ kiện thiết bị",
    payment_terms: "Đối soát nội bộ",
    rating: 5,
    notes: "Nhà cung cấp nội bộ mặc định của Phòng Cung ứng Khối Kinh doanh — PO tự động chuyển sang Đơn hàng nội bộ (Phòng Kỹ thuật - Thiết bị).",
  },
] as const;

function foldVi(value?: string | null): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function inferFactoryUnitFromSupplierName(
  name?: string | null,
  shortName?: string | null,
  code?: string | null
): FactoryUnit | null {
  const c = String(code || "").trim().toUpperCase();
  if (c === "NCC-NB-OLIGO" || c === "P-OLIGO") return "OLIGO";
  if (c === "NCC-NB-KIT" || c === "P-KIT") return "KIT";
  if (c === "NCC-NB-DEVICE" || c === "P-DEVICE") return "DEVICE";

  const combined = `${foldVi(name)} ${foldVi(shortName)}`.trim();
  if (!combined) return null;

  for (const spec of DEFAULT_INTERNAL_SUPPLIERS) {
    if (
      foldVi(spec.name) === foldVi(name) ||
      foldVi(spec.short_name) === foldVi(shortName) ||
      spec.legacy_names.some((ln) => foldVi(ln) === foldVi(name) || foldVi(ln) === foldVi(shortName))
    ) {
      return spec.factory_unit;
    }
  }

  if (combined.includes("tong hop oligo") || (combined.includes("phong") && combined.includes("oligo"))) {
    return "OLIGO";
  }
  if (combined.includes("san xuat kit") || combined.includes("sx kit")) {
    return "KIT";
  }
  if (
    combined.includes("ky thuat thiet bi") ||
    combined.includes("ky thuat cong nghe") ||
    (combined.includes("phong ky thuat") && combined.includes("thiet bi"))
  ) {
    return "DEVICE";
  }
  return null;
}

let schemaReady: Promise<void> | null = null;
export function ensureBridgeSchema(): Promise<void> {
  schemaReady ??= query(`
    CREATE TABLE IF NOT EXISTS factory_bridge_supplier (
      supplier_id  integer PRIMARY KEY REFERENCES procurement_suppliers (id),
      factory_unit varchar(10) NOT NULL CHECK (factory_unit IN ('KIT', 'OLIGO', 'DEVICE')),
      updated_at   timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS factory_bridge_po (
      po_id              integer PRIMARY KEY REFERENCES procurement_orders (id),
      po_code            varchar(50) NOT NULL UNIQUE,
      factory_unit       varchar(10) NOT NULL,
      ship_mode          varchar(10) NOT NULL CHECK (ship_mode IN ('TO_KD', 'DROP_SHIP')),
      ship_to            jsonb,
      kd_so_code         varchar(100),
      sent_at            timestamptz NOT NULL DEFAULT now(),
      sent_by            varchar(150),
      factory_order_code varchar(50),
      factory_status     varchar(30) NOT NULL DEFAULT 'SENT',
      committed_date     date,
      reject_reason      text,
      updated_at         timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS factory_bridge_shipment (
      id              uuid PRIMARY KEY,
      po_id           integer NOT NULL REFERENCES procurement_orders (id),
      shipment_code   varchar(50) NOT NULL,
      ship_mode       varchar(10) NOT NULL,
      ship_to         jsonb,
      lines           jsonb NOT NULL,
      status          varchar(20) NOT NULL DEFAULT 'POSTED' CHECK (status IN ('POSTED', 'DELIVERED', 'RECEIVED')),
      proof_file_name text,
      inbound_code    varchar(120),
      received_by     varchar(150),
      created_at      timestamptz NOT NULL DEFAULT now(),
      delivered_at    timestamptz,
      received_at     timestamptz
    );
    CREATE TABLE IF NOT EXISTS factory_bridge_outbox (
      id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      event_type   varchar(60) NOT NULL,
      payload      jsonb NOT NULL,
      created_at   timestamptz NOT NULL DEFAULT now(),
      available_at timestamptz NOT NULL DEFAULT now(),
      processed_at timestamptz,
      attempts     integer NOT NULL DEFAULT 0,
      last_error   text
    );
    CREATE INDEX IF NOT EXISTS factory_bridge_outbox_pending ON factory_bridge_outbox (available_at) WHERE processed_at IS NULL;
    CREATE TABLE IF NOT EXISTS factory_bridge_inbox (
      event_id    uuid PRIMARY KEY,
      event_type  varchar(60) NOT NULL,
      received_at timestamptz NOT NULL DEFAULT now()
    );
  `).then(() => undefined, (e) => {
    schemaReady = null;
    throw e;
  });
  return schemaReady;
}

export const canManageBridge = (u: AuthorizedUser) => isAdminUser(u) || hasPermission(u, "procurement.approve_po");
export const canViewBridge = (u: AuthorizedUser) =>
  isAdminUser(u) || hasPermission(u, "procurement.view") || hasPermission(u, "procurement.approve_po") || hasPermission(u, "warehouse.inbound");
export const canReceive = (u: AuthorizedUser) => isAdminUser(u) || hasPermission(u, "warehouse.inbound");

const APPROVED_PO = ["APPROVED", "CONFIRMED", "ORDERED", "PRODUCED", "SHIPPED", "SHIPPING", "IN_TRANSIT", "DELIVERED", "PARTIALLY_RECEIVED", "PARTIAL_RECEIVED"];

export async function setInternalSupplier(me: AuthorizedUser, supplierId: number, unit: FactoryUnit | null) {
  if (!canManageBridge(me)) throw new HttpError(403, "Cần quyền duyệt PO để khai báo nhà cung cấp nội bộ.");
  await ensureBridgeSchema();
  if (unit && !(unit in FACTORY_UNITS)) throw new HttpError(400, "Phòng sản xuất không hợp lệ.");
  if (unit) {
    await query(
      `INSERT INTO factory_bridge_supplier (supplier_id, factory_unit) VALUES ($1, $2)
       ON CONFLICT (supplier_id) DO UPDATE SET factory_unit = EXCLUDED.factory_unit, updated_at = now()`,
      [supplierId, unit]
    );
  } else {
    await query("DELETE FROM factory_bridge_supplier WHERE supplier_id = $1", [supplierId]);
  }
  await logAudit("FACTORY_SUPPLIER", "PROCUREMENT", `Nhà cung cấp #${supplierId}: ${unit ? `là nội bộ ${FACTORY_UNITS[unit]}` : "bỏ đánh dấu nội bộ"}`);
}

let internalSuppliersEnsuredAt = 0;

/**
 * Đảm bảo 3 nhà cung cấp nội bộ mặc định của Phòng Cung ứng Khối Kinh doanh luôn tồn tại:
 * 1. Phòng Tổng hợp Oligo (`OLIGO`)
 * 2. Phòng Sản xuất Kit (`KIT`)
 * 3. Phòng Kỹ thuật - Thiết bị (`DEVICE`)
 * Đồng thời chuyển đổi bản ghi cũ "Nhà cung cấp tổng hợp Oligo" (nếu có) sang "Phòng Tổng hợp Oligo"
 * và tự động liên kết vào `factory_bridge_supplier`.
 */
export async function ensureDefaultInternalSuppliers(force = false): Promise<Record<FactoryUnit, { id: number; supplier_code: string; name: string }>> {
  await ensureBridgeSchema();
  const now = Date.now();
  if (!force && now - internalSuppliersEnsuredAt < 15_000) {
    const existingRows = (
      await query(
        `SELECT s.id, s.supplier_code, s.name, b.factory_unit
           FROM factory_bridge_supplier b
           JOIN procurement_suppliers s ON s.id = b.supplier_id`
      )
    ).rows;
    if (existingRows.length >= 3) {
      const map = {} as Record<FactoryUnit, { id: number; supplier_code: string; name: string }>;
      for (const r of existingRows) {
        if (r.factory_unit in FACTORY_UNITS && !map[r.factory_unit as FactoryUnit]) {
          map[r.factory_unit as FactoryUnit] = { id: Number(r.id), supplier_code: r.supplier_code, name: r.name };
        }
      }
      if (map.OLIGO && map.KIT && map.DEVICE) return map;
    }
  }

  const seeded = await withTransaction(async (c) => {
    const allSuppliers = (await c.query("SELECT * FROM procurement_suppliers ORDER BY id ASC")).rows;
    const bridgeRows = (await c.query("SELECT supplier_id, factory_unit FROM factory_bridge_supplier")).rows;
    const bridgeByUnit = new Map<FactoryUnit, number>();
    for (const b of bridgeRows) {
      if (b.factory_unit in FACTORY_UNITS && !bridgeByUnit.has(b.factory_unit as FactoryUnit)) {
        bridgeByUnit.set(b.factory_unit as FactoryUnit, Number(b.supplier_id));
      }
    }

    const result = {} as Record<FactoryUnit, { id: number; supplier_code: string; name: string }>;

    for (const spec of DEFAULT_INTERNAL_SUPPLIERS) {
      let matched = allSuppliers.find((s: any) => Number(s.id) === bridgeByUnit.get(spec.factory_unit));
      if (!matched) {
        matched = allSuppliers.find(
          (s: any) =>
            String(s.supplier_code || "").toUpperCase() === spec.preferred_code ||
            foldVi(s.name) === foldVi(spec.name) ||
            foldVi(s.short_name) === foldVi(spec.short_name) ||
            spec.legacy_names.some((ln) => foldVi(ln) === foldVi(s.name) || foldVi(ln) === foldVi(s.short_name))
        );
      }

      if (matched) {
        const oldName = String(matched.name || "");
        const updated = (
          await c.query(
            `UPDATE procurement_suppliers
                SET name = $2,
                    short_name = $3,
                    contact_person = CASE WHEN COALESCE(contact_person, '') IN ('', 'Phòng Kinh Doanh / Cung Ứng') THEN $4 ELSE contact_person END,
                    address = CASE WHEN COALESCE(address, '') = '' THEN $5 ELSE address END,
                    product_lines = CASE WHEN COALESCE(product_lines, '') IN ('', 'Hóa chất & Sinh phẩm, Dịch vụ & Khác', 'Hóa chất & Sinh phẩm') THEN $6 ELSE product_lines END,
                    payment_terms = CASE WHEN COALESCE(payment_terms, '') IN ('', 'Công nợ 30 ngày') THEN $7 ELSE payment_terms END,
                    notes = CASE WHEN COALESCE(notes, '') = '' OR notes LIKE 'Đồng bộ tự động từ Danh mục%' THEN $8 ELSE notes END
              WHERE id = $1
              RETURNING id, supplier_code, name`,
            [
              matched.id,
              spec.name,
              spec.short_name,
              spec.contact_person,
              spec.address,
              spec.product_lines,
              spec.payment_terms,
              spec.notes,
            ]
          )
        ).rows[0];
        matched = updated;

        if (oldName && oldName !== spec.name) {
          await c.query("UPDATE procurement_orders SET supplier_name = $2 WHERE supplier_id = $1 OR supplier_name = $3", [
            matched.id,
            spec.name,
            oldName,
          ]);
          await c.query("UPDATE catalog_items SET supplier = $1 WHERE supplier = $2", [spec.name, oldName]);
        }
      } else {
        const codeTaken = allSuppliers.some((s: any) => String(s.supplier_code || "").toUpperCase() === spec.preferred_code);
        const codeToUse = codeTaken ? `${spec.preferred_code}-${Math.floor(10 + Math.random() * 89)}` : spec.preferred_code;
        const inserted = (
          await c.query(
            `INSERT INTO procurement_suppliers
               (supplier_code, name, short_name, contact_person, phone, email, address, product_lines, payment_terms, rating, notes)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
             RETURNING id, supplier_code, name`,
            [
              codeToUse,
              spec.name,
              spec.short_name,
              spec.contact_person,
              spec.phone,
              spec.email,
              spec.address,
              spec.product_lines,
              spec.payment_terms,
              spec.rating,
              spec.notes,
            ]
          )
        ).rows[0];
        matched = inserted;
        allSuppliers.push(inserted);
      }

      await c.query(
        `INSERT INTO factory_bridge_supplier (supplier_id, factory_unit, updated_at)
         VALUES ($1, $2, now())
         ON CONFLICT (supplier_id) DO UPDATE SET factory_unit = EXCLUDED.factory_unit, updated_at = now()`,
        [matched.id, spec.factory_unit]
      );

      // Cũng tự động gắn factory_bridge_supplier cho các bản ghi nhà cung cấp trùng tên phòng ban nội bộ (nếu có)
      for (const s of allSuppliers) {
        if (Number(s.id) === Number(matched.id)) continue;
        const inferred = inferFactoryUnitFromSupplierName(s.name, s.short_name, s.supplier_code);
        if (inferred === spec.factory_unit) {
          await c.query(
            `INSERT INTO factory_bridge_supplier (supplier_id, factory_unit, updated_at)
             VALUES ($1, $2, now())
             ON CONFLICT (supplier_id) DO UPDATE SET factory_unit = EXCLUDED.factory_unit, updated_at = now()`,
            [s.id, spec.factory_unit]
          );
        }
      }

      result[spec.factory_unit] = {
        id: Number(matched.id),
        supplier_code: matched.supplier_code,
        name: matched.name,
      };
    }

    // Đồng bộ tên nhà cung cấp cũ trong catalog_items sang Phòng Tổng hợp Oligo
    await c.query(
      "UPDATE catalog_items SET supplier = 'Phòng Tổng hợp Oligo' WHERE supplier = 'Nhà cung cấp tổng hợp Oligo'"
    );

    return result;
  });

  internalSuppliersEnsuredAt = now;
  return seeded;
}

/**
 * Tự động chuyển / đồng bộ PO của Phòng Cung ứng Khối Kinh doanh sang Đơn hàng nội bộ (`intake.internal_order`)
 * cho đúng phòng ban liên quan (`OLIGO` — Phòng Tổng hợp Oligo, `KIT` — Phòng Sản xuất Kit, `DEVICE` — Phòng Kỹ thuật - Thiết bị)
 * ngay khi PO được tạo hoặc cập nhật.
 */
export async function syncPoWithFactoryIfInternal(
  poId: number,
  actorName?: string,
  opts?: {
    ship_mode?: "TO_KD" | "DROP_SHIP";
    ship_to?: { name?: string; address?: string; receiver?: string; phone?: string } | null;
    kd_so_code?: string | null;
  }
): Promise<{
  synced: boolean;
  factory_unit?: FactoryUnit;
  department_name?: string;
  factory_order_code?: string | null;
  factory_status?: string | null;
}> {
  await ensureBridgeSchema();
  const defaultMap = await ensureDefaultInternalSuppliers();

  const txInfo = await withTransaction(async (c) => {
    const po = (await c.query("SELECT * FROM procurement_orders WHERE id = $1 FOR UPDATE", [poId])).rows[0];
    if (!po) return null;

    let supplierRow: any = null;
    if (po.supplier_id) {
      supplierRow = (await c.query("SELECT * FROM procurement_suppliers WHERE id = $1", [po.supplier_id])).rows[0] || null;
    }
    if (!supplierRow && po.supplier_name) {
      supplierRow =
        (
          await c.query(
            "SELECT * FROM procurement_suppliers WHERE lower(name) = lower($1) OR lower(short_name) = lower($1) ORDER BY id ASC LIMIT 1",
            [String(po.supplier_name).trim()]
          )
        ).rows[0] || null;
    }

    let factoryUnit: FactoryUnit | null = null;
    if (po.supplier_id) {
      const bridgeSup = (
        await c.query("SELECT factory_unit FROM factory_bridge_supplier WHERE supplier_id = $1", [po.supplier_id])
      ).rows[0];
      if (bridgeSup?.factory_unit && bridgeSup.factory_unit in FACTORY_UNITS) {
        factoryUnit = bridgeSup.factory_unit as FactoryUnit;
      }
    }

    if (!factoryUnit) {
      factoryUnit = inferFactoryUnitFromSupplierName(
        po.supplier_name || supplierRow?.name,
        supplierRow?.short_name,
        supplierRow?.supplier_code
      );
    }

    if (!factoryUnit) {
      return null;
    }

    const canonicalSup = defaultMap[factoryUnit];
    const targetSupplierId = supplierRow?.id ? Number(supplierRow.id) : canonicalSup?.id;
    const targetSupplierName = canonicalSup?.name || FACTORY_UNITS[factoryUnit];

    if (targetSupplierId && (!po.supplier_id || po.supplier_name === "Nhà cung cấp tổng hợp Oligo")) {
      await c.query(
        "UPDATE procurement_orders SET supplier_id = COALESCE(supplier_id, $2), supplier_name = $3 WHERE id = $1",
        [poId, targetSupplierId, targetSupplierName]
      );
      po.supplier_id = po.supplier_id || targetSupplierId;
      po.supplier_name = targetSupplierName;
    }
    if (po.supplier_id) {
      await c.query(
        `INSERT INTO factory_bridge_supplier (supplier_id, factory_unit, updated_at)
         VALUES ($1, $2, now())
         ON CONFLICT (supplier_id) DO UPDATE SET factory_unit = EXCLUDED.factory_unit, updated_at = now()`,
        [po.supplier_id, factoryUnit]
      );
    }

    const existingBridgePo = (await c.query("SELECT * FROM factory_bridge_po WHERE po_id = $1 FOR UPDATE", [poId])).rows[0];
    const poStatusUpper = String(po.status || "PENDING").toUpperCase();

    if (poStatusUpper === "CANCELLED") {
      if (existingBridgePo) {
        await c.query("INSERT INTO factory_bridge_outbox (event_type, payload) VALUES ('KdPoCancelled', $1)", [
          JSON.stringify({ kd_po_code: po.po_code, reason: "Hủy đơn PO từ Phòng Cung ứng Khối Kinh doanh" }),
        ]);
        await c.query(
          "UPDATE factory_bridge_po SET factory_status = 'CANCEL_REQUESTED', updated_at = now() WHERE po_id = $1",
          [poId]
        );
      }
      return { po_code: String(po.po_code), factory_unit: factoryUnit, cancelled: true };
    }

    let items = po.items;
    if (typeof items === "string") {
      try {
        items = JSON.parse(items);
      } catch {
        items = [];
      }
    }
    const rawItems = Array.isArray(items) ? items : [];
    const lines = rawItems
      .map((it: any, i: number) => ({
        line_index: i,
        product_code: String(it.product_code || it.sku || it.code || `ITEM-${i + 1}`).trim(),
        product_name: it.product_name || it.name || null,
        unit: it.unit || (factoryUnit === "OLIGO" ? "tube" : factoryUnit === "DEVICE" ? "Cái" : "Hộp"),
        quantity: Number(it.quantity) || 0,
        unit_price: Number(it.unit_price) || 0,
      }))
      .filter((l) => l.product_code && l.quantity > 0);

    if (!lines.length) {
      return null;
    }

    let kdSoCode = opts?.kd_so_code || existingBridgePo?.kd_so_code || null;
    if (!kdSoCode) {
      const itemWithSo = rawItems.find((it: any) => it?.order_code || it?.so_code);
      if (itemWithSo) kdSoCode = String(itemWithSo.order_code || itemWithSo.so_code).trim();
    }
    if (!kdSoCode && po.notes) {
      const m = String(po.notes).match(/\b(SO\d{2}-[A-Z0-9-]+|SO-[A-Z0-9-]+)\b/i);
      if (m) kdSoCode = m[1].toUpperCase();
    }

    const shipMode: "TO_KD" | "DROP_SHIP" =
      opts?.ship_mode || (existingBridgePo?.ship_mode === "DROP_SHIP" ? "DROP_SHIP" : "TO_KD");
    const shipTo =
      shipMode === "DROP_SHIP" ? opts?.ship_to || existingBridgePo?.ship_to || null : null;
    const requestedDate =
      po.expected_delivery_date && /^\d{4}-\d{2}-\d{2}/.test(String(po.expected_delivery_date))
        ? String(po.expected_delivery_date).slice(0, 10)
        : null;

    await c.query(
      `INSERT INTO factory_bridge_po (po_id, po_code, factory_unit, ship_mode, ship_to, kd_so_code, sent_by, factory_status, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'SENT', now())
       ON CONFLICT (po_id) DO UPDATE
         SET factory_unit = EXCLUDED.factory_unit,
             ship_mode = EXCLUDED.ship_mode,
             ship_to = COALESCE(EXCLUDED.ship_to, factory_bridge_po.ship_to),
             kd_so_code = COALESCE(EXCLUDED.kd_so_code, factory_bridge_po.kd_so_code),
             updated_at = now()`,
      [
        poId,
        po.po_code,
        factoryUnit,
        shipMode,
        shipTo ? JSON.stringify(shipTo) : null,
        kdSoCode,
        actorName || po.created_by || "Cung Ứng KD",
      ]
    );

    await c.query("INSERT INTO factory_bridge_outbox (event_type, payload) VALUES ('KdPoIssued', $1)", [
      JSON.stringify({
        kd_po_id: Number(poId),
        kd_po_code: String(po.po_code),
        factory_unit: factoryUnit,
        ship_mode: shipMode,
        ship_to: shipTo,
        kd_so_code: kdSoCode,
        requested_date: requestedDate,
        notes: po.notes || null,
        lines,
      }),
    ]);

    return { po_code: String(po.po_code), factory_unit: factoryUnit, cancelled: false };
  });

  if (!txInfo) {
    return { synced: false };
  }

  await dispatchKdOutbox();

  const summary = await getFactoryInternalOrderSummary(txInfo.po_code).catch(() => null);
  if (summary) {
    await query(
      `UPDATE factory_bridge_po
          SET factory_order_code = $2,
              factory_status = $3,
              committed_date = COALESCE($4::date, committed_date),
              updated_at = now()
        WHERE po_id = $1`,
      [poId, summary.code, summary.status, summary.committed_date]
    );
  }

  return {
    synced: true,
    factory_unit: txInfo.factory_unit,
    department_name: FACTORY_UNITS[txInfo.factory_unit],
    factory_order_code: summary?.code ?? null,
    factory_status: summary?.status ?? "RECEIVED",
  };
}

interface SendInput {
  ship_mode: "TO_KD" | "DROP_SHIP";
  ship_to?: { name?: string; address?: string; receiver?: string; phone?: string } | null;
  kd_so_code?: string | null;
  notes?: string | null;
}

/** Sends an approved PO of an internal supplier to the factory, once. */
export async function sendPoToFactory(me: AuthorizedUser, poId: number, input: SendInput) {
  if (!canManageBridge(me)) throw new HttpError(403, "Cần quyền duyệt PO để gửi đơn cho nhà máy.");
  await ensureBridgeSchema();
  if (!["TO_KD", "DROP_SHIP"].includes(input.ship_mode)) throw new HttpError(400, "Chọn hình thức giao: về kho Kinh doanh hoặc giao thẳng khách.");
  if (input.ship_mode === "DROP_SHIP" && (!input.ship_to?.name?.trim() || !input.ship_to?.address?.trim())) {
    throw new HttpError(400, "Giao thẳng: nhập tên khách hàng và địa chỉ giao.");
  }
  const result = await withTransaction(async (c) => {
    const po = (await c.query("SELECT * FROM procurement_orders WHERE id = $1 FOR UPDATE", [poId])).rows[0];
    if (!po) throw new HttpError(404, "Không tìm thấy đơn PO.");
    const sup = (await c.query("SELECT factory_unit FROM factory_bridge_supplier WHERE supplier_id = $1", [po.supplier_id])).rows[0];
    if (!sup) throw new HttpError(409, "Nhà cung cấp của PO này chưa được khai báo là nhà máy nội bộ.");
    if (!APPROVED_PO.includes(String(po.status || "").toUpperCase())) throw new HttpError(409, `PO ${po.po_code} chưa được duyệt (trạng thái ${po.status}).`);
    if ((await c.query("SELECT 1 FROM factory_bridge_po WHERE po_id = $1", [poId])).rowCount) throw new HttpError(409, `PO ${po.po_code} đã được gửi cho nhà máy.`);
    let items = po.items;
    if (typeof items === "string") items = JSON.parse(items);
    const lines = (Array.isArray(items) ? items : []).map((it: any, i: number) => ({
      line_index: i,
      product_code: String(it.product_code || "").trim(),
      product_name: it.product_name || null,
      unit: it.unit || null,
      quantity: Number(it.quantity) || 0,
      unit_price: Number(it.unit_price) || 0,
    }));
    if (!lines.length || lines.some((l) => !l.product_code || !(l.quantity > 0))) throw new HttpError(400, "Mỗi dòng PO cần mã hàng và số lượng > 0.");
    const shipTo = input.ship_mode === "DROP_SHIP" ? input.ship_to : null;
    await c.query(
      "INSERT INTO factory_bridge_po (po_id, po_code, factory_unit, ship_mode, ship_to, kd_so_code, sent_by) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      [poId, po.po_code, sup.factory_unit, input.ship_mode, shipTo ? JSON.stringify(shipTo) : null, input.kd_so_code || null, me.full_name || me.username]
    );
    await c.query("INSERT INTO factory_bridge_outbox (event_type, payload) VALUES ('KdPoIssued', $1)", [
      JSON.stringify({
        kd_po_id: poId,
        kd_po_code: po.po_code,
        factory_unit: sup.factory_unit,
        ship_mode: input.ship_mode,
        ship_to: shipTo,
        kd_so_code: input.kd_so_code || null,
        requested_date: po.expected_delivery_date ? String(po.expected_delivery_date).slice(0, 10) : null,
        notes: input.notes || po.notes || null,
        lines,
      }),
    ]);
    return po.po_code as string;
  });
  await logAudit("FACTORY_PO_SENT", "PROCUREMENT", `Gửi PO ${result} cho nhà máy (${input.ship_mode === "DROP_SHIP" ? "giao thẳng khách" : "giao về kho KD"})`);
  void dispatchKdOutbox().catch(() => {});
  return { po_code: result };
}

/** Tells the factory a sent PO was cancelled on the Kinh doanh side. */
export async function notifyPoCancelled(me: AuthorizedUser, poId: number, reason: string) {
  if (!canManageBridge(me)) throw new HttpError(403, "Cần quyền duyệt PO.");
  await ensureBridgeSchema();
  await withTransaction(async (c) => {
    const bp = (await c.query("SELECT b.po_code, p.status FROM factory_bridge_po b JOIN procurement_orders p ON p.id = b.po_id WHERE b.po_id = $1 FOR UPDATE OF b", [poId])).rows[0];
    if (!bp) throw new HttpError(404, "PO chưa được gửi cho nhà máy.");
    if (String(bp.status).toUpperCase() !== "CANCELLED") throw new HttpError(409, "Hủy PO trên màn hình Đơn PO trước, rồi mới báo hủy cho nhà máy.");
    await c.query("INSERT INTO factory_bridge_outbox (event_type, payload) VALUES ('KdPoCancelled', $1)", [JSON.stringify({ kd_po_code: bp.po_code, reason })]);
    await c.query("UPDATE factory_bridge_po SET factory_status = 'CANCEL_REQUESTED', updated_at = now() WHERE po_id = $1", [poId]);
  });
  void dispatchKdOutbox().catch(() => {});
}

/**
 * Marks a factory shipment received, after the goods were booked with the normal PO receipt using the
 * shipment id as request id (so the receipt can be found and is never booked twice).
 */
export async function acknowledgeShipment(me: AuthorizedUser, shipmentId: string) {
  if (!canReceive(me)) throw new HttpError(403, "Cần quyền nhập kho.");
  await ensureBridgeSchema();
  await withTransaction(async (c) => {
    const s = (await c.query("SELECT s.*, b.po_code FROM factory_bridge_shipment s JOIN factory_bridge_po b ON b.po_id = s.po_id WHERE s.id = $1 FOR UPDATE OF s", [shipmentId])).rows[0];
    if (!s) throw new HttpError(404, "Không tìm thấy phiếu giao của nhà máy.");
    if (s.status === "RECEIVED") return;
    if (s.ship_mode === "DROP_SHIP" && s.status !== "DELIVERED") throw new HttpError(409, "Giao thẳng: chờ nhà máy xác nhận đã giao khách (có biên bản ký) rồi mới ghi nhận.");
    const inbound = (
      await c.query(
        "SELECT transaction_code FROM inventory_transactions WHERE transaction_type = 'INBOUND' AND reference_code = $1 AND notes LIKE $2 LIMIT 1",
        [s.po_code, `%[req:${shipmentId}]%`]
      )
    ).rows[0];
    if (!inbound) throw new HttpError(409, "Chưa có phiếu nhập kho cho lô hàng này. Hãy bấm Nhập kho trước.");
    await c.query("UPDATE factory_bridge_shipment SET status = 'RECEIVED', inbound_code = $2, received_by = $3, received_at = now() WHERE id = $1", [
      shipmentId,
      inbound.transaction_code,
      me.full_name || me.username,
    ]);
    await c.query("INSERT INTO factory_bridge_outbox (event_type, payload) VALUES ('KdShipmentAcknowledged', $1)", [
      JSON.stringify({ shipment_id: shipmentId, inbound_code: inbound.transaction_code }),
    ]);
  });
  void dispatchKdOutbox().catch(() => {});
}

/** Applies a factory event here, at most once (factory_bridge_inbox). */
export async function applyFactoryEvent(event: BridgeEvent): Promise<void> {
  await ensureBridgeSchema();
  await withTransaction(async (c) => {
    const fresh = await c.query("INSERT INTO factory_bridge_inbox (event_id, event_type) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING event_id", [event.event_id, event.event_type]);
    if (!fresh.rowCount) return;
    const p = event.payload;
    const bp = (await c.query("SELECT po_id FROM factory_bridge_po WHERE po_code = $1 FOR UPDATE", [p.kd_po_code])).rows[0];
    if (!bp) throw new Error(`PO ${p.kd_po_code} không có trong danh sách đã gửi nhà máy`);
    switch (event.event_type) {
      case "FactoryOrderAccepted":
        await c.query("UPDATE factory_bridge_po SET factory_order_code = $2, factory_status = 'ACCEPTED', committed_date = $3, updated_at = now() WHERE po_id = $1", [bp.po_id, p.order_code, p.committed_date]);
        break;
      case "FactoryOrderRejected":
        await c.query("UPDATE factory_bridge_po SET factory_order_code = $2, factory_status = 'REJECTED', reject_reason = $3, updated_at = now() WHERE po_id = $1", [bp.po_id, p.order_code, p.reason]);
        break;
      case "FactoryOrderProgress":
        await c.query(
          "UPDATE factory_bridge_po SET factory_order_code = COALESCE($4, factory_order_code), factory_status = $2, committed_date = COALESCE($3, committed_date), updated_at = now() WHERE po_id = $1",
          [bp.po_id, p.status, p.committed_date ?? null, p.order_code ?? null]
        );
        break;
      case "FactoryShipmentPosted":
        await c.query(
          `INSERT INTO factory_bridge_shipment (id, po_id, shipment_code, ship_mode, ship_to, lines) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`,
          [p.shipment_id, bp.po_id, p.shipment_code, p.ship_mode, p.ship_to ? JSON.stringify(p.ship_to) : null, JSON.stringify(p.lines)]
        );
        break;
      case "FactoryShipmentDelivered":
        await c.query("UPDATE factory_bridge_shipment SET status = 'DELIVERED', proof_file_name = $2, delivered_at = now() WHERE id = $1 AND status = 'POSTED'", [p.shipment_id, p.proof_file_name]);
        break;
      default:
        throw new Error(`Loại sự kiện không hỗ trợ: ${event.event_type}`);
    }
  });
}

let dispatching = false;
/** Sends pending Kinh doanh → factory messages; failures are retried with growing delay. */
export async function dispatchKdOutbox(limit = 50): Promise<number> {
  if (dispatching) return 0;
  dispatching = true;
  let sent = 0;
  try {
    await ensureBridgeSchema();
    for (let i = 0; i < limit; i++) {
      const done = await withTransaction(async (c) => {
        const ev = (
          await c.query(
            "SELECT id, event_type, payload, attempts FROM factory_bridge_outbox WHERE processed_at IS NULL AND available_at <= now() AND attempts < 20 ORDER BY available_at, id LIMIT 1 FOR UPDATE SKIP LOCKED"
          )
        ).rows[0];
        if (!ev) return null;
        try {
          await handleKdEvent({ event_id: ev.id, event_type: ev.event_type, payload: ev.payload });
          await c.query("UPDATE factory_bridge_outbox SET processed_at = now(), attempts = attempts + 1, last_error = NULL WHERE id = $1", [ev.id]);
          return true;
        } catch (e: any) {
          await c.query(
            "UPDATE factory_bridge_outbox SET attempts = attempts + 1, last_error = $2, available_at = now() + make_interval(secs => least(3600, 15 * power(2, attempts))) WHERE id = $1",
            [ev.id, String(e?.message ?? e).slice(0, 2000)]
          );
          return false;
        }
      });
      if (done === null) break;
      if (done) sent++;
    }
  } finally {
    dispatching = false;
  }
  return sent;
}

/** Internal suppliers, sent POs with the factory's status, and shipments waiting to be received. */
export async function bridgeOverview(me: AuthorizedUser) {
  if (!canViewBridge(me)) throw new HttpError(403, "Không có quyền xem đơn nhà máy.");
  await ensureBridgeSchema();
  const [suppliers, internal, pos, shipments, pending] = await Promise.all([
    query("SELECT id, supplier_code, name FROM procurement_suppliers ORDER BY name"),
    query("SELECT supplier_id, factory_unit FROM factory_bridge_supplier"),
    query(
      `SELECT p.id, p.po_code, p.status, p.supplier_name, p.order_date, p.expected_delivery_date, p.items, b.factory_unit, b.ship_mode, b.ship_to, b.kd_so_code,
              b.sent_at, b.factory_order_code, b.factory_status, b.committed_date, b.reject_reason, (b.po_id IS NOT NULL) AS sent
         FROM procurement_orders p JOIN factory_bridge_supplier s ON s.supplier_id = p.supplier_id
         LEFT JOIN factory_bridge_po b ON b.po_id = p.id
        ORDER BY p.id DESC LIMIT 200`
    ),
    query("SELECT s.*, b.po_code FROM factory_bridge_shipment s JOIN factory_bridge_po b ON b.po_id = s.po_id ORDER BY s.created_at DESC LIMIT 200"),
    query("SELECT count(*)::int AS n, max(last_error) AS last_error FROM factory_bridge_outbox WHERE processed_at IS NULL"),
  ]);
  return { units: FACTORY_UNITS, suppliers: suppliers.rows, internal: internal.rows, pos: pos.rows, shipments: shipments.rows, outbox_pending: pending.rows[0] };
}
