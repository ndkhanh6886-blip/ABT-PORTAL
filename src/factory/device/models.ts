import { z } from "zod";
import type { Tx } from "../core/db";
import { writeAudit } from "../core/audit";
import { authorize, authorizeAnywhere, hasFactoryPermission, type AuthzActor } from "../core/authz";
import { conflict, invalid, notFound } from "../core/errors";
import { nextNumber } from "../core/numbering";
import { insertRecord, parseInput, updateRecord } from "../core/records";
import { defineMachine, listAllowedActions, runTransition } from "../core/stateMachine";
import {
  LEGACY_EQUIPMENT_CATALOG_SEED,
  LEGACY_TECH_PARTS_SEED,
  type LegacyEquipmentBOMItem,
} from "./legacyCatalogSeed";
import "./permissions";

export type ModelStatus = "DEVELOPMENT" | "COMMERCIAL" | "DISCONTINUED";
export type RevisionStatus = "DRAFT" | "RELEASED" | "OBSOLETE";
export type EcoStatus =
  | "DRAFT"
  | "IMPACT_ASSESSMENT"
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "REJECTED"
  | "IMPLEMENTED"
  | "CLOSED";

export interface DeviceModelRow {
  id: string;
  code: string;
  name: string;
  org_unit_id: string;
  item_id: string | null;
  category: string;
  current_revision_id: string | null;
  warranty_months: number;
  required_burn_in_hours: string;
  fqc_spec_id: string | null;
  rd_project_id: string | null;
  description: string | null;
  specs_json?: Record<string, unknown>;
  accessories_standard?: unknown[];
  accessories_optional?: unknown[];
  status: ModelStatus;
  version: number;
}

export interface ModelRevisionRow {
  id: string;
  model_id: string;
  revision: string;
  firmware_version: string | null;
  firmware_release_id?: string | null;
  dmr_summary: string;
  dmr_attachment_id: string | null;
  eco_request_id: string | null;
  effectivity_type: "IMMEDIATE" | "FROM_DATE" | "FROM_SERIAL";
  effectivity_value: string | null;
  released_by: number | null;
  released_at: string | null;
  status: RevisionStatus;
  version: number;
  created_by: number | null;
}

export interface EcoRequestRow {
  id: string;
  code: string;
  model_id: string;
  target_revision: string;
  title: string;
  reason: string;
  change_summary: string;
  impact_documents: string | null;
  impact_training: string | null;
  impact_stock: string | null;
  impact_open_orders: string | null;
  impact_regulatory: string | null;
  effectivity_type: "IMMEDIATE" | "FROM_DATE" | "FROM_SERIAL";
  effectivity_value: string | null;
  proposer_id: number;
  approved_by: number | null;
  approved_at: string | null;
  implemented_by: number | null;
  implemented_at: string | null;
  closed_by: number | null;
  closed_at: string | null;
  verification_note: string | null;
  status: EcoStatus;
  version: number;
}

async function modelOwner(tx: Tx, modelId: string): Promise<string> {
  const m = (await tx.query("SELECT org_unit_id FROM device.device_model WHERE id = $1", [modelId])).rows[0];
  if (!m) throw notFound("model thiết bị");
  return m.org_unit_id;
}

/**
 * Model Revision (DMR) state machine (docs/nha-may/02 §10.6):
 * DRAFT → RELEASED ✍ → OBSOLETE.
 * Releasing a revision automatically marks any prior RELEASED revision of the same model as OBSOLETE
 * before the unique index `model_revision_one_released` is checked, and sets `device_model.current_revision_id`.
 */
export const modelRevisionMachine = defineMachine<RevisionStatus, ModelRevisionRow>({
  entityType: "device_model_revision",
  table: "device.model_revision",
  states: ["DRAFT", "RELEASED", "OBSOLETE"],
  terminal: ["OBSOLETE"],
  scopeOf: (row, tx) => modelOwner(tx!, row.model_id),
  transitions: [
    {
      action: "release",
      from: "DRAFT",
      to: "RELEASED",
      permission: "device.model.manage",
      signature: "APPROVED",
      guards: [
        {
          code: "SELF_APPROVAL",
          message: "Người tạo phiên bản thiết kế (DMR) không được tự ký phê duyệt phát hành.",
          check: ({ row, actor }) => Boolean(actor.isRootAdmin || row.created_by == null || row.created_by !== actor.userId),
        },
        {
          code: "BOM_REQUIRED",
          message: "Phiên bản thiết kế (DMR) phải có ít nhất 1 dòng cấu trúc linh kiện (BOM) trước khi phát hành.",
          check: async ({ tx, row }) => {
            const b = await tx.query("SELECT 1 FROM device.model_bom_line WHERE revision_id = $1 LIMIT 1", [row.id]);
            return (b.rowCount ?? 0) > 0;
          },
        },
        {
          code: "FIRMWARE_RELEASE_NOT_APPROVED",
          message: "Bản phát hành phần mềm/Firmware liên kết (IEC 62304) phải ở trạng thái Đã phát hành (RELEASED).",
          check: async ({ tx, row }) => {
            if (!row.firmware_release_id) return true;
            const sw = (await tx.query("SELECT status FROM rd.software_release WHERE id = $1", [row.firmware_release_id])).rows[0];
            return sw?.status === "RELEASED";
          },
        },
      ],
      beforeUpdate: async ({ tx, actor, row }) => {
        const priors = (
          await tx.query(
            `SELECT id, version FROM device.model_revision
              WHERE model_id = $1 AND id <> $2 AND status = 'RELEASED' FOR UPDATE`,
            [row.model_id, row.id]
          )
        ).rows;
        for (const p of priors) {
          await runTransition(
            tx,
            modelRevisionMachine,
            actor,
            {
              id: p.id,
              action: "obsolete",
              expectedVersion: p.version,
              reason: `Thay thế bởi phiên bản thiết kế mới ${row.revision}`,
            },
            { trusted: true }
          );
        }
      },
      patch: ({ actor }) => ({ released_by: actor.userId, released_at: new Date() }),
      effects: async ({ tx, actor, updated }) => {
        await tx.query(
          `UPDATE device.device_model
              SET current_revision_id = $2,
                  status = CASE WHEN status = 'DEVELOPMENT' THEN 'COMMERCIAL' ELSE status END,
                  version = version + 1, updated_at = now(), updated_by = $3
            WHERE id = $1`,
          [updated.model_id, updated.id, actor.userId]
        );
      },
    },
    {
      action: "obsolete",
      from: "RELEASED",
      to: "OBSOLETE",
      permission: "device.model.manage",
      reasonRequired: true,
    },
  ],
});

/**
 * Engineering Change Order (ECO) state machine (docs/nha-may/02 §4.5 & §10.6):
 * DRAFT → IMPACT_ASSESSMENT → PENDING_APPROVAL → APPROVED ✍ | REJECTED 📝 → IMPLEMENTED → CLOSED.
 * - Moving IMPACT_ASSESSMENT → PENDING_APPROVAL requires all 5 impact assessment dimensions to be documented.
 * - Moving APPROVED → IMPLEMENTED atomically releases the target `model_revision` and obsoletes the old one.
 */
export const ecoMachine = defineMachine<EcoStatus, EcoRequestRow>({
  entityType: "device_eco",
  table: "device.eco_request",
  states: ["DRAFT", "IMPACT_ASSESSMENT", "PENDING_APPROVAL", "APPROVED", "REJECTED", "IMPLEMENTED", "CLOSED"],
  terminal: ["REJECTED", "CLOSED"],
  scopeOf: (row, tx) => modelOwner(tx!, row.model_id),
  transitions: [
    {
      action: "start_impact",
      from: "DRAFT",
      to: "IMPACT_ASSESSMENT",
      permission: "device.eco.propose",
    },
    {
      action: "submit_approval",
      from: "IMPACT_ASSESSMENT",
      to: "PENDING_APPROVAL",
      permission: "device.eco.propose",
      guards: [
        {
          code: "IMPACT_INCOMPLETE",
          message:
            "Phải điền đầy đủ 5 mục đánh giá ảnh hưởng (Tài liệu DMR/SOP, Đào tạo, Tồn kho linh kiện, Lệnh lắp ráp đang chạy, Hồ sơ đăng ký lưu hành) trước khi trình duyệt ECO.",
          check: ({ row }) =>
            Boolean(
              row.impact_documents?.trim() &&
                row.impact_training?.trim() &&
                row.impact_stock?.trim() &&
                row.impact_open_orders?.trim() &&
                row.impact_regulatory?.trim()
            ),
        },
      ],
    },
    {
      action: "approve",
      from: "PENDING_APPROVAL",
      to: "APPROVED",
      permission: "device.eco.approve",
      signature: "APPROVED",
      guards: [
        {
          code: "SELF_APPROVAL",
          message: "Người phê duyệt thay đổi kỹ thuật (ECO) phải khác người đề xuất.",
          check: ({ actor, row }) => row.proposer_id !== actor.userId,
        },
      ],
      patch: ({ actor }) => ({ approved_by: actor.userId, approved_at: new Date() }),
    },
    {
      action: "reject",
      from: ["IMPACT_ASSESSMENT", "PENDING_APPROVAL"],
      to: "REJECTED",
      permission: "device.eco.approve",
      reasonRequired: true,
    },
    {
      action: "implement",
      from: "APPROVED",
      to: "IMPLEMENTED",
      permission: "device.eco.approve",
      guards: [
        {
          code: "TARGET_REVISION_MISSING",
          message: "Cần tạo bản nháp phiên bản thiết kế (Model Revision) tương ứng với target_revision và có BOM trước khi ban hành hiệu lực ECO.",
          check: async ({ tx, row }) => {
            const rev = (
              await tx.query(
                "SELECT id FROM device.model_revision WHERE model_id = $1 AND revision = $2",
                [row.model_id, row.target_revision]
              )
            ).rows[0];
            if (!rev) return false;
            const bom = await tx.query("SELECT 1 FROM device.model_bom_line WHERE revision_id = $1 LIMIT 1", [rev.id]);
            return (bom.rowCount ?? 0) > 0;
          },
        },
      ],
      patch: ({ actor }) => ({ implemented_by: actor.userId, implemented_at: new Date() }),
      effects: async ({ tx, actor, updated }) => {
        // Supersede previous RELEASED revision first so the partial unique index is satisfied
        await tx.query(
          `UPDATE device.model_revision
              SET status = 'OBSOLETE', version = version + 1, updated_at = now(), updated_by = $2
            WHERE model_id = $1 AND status = 'RELEASED'`,
          [updated.model_id, actor.userId]
        );
        const rev = (
          await tx.query(
            `UPDATE device.model_revision
                SET status = 'RELEASED', eco_request_id = $3, effectivity_type = $4, effectivity_value = $5,
                    released_by = $6, released_at = now(), version = version + 1, updated_at = now(), updated_by = $6
              WHERE model_id = $1 AND revision = $2
              RETURNING id`,
            [
              updated.model_id,
              updated.target_revision,
              updated.id,
              updated.effectivity_type,
              updated.effectivity_value,
              actor.userId,
            ]
          )
        ).rows[0];
        await tx.query(
          `UPDATE device.device_model
              SET current_revision_id = $2,
                  status = CASE WHEN status = 'DEVELOPMENT' THEN 'COMMERCIAL' ELSE status END,
                  version = version + 1, updated_at = now(), updated_by = $3
            WHERE id = $1`,
          [updated.model_id, rev.id, actor.userId]
        );
      },
    },
    {
      action: "close",
      from: "IMPLEMENTED",
      to: "CLOSED",
      permission: "device.eco.approve",
      guards: [
        {
          code: "VERIFICATION_REQUIRED",
          message: "Nhập kết quả xác minh sau triển khai ECO (verification_note) trước khi đóng.",
          check: ({ row, payload }) => Boolean((payload.verification_note as string)?.trim() || row.verification_note?.trim()),
        },
      ],
      patch: ({ actor, row, payload }) => ({
        verification_note: ((payload.verification_note as string)?.trim() || row.verification_note) ?? null,
        closed_by: actor.userId,
        closed_at: new Date(),
      }),
    },
  ],
});

const createModelSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{2,30}$/, "Mã model gồm chữ, số, gạch ngang")
    .transform((s) => s.toUpperCase())
    .optional(),
  name: z.string().trim().min(3, "nhập tên model thiết bị").max(250),
  org_unit_id: z.string().uuid("chọn phòng Kỹ thuật – Công nghệ").optional(),
  item_id: z.string().uuid().optional().nullable(),
  category: z
    .enum(["THERMAL_CYCLER", "EXTRACTOR", "CENTRIFUGE", "SPIN_COLUMN_SYSTEM", "INCUBATOR", "SPECTROPHOTOMETER", "OTHER"])
    .default("THERMAL_CYCLER"),
  category_label: z.string().trim().max(150).optional().nullable(),
  manufacturer: z.string().trim().max(250).optional().nullable(),
  origin: z.string().trim().max(120).optional().nullable(),
  price: z.coerce.number().min(0).default(0),
  price_dealer1: z.coerce.number().min(0).default(0),
  price_dealer2: z.coerce.number().min(0).default(0),
  lead_time_days: z.coerce.number().int().min(1).max(365).default(14),
  image_url: z.string().trim().max(1000).optional().nullable(),
  warranty_months: z.coerce.number().int().min(0).max(120).default(12),
  required_burn_in_hours: z.coerce.number().min(0).max(500).default(48),
  fqc_spec_id: z.string().uuid().optional().nullable(),
  rd_project_id: z.string().uuid().optional().nullable(),
  description: z.string().trim().max(3000).optional().nullable(),
  specs_json: z.record(z.string(), z.unknown()).optional(),
  baseline_specs_json: z.record(z.string(), z.unknown()).optional(),
  accessories_standard: z.array(z.unknown()).optional(),
  accessories_optional: z.array(z.unknown()).optional(),
  production_stages: z.array(z.string()).optional(),
  bom_json: z.array(z.unknown()).optional(),
  revision: z.string().trim().max(16).optional(),
  firmware_version: z.string().trim().max(60).optional().nullable(),
});

function mapUnitToBaseUom(unit?: string | null): string {
  const u = (unit ?? "").trim().toLowerCase();
  if (u === "bộ" || u === "set") return "set";
  if (u === "khay" || u === "plate") return "plate";
  if (u === "hộp" || u === "box") return "box";
  if (u === "mét" || u === "m") return "m";
  return "pcs";
}

function mapStationToCode(station?: string | null): "STATION_1_MECH" | "STATION_2_PCB" | "STATION_3_FW" | "STATION_4_FQC" {
  const s = (station ?? "").trim();
  if (s === "STATION_1_MECH" || s === "STATION_2_PCB" || s === "STATION_3_FW" || s === "STATION_4_FQC") {
    return s;
  }
  if (s.startsWith("1") || /cơ khí|vỏ máy|khung/i.test(s)) return "STATION_1_MECH";
  if (s.startsWith("2") || /gia nhiệt|quang học|cảm biến/i.test(s)) return "STATION_2_PCB";
  if (s.startsWith("3") || /điện|bo mạch|pcb/i.test(s)) return "STATION_2_PCB";
  if (s.startsWith("4") || /firmware|burn-in|hiệu chuẩn|fqc/i.test(s)) return "STATION_4_FQC";
  return "STATION_1_MECH";
}

let catalogSeededInProcess = false;

export async function ensureTechCatalogAndBomSeeded(tx: Tx) {
  if (process.env.FACTORY_ALLOW_DEMO_SEED !== "1") {
    catalogSeededInProcess = true;
    return;
  }

  if (catalogSeededInProcess) {
    const checkCnt = (await tx.query("SELECT count(*)::int AS cnt FROM device.device_model WHERE price > 0")).rows[0]?.cnt ?? 0;
    if (checkCnt >= 25) return;
  }

  // Find default Device Engineering org_unit
  let orgUnitId = (
    await tx.query(
      "SELECT id FROM core.org_unit WHERE code IN ('P-DEVICE', 'P-KT', 'DEVICE', 'TECH') AND status = 'ACTIVE' ORDER BY code LIMIT 1"
    )
  ).rows[0]?.id as string | undefined;
  if (!orgUnitId) {
    orgUnitId = (await tx.query("SELECT id FROM core.org_unit WHERE status = 'ACTIVE' ORDER BY code LIMIT 1")).rows[0]?.id;
  }
  if (!orgUnitId) return;

  // Find or create Device Parts warehouse + default location so parts have real on-hand stock
  let whId = (
    await tx.query(
      "SELECT id FROM master.warehouse WHERE (purpose = 'DEVICE_PARTS' OR code IN ('KHO-TB', 'WH-DEVICE')) AND status = 'ACTIVE' ORDER BY code LIMIT 1"
    )
  ).rows[0]?.id as string | undefined;
  if (!whId) {
    whId = (await tx.query("SELECT id FROM master.warehouse WHERE status = 'ACTIVE' ORDER BY code LIMIT 1")).rows[0]?.id;
  }

  let defaultLocId: string | undefined;
  if (whId) {
    defaultLocId = (
      await tx.query("SELECT id FROM master.location WHERE warehouse_id = $1 AND is_quarantine = false AND status = 'ACTIVE' ORDER BY code LIMIT 1", [
        whId,
      ])
    ).rows[0]?.id;
    if (!defaultLocId) {
      defaultLocId = (
        await tx.query(
          `INSERT INTO master.location (warehouse_id, code, name, temperature_condition, is_quarantine, status)
           VALUES ($1, 'KE-LK-TB', 'Kệ Linh Kiện Kỹ Thuật Thiết Bị', 'RT', false, 'ACTIVE')
           ON CONFLICT (warehouse_id, code) DO UPDATE SET name = EXCLUDED.name
           RETURNING id`,
          [whId]
        )
      ).rows[0]?.id;
    }
  }

  // 1. Seed 30 specialized tech parts into master.item + inv.lot + inv.stock_balance
  const partItemMap = new Map<string, { id: string; baseUom: string; unit: string; unitCost: number; category: string }>();

  for (const part of LEGACY_TECH_PARTS_SEED) {
    const baseUom = mapUnitToBaseUom(part.baseUom || part.unit);
    const tracking = part.trackingType === "SERIAL" ? "SERIAL" : part.trackingType === "BULK" ? "NONE" : "LOT";
    const metaJson = JSON.stringify({
      legacyTechPart: true,
      category: part.category,
      displayUnit: part.unit,
      unitCost: part.unitCost,
      location: part.location,
      supplierName: part.supplierName,
      lotNumber: part.lotNumber,
      seedStockQty: part.stockQty,
    });

    const itemRow = (
      await tx.query(
        `INSERT INTO master.item (code, name, item_type, base_uom, tracking, storage_condition, min_stock, reorder_qty, receipt_qc_required, is_purchasable, is_saleable, is_manufacturable, notes, status)
         VALUES ($1, $2, 'COMPONENT', $3, $4, 'RT', $5, $6, true, true, false, false, $7, 'ACTIVE')
         ON CONFLICT (code) DO UPDATE
           SET name = EXCLUDED.name,
               min_stock = EXCLUDED.min_stock,
               notes = COALESCE(master.item.notes, EXCLUDED.notes)
         RETURNING id, base_uom`,
        [part.code, part.name, baseUom, tracking, part.minAlertQty, Math.max(part.minAlertQty * 2, 10), metaJson]
      )
    ).rows[0];

    partItemMap.set(part.code, {
      id: itemRow.id,
      baseUom: itemRow.base_uom,
      unit: part.unit,
      unitCost: part.unitCost,
      category: part.category,
    });

    if (defaultLocId && part.stockQty > 0) {
      const existingBal = (
        await tx.query("SELECT coalesce(sum(qty_on_hand), 0)::float AS qty FROM inv.stock_balance WHERE item_id = $1", [itemRow.id])
      ).rows[0]?.qty ?? 0;
      if (existingBal <= 0) {
        const lotRow = (
          await tx.query(
            `INSERT INTO inv.lot (code, item_id, mfr_lot_no, received_date, status, origin)
             VALUES ($1, $2, $1, current_date, 'RELEASED', 'OPENING')
             ON CONFLICT (item_id, code) DO UPDATE SET status = 'RELEASED'
             RETURNING id`,
            [part.lotNumber || `LOT-${part.code}`, itemRow.id]
          )
        ).rows[0];

        await tx.query(
          `INSERT INTO inv.stock_balance (item_id, lot_id, container_id, location_id, qty_on_hand, qty_reserved)
           SELECT $1, $2, NULL, $3, $4, 0
           WHERE NOT EXISTS (
             SELECT 1 FROM inv.stock_balance WHERE item_id = $1 AND location_id = $3
           )`,
          [itemRow.id, lotRow.id, defaultLocId, part.stockQty]
        );
      }
    }
  }

  // 2. Seed all 31+ commercial models from LEGACY_EQUIPMENT_CATALOG_SEED
  for (const seed of LEGACY_EQUIPMENT_CATALOG_SEED) {
    const existing = (
      await tx.query(
        `SELECT id, current_revision_id, price::float AS price,
                CASE WHEN jsonb_typeof(bom_json) = 'array' THEN jsonb_array_length(bom_json) ELSE 0 END AS bom_len
           FROM device.device_model WHERE code = $1`,
        [seed.code]
      )
    ).rows[0];

    let modelId: string;
    let currentRevId: string | null = existing?.current_revision_id ?? null;

    if (!existing) {
      // Also ensure finished device item exists in master.item
      const devItem = (
        await tx.query(
          `INSERT INTO master.item (code, name, item_type, base_uom, tracking, storage_condition, min_stock, receipt_qc_required, is_purchasable, is_saleable, is_manufacturable, status)
           VALUES ($1, $2, 'DEVICE', 'pcs', 'SERIAL', 'RT', 1, true, false, true, true, 'ACTIVE')
           ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
           RETURNING id`,
          [seed.code, seed.name]
        )
      ).rows[0];

      const ins = (
        await tx.query(
          `INSERT INTO device.device_model (
             code, name, org_unit_id, item_id, category, category_label, manufacturer, origin,
             price, price_dealer1, price_dealer2, warranty_months, lead_time_days, required_burn_in_hours,
             image_url, description, specs_json, baseline_specs_json, accessories_standard, accessories_optional,
             production_stages, bom_json, status
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7, $8,
             $9, $10, $11, $12, $13, $14,
             $15, $16, $17::jsonb, $18::jsonb, $19::jsonb, $20::jsonb,
             $21::jsonb, $22::jsonb, 'COMMERCIAL'
           ) RETURNING id`,
          [
            seed.code,
            seed.name,
            orgUnitId,
            devItem.id,
            seed.category,
            seed.categoryLabel,
            seed.manufacturer,
            seed.origin,
            seed.price,
            seed.priceDealer1,
            seed.priceDealer2,
            seed.warrantyMonths,
            seed.leadTimeDays,
            seed.burnInHours,
            seed.imageUrl || "/logo_abt.png",
            `${seed.categoryLabel} — Xuất xứ: ${seed.origin}`,
            JSON.stringify(seed.specs ?? {}),
            JSON.stringify(seed.baselineSpecs ?? seed.specs ?? {}),
            JSON.stringify(seed.accessoriesStandard ?? []),
            JSON.stringify(seed.accessoriesOptional ?? []),
            JSON.stringify(seed.productionStages ?? []),
            JSON.stringify(seed.bom ?? []),
          ]
        )
      ).rows[0];
      modelId = ins.id;
    } else {
      modelId = existing.id;
      if (!existing.price || existing.price <= 0 || !existing.bom_len || existing.bom_len === 0) {
        await tx.query(
          `UPDATE device.device_model
              SET category_label = COALESCE(category_label, $2),
                  manufacturer = COALESCE(manufacturer, $3),
                  origin = COALESCE(origin, $4),
                  price = CASE WHEN price <= 0 THEN $5 ELSE price END,
                  price_dealer1 = CASE WHEN price_dealer1 <= 0 THEN $6 ELSE price_dealer1 END,
                  price_dealer2 = CASE WHEN price_dealer2 <= 0 THEN $7 ELSE price_dealer2 END,
                  warranty_months = COALESCE(warranty_months, $8),
                  lead_time_days = CASE WHEN lead_time_days <= 0 THEN $9 ELSE lead_time_days END,
                  image_url = COALESCE(image_url, $10),
                  specs_json = CASE WHEN specs_json IS NULL OR specs_json = '[]'::jsonb OR specs_json = '{}'::jsonb THEN $11::jsonb ELSE specs_json END,
                  baseline_specs_json = CASE WHEN baseline_specs_json IS NULL OR baseline_specs_json = '{}'::jsonb THEN $12::jsonb ELSE baseline_specs_json END,
                  accessories_standard = CASE WHEN accessories_standard IS NULL OR accessories_standard = '[]'::jsonb THEN $13::jsonb ELSE accessories_standard END,
                  accessories_optional = CASE WHEN accessories_optional IS NULL OR accessories_optional = '[]'::jsonb THEN $14::jsonb ELSE accessories_optional END,
                  production_stages = CASE WHEN production_stages IS NULL OR production_stages = '[]'::jsonb THEN $15::jsonb ELSE production_stages END,
                  bom_json = CASE WHEN bom_json IS NULL OR bom_json = '[]'::jsonb THEN $16::jsonb ELSE bom_json END,
                  status = 'COMMERCIAL'
            WHERE id = $1`,
          [
            modelId,
            seed.categoryLabel,
            seed.manufacturer,
            seed.origin,
            seed.price,
            seed.priceDealer1,
            seed.priceDealer2,
            seed.warrantyMonths,
            seed.leadTimeDays,
            seed.imageUrl || "/logo_abt.png",
            JSON.stringify(seed.specs ?? {}),
            JSON.stringify(seed.baselineSpecs ?? seed.specs ?? {}),
            JSON.stringify(seed.accessoriesStandard ?? []),
            JSON.stringify(seed.accessoriesOptional ?? []),
            JSON.stringify(seed.productionStages ?? []),
            JSON.stringify(seed.bom ?? []),
          ]
        );
      }
    }

    // Ensure a RELEASED model_revision exists and has BOM lines
    if (!currentRevId) {
      const existingRev = (
        await tx.query("SELECT id FROM device.model_revision WHERE model_id = $1 ORDER BY created_at DESC LIMIT 1", [modelId])
      ).rows[0];
      if (existingRev) {
        currentRevId = existingRev.id;
      } else {
        const revIns = (
          await tx.query(
            `INSERT INTO device.model_revision (model_id, revision, firmware_version, dmr_summary, effectivity_type, released_at, status)
             VALUES ($1, $2, $3, $4, 'IMMEDIATE', now(), 'RELEASED')
             RETURNING id`,
            [
              modelId,
              seed.revision || "1.0",
              seed.firmwareVersion || "v1.0.0",
              `Hồ sơ thiết kế gốc (DMR) chuyển giao sản xuất cho thiết bị ${seed.code} (${seed.name})`,
            ]
          )
        ).rows[0];
        currentRevId = revIns.id;
      }
      await tx.query("UPDATE device.device_model SET current_revision_id = $2 WHERE id = $1 AND current_revision_id IS NULL", [
        modelId,
        currentRevId,
      ]);
    }

    if (currentRevId && seed.bom && seed.bom.length > 0) {
      const bomCnt = (
        await tx.query("SELECT count(*)::int AS cnt FROM device.model_bom_line WHERE revision_id = $1", [currentRevId])
      ).rows[0]?.cnt ?? 0;
      if (bomCnt === 0) {
        await syncBomJsonToRevisionLines(tx, currentRevId, seed.bom, partItemMap, defaultLocId);
      }
    }
  }

  catalogSeededInProcess = true;
}

async function syncBomJsonToRevisionLines(
  tx: Tx,
  revisionId: string,
  bomItems: LegacyEquipmentBOMItem[],
  partItemMap?: Map<string, { id: string; baseUom: string; unit: string; unitCost: number; category: string }>,
  defaultLocId?: string
) {
  await tx.query("DELETE FROM device.model_bom_line WHERE revision_id = $1", [revisionId]);
  let lineNo = 1;
  for (const line of bomItems) {
    const partCode = (line.partCode || `PART-${lineNo}`).trim().toUpperCase();
    const partName = (line.partName || partCode).trim();
    const baseUom = mapUnitToBaseUom(line.unit);
    let itemId = partItemMap?.get(partCode)?.id;

    if (!itemId) {
      const found = (await tx.query("SELECT id FROM master.item WHERE code = $1", [partCode])).rows[0];
      if (found) {
        itemId = found.id;
      } else {
        const metaJson = JSON.stringify({
          legacyTechPart: true,
          category: line.category || "Cơ khí & Vỏ máy",
          displayUnit: line.unit || "Cái",
          unitCost: Number(line.unitCost) || 0,
          location: "Kho Kỹ thuật",
        });
        const created = (
          await tx.query(
            `INSERT INTO master.item (code, name, item_type, base_uom, tracking, storage_condition, min_stock, reorder_qty, receipt_qc_required, is_purchasable, is_saleable, is_manufacturable, notes, status)
             VALUES ($1, $2, 'COMPONENT', $3, 'LOT', 'RT', 5, 10, true, true, false, false, $4, 'ACTIVE')
             ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
             RETURNING id`,
            [partCode, partName, baseUom, metaJson]
          )
        ).rows[0];
        itemId = created.id;
        if (defaultLocId) {
          const lotRow = (
            await tx.query(
              `INSERT INTO inv.lot (code, item_id, mfr_lot_no, received_date, status, origin)
               VALUES ($1, $2, $1, current_date, 'RELEASED', 'OPENING')
               ON CONFLICT (item_id, code) DO UPDATE SET status = 'RELEASED'
               RETURNING id`,
              [`LOT-${partCode}`, itemId]
            )
          ).rows[0];
          await tx.query(
            `INSERT INTO inv.stock_balance (item_id, lot_id, container_id, location_id, qty_on_hand, qty_reserved)
             SELECT $1, $2, NULL, $3, 15, 0
             WHERE NOT EXISTS (
               SELECT 1 FROM inv.stock_balance WHERE item_id = $1 AND location_id = $3
             )`,
            [itemId, lotRow.id, defaultLocId]
          );
        }
      }
    }

    const stationCode = mapStationToCode(line.station);
    const sourceType = line.sourceType === "OUTSOURCE" ? "SUBCONTRACT" : "BUY";
    const qty = Math.max(Number(line.quantity) || 1, 0.0001);

    await tx.query(
      `INSERT INTO device.model_bom_line (
         revision_id, line_no, station_code, component_item_id, qty_per_unit, uom,
         source_type, is_critical, requires_serial, tracking_type, drawing_code, notes,
         unit_cost, display_uom, part_category, station_label, preferred_vendor
       ) VALUES (
         $1, $2, $3, $4, $5, $6,
         $7, true, false, 'LOT', $8, $9,
         $10, $11, $12, $13, $14
       )`,
      [
        revisionId,
        lineNo++,
        stationCode,
        itemId,
        qty,
        baseUom,
        sourceType,
        line.drawingFile || null,
        line.notes || null,
        Number(line.unitCost) || 0,
        line.unit || "Cái",
        line.category || "Bo mạch & Điện tử",
        line.station || "1. Lắp ráp Khung Cơ khí & Vỏ máy",
        line.preferredVendor || null,
      ]
    );
  }
}

export async function listTechPartsInventory(tx: Tx, actor: AuthzActor) {
  await authorizeAnywhere(tx, actor, "device.view");
  await ensureTechCatalogAndBomSeeded(tx);

  const rows = (
    await tx.query(
      `SELECT i.id, i.code, i.name, i.base_uom, i.tracking, i.min_stock::float AS min_alert_qty, i.notes,
              coalesce((SELECT sum(sb.qty_on_hand - sb.qty_reserved)::float FROM inv.stock_balance sb WHERE sb.item_id = i.id), 0) AS stock_qty,
              coalesce((SELECT sum(sb.qty_on_hand)::float FROM inv.stock_balance sb WHERE sb.item_id = i.id), 0) AS on_hand_qty
         FROM master.item i
        WHERE i.item_type IN ('COMPONENT', 'SPARE_PART', 'RAW_MATERIAL')
          AND i.status = 'ACTIVE'
        ORDER BY i.code ASC`
    )
  ).rows;

  const seedLookup = new Map(LEGACY_TECH_PARTS_SEED.map((p) => [p.code, p]));
  return rows.map((r) => {
    let parsed: Record<string, unknown> = {};
    if (r.notes && typeof r.notes === "string" && r.notes.trim().startsWith("{")) {
      try {
        parsed = JSON.parse(r.notes);
      } catch {
        parsed = {};
      }
    }
    const seed = seedLookup.get(r.code);
    return {
      id: r.id,
      code: r.code,
      name: r.name,
      category: (parsed.category as string) || seed?.category || "Bo mạch & Điện tử",
      unit: (parsed.displayUnit as string) || seed?.unit || r.base_uom,
      base_uom: r.base_uom,
      stock_qty: Number(r.stock_qty ?? seed?.stockQty ?? 0),
      on_hand_qty: Number(r.on_hand_qty ?? seed?.stockQty ?? 0),
      min_alert_qty: Number(r.min_alert_qty || seed?.minAlertQty || 5),
      unit_cost: Number(parsed.unitCost ?? seed?.unitCost ?? 0),
      location: (parsed.location as string) || seed?.location || "Kệ Linh kiện Kỹ thuật",
      supplier_name: (parsed.supplierName as string) || seed?.supplierName || "Nhà cung cấp ABT",
      lot_number: (parsed.lotNumber as string) || seed?.lotNumber || `LOT-${r.code}`,
      tracking_type: r.tracking === "SERIAL" ? "SERIAL" : r.tracking === "NONE" ? "BULK" : "LOT",
    };
  });
}

export async function createDeviceModel(tx: Tx, actor: AuthzActor, input: unknown) {
  await ensureTechCatalogAndBomSeeded(tx);
  const d = parseInput(createModelSchema, input);

  let orgUnitId = d.org_unit_id;
  if (!orgUnitId) {
    orgUnitId = (
      await tx.query(
        "SELECT id FROM core.org_unit WHERE code IN ('P-DEVICE', 'P-KT', 'DEVICE', 'TECH') AND status = 'ACTIVE' ORDER BY code LIMIT 1"
      )
    ).rows[0]?.id;
  }
  if (!orgUnitId) throw invalid("Không tìm thấy đơn vị Phòng Kỹ thuật – Công nghệ.");

  await authorize(tx, actor, "device.model.manage", orgUnitId);
  const code = d.code ?? (await nextNumber(tx, "DEVICE_MODEL"));
  const dup = await tx.query("SELECT 1 FROM device.device_model WHERE code = $1", [code]);
  if (dup.rowCount) throw conflict(`Mã model thiết bị ${code} đã tồn tại.`, "DUPLICATE_CODE");

  let itemId = d.item_id ?? null;
  if (!itemId) {
    const devItem = (
      await tx.query(
        `INSERT INTO master.item (code, name, item_type, base_uom, tracking, storage_condition, min_stock, receipt_qc_required, is_purchasable, is_saleable, is_manufacturable, kd_item_code, status)
         VALUES ($1, $2, 'DEVICE', 'pcs', 'SERIAL', 'RT', 1, true, false, true, true, $1, 'ACTIVE')
         ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [code, d.name]
      )
    ).rows[0];
    itemId = devItem.id;
  }

  const defaultStages =
    d.production_stages && d.production_stages.length > 0
      ? d.production_stages
      : [
          "1. Gia công & Lắp ráp Khung vỏ cơ khí",
          "2. Lắp đặt Cụm chức năng & Đấu nối Điện - Bo mạch",
          "3. Nạp Firmware, Hiệu chuẩn thông số & Burn-in",
          "4. Kiểm định QC xuất xưởng (FQC) & Đóng gói",
        ];

  const created = await insertRecord<DeviceModelRow>(tx, actor, "device.device_model", "device_model", {
    code,
    name: d.name,
    org_unit_id: orgUnitId,
    item_id: itemId,
    category: d.category,
    category_label: d.category_label || "Thiết bị phụ trợ phòng Lab",
    manufacturer: d.manufacturer || "CÔNG TY TNHH GIẢI PHÁP Y SINH ABT - CHI NHÁNH LONG HẬU",
    origin: d.origin || "Việt Nam",
    price: d.price,
    price_dealer1: d.price_dealer1 || (d.price > 0 ? Math.round(d.price * 0.85) : 0),
    price_dealer2: d.price_dealer2 || (d.price > 0 ? Math.round(d.price * 0.9) : 0),
    lead_time_days: d.lead_time_days,
    image_url: d.image_url || "/logo_abt.png",
    warranty_months: d.warranty_months,
    required_burn_in_hours: d.required_burn_in_hours,
    fqc_spec_id: d.fqc_spec_id ?? null,
    rd_project_id: d.rd_project_id ?? null,
    description: d.description ?? null,
    specs_json: JSON.stringify(d.specs_json ?? {}),
    baseline_specs_json: JSON.stringify(d.baseline_specs_json ?? d.specs_json ?? {}),
    accessories_standard: JSON.stringify(d.accessories_standard ?? []),
    accessories_optional: JSON.stringify(d.accessories_optional ?? []),
    production_stages: JSON.stringify(defaultStages),
    bom_json: JSON.stringify(d.bom_json ?? []),
    status: "COMMERCIAL",
  });

  // Create initial Revision 1.0 automatically so it appears in the catalog with Rev 1.0 ready
  const revCode = d.revision || "1.0";
  const rev = (
    await tx.query(
      `INSERT INTO device.model_revision (model_id, revision, firmware_version, dmr_summary, effectivity_type, released_by, released_at, status, created_by, updated_by)
       VALUES ($1, $2, $3, $4, 'IMMEDIATE', $5, now(), 'RELEASED', $5, $5)
       RETURNING id`,
      [
        created.id,
        revCode,
        d.firmware_version || "v1.0.0",
        `Hồ sơ thiết kế gốc (DMR) khởi tạo cho thiết bị ${code} (${d.name})`,
        actor.userId,
      ]
    )
  ).rows[0];

  await tx.query("UPDATE device.device_model SET current_revision_id = $2 WHERE id = $1", [created.id, rev.id]);

  if (Array.isArray(d.bom_json) && d.bom_json.length > 0) {
    await syncBomJsonToRevisionLines(tx, rev.id, d.bom_json as LegacyEquipmentBOMItem[]);
  }

  return { ...created, current_revision_id: rev.id, current_revision: revCode };
}

const updateCatalogBomSchema = z.object({
  model_id: z.string().uuid("chọn model thiết bị"),
  code: z.string().trim().min(2).max(40).optional(),
  name: z.string().trim().min(2).max(250).optional(),
  category: z
    .enum(["THERMAL_CYCLER", "EXTRACTOR", "CENTRIFUGE", "SPIN_COLUMN_SYSTEM", "INCUBATOR", "SPECTROPHOTOMETER", "OTHER"])
    .optional(),
  category_label: z.string().trim().max(150).optional().nullable(),
  manufacturer: z.string().trim().max(250).optional().nullable(),
  origin: z.string().trim().max(120).optional().nullable(),
  price: z.coerce.number().min(0).optional(),
  price_dealer1: z.coerce.number().min(0).optional(),
  price_dealer2: z.coerce.number().min(0).optional(),
  warranty_months: z.coerce.number().int().min(0).max(120).optional(),
  lead_time_days: z.coerce.number().int().min(1).max(365).optional(),
  required_burn_in_hours: z.coerce.number().min(0).max(500).optional(),
  image_url: z.string().trim().max(1000).optional().nullable(),
  description: z.string().trim().max(3000).optional().nullable(),
  specs_json: z.record(z.string(), z.unknown()).optional(),
  baseline_specs_json: z.record(z.string(), z.unknown()).optional(),
  accessories_standard: z.array(z.unknown()).optional(),
  accessories_optional: z.array(z.unknown()).optional(),
  production_stages: z.array(z.string()).optional(),
  bom_json: z.array(z.unknown()).optional(),
});

export async function updateDeviceModelCatalogAndBom(tx: Tx, actor: AuthzActor, input: unknown) {
  await ensureTechCatalogAndBomSeeded(tx);
  const d = parseInput(updateCatalogBomSchema, input);
  const cur = (await tx.query("SELECT * FROM device.device_model WHERE id = $1 FOR UPDATE", [d.model_id])).rows[0];
  if (!cur) throw notFound("model thiết bị");
  await authorize(tx, actor, "device.model.manage", cur.org_unit_id);

  const patch: Record<string, unknown> = {};
  if (d.code !== undefined && d.code.toUpperCase() !== cur.code) {
    const newCode = d.code.toUpperCase();
    const dup = await tx.query("SELECT 1 FROM device.device_model WHERE code = $1 AND id <> $2", [newCode, d.model_id]);
    if (dup.rowCount) throw conflict(`Mã thiết bị ${newCode} đã tồn tại.`);
    patch.code = newCode;
  }
  if (d.name !== undefined) patch.name = d.name;
  if (d.category !== undefined) patch.category = d.category;
  if (d.category_label !== undefined) patch.category_label = d.category_label;
  if (d.manufacturer !== undefined) patch.manufacturer = d.manufacturer;
  if (d.origin !== undefined) patch.origin = d.origin;
  if (d.price !== undefined) patch.price = d.price;
  if (d.price_dealer1 !== undefined) patch.price_dealer1 = d.price_dealer1;
  if (d.price_dealer2 !== undefined) patch.price_dealer2 = d.price_dealer2;
  if (d.warranty_months !== undefined) patch.warranty_months = d.warranty_months;
  if (d.lead_time_days !== undefined) patch.lead_time_days = d.lead_time_days;
  if (d.required_burn_in_hours !== undefined) patch.required_burn_in_hours = d.required_burn_in_hours;
  if (d.image_url !== undefined) patch.image_url = d.image_url;
  if (d.description !== undefined) patch.description = d.description;
  if (d.specs_json !== undefined) patch.specs_json = JSON.stringify(d.specs_json);
  if (d.baseline_specs_json !== undefined) patch.baseline_specs_json = JSON.stringify(d.baseline_specs_json);
  if (d.accessories_standard !== undefined) patch.accessories_standard = JSON.stringify(d.accessories_standard);
  if (d.accessories_optional !== undefined) patch.accessories_optional = JSON.stringify(d.accessories_optional);
  if (d.production_stages !== undefined) patch.production_stages = JSON.stringify(d.production_stages);
  if (d.bom_json !== undefined) patch.bom_json = JSON.stringify(d.bom_json);

  const updated = await updateRecord<DeviceModelRow>(
    tx,
    actor,
    "device.device_model",
    "device_model",
    d.model_id,
    cur.version,
    patch
  );

  // Sync bom_json to active/latest revision's model_bom_line table
  if (d.bom_json !== undefined) {
    let revId = cur.current_revision_id as string | null;
    if (!revId) {
      const latestRev = (
        await tx.query("SELECT id FROM device.model_revision WHERE model_id = $1 ORDER BY created_at DESC LIMIT 1", [d.model_id])
      ).rows[0];
      if (latestRev) {
        revId = latestRev.id;
      } else {
        const revIns = (
          await tx.query(
            `INSERT INTO device.model_revision (model_id, revision, firmware_version, dmr_summary, effectivity_type, released_by, released_at, status, created_by, updated_by)
             VALUES ($1, '1.0', 'v1.0.0', $2, 'IMMEDIATE', $3, now(), 'RELEASED', $3, $3)
             RETURNING id`,
            [d.model_id, `Hồ sơ DMR cho thiết bị ${cur.code}`, actor.userId]
          )
        ).rows[0];
        revId = revIns.id;
        await tx.query("UPDATE device.device_model SET current_revision_id = $2 WHERE id = $1", [d.model_id, revId]);
      }
    }
    if (revId) {
      const revStatus = (await tx.query("SELECT status FROM device.model_revision WHERE id = $1", [revId])).rows[0]?.status;
      if (revStatus === "DRAFT") {
        await syncBomJsonToRevisionLines(tx, revId, d.bom_json as LegacyEquipmentBOMItem[]);
      }
    }
  }

  return getDeviceModelDetail(tx, actor, updated.id);
}

const cloneUpgradeSchema = z.object({
  source_model_id: z.string().uuid("chọn thiết bị gốc"),
  new_code: z.string().trim().min(2).max(40).optional(),
  new_name: z.string().trim().min(3).max(250).optional(),
  target_revision: z.string().trim().max(16).default("2.0"),
  upgrade_reason: z.string().trim().max(1000).optional(),
});

export async function cloneOrUpgradeDeviceModel(tx: Tx, actor: AuthzActor, input: unknown) {
  await ensureTechCatalogAndBomSeeded(tx);
  const d = parseInput(cloneUpgradeSchema, input);
  const src = (await tx.query("SELECT * FROM device.device_model WHERE id = $1", [d.source_model_id])).rows[0];
  if (!src) throw notFound("thiết bị gốc");
  await authorize(tx, actor, "device.model.manage", src.org_unit_id);

  const baseCode = src.code.replace(/-V\d+$/i, "");
  let newCode = (d.new_code || `${baseCode}-V2`).toUpperCase();
  let suffix = 2;
  while ((await tx.query("SELECT 1 FROM device.device_model WHERE code = $1", [newCode])).rowCount) {
    suffix++;
    newCode = `${baseCode}-V${suffix}`;
  }

  const newName = d.new_name || `${src.name} (Bản nâng cấp V${suffix})`;
  const devItem = (
    await tx.query(
      `INSERT INTO master.item (code, name, item_type, base_uom, tracking, storage_condition, min_stock, receipt_qc_required, is_purchasable, is_saleable, is_manufacturable, kd_item_code, status)
       VALUES ($1, $2, 'DEVICE', 'pcs', 'SERIAL', 'RT', 1, true, false, true, true, $1, 'ACTIVE')
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [newCode, newName]
    )
  ).rows[0];

  const created = await insertRecord<DeviceModelRow>(tx, actor, "device.device_model", "device_model", {
    code: newCode,
    name: newName,
    org_unit_id: src.org_unit_id,
    item_id: devItem.id,
    category: src.category,
    category_label: src.category_label || "Thiết bị chuyên sâu",
    manufacturer: src.manufacturer || "CÔNG TY TNHH GIẢI PHÁP Y SINH ABT - CHI NHÁNH LONG HẬU",
    origin: src.origin || "Việt Nam",
    price: Number(src.price) || 0,
    price_dealer1: Number(src.price_dealer1) || 0,
    price_dealer2: Number(src.price_dealer2) || 0,
    warranty_months: src.warranty_months,
    lead_time_days: src.lead_time_days || 21,
    required_burn_in_hours: src.required_burn_in_hours,
    image_url: src.image_url || "/logo_abt.png",
    description: d.upgrade_reason || `Bản nâng cấp thế hệ mới kế thừa từ model ${src.code}`,
    specs_json: JSON.stringify(src.specs_json ?? {}),
    baseline_specs_json: JSON.stringify(src.specs_json ?? {}),
    accessories_standard: JSON.stringify(src.accessories_standard ?? []),
    accessories_optional: JSON.stringify(src.accessories_optional ?? []),
    production_stages: JSON.stringify(src.production_stages ?? []),
    bom_json: JSON.stringify(src.bom_json ?? []),
    base_model_code: src.code,
    status: "COMMERCIAL",
  });

  const rev = (
    await tx.query(
      `INSERT INTO device.model_revision (model_id, revision, firmware_version, dmr_summary, effectivity_type, released_by, released_at, status, created_by, updated_by)
       VALUES ($1, $2, 'v2.0.0', $3, 'IMMEDIATE', $4, now(), 'RELEASED', $4, $4)
       RETURNING id`,
      [
        created.id,
        d.target_revision || "2.0",
        `Hồ sơ thiết kế nâng cấp (Rev ${d.target_revision || "2.0"}) kế thừa từ ${src.code}. ${d.upgrade_reason || ""}`.trim(),
        actor.userId,
      ]
    )
  ).rows[0];

  await tx.query("UPDATE device.device_model SET current_revision_id = $2 WHERE id = $1", [created.id, rev.id]);

  if (Array.isArray(src.bom_json) && src.bom_json.length > 0) {
    await syncBomJsonToRevisionLines(tx, rev.id, src.bom_json as LegacyEquipmentBOMItem[]);
  }

  return getDeviceModelDetail(tx, actor, created.id);
}

export async function deleteDeviceModel(tx: Tx, actor: AuthzActor, modelId: string) {
  const cur = (await tx.query("SELECT * FROM device.device_model WHERE id = $1 FOR UPDATE", [modelId])).rows[0];
  if (!cur) throw notFound("model thiết bị");
  await authorize(tx, actor, "device.model.manage", cur.org_unit_id);

  const hasOrders = (await tx.query("SELECT 1 FROM device.device_order WHERE model_id = $1 LIMIT 1", [modelId])).rowCount;
  if (hasOrders) {
    await tx.query(
      "UPDATE device.device_model SET status = 'DISCONTINUED', version = version + 1, updated_at = now(), updated_by = $2 WHERE id = $1",
      [modelId, actor.userId]
    );
    return { deleted: false, discontinued: true, id: modelId };
  }

  await tx.query("UPDATE device.device_model SET current_revision_id = NULL WHERE id = $1", [modelId]);
  await tx.query("DELETE FROM device.eco_request WHERE model_id = $1", [modelId]);
  await tx.query("DELETE FROM device.model_revision WHERE model_id = $1", [modelId]);
  await tx.query("DELETE FROM device.device_model WHERE id = $1", [modelId]);
  return { deleted: true, id: modelId };
}

const createRevisionSchema = z.object({
  model_id: z.string().uuid("chọn model thiết bị"),
  revision: z
    .string()
    .trim()
    .regex(/^[A-Z0-9._-]{1,16}$/i, "Ký hiệu phiên bản (ví dụ A, B, 1.0)")
    .transform((s) => s.toUpperCase()),
  firmware_version: z.string().trim().max(60).optional().nullable(),
  firmware_release_id: z.string().uuid().optional().nullable(),
  dmr_summary: z.string().trim().min(5, "nhập tóm tắt hồ sơ thiết kế gốc (DMR)").max(4000),
  eco_request_id: z.string().uuid().optional().nullable(),
  effectivity_type: z.enum(["IMMEDIATE", "FROM_DATE", "FROM_SERIAL"]).default("IMMEDIATE"),
  effectivity_value: z.string().trim().max(100).optional().nullable(),
  clone_from_revision_id: z.string().uuid().optional().nullable(),
});

export async function createModelRevision(tx: Tx, actor: AuthzActor, input: unknown) {
  const d = parseInput(createRevisionSchema, input);
  const owner = await modelOwner(tx, d.model_id);
  await authorize(tx, actor, "device.model.manage", owner);
  const dup = await tx.query("SELECT 1 FROM device.model_revision WHERE model_id = $1 AND revision = $2", [d.model_id, d.revision]);
  if (dup.rowCount) throw conflict(`Phiên bản ${d.revision} của model này đã tồn tại.`, "DUPLICATE_REVISION");

  let fwVersion = d.firmware_version ?? null;
  if (d.firmware_release_id) {
    const sw = (await tx.query("SELECT version_tag, status FROM rd.software_release WHERE id = $1", [d.firmware_release_id])).rows[0];
    if (!sw) throw notFound("bản phát hành Firmware (rd.software_release)");
    if (sw.status !== "RELEASED") {
      throw invalid("Chỉ được gắn kết với bản phát hành Firmware đã được phê duyệt phát hành (RELEASED).");
    }
    if (!fwVersion) fwVersion = sw.version_tag;
  }

  const rev = await insertRecord<ModelRevisionRow>(tx, actor, "device.model_revision", "device_model_revision", {
    model_id: d.model_id,
    revision: d.revision,
    firmware_version: fwVersion,
    firmware_release_id: d.firmware_release_id ?? null,
    dmr_summary: d.dmr_summary,
    eco_request_id: d.eco_request_id ?? null,
    effectivity_type: d.effectivity_type,
    effectivity_value: d.effectivity_value ?? null,
  });

  if (d.clone_from_revision_id) {
    await tx.query(
      `INSERT INTO device.model_bom_line (revision_id, line_no, station_code, component_item_id, qty_per_unit, uom, source_type, is_critical, requires_serial, tracking_type, drawing_code, notes, created_by, updated_by)
       SELECT $1, line_no, station_code, component_item_id, qty_per_unit, uom, source_type, is_critical, requires_serial, tracking_type, drawing_code, notes, $2, $2
         FROM device.model_bom_line WHERE revision_id = $3 ORDER BY line_no`,
      [rev.id, actor.userId, d.clone_from_revision_id]
    );
  }
  return rev;
}

const bomLineSchema = z.object({
  revision_id: z.string().uuid("chọn phiên bản thiết kế"),
  station_code: z.enum(["STATION_1_MECH", "STATION_2_PCB", "STATION_3_FW", "STATION_4_FQC"]),
  component_item_id: z.string().uuid("chọn linh kiện / vật tư"),
  qty_per_unit: z.coerce.number().positive("định mức phải > 0"),
  uom: z.string().trim().min(1),
  source_type: z.enum(["BUY", "MAKE", "SUBCONTRACT"]).default("BUY"),
  is_critical: z.boolean().default(true),
  requires_serial: z.boolean().default(false),
  tracking_type: z.enum(["SERIAL", "LOT", "BULK"]).optional(),
  drawing_code: z.string().trim().max(120).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
});

export async function addModelBomLine(tx: Tx, actor: AuthzActor, input: unknown) {
  const d = parseInput(bomLineSchema, input);
  const rev = (await tx.query("SELECT * FROM device.model_revision WHERE id = $1 FOR UPDATE", [d.revision_id])).rows[0] as
    | ModelRevisionRow
    | undefined;
  if (!rev) throw notFound("phiên bản thiết kế DMR");
  const owner = await modelOwner(tx, rev.model_id);
  await authorize(tx, actor, "device.model.manage", owner);
  if (rev.status !== "DRAFT") {
    throw invalid("Chỉ được thêm/sửa cấu trúc BOM khi phiên bản thiết kế đang ở trạng thái Nháp (DRAFT).");
  }
  const nextLine = Number(
    (await tx.query("SELECT coalesce(max(line_no), 0) + 1 AS n FROM device.model_bom_line WHERE revision_id = $1", [d.revision_id])).rows[0].n
  );
  const trackingType = d.tracking_type ?? (d.requires_serial ? "SERIAL" : "LOT");
  const requiresSerial = trackingType === "SERIAL" ? true : d.requires_serial;
  const row = (
    await tx.query(
      `INSERT INTO device.model_bom_line (revision_id, line_no, station_code, component_item_id, qty_per_unit, uom, source_type, is_critical, requires_serial, tracking_type, drawing_code, notes, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13) RETURNING *`,
      [
        d.revision_id,
        nextLine,
        d.station_code,
        d.component_item_id,
        d.qty_per_unit,
        d.uom,
        d.source_type,
        d.is_critical,
        requiresSerial,
        trackingType,
        d.drawing_code ?? null,
        d.notes ?? null,
        actor.userId,
      ]
    )
  ).rows[0];
  await writeAudit(tx, actor, {
    entityType: "device_model_revision",
    entityId: d.revision_id,
    action: "add_bom_line",
    changes: { line: [null, `#${nextLine} (${d.station_code}) qty=${d.qty_per_unit} ${d.uom}`] },
  });
  return row;
}

const createEcoSchema = z.object({
  model_id: z.string().uuid("chọn model thiết bị"),
  target_revision: z
    .string()
    .trim()
    .regex(/^[A-Z0-9._-]{1,16}$/i, "Ký hiệu phiên bản đích (ví dụ B)")
    .transform((s) => s.toUpperCase()),
  title: z.string().trim().min(3, "nhập tiêu đề ECO").max(300),
  reason: z.string().trim().min(5, "nhập lý do thay đổi kỹ thuật").max(2000),
  change_summary: z.string().trim().min(5, "nhập tóm tắt nội dung thay đổi").max(4000),
  effectivity_type: z.enum(["IMMEDIATE", "FROM_DATE", "FROM_SERIAL"]).default("IMMEDIATE"),
  effectivity_value: z.string().trim().max(100).optional().nullable(),
  impact_documents: z.string().trim().max(2000).optional().nullable(),
  impact_training: z.string().trim().max(2000).optional().nullable(),
  impact_stock: z.string().trim().max(2000).optional().nullable(),
  impact_open_orders: z.string().trim().max(2000).optional().nullable(),
  impact_regulatory: z.string().trim().max(2000).optional().nullable(),
});

export async function createEcoRequest(tx: Tx, actor: AuthzActor, input: unknown) {
  const d = parseInput(createEcoSchema, input);
  const owner = await modelOwner(tx, d.model_id);
  await authorize(tx, actor, "device.eco.propose", owner);
  const code = await nextNumber(tx, "DEVICE_ECO");
  return insertRecord<EcoRequestRow>(tx, actor, "device.eco_request", "device_eco", {
    code,
    model_id: d.model_id,
    target_revision: d.target_revision,
    title: d.title,
    reason: d.reason,
    change_summary: d.change_summary,
    effectivity_type: d.effectivity_type,
    effectivity_value: d.effectivity_value ?? null,
    impact_documents: d.impact_documents ?? null,
    impact_training: d.impact_training ?? null,
    impact_stock: d.impact_stock ?? null,
    impact_open_orders: d.impact_open_orders ?? null,
    impact_regulatory: d.impact_regulatory ?? null,
    proposer_id: actor.userId,
  });
}

export async function updateEcoImpact(tx: Tx, actor: AuthzActor, ecoId: string, input: unknown) {
  const raw = (input ?? {}) as Record<string, unknown>;
  const cur = (await tx.query("SELECT * FROM device.eco_request WHERE id = $1 FOR UPDATE", [ecoId])).rows[0] as EcoRequestRow | undefined;
  if (!cur) throw notFound("yêu cầu thay đổi kỹ thuật (ECO)");
  const owner = await modelOwner(tx, cur.model_id);
  await authorize(tx, actor, "device.eco.propose", owner);
  if (!["DRAFT", "IMPACT_ASSESSMENT"].includes(cur.status)) {
    throw invalid("Chỉ cập nhật đánh giá ảnh hưởng khi ECO đang ở trạng thái DRAFT hoặc IMPACT_ASSESSMENT.");
  }
  const schema = z.object({
    impact_documents: z.string().trim().min(2, "nhập ảnh hưởng tài liệu DMR/SOP").max(2000),
    impact_training: z.string().trim().min(2, "nhập ảnh hưởng đào tạo").max(2000),
    impact_stock: z.string().trim().min(2, "nhập phương án xử lý tồn kho linh kiện cũ").max(2000),
    impact_open_orders: z.string().trim().min(2, "nhập ảnh hưởng lệnh lắp ráp đang chạy").max(2000),
    impact_regulatory: z.string().trim().min(2, "nhập ảnh hưởng hồ sơ đăng ký lưu hành").max(2000),
  });
  const d = parseInput(schema, input);
  return updateRecord<EcoRequestRow>(tx, actor, "device.eco_request", "device_eco", ecoId, Number(raw.version ?? cur.version), d);
}

export async function listDeviceModels(tx: Tx, actor: AuthzActor) {
  await authorizeAnywhere(tx, actor, "device.view");
  await ensureTechCatalogAndBomSeeded(tx);
  const rows = (
    await tx.query(
      `SELECT m.*,
              m.required_burn_in_hours::float AS required_burn_in_hours,
              coalesce(m.price, 0)::float AS price,
              coalesce(m.price_dealer1, 0)::float AS price_dealer1,
              coalesce(m.price_dealer2, 0)::float AS price_dealer2,
              coalesce(m.lead_time_days, 14)::int AS lead_time_days,
              u.name AS org_unit_name, it.code AS item_code, it.name AS item_name,
              coalesce(r.revision, '1.0') AS current_revision, r.firmware_version AS current_firmware,
              (SELECT count(*)::int FROM device.device_unit du WHERE du.model_id = m.id) AS unit_count,
              (SELECT count(*)::int FROM device.eco_request ec WHERE ec.model_id = m.id) AS eco_count
         FROM device.device_model m
         JOIN core.org_unit u ON u.id = m.org_unit_id
         LEFT JOIN master.item it ON it.id = m.item_id
         LEFT JOIN device.model_revision r ON r.id = m.current_revision_id
        WHERE m.status <> 'DISCONTINUED'
        ORDER BY m.code ASC`
    )
  ).rows;
  const visible = [];
  for (const r of rows) {
    if (await hasFactoryPermission(tx, actor, "device.view", r.org_unit_id)) visible.push(r);
  }
  return visible;
}

export async function getDeviceModelDetail(tx: Tx, actor: AuthzActor, id: string) {
  await ensureTechCatalogAndBomSeeded(tx);
  const model = (
    await tx.query(
      `SELECT m.*,
              m.required_burn_in_hours::float AS required_burn_in_hours,
              coalesce(m.price, 0)::float AS price,
              coalesce(m.price_dealer1, 0)::float AS price_dealer1,
              coalesce(m.price_dealer2, 0)::float AS price_dealer2,
              coalesce(m.lead_time_days, 14)::int AS lead_time_days,
              u.name AS org_unit_name, it.code AS item_code, it.name AS item_name,
              qs.code AS fqc_spec_code, qs.name AS fqc_spec_name,
              coalesce(r.revision, '1.0') AS current_revision, r.firmware_version AS current_firmware
         FROM device.device_model m
         JOIN core.org_unit u ON u.id = m.org_unit_id
         LEFT JOIN master.item it ON it.id = m.item_id
         LEFT JOIN qms.qc_spec qs ON qs.id = m.fqc_spec_id
         LEFT JOIN device.model_revision r ON r.id = m.current_revision_id
        WHERE m.id = $1`,
      [id]
    )
  ).rows[0];
  if (!model) throw notFound("model thiết bị");
  await authorize(tx, actor, "device.view", model.org_unit_id);

  const revisions = (
    await tx.query(
      `SELECT r.*, up.display_name AS released_by_name, ec.code AS eco_code,
              sw.code AS firmware_release_code, sw.version_tag AS firmware_release_tag, sw.safety_class AS firmware_safety_class
         FROM device.model_revision r
         LEFT JOIN core.user_profile up ON up.user_id = r.released_by
         LEFT JOIN device.eco_request ec ON ec.id = r.eco_request_id
         LEFT JOIN rd.software_release sw ON sw.id = r.firmware_release_id
        WHERE r.model_id = $1 ORDER BY r.created_at DESC`,
      [id]
    )
  ).rows;

  for (const rev of revisions) {
    rev.bom_lines = (
      await tx.query(
        `SELECT bl.*,
                bl.qty_per_unit::float AS qty_per_unit,
                coalesce(bl.unit_cost, 0)::float AS unit_cost,
                it.code AS item_code, it.name AS item_name,
                coalesce((SELECT sum(sb.qty_on_hand - sb.qty_reserved)::float FROM inv.stock_balance sb WHERE sb.item_id = bl.component_item_id), 0) AS stock_qty
           FROM device.model_bom_line bl
           JOIN master.item it ON it.id = bl.component_item_id
          WHERE bl.revision_id = $1 ORDER BY bl.line_no ASC`,
        [rev.id]
      )
    ).rows;
    rev.actions = await listAllowedActions(tx, modelRevisionMachine, actor, rev);
  }

  const ecos = (
    await tx.query(
      `SELECT e.*, pr.display_name AS proposer_name, ap.display_name AS approved_by_name
         FROM device.eco_request e
         LEFT JOIN core.user_profile pr ON pr.user_id = e.proposer_id
         LEFT JOIN core.user_profile ap ON ap.user_id = e.approved_by
        WHERE e.model_id = $1 ORDER BY e.created_at DESC`,
      [id]
    )
  ).rows;
  for (const e of ecos) {
    e.actions = await listAllowedActions(tx, ecoMachine, actor, e);
  }

  return { ...model, revisions, ecos };
}
