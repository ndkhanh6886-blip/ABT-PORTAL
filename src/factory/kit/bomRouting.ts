import { z } from "zod";
import type { Tx } from "../core/db";
import { writeAudit } from "../core/audit";
import { authorize, authorizeAnywhere, hasFactoryPermission, type AuthzActor } from "../core/authz";
import { conflict, invalid, notFound } from "../core/errors";
import { nextNumber } from "../core/numbering";
import { insertRecord, parseInput } from "../core/records";
import { defineMachine, listAllowedActions, runTransition, type Guard } from "../core/stateMachine";
import { getItem, toBaseQty } from "../master/service";
import "./permissions";

export type SpecDocStatus = "DRAFT" | "IN_REVIEW" | "EFFECTIVE" | "OBSOLETE";

export interface KitBomRow {
  id: string;
  code: string;
  org_unit_id: string;
  product_item_id: string;
  bom_version: number;
  name: string;
  base_qty: string;
  base_uom: string;
  tests_per_kit: number;
  shelf_life_days: number;
  qc_spec_id: string | null;
  notes: string | null;
  status: SpecDocStatus;
  approved_by: number | null;
  approved_at: string | null;
  created_by: number | null;
  version: number;
}

export interface KitRoutingRow {
  id: string;
  code: string;
  org_unit_id: string;
  product_item_id: string;
  routing_version: number;
  name: string;
  notes: string | null;
  status: SpecDocStatus;
  approved_by: number | null;
  approved_at: string | null;
  created_by: number | null;
  version: number;
}

const notAuthorGuard = <T extends { created_by: number | null }>(label: string): Guard<T> => ({
  code: "SELF_APPROVAL",
  message: `Người phê duyệt ${label} phải khác người soạn thảo.`,
  check: ({ actor, row }) => row.created_by !== actor.userId,
});

/** Resolves visible org units in a single query instead of N+1 per row (scales to thousands of BOMs/Routings). */
export async function visibleKitOrgUnits(tx: Tx, actor: AuthzActor, perm = "kit.view"): Promise<"ALL" | string[]> {
  if (await hasFactoryPermission(tx, actor, perm, null)) return "ALL";
  const units = (await tx.query("SELECT id FROM core.org_unit WHERE status = 'ACTIVE'")).rows as { id: string }[];
  const allowed: string[] = [];
  for (const u of units) {
    if (await hasFactoryPermission(tx, actor, perm, u.id)) allowed.push(u.id);
  }
  return allowed;
}

/**
 * Kit BOM State Machine (docs/nha-may/02 §8.1):
 * DRAFT → IN_REVIEW → EFFECTIVE ✍ → OBSOLETE
 * Activating a new BOM version uses `beforeUpdate` (never executed during GET/listAllowedActions)
 * to transition any previous EFFECTIVE BOM for the same product to OBSOLETE with full audit trail.
 */
export const bomMachine = defineMachine<SpecDocStatus, KitBomRow>({
  entityType: "kit_bom",
  table: "kit.bom",
  states: ["DRAFT", "IN_REVIEW", "EFFECTIVE", "OBSOLETE"],
  terminal: ["OBSOLETE"],
  scopeOf: (row) => row.org_unit_id,
  transitions: [
    {
      action: "submit_review",
      from: "DRAFT",
      to: "IN_REVIEW",
      permission: "kit.bom.manage",
      guards: [
        {
          code: "EMPTY_BOM",
          message: "Định mức BOM phải có ít nhất một dòng nguyên vật liệu trước khi gửi duyệt.",
          check: async ({ tx, row }) => {
            const c = await tx.query("SELECT 1 FROM kit.bom_line WHERE bom_id = $1 LIMIT 1", [row.id]);
            return (c.rowCount ?? 0) > 0;
          },
        },
      ],
    },
    {
      action: "return_draft",
      from: "IN_REVIEW",
      to: "DRAFT",
      permission: "kit.bom.approve",
      reasonRequired: true,
    },
    {
      action: "approve",
      from: "IN_REVIEW",
      to: "EFFECTIVE",
      permission: "kit.bom.approve",
      signature: "APPROVED",
      guards: [notAuthorGuard("định mức BOM")],
      beforeUpdate: async ({ tx, actor, row }) => {
        const prevRows = (
          await tx.query(
            "SELECT * FROM kit.bom WHERE product_item_id = $1 AND status = 'EFFECTIVE' AND id <> $2 FOR UPDATE",
            [row.product_item_id, row.id]
          )
        ).rows as KitBomRow[];
        for (const p of prevRows) {
          await runTransition(
            tx,
            bomMachine,
            actor,
            {
              id: p.id,
              action: "supersede",
              expectedVersion: p.version,
              reason: `Thay thế bởi BOM ${row.code} (v${row.bom_version})`,
            },
            { trusted: true }
          );
        }
      },
      patch: ({ actor }) => ({ approved_by: actor.userId, approved_at: new Date() }),
    },
    {
      action: "supersede",
      from: "EFFECTIVE",
      to: "OBSOLETE",
      permission: "kit.bom.approve",
    },
    {
      action: "obsolete",
      from: "EFFECTIVE",
      to: "OBSOLETE",
      permission: "kit.bom.approve",
      reasonRequired: true,
    },
  ],
});

/**
 * Kit Routing State Machine (docs/nha-may/02 §8.1):
 * DRAFT → IN_REVIEW → EFFECTIVE ✍ → OBSOLETE
 * Activating a new Routing version uses `beforeUpdate` to supersede any previous EFFECTIVE Routing with full audit trail.
 */
export const routingMachine = defineMachine<SpecDocStatus, KitRoutingRow>({
  entityType: "kit_routing",
  table: "kit.routing",
  states: ["DRAFT", "IN_REVIEW", "EFFECTIVE", "OBSOLETE"],
  terminal: ["OBSOLETE"],
  scopeOf: (row) => row.org_unit_id,
  transitions: [
    {
      action: "submit_review",
      from: "DRAFT",
      to: "IN_REVIEW",
      permission: "kit.bom.manage",
      guards: [
        {
          code: "EMPTY_ROUTING",
          message: "Quy trình công đoạn (Routing) phải có ít nhất một bước sản xuất trước khi gửi duyệt.",
          check: async ({ tx, row }) => {
            const c = await tx.query("SELECT 1 FROM kit.routing_step WHERE routing_id = $1 LIMIT 1", [row.id]);
            return (c.rowCount ?? 0) > 0;
          },
        },
      ],
    },
    {
      action: "return_draft",
      from: "IN_REVIEW",
      to: "DRAFT",
      permission: "kit.bom.approve",
      reasonRequired: true,
    },
    {
      action: "approve",
      from: "IN_REVIEW",
      to: "EFFECTIVE",
      permission: "kit.bom.approve",
      signature: "APPROVED",
      guards: [notAuthorGuard("quy trình công đoạn Routing")],
      beforeUpdate: async ({ tx, actor, row }) => {
        const prevRows = (
          await tx.query(
            "SELECT * FROM kit.routing WHERE product_item_id = $1 AND status = 'EFFECTIVE' AND id <> $2 FOR UPDATE",
            [row.product_item_id, row.id]
          )
        ).rows as KitRoutingRow[];
        for (const p of prevRows) {
          await runTransition(
            tx,
            routingMachine,
            actor,
            {
              id: p.id,
              action: "supersede",
              expectedVersion: p.version,
              reason: `Thay thế bởi Routing ${row.code} (v${row.routing_version})`,
            },
            { trusted: true }
          );
        }
      },
      patch: ({ actor }) => ({ approved_by: actor.userId, approved_at: new Date() }),
    },
    {
      action: "supersede",
      from: "EFFECTIVE",
      to: "OBSOLETE",
      permission: "kit.bom.approve",
    },
    {
      action: "obsolete",
      from: "EFFECTIVE",
      to: "OBSOLETE",
      permission: "kit.bom.approve",
      reasonRequired: true,
    },
  ],
});

const createBomSchema = z.object({
  org_unit_id: z.string().uuid("chọn phòng Sản xuất Kit"),
  product_item_id: z.string().uuid("chọn sản phẩm Kit / Bán thành phẩm"),
  name: z.string().trim().min(3, "nhập tên định mức BOM").max(250),
  base_qty: z.coerce.number().positive().default(1),
  base_uom: z.string().trim().min(1).optional(),
  tests_per_kit: z.coerce.number().int().positive("số phản ứng/kit phải > 0").default(50),
  shelf_life_days: z.coerce.number().int().positive("hạn dùng (ngày) phải > 0").default(365),
  shelf_life_months: z.coerce.number().int().positive().optional().nullable(),
  qc_spec_id: z.string().uuid().optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  clone_from_bom_id: z.string().uuid().optional().nullable(),
  bom_type: z.enum(["finished_good", "semi_finished"]).optional(),
  bom_category: z.string().trim().max(80).optional().nullable(),
  parent_item_code: z.string().trim().max(80).optional().nullable(),
  tccs_code: z.string().trim().max(120).optional().nullable(),
  tccs_file_name: z.string().trim().max(250).optional().nullable(),
  tccs_file_url: z.string().optional().nullable(),
  registration_no: z.string().trim().max(120).optional().nullable(),
  responsible_person_id: z.string().trim().max(80).optional().nullable(),
  responsible_person_name: z.string().trim().max(150).optional().nullable(),
  qc_assignee_name: z.string().trim().max(150).optional().nullable(),
  specification: z.string().trim().max(200).optional().nullable(),
  storage_condition: z.string().trim().max(120).optional().nullable(),
  qc_retention_qty: z.coerce.number().min(0).optional().nullable(),
  ph_min: z.coerce.number().optional().nullable(),
  ph_max: z.coerce.number().optional().nullable(),
  ifu_file_name: z.string().trim().max(250).optional().nullable(),
  ifu_file_url: z.string().optional().nullable(),
  ifu_file_size: z.string().trim().max(60).optional().nullable(),
  ifu_aliquoted_file_name: z.string().trim().max(250).optional().nullable(),
  ifu_aliquoted_file_url: z.string().optional().nullable(),
  ifu_aliquoted_file_size: z.string().trim().max(60).optional().nullable(),
});

export function inferParentItemCode(code: string): string | null {
  const trimmed = (code || "").trim();
  if (!trimmed) return null;
  if (trimmed.toUpperCase().endsWith(".D.IC")) {
    return trimmed.slice(0, -5);
  }
  const parenMatch = trimmed.match(/^(.+?)\s*\([^)]+\)$/);
  if (parenMatch) return parenMatch[1].trim();
  return null;
}

export async function createBom(tx: Tx, actor: AuthzActor, input: unknown) {
  await ensureKitBomRoutingAndIfuSchema(tx);
  const d = parseInput(createBomSchema, input);
  await authorize(tx, actor, "kit.bom.manage", d.org_unit_id);
  const product = await getItem(tx, d.product_item_id);
  const baseUom = d.base_uom ?? product.base_uom;
  await toBaseQty(tx, product, d.base_qty, baseUom);

  const inferredBomType: "finished_good" | "semi_finished" =
    d.bom_type ??
    (product.item_type === "SEMI_FINISHED" || /^(BTP|SFG|ST|MIX)/i.test(product.code)
      ? "semi_finished"
      : "finished_good");

  const inferredCategory =
    d.bom_category?.trim() ||
    (/pcr|topsensi|hi-|sqh|abp|qpc/i.test(`${product.code} ${product.name}`) ? "PCR Kit" : "Tách chiết / Khác");

  const shelfMonths = d.shelf_life_months ?? Math.max(1, Math.round(d.shelf_life_days / 30));
  const shelfDays = d.shelf_life_days || shelfMonths * 30;
  const parentCode = d.parent_item_code?.trim() || inferParentItemCode(product.code);

  const nextVer = Number(
    (
      await tx.query("SELECT coalesce(max(bom_version), 0) + 1 AS v FROM kit.bom WHERE product_item_id = $1", [
        d.product_item_id,
      ])
    ).rows[0].v
  );
  const code = await nextNumber(tx, "KIT_BOM");
  const bom = await insertRecord<KitBomRow>(tx, actor, "kit.bom", "kit_bom", {
    code,
    org_unit_id: d.org_unit_id,
    product_item_id: d.product_item_id,
    bom_version: nextVer,
    name: d.name,
    base_qty: d.base_qty,
    base_uom: baseUom,
    tests_per_kit: d.tests_per_kit,
    shelf_life_days: shelfDays,
    qc_spec_id: d.qc_spec_id ?? null,
    notes: d.notes ?? null,
  });

  await tx.query(
    `UPDATE kit.bom
        SET bom_type = $2,
            bom_category = $3,
            parent_item_code = $4,
            tccs_code = $5,
            tccs_file_name = $6,
            tccs_file_url = $7,
            registration_no = $8,
            responsible_person_id = $9,
            responsible_person_name = $10,
            qc_assignee_name = $11,
            specification = $12,
            storage_condition = $13,
            shelf_life_months = $14,
            qc_retention_qty = $15,
            ph_min = $16,
            ph_max = $17,
            ifu_file_name = $18,
            ifu_file_url = $19,
            ifu_file_size = $20,
            ifu_aliquoted_file_name = $21,
            ifu_aliquoted_file_url = $22,
            ifu_aliquoted_file_size = $23
      WHERE id = $1`,
    [
      bom.id,
      inferredBomType,
      inferredCategory,
      parentCode,
      d.tccs_code?.trim() || (inferredBomType === "finished_good" ? `TCCS ${product.code}:2026/ABT` : null),
      d.tccs_file_name?.trim() || null,
      d.tccs_file_url || null,
      d.registration_no?.trim() || null,
      d.responsible_person_id?.trim() || null,
      d.responsible_person_name?.trim() || null,
      d.qc_assignee_name?.trim() || null,
      d.specification?.trim() || (inferredBomType === "finished_good" ? `Hộp ${d.tests_per_kit} test` : `Lô chuẩn ${d.base_qty} ${baseUom}`),
      d.storage_condition?.trim() || (inferredCategory === "PCR Kit" ? "-20°C ± 2°C" : "15°C...25°C"),
      shelfMonths,
      d.qc_retention_qty ?? (inferredBomType === "finished_good" ? 1 : 0),
      d.ph_min ?? null,
      d.ph_max ?? null,
      d.ifu_file_name?.trim() || null,
      d.ifu_file_url || null,
      d.ifu_file_size?.trim() || null,
      d.ifu_aliquoted_file_name?.trim() || null,
      d.ifu_aliquoted_file_url || null,
      d.ifu_aliquoted_file_size?.trim() || null,
    ]
  );

  if (d.clone_from_bom_id) {
    await tx.query(
      `INSERT INTO kit.bom_line
         (bom_id, line_no, component_item_id, qty_per_base, qty_per_base_aliquoted, uom, scrap_pct, box_no, component_role,
          is_critical, is_bundled, bundle_parent_code, allow_substitute, is_mix_component, is_demo_fixed_component, include_in_qc_retention, notes, created_by, updated_by)
       SELECT $1, line_no, component_item_id, qty_per_base, qty_per_base_aliquoted, uom, scrap_pct, box_no, component_role,
              is_critical, is_bundled, bundle_parent_code, allow_substitute, is_mix_component, is_demo_fixed_component, include_in_qc_retention, notes, $2, $2
         FROM kit.bom_line WHERE bom_id = $3 ORDER BY line_no`,
      [bom.id, actor.userId, d.clone_from_bom_id]
    );
    await tx.query(
      `INSERT INTO kit.kit_packaging
         (bom_id, box_no, box_name, component_name, container_type, fill_qty, fill_uom, units_per_kit, storage_temp, label_spec)
       SELECT $1, box_no, box_name, component_name, container_type, fill_qty, fill_uom, units_per_kit, storage_temp, label_spec
         FROM kit.kit_packaging WHERE bom_id = $2 ORDER BY box_no, id`,
      [bom.id, d.clone_from_bom_id]
    );
  }
  return bom;
}

export async function updateBomHeader(tx: Tx, actor: AuthzActor, bomId: string, input: Record<string, unknown>) {
  await ensureKitBomRoutingAndIfuSchema(tx);
  const bom = (await tx.query("SELECT * FROM kit.bom WHERE id = $1 FOR UPDATE", [bomId])).rows[0] as Record<string, unknown> | undefined;
  if (!bom) throw notFound("định mức BOM");
  await authorize(tx, actor, "kit.bom.manage", String(bom.org_unit_id));

  const name = input.name !== undefined ? String(input.name).trim() : String(bom.name);
  const testsPerKit = input.tests_per_kit !== undefined ? Math.max(1, Number(input.tests_per_kit) || 50) : Number(bom.tests_per_kit || 50);
  const shelfMonths =
    input.shelf_life_months !== undefined && input.shelf_life_months !== null && input.shelf_life_months !== ""
      ? Math.max(1, Number(input.shelf_life_months))
      : Number(bom.shelf_life_months || Math.max(1, Math.round(Number(bom.shelf_life_days || 365) / 30)));
  const shelfDays =
    input.shelf_life_days !== undefined && input.shelf_life_days !== null && input.shelf_life_days !== ""
      ? Math.max(1, Number(input.shelf_life_days))
      : shelfMonths * 30;

  const updated = (
    await tx.query(
      `UPDATE kit.bom
          SET name = $2,
              tests_per_kit = $3,
              shelf_life_days = $4,
              shelf_life_months = $5,
              bom_type = $6,
              bom_category = $7,
              parent_item_code = $8,
              tccs_code = $9,
              tccs_file_name = $10,
              tccs_file_url = $11,
              registration_no = $12,
              responsible_person_id = $13,
              responsible_person_name = $14,
              qc_assignee_name = $15,
              specification = $16,
              storage_condition = $17,
              qc_retention_qty = $18,
              ph_min = $19,
              ph_max = $20,
              notes = $21,
              updated_at = now(),
              updated_by = $22
        WHERE id = $1
        RETURNING *`,
      [
        bomId,
        name,
        testsPerKit,
        shelfDays,
        shelfMonths,
        input.bom_type === "semi_finished" ? "semi_finished" : "finished_good",
        input.bom_category ? String(input.bom_category).trim() : String(bom.bom_category || "PCR Kit"),
        input.parent_item_code ? String(input.parent_item_code).trim() : null,
        input.tccs_code ? String(input.tccs_code).trim() : null,
        input.tccs_file_name !== undefined ? (input.tccs_file_name ? String(input.tccs_file_name).trim() : null) : bom.tccs_file_name,
        input.tccs_file_url !== undefined ? (input.tccs_file_url ? String(input.tccs_file_url) : null) : bom.tccs_file_url,
        input.registration_no ? String(input.registration_no).trim() : null,
        input.responsible_person_id ? String(input.responsible_person_id).trim() : null,
        input.responsible_person_name ? String(input.responsible_person_name).trim() : null,
        input.qc_assignee_name ? String(input.qc_assignee_name).trim() : null,
        input.specification ? String(input.specification).trim() : null,
        input.storage_condition ? String(input.storage_condition).trim() : null,
        input.qc_retention_qty !== undefined && input.qc_retention_qty !== "" ? Number(input.qc_retention_qty) : Number(bom.qc_retention_qty ?? 0),
        input.ph_min !== undefined && input.ph_min !== null && input.ph_min !== "" ? Number(input.ph_min) : null,
        input.ph_max !== undefined && input.ph_max !== null && input.ph_max !== "" ? Number(input.ph_max) : null,
        input.notes !== undefined ? (input.notes ? String(input.notes).trim() : null) : bom.notes,
        actor.userId,
      ]
    )
  ).rows[0];

  await writeAudit(tx, actor, {
    entityType: "kit_bom",
    entityId: bomId,
    action: "update_bom_header",
    changes: {
      bom_type: [bom.bom_type, updated.bom_type],
      tccs_code: [bom.tccs_code, updated.tccs_code],
      responsible_person_name: [bom.responsible_person_name, updated.responsible_person_name],
    },
  });
  return updated;
}

const bomLineItemSchema = z.object({
  component_item_id: z.string().uuid("chọn nguyên vật liệu / bán thành phẩm"),
  qty_per_base: z.coerce.number().positive("định mức phải > 0"),
  qty_per_base_aliquoted: z.coerce.number().positive().optional().nullable(),
  uom: z.string().trim().min(1),
  scrap_pct: z.coerce.number().min(0).max(100).default(0),
  box_no: z.coerce.number().int().positive().default(1),
  component_role: z
    .enum([
      "MASTER_MIX",
      "PRIMER_PROBE",
      "ENZYME",
      "POSITIVE_CONTROL",
      "NEGATIVE_CONTROL",
      "EXTRACTION_BUFFER",
      "PACKAGING",
      "SEMI_FINISHED",
      "REAGENT",
    ])
    .default("REAGENT"),
  is_critical: z.boolean().default(true),
  is_bundled: z.boolean().default(false),
  bundle_parent_code: z.string().trim().max(80).optional().nullable(),
  allow_substitute: z.boolean().default(false),
  is_mix_component: z.boolean().optional(),
  is_demo_fixed_component: z.boolean().optional(),
  include_in_qc_retention: z.boolean().optional(),
  notes: z.string().trim().max(500).optional().nullable(),
});

const bomLineSchema = bomLineItemSchema.extend({
  bom_id: z.string().uuid("chọn BOM"),
});

export async function addBomLine(tx: Tx, actor: AuthzActor, input: unknown) {
  const d = parseInput(bomLineSchema, input);
  const bom = (await tx.query("SELECT * FROM kit.bom WHERE id = $1 FOR UPDATE", [d.bom_id])).rows[0] as KitBomRow | undefined;
  if (!bom) throw notFound("định mức BOM");
  await authorize(tx, actor, "kit.bom.manage", bom.org_unit_id);
  if (bom.status === "OBSOLETE") throw invalid("Không thể chỉnh sửa BOM đã hết hiệu lực (OBSOLETE).");
  if (d.component_item_id === bom.product_item_id) {
    throw invalid("Nguyên vật liệu thành phần không được trùng với sản phẩm đầu ra của BOM.");
  }
  const compItem = await getItem(tx, d.component_item_id);
  await toBaseQty(tx, compItem, d.qty_per_base, d.uom);

  const isPackaging = d.component_role === "PACKAGING" || compItem.item_type === "PACKAGING";
  const isMixComponent = d.is_mix_component ?? !isPackaging;
  const isDemoFixed = d.is_demo_fixed_component ?? isPackaging;
  const includeInQcRet = d.include_in_qc_retention ?? !isPackaging;

  const nextLine = Number(
    (await tx.query("SELECT coalesce(max(line_no), 0) + 1 AS n FROM kit.bom_line WHERE bom_id = $1", [d.bom_id])).rows[0].n
  );
  const row = (
    await tx.query(
      `INSERT INTO kit.bom_line
         (bom_id, line_no, component_item_id, qty_per_base, qty_per_base_aliquoted, uom, scrap_pct, box_no, component_role,
          is_critical, is_bundled, bundle_parent_code, allow_substitute, is_mix_component, is_demo_fixed_component, include_in_qc_retention, notes, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $18) RETURNING *`,
      [
        d.bom_id,
        nextLine,
        d.component_item_id,
        d.qty_per_base,
        d.qty_per_base_aliquoted ?? null,
        d.uom,
        d.scrap_pct,
        d.box_no,
        d.component_role,
        d.is_critical,
        d.is_bundled,
        d.bundle_parent_code ?? null,
        d.allow_substitute,
        isMixComponent,
        isDemoFixed,
        includeInQcRet,
        d.notes ?? null,
        actor.userId,
      ]
    )
  ).rows[0];
  await writeAudit(tx, actor, {
    entityType: "kit_bom",
    entityId: d.bom_id,
    action: "add_bom_line",
    changes: { line: [null, `#${nextLine} ${compItem.code} (${d.qty_per_base} ${d.uom}, Hộp ${d.box_no})`] },
  });
  return row;
}

export async function updateBomLine(tx: Tx, actor: AuthzActor, bomId: string, input: Record<string, unknown>) {
  const lineId = String(input.line_id || "");
  if (!lineId) throw invalid("Thiếu ID dòng BOM cần chỉnh sửa.");
  const bom = (await tx.query("SELECT * FROM kit.bom WHERE id = $1 FOR UPDATE", [bomId])).rows[0] as KitBomRow | undefined;
  if (!bom) throw notFound("định mức BOM");
  await authorize(tx, actor, "kit.bom.manage", bom.org_unit_id);
  if (bom.status === "OBSOLETE") throw invalid("Không thể chỉnh sửa BOM đã hết hiệu lực (OBSOLETE).");

  const existing = (await tx.query("SELECT * FROM kit.bom_line WHERE id = $1 AND bom_id = $2", [lineId, bomId])).rows[0];
  if (!existing) throw notFound("dòng nguyên vật liệu BOM");

  const compId = String(input.component_item_id || existing.component_item_id);
  const compItem = await getItem(tx, compId);
  const qty = Number(input.qty_per_base ?? existing.qty_per_base);
  const qtyAliq =
    input.qty_per_base_aliquoted !== undefined && input.qty_per_base_aliquoted !== "" && input.qty_per_base_aliquoted !== null
      ? Number(input.qty_per_base_aliquoted)
      : null;
  const uom = String(input.uom || existing.uom || compItem.base_uom);
  const scrapPct = Number(input.scrap_pct ?? existing.scrap_pct ?? 0);
  const boxNo = Math.max(1, Number(input.box_no ?? existing.box_no ?? 1));
  const role = String(input.component_role || existing.component_role || "REAGENT");
  const isBundled = input.is_bundled !== undefined ? Boolean(input.is_bundled) : Boolean(existing.is_bundled);
  const allowSub = input.allow_substitute !== undefined ? Boolean(input.allow_substitute) : Boolean(existing.allow_substitute);
  const isDemoFixed =
    input.is_demo_fixed_component !== undefined
      ? Boolean(input.is_demo_fixed_component)
      : Boolean(existing.is_demo_fixed_component);
  const incRetention =
    input.include_in_qc_retention !== undefined
      ? Boolean(input.include_in_qc_retention)
      : Boolean(existing.include_in_qc_retention ?? true);

  const row = (
    await tx.query(
      `UPDATE kit.bom_line
          SET component_item_id = $2,
              qty_per_base = $3,
              qty_per_base_aliquoted = $4,
              uom = $5,
              scrap_pct = $6,
              box_no = $7,
              component_role = $8,
              is_bundled = $9,
              allow_substitute = $10,
              is_demo_fixed_component = $11,
              is_mix_component = $12,
              include_in_qc_retention = $13,
              updated_by = $14,
              updated_at = now()
        WHERE id = $1
        RETURNING *`,
      [
        lineId,
        compId,
        qty,
        qtyAliq,
        uom,
        scrapPct,
        boxNo,
        role,
        isBundled,
        allowSub,
        isDemoFixed,
        !isDemoFixed,
        incRetention,
        actor.userId,
      ]
    )
  ).rows[0];

  await writeAudit(tx, actor, {
    entityType: "kit_bom",
    entityId: bomId,
    action: "update_bom_line",
    changes: { line: [`#${existing.line_no}`, `#${existing.line_no} ${compItem.code} (${qty} ${uom}, Hộp ${boxNo})`] },
  });
  return row;
}

export async function deleteBomLine(tx: Tx, actor: AuthzActor, bomId: string, lineId: string) {
  const bom = (await tx.query("SELECT * FROM kit.bom WHERE id = $1 FOR UPDATE", [bomId])).rows[0] as KitBomRow | undefined;
  if (!bom) throw notFound("định mức BOM");
  await authorize(tx, actor, "kit.bom.manage", bom.org_unit_id);
  if (bom.status === "OBSOLETE") throw invalid("Không thể xóa dòng của BOM đã hết hiệu lực (OBSOLETE).");

  await tx.query("DELETE FROM kit.bom_line WHERE id = $1 AND bom_id = $2", [lineId, bomId]);
  await tx.query(
    `WITH ordered AS (
       SELECT id, row_number() OVER (ORDER BY box_no, line_no, id) AS rn
         FROM kit.bom_line WHERE bom_id = $1
     )
     UPDATE kit.bom_line bl SET line_no = ordered.rn FROM ordered WHERE bl.id = ordered.id`,
    [bomId]
  );
  await writeAudit(tx, actor, {
    entityType: "kit_bom",
    entityId: bomId,
    action: "delete_bom_line",
    changes: { deleted_line_id: [lineId, null] },
  });
  return { deleted: true };
}

const bomLineSubSchema = z.object({
  bom_line_id: z.string().uuid("chọn dòng BOM"),
  substitute_item_id: z.string().uuid("chọn vật tư thay thế"),
  conversion_factor: z.coerce.number().positive().default(1),
  priority: z.coerce.number().int().positive().default(1),
  notes: z.string().trim().max(300).optional().nullable(),
});

export async function addBomLineSubstitute(tx: Tx, actor: AuthzActor, input: unknown) {
  const d = parseInput(bomLineSubSchema, input);
  const line = (
    await tx.query(
      "SELECT bl.*, b.org_unit_id, b.id AS bom_id FROM kit.bom_line bl JOIN kit.bom b ON b.id = bl.bom_id WHERE bl.id = $1 FOR UPDATE",
      [d.bom_line_id]
    )
  ).rows[0];
  if (!line) throw notFound("dòng nguyên liệu BOM");
  await authorize(tx, actor, "kit.bom.manage", line.org_unit_id);
  if (d.substitute_item_id === line.component_item_id) {
    throw invalid("Vật tư thay thế không được trùng với vật tư chính của dòng BOM.");
  }
  const subItem = await getItem(tx, d.substitute_item_id);
  const row = (
    await tx.query(
      `INSERT INTO kit.bom_line_substitute (bom_line_id, substitute_item_id, conversion_factor, priority, notes)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (bom_line_id, substitute_item_id)
       DO UPDATE SET conversion_factor = EXCLUDED.conversion_factor, priority = EXCLUDED.priority, notes = EXCLUDED.notes
       RETURNING *`,
      [d.bom_line_id, d.substitute_item_id, d.conversion_factor, d.priority, d.notes ?? null]
    )
  ).rows[0];
  await tx.query("UPDATE kit.bom_line SET allow_substitute = true WHERE id = $1", [d.bom_line_id]);
  await writeAudit(tx, actor, {
    entityType: "kit_bom",
    entityId: line.bom_id,
    action: "add_bom_line_substitute",
    changes: { substitute: [null, `Line #${line.line_no} -> ${subItem.code} (x${d.conversion_factor})`] },
  });
  return row;
}

const bulkBomLinesSchema = z.object({
  bom_id: z.string().uuid("chọn BOM"),
  lines: z.array(bomLineItemSchema).min(1, "nhập ít nhất 1 dòng nguyên liệu").max(2000),
});

/**
 * High-volume batch insert of up to 2,000 BOM lines in a single SQL statement (`UNNEST`),
 * designed for complex multi-box kits and large batch formula imports.
 */
export async function bulkAddBomLines(tx: Tx, actor: AuthzActor, input: unknown) {
  const d = parseInput(bulkBomLinesSchema, input);
  const bom = (await tx.query("SELECT * FROM kit.bom WHERE id = $1 FOR UPDATE", [d.bom_id])).rows[0] as KitBomRow | undefined;
  if (!bom) throw notFound("định mức BOM");
  await authorize(tx, actor, "kit.bom.manage", bom.org_unit_id);
  if (bom.status === "OBSOLETE") throw invalid("Không thể chỉnh sửa BOM đã hết hiệu lực (OBSOLETE).");

  for (const l of d.lines) {
    if (l.component_item_id === bom.product_item_id) {
      throw invalid("Nguyên vật liệu thành phần không được trùng với sản phẩm đầu ra của BOM.");
    }
  }

  const startLine = Number(
    (await tx.query("SELECT coalesce(max(line_no), 0) AS n FROM kit.bom_line WHERE bom_id = $1", [d.bom_id])).rows[0].n
  );

  const lineNos = d.lines.map((_, idx) => startLine + idx + 1);
  const compIds = d.lines.map((l) => l.component_item_id);
  const qtys = d.lines.map((l) => l.qty_per_base);
  const uoms = d.lines.map((l) => l.uom);
  const scraps = d.lines.map((l) => l.scrap_pct);
  const boxes = d.lines.map((l) => l.box_no);
  const roles = d.lines.map((l) => l.component_role);
  const criticals = d.lines.map((l) => l.is_critical);
  const bundleds = d.lines.map((l) => l.is_bundled);
  const substitutes = d.lines.map((l) => l.allow_substitute);
  const notes = d.lines.map((l) => l.notes ?? null);

  const inserted = (
    await tx.query(
      `INSERT INTO kit.bom_line
         (bom_id, line_no, component_item_id, qty_per_base, uom, scrap_pct, box_no, component_role,
          is_critical, is_bundled, allow_substitute, notes, created_by, updated_by)
       SELECT $1, u.line_no, u.comp_id, u.qty, u.uom, u.scrap, u.box_no, u.role,
              u.is_crit, u.is_bund, u.allow_sub, u.note, $2, $2
         FROM unnest(
           $3::int[], $4::uuid[], $5::numeric[], $6::text[], $7::numeric[],
           $8::int[], $9::text[], $10::bool[], $11::bool[], $12::bool[], $13::text[]
         ) AS u(line_no, comp_id, qty, uom, scrap, box_no, role, is_crit, is_bund, allow_sub, note)
       RETURNING *`,
      [
        d.bom_id,
        actor.userId,
        lineNos,
        compIds,
        qtys,
        uoms,
        scraps,
        boxes,
        roles,
        criticals,
        bundleds,
        substitutes,
        notes,
      ]
    )
  ).rows;

  await writeAudit(tx, actor, {
    entityType: "kit_bom",
    entityId: d.bom_id,
    action: "bulk_add_bom_lines",
    changes: { lines_added: [0, inserted.length] },
  });
  return inserted;
}

const packagingSchema = z.object({
  bom_id: z.string().uuid("chọn BOM"),
  box_no: z.coerce.number().int().positive().default(1),
  box_name: z.string().trim().min(2, "nhập tên hộp (ví dụ Hộp 1: Hóa chất khuếch đại)").max(200),
  component_name: z.string().trim().min(2, "nhập tên ống/chai thành phần").max(200),
  container_type: z
    .enum(["TUBE_0_5ML", "TUBE_1_5ML", "TUBE_2_0ML", "BOTTLE_10ML", "BOTTLE_50ML", "STRIP_8", "PLATE_96", "BOX_OUTER"])
    .default("TUBE_1_5ML"),
  fill_qty: z.coerce.number().positive("thể tích/lượng chiết rót phải > 0"),
  fill_uom: z.string().trim().min(1).default("µL"),
  units_per_kit: z.coerce.number().int().positive("số ống/chai trên mỗi bộ Kit phải ≥ 1").default(1),
  storage_temp: z.string().trim().max(60).default("-20°C"),
  label_spec: z.string().trim().max(300).optional().nullable(),
});

export async function addKitPackaging(tx: Tx, actor: AuthzActor, input: unknown) {
  const d = parseInput(packagingSchema, input);
  const bom = (await tx.query("SELECT * FROM kit.bom WHERE id = $1 FOR UPDATE", [d.bom_id])).rows[0] as KitBomRow | undefined;
  if (!bom) throw notFound("định mức BOM");
  await authorize(tx, actor, "kit.bom.manage", bom.org_unit_id);
  if (bom.status === "OBSOLETE") throw invalid("Không thể chỉnh sửa cấu trúc đóng gói khi BOM đã hết hiệu lực (OBSOLETE).");

  const row = (
    await tx.query(
      `INSERT INTO kit.kit_packaging
         (bom_id, box_no, box_name, component_name, container_type, fill_qty, fill_uom, units_per_kit, storage_temp, label_spec)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [
        d.bom_id,
        d.box_no,
        d.box_name,
        d.component_name,
        d.container_type,
        d.fill_qty,
        d.fill_uom,
        d.units_per_kit,
        d.storage_temp,
        d.label_spec ?? null,
      ]
    )
  ).rows[0];
  await writeAudit(tx, actor, {
    entityType: "kit_bom",
    entityId: d.bom_id,
    action: "add_packaging",
    changes: { packaging: [null, `Hộp ${d.box_no} (${d.box_name}): ${d.units_per_kit} × ${d.component_name} (${d.fill_qty} ${d.fill_uom})`] },
  });
  return row;
}

const updatePackagingSchema = packagingSchema.extend({
  pack_id: z.string().uuid("chọn quy cách đóng gói"),
});

export async function updateKitPackaging(tx: Tx, actor: AuthzActor, bomId: string, input: unknown) {
  const d = parseInput(updatePackagingSchema, { ...(input as Record<string, unknown>), bom_id: bomId });
  const bom = (await tx.query("SELECT * FROM kit.bom WHERE id = $1 FOR UPDATE", [bomId])).rows[0] as KitBomRow | undefined;
  if (!bom) throw notFound("định mức BOM");
  await authorize(tx, actor, "kit.bom.manage", bom.org_unit_id);
  if (bom.status === "OBSOLETE") throw invalid("Không thể chỉnh sửa cấu trúc đóng gói khi BOM đã hết hiệu lực (OBSOLETE).");

  const existing = (await tx.query("SELECT * FROM kit.kit_packaging WHERE id = $1 AND bom_id = $2", [d.pack_id, bomId])).rows[0];
  if (!existing) throw notFound("quy cách đóng gói");

  const row = (
    await tx.query(
      `UPDATE kit.kit_packaging
          SET box_no = $1,
              box_name = $2,
              component_name = $3,
              container_type = $4,
              fill_qty = $5,
              fill_uom = $6,
              units_per_kit = $7,
              storage_temp = $8,
              label_spec = $9
        WHERE id = $10 AND bom_id = $11
        RETURNING *`,
      [
        d.box_no,
        d.box_name,
        d.component_name,
        d.container_type,
        d.fill_qty,
        d.fill_uom,
        d.units_per_kit,
        d.storage_temp,
        d.label_spec ?? null,
        d.pack_id,
        bomId,
      ]
    )
  ).rows[0];
  await writeAudit(tx, actor, {
    entityType: "kit_bom",
    entityId: bomId,
    action: "update_packaging",
    changes: {
      packaging: [
        `Hộp ${existing.box_no}: ${existing.component_name}`,
        `Hộp ${d.box_no} (${d.box_name}): ${d.units_per_kit} × ${d.component_name} (${d.fill_qty} ${d.fill_uom})`,
      ],
    },
  });
  return row;
}

export async function deleteKitPackaging(tx: Tx, actor: AuthzActor, bomId: string, packId: string) {
  const bom = (await tx.query("SELECT * FROM kit.bom WHERE id = $1 FOR UPDATE", [bomId])).rows[0] as KitBomRow | undefined;
  if (!bom) throw notFound("định mức BOM");
  await authorize(tx, actor, "kit.bom.manage", bom.org_unit_id);
  if (bom.status === "OBSOLETE") throw invalid("Không thể xóa quy cách đóng gói khi BOM đã hết hiệu lực (OBSOLETE).");

  const existing = (await tx.query("SELECT * FROM kit.kit_packaging WHERE id = $1 AND bom_id = $2", [packId, bomId])).rows[0];
  if (!existing) throw notFound("quy cách đóng gói");

  await tx.query("DELETE FROM kit.kit_packaging WHERE id = $1 AND bom_id = $2", [packId, bomId]);
  await writeAudit(tx, actor, {
    entityType: "kit_bom",
    entityId: bomId,
    action: "delete_packaging",
    changes: { packaging: [`Hộp ${existing.box_no}: ${existing.component_name}`, null] },
  });
  return { deleted: true, id: packId };
}

export async function syncPackagingFromBomLines(tx: Tx, actor: AuthzActor, bomId: string) {
  const bom = (await tx.query("SELECT * FROM kit.bom WHERE id = $1 FOR UPDATE", [bomId])).rows[0] as KitBomRow | undefined;
  if (!bom) throw notFound("định mức BOM");
  await authorize(tx, actor, "kit.bom.manage", bom.org_unit_id);
  if (bom.status === "OBSOLETE") throw invalid("Không thể đồng bộ quy cách đóng gói khi BOM đã hết hiệu lực (OBSOLETE).");

  const lines = (
    await tx.query(
      `SELECT bl.*, it.sku AS component_sku, it.name AS component_name, it.storage_condition
         FROM kit.bom_line bl
         JOIN inv.item it ON it.id = bl.component_item_id
        WHERE bl.bom_id = $1
        ORDER BY bl.box_no ASC, bl.line_no ASC`,
      [bomId]
    )
  ).rows as Array<Record<string, unknown>>;

  const existingRows = (await tx.query("SELECT component_name FROM kit.kit_packaging WHERE bom_id = $1", [bomId])).rows as Array<{
    component_name: string;
  }>;
  const existingSet = new Set(existingRows.map((r) => r.component_name.trim().toLowerCase()));

  let added = 0;
  for (const l of lines) {
    const role = String(l.role || "");
    if (role === "BOX" || role === "IFU") continue;
    const compTitle = `${l.component_sku} — ${l.component_name}`;
    if (existingSet.has(compTitle.trim().toLowerCase()) || existingSet.has(String(l.component_name).trim().toLowerCase())) {
      continue;
    }
    const qty = Number(l.qty_per_batch || 1);
    const uom = String(l.uom || "µL");
    const uomLower = uom.toLowerCase();
    let containerType = "TUBE_1_5ML";
    if (role === "PLATE_STRIP") containerType = "STRIP_8";
    else if (uomLower === "ml" && qty >= 25) containerType = "BOTTLE_50ML";
    else if (uomLower === "ml" && qty >= 5) containerType = "BOTTLE_10ML";
    else if ((uomLower === "µl" || uomLower === "ul") && qty <= 500) containerType = "TUBE_0_5ML";
    else if ((uomLower === "µl" || uomLower === "ul") && qty > 1500) containerType = "TUBE_2_0ML";

    const boxNo = Number(l.box_no || 1);
    const boxName = boxNo === 1 ? "Hộp 1: Hóa chất / Bán thành phẩm chính" : `Hộp ${boxNo}: Thành phần phụ trợ`;
    const storageTemp = String(l.storage_condition || "-20°C").slice(0, 60);

    await tx.query(
      `INSERT INTO kit.kit_packaging
         (bom_id, box_no, box_name, component_name, container_type, fill_qty, fill_uom, units_per_kit, storage_temp, label_spec)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        bomId,
        boxNo,
        boxName,
        compTitle.slice(0, 200),
        containerType,
        qty > 0 ? qty : 1,
        uom,
        1,
        storageTemp,
        `Tem ống/chai ${l.component_sku} (${qty} ${uom})`,
      ]
    );
    existingSet.add(compTitle.trim().toLowerCase());
    added++;
  }

  await writeAudit(tx, actor, {
    entityType: "kit_bom",
    entityId: bomId,
    action: "sync_packaging_from_bom",
    changes: { added_packaging_count: [0, added] },
  });
  return { added };
}

const createRoutingSchema = z.object({
  org_unit_id: z.string().uuid("chọn phòng Sản xuất Kit"),
  product_item_id: z.string().uuid("chọn sản phẩm Kit / Bán thành phẩm"),
  name: z.string().trim().min(3, "nhập tên quy trình công đoạn (Routing)").max(250),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export async function createRouting(tx: Tx, actor: AuthzActor, input: unknown) {
  const d = parseInput(createRoutingSchema, input);
  await authorize(tx, actor, "kit.bom.manage", d.org_unit_id);
  const nextVer = Number(
    (
      await tx.query("SELECT coalesce(max(routing_version), 0) + 1 AS v FROM kit.routing WHERE product_item_id = $1", [
        d.product_item_id,
      ])
    ).rows[0].v
  );
  const code = await nextNumber(tx, "KIT_ROUTING");
  return insertRecord<KitRoutingRow>(tx, actor, "kit.routing", "kit_routing", {
    code,
    org_unit_id: d.org_unit_id,
    product_item_id: d.product_item_id,
    routing_version: nextVer,
    name: d.name,
    notes: d.notes ?? null,
  });
}

const paramFieldSchema = z.object({
  key: z.string().trim().min(1),
  label: z.string().trim().min(1),
  type: z.enum(["number", "text", "boolean"]).default("number"),
  unit: z.string().trim().optional().nullable(),
  min: z.coerce.number().optional().nullable(),
  max: z.coerce.number().optional().nullable(),
  required: z.boolean().default(true),
});

export type RoutingStepParamDef = z.infer<typeof paramFieldSchema>;

const routingStepSchema = z.object({
  routing_id: z.string().uuid("chọn quy trình Routing"),
  seq: z.coerce.number().int().positive().optional(),
  step_code: z.string().trim().min(2).max(40),
  step_name: z.string().trim().min(2, "nhập tên bước công đoạn").max(250),
  category: z
    .enum(["PREPARATION", "FORMULATION", "FILLING", "LYOPHILIZATION", "QC", "PACKAGING", "LABELING"])
    .default("FORMULATION"),
  instructions: z.string().trim().min(3, "nhập hướng dẫn thao tác công đoạn").max(4000),
  sop_doc_code: z.string().trim().max(80).optional().nullable(),
  required_training_doc_code: z.string().trim().max(80).optional().nullable(),
  required_asset_id: z.string().uuid().optional().nullable(),
  param_schema: z.array(paramFieldSchema).max(30).default([]),
  is_qc: z.boolean().default(false),
  qc_spec_id: z.string().uuid().optional().nullable(),
  requires_check_signature: z.boolean().default(false),
  allow_skip: z.boolean().default(false),
  std_duration_min: z.coerce.number().int().positive().default(30),
});

export async function addRoutingStep(tx: Tx, actor: AuthzActor, input: unknown) {
  const d = parseInput(routingStepSchema, input);
  const rtg = (await tx.query("SELECT * FROM kit.routing WHERE id = $1 FOR UPDATE", [d.routing_id])).rows[0] as
    | KitRoutingRow
    | undefined;
  if (!rtg) throw notFound("quy trình công đoạn (Routing)");
  await authorize(tx, actor, "kit.bom.manage", rtg.org_unit_id);
  if (rtg.status === "OBSOLETE") throw invalid("Không thể thêm bước công đoạn khi quy trình Routing đã hết hiệu lực (OBSOLETE).");

  const seq =
    d.seq ??
    Number(
      (await tx.query("SELECT coalesce(max(seq), 0) + 1 AS s FROM kit.routing_step WHERE routing_id = $1", [d.routing_id])).rows[0].s
    );
  const dup = await tx.query("SELECT 1 FROM kit.routing_step WHERE routing_id = $1 AND seq = $2", [d.routing_id, seq]);
  if (dup.rowCount) throw conflict(`Bước thứ tự #${seq} đã tồn tại trong quy trình này.`, "DUPLICATE_STEP_SEQ");

  const row = (
    await tx.query(
      `INSERT INTO kit.routing_step
         (routing_id, seq, step_code, step_name, category, instructions, sop_doc_code, required_training_doc_code,
          required_asset_id, param_schema, is_qc, qc_spec_id, requires_check_signature, allow_skip, std_duration_min)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING *`,
      [
        d.routing_id,
        seq,
        d.step_code,
        d.step_name,
        d.category,
        d.instructions,
        d.sop_doc_code ?? null,
        d.required_training_doc_code ?? null,
        d.required_asset_id ?? null,
        JSON.stringify(d.param_schema),
        d.is_qc,
        d.qc_spec_id ?? null,
        d.requires_check_signature,
        d.allow_skip,
        d.std_duration_min,
      ]
    )
  ).rows[0];
  await writeAudit(tx, actor, {
    entityType: "kit_routing",
    entityId: d.routing_id,
    action: "add_routing_step",
    changes: { step: [null, `#${seq} ${d.step_code} — ${d.step_name}`] },
  });
  return row;
}

export interface ListFormulaFilter {
  q?: string | null;
  status?: string | null;
  product_item_id?: string | null;
  bom_type?: string | null;
  bom_category?: string | null;
  limit?: number;
  offset?: number;
}

/**
 * Lists BOMs with server-side search, status/product/bom_type filtering, and single-query org-unit scope resolution
 * so thousands of formulas can be searched and paginated cleanly.
 */
let kitBomRoutingIfuSchemaEnsured = false;

export async function ensureKitBomRoutingAndIfuSchema(tx: Tx) {
  if (kitBomRoutingIfuSchemaEnsured) return;
  await tx.query(`
    ALTER TABLE kit.bom
      ADD COLUMN IF NOT EXISTS label_template_code text,
      ADD COLUMN IF NOT EXISTS label_dimensions text,
      ADD COLUMN IF NOT EXISTS udi_di text,
      ADD COLUMN IF NOT EXISTS ifu_code text,
      ADD COLUMN IF NOT EXISTS ifu_version text,
      ADD COLUMN IF NOT EXISTS ifu_intended_use text,
      ADD COLUMN IF NOT EXISTS ifu_thermal_profile text,
      ADD COLUMN IF NOT EXISTS ifu_channels text,
      ADD COLUMN IF NOT EXISTS ifu_interpretation text,
      ADD COLUMN IF NOT EXISTS bom_type text DEFAULT 'finished_good',
      ADD COLUMN IF NOT EXISTS bom_category text DEFAULT 'PCR Kit',
      ADD COLUMN IF NOT EXISTS parent_item_code text,
      ADD COLUMN IF NOT EXISTS tccs_code text,
      ADD COLUMN IF NOT EXISTS tccs_file_name text,
      ADD COLUMN IF NOT EXISTS tccs_file_url text,
      ADD COLUMN IF NOT EXISTS registration_no text,
      ADD COLUMN IF NOT EXISTS responsible_person_id text,
      ADD COLUMN IF NOT EXISTS responsible_person_name text,
      ADD COLUMN IF NOT EXISTS qc_assignee_name text,
      ADD COLUMN IF NOT EXISTS specification text,
      ADD COLUMN IF NOT EXISTS storage_condition text,
      ADD COLUMN IF NOT EXISTS shelf_life_months int DEFAULT 12,
      ADD COLUMN IF NOT EXISTS qc_retention_qty numeric DEFAULT 1,
      ADD COLUMN IF NOT EXISTS ph_min numeric,
      ADD COLUMN IF NOT EXISTS ph_max numeric,
      ADD COLUMN IF NOT EXISTS ifu_file_name text,
      ADD COLUMN IF NOT EXISTS ifu_file_url text,
      ADD COLUMN IF NOT EXISTS ifu_file_size text,
      ADD COLUMN IF NOT EXISTS ifu_updated_at timestamptz,
      ADD COLUMN IF NOT EXISTS ifu_aliquoted_file_name text,
      ADD COLUMN IF NOT EXISTS ifu_aliquoted_file_url text,
      ADD COLUMN IF NOT EXISTS ifu_aliquoted_file_size text,
      ADD COLUMN IF NOT EXISTS label_design_json jsonb DEFAULT '{}'::jsonb
  `);

  await tx.query(`
    ALTER TABLE kit.bom_line
      ADD COLUMN IF NOT EXISTS qty_per_base_aliquoted numeric,
      ADD COLUMN IF NOT EXISTS is_mix_component boolean DEFAULT true,
      ADD COLUMN IF NOT EXISTS is_demo_fixed_component boolean DEFAULT false,
      ADD COLUMN IF NOT EXISTS include_in_qc_retention boolean DEFAULT true
  `);

  // Backfill metadata on existing BOMs if missing
  await tx.query(`
    UPDATE kit.bom b
       SET bom_type = CASE
             WHEN it.item_type = 'SEMI_FINISHED' OR it.code ~* '^(BTP|SFG|ST|MIX)' THEN 'semi_finished'
             ELSE coalesce(nullif(b.bom_type, ''), 'finished_good')
           END,
           bom_category = CASE
             WHEN it.code ~* '(PCR|HBV|HCV|HPV|HI-|SQH|ABP)' OR it.name ~* '(PCR|TopSENSI)' THEN 'PCR Kit'
             ELSE coalesce(nullif(b.bom_category, ''), 'Tách chiết / Khác')
           END,
           parent_item_code = coalesce(
             b.parent_item_code,
             CASE WHEN upper(it.code) LIKE '%.D.IC' THEN substring(it.code from 1 for length(it.code) - 5) ELSE NULL END
           ),
           tccs_code = coalesce(b.tccs_code, CASE WHEN it.item_type <> 'SEMI_FINISHED' THEN 'TCCS 01:2026/ABT' ELSE 'TCCS-BTP:2026/ABT' END),
           registration_no = coalesce(b.registration_no, CASE WHEN it.item_type <> 'SEMI_FINISHED' THEN '2400189/ĐKLH-BYT-TB-CT' ELSE NULL END),
           specification = coalesce(b.specification, CASE WHEN it.item_type = 'SEMI_FINISHED' THEN 'Lô chuẩn 100 mL' ELSE 'Hộp ' || coalesce(b.tests_per_kit, 50)::text || ' test' END),
           storage_condition = coalesce(b.storage_condition, CASE WHEN it.code ~* '(HK-|ST)' THEN '15°C...25°C' ELSE '-20°C ± 2°C' END),
           shelf_life_months = coalesce(b.shelf_life_months, greatest(1, round(coalesce(b.shelf_life_days, 365)::numeric / 30.0)::int)),
           qc_retention_qty = coalesce(b.qc_retention_qty, CASE WHEN it.item_type = 'SEMI_FINISHED' THEN 0 ELSE 1 END),
           ifu_file_name = coalesce(b.ifu_file_name, CASE WHEN it.item_type <> 'SEMI_FINISHED' THEN 'HDSD_' || replace(it.code, '.D.IC', '') || '_Rev01.pdf' ELSE NULL END),
           ifu_file_size = coalesce(b.ifu_file_size, CASE WHEN it.item_type <> 'SEMI_FINISHED' THEN '428 KB (PDF chuẩn ISO 13485)' ELSE NULL END),
           ifu_aliquoted_file_name = coalesce(b.ifu_aliquoted_file_name, CASE WHEN it.item_type <> 'SEMI_FINISHED' THEN 'HDSD_' || replace(it.code, '.D.IC', '') || '.D.IC_ChiaSan_Rev01.pdf' ELSE NULL END),
           ifu_aliquoted_file_size = coalesce(b.ifu_aliquoted_file_size, CASE WHEN it.item_type <> 'SEMI_FINISHED' THEN '452 KB (PDF bản chia sẵn .D.IC)' ELSE NULL END)
      FROM master.item it
     WHERE it.id = b.product_item_id
       AND (b.tccs_code IS NULL OR b.specification IS NULL)
  `);

  // Seed representative Semi-Finished BOMs & Finished Good BOMs from molecularkit-mes if no semi_finished BOM exists yet
  const semiCheck = await tx.query("SELECT count(*)::int AS c FROM kit.bom WHERE bom_type = 'semi_finished'");
  if (Number(semiCheck.rows[0]?.c ?? 0) === 0 && process.env.FACTORY_ALLOW_DEMO_SEED === "1") {
    const kitOrg = (await tx.query("SELECT id FROM core.org_unit WHERE code = 'P-KIT' LIMIT 1")).rows[0]?.id;
    if (kitOrg) {
      const uomRows = (await tx.query("SELECT code FROM master.uom WHERE status = 'ACTIVE'")).rows as Array<{ code: string }>;
      const findUom = (preferred: string[], fallback = "pcs") => {
        for (const p of preferred) {
          const hit = uomRows.find((u) => u.code.toLowerCase() === p.toLowerCase());
          if (hit) return hit.code;
        }
        return uomRows[0]?.code ?? fallback;
      };
      const mlUom = findUom(["mL", "ml", "L", "pcs"]);
      const kitUom = findUom(["kit", "KIT", "box", "pcs"]);

      // Ensure standard semi-finished & finished items from molecularkit-mes exist
      const seedItems = [
        { code: "BTP-MMIX-2X", name: "Bán thành phẩm qPCR MasterMix 2X (Pha sẵn)", type: "SEMI_FINISHED", uom: mlUom, temp: "-20" },
        { code: "BTP-PRIMER-HBV", name: "Bán thành phẩm Hỗn hợp Primer/Probe HBV 10X", type: "SEMI_FINISHED", uom: mlUom, temp: "-20" },
        { code: "ST127", name: "Bán thành phẩm Dung dịch đệm VBL Buffer Ver 2", type: "SEMI_FINISHED", uom: mlUom, temp: "RT" },
        { code: "ST035", name: "Bán thành phẩm Dung dịch rửa WB1 Buffer", type: "SEMI_FINISHED", uom: mlUom, temp: "RT" },
        { code: "HK-008", name: "TopPURE® Viral DNA/RNA Extraction Kit (50 test)", type: "FINISHED_KIT", uom: kitUom, temp: "RT" },
        { code: "HI-712", name: "TopSENSI® HPV-16/18 & High-Risk qPCR Kit (50 test)", type: "FINISHED_KIT", uom: kitUom, temp: "-20" },
      ];
      for (const si of seedItems) {
        await tx.query(
          `INSERT INTO master.item (code, name, item_type, base_uom, tracking, storage_condition, receipt_qc_required, is_purchasable, is_saleable, is_manufacturable, status)
           VALUES ($1, $2, $3, $4, 'LOT', $5, true, false, $6, true, 'ACTIVE')
           ON CONFLICT (code) DO NOTHING`,
          [si.code, si.name, si.type, si.uom, si.temp, si.type === "FINISHED_KIT"]
        );
      }

      const rawItems = (
        await tx.query("SELECT id, code, base_uom FROM master.item WHERE item_type IN ('RAW_MATERIAL', 'REAGENT', 'CONSUMABLE', 'SEMI_FINISHED') ORDER BY code ASC LIMIT 12")
      ).rows as Array<{ id: string; code: string; base_uom: string }>;

      const seedBoms = [
        {
          bom_code: "BOM-BTP-MMIX-2X-V1",
          item_code: "BTP-MMIX-2X",
          name: "BOM Bán thành phẩm qPCR MasterMix 2X (Lô chuẩn 50 mL)",
          bom_type: "semi_finished",
          bom_category: "PCR Kit",
          base_qty: 50,
          base_uom: mlUom,
          tests_per_kit: 2500,
          shelf_life_days: 365,
          shelf_life_months: 12,
          tccs_code: "TCCS-BTP-MMIX:2026/ABT",
          responsible_person_name: "Trần Minh Khoa (Tổ trưởng Pha chế Kit)",
          qc_assignee_name: "Lê Thu Hà (Chuyên viên QC Kit)",
          specification: "Chai 50 mL (Đủ chia 50 bộ Kit 50 test)",
          storage_condition: "-20°C ± 2°C",
          qc_retention_qty: 1,
          ph_min: 8.2,
          ph_max: 8.4,
        },
        {
          bom_code: "BOM-BTP-PRIMER-HBV-V1",
          item_code: "BTP-PRIMER-HBV",
          name: "BOM Bán thành phẩm Hỗn hợp Primer/Probe HBV 10X (Lô chuẩn 10 mL)",
          bom_type: "semi_finished",
          bom_category: "PCR Kit",
          base_qty: 10,
          base_uom: mlUom,
          tests_per_kit: 2000,
          shelf_life_days: 365,
          shelf_life_months: 12,
          tccs_code: "TCCS-BTP-OLI:2026/ABT",
          responsible_person_name: "Nguyễn Thị Ngọc Ánh (Chuyên viên Pha chế PCR)",
          qc_assignee_name: "Lê Thu Hà (Chuyên viên QC Kit)",
          specification: "Ống Falcon 10 mL bọc giấy bạc chống sáng",
          storage_condition: "-20°C ± 2°C (Tránh ánh sáng)",
          qc_retention_qty: 1,
          ph_min: 7.9,
          ph_max: 8.1,
        },
        {
          bom_code: "BOM-ST127-VBL-V2",
          item_code: "ST127",
          name: "BOM Bán thành phẩm Dung dịch đệm ly giải VBL Buffer Ver 2 (Lô 1000 mL)",
          bom_type: "semi_finished",
          bom_category: "Tách chiết / Khác",
          base_qty: 1000,
          base_uom: mlUom,
          tests_per_kit: 2000,
          shelf_life_days: 730,
          shelf_life_months: 24,
          tccs_code: "TCCS-BTP-ST127:2026/ABT",
          responsible_person_name: "Phạm Quốc Cường (Chuyên viên Pha chế Buffer)",
          qc_assignee_name: "Đỗ Hoàng Yến (Chuyên viên QC Hóa lý)",
          specification: "Can HDPE 1000 mL",
          storage_condition: "15°C...25°C",
          qc_retention_qty: 1,
          ph_min: 6.5,
          ph_max: 6.9,
        },
        {
          bom_code: "BOM-HK-008-V1",
          item_code: "HK-008",
          name: "BOM Thành phẩm TopPURE® Viral DNA/RNA Extraction Kit (HK-008 · 50 test)",
          bom_type: "finished_good",
          bom_category: "Tách chiết / Khác",
          base_qty: 1,
          base_uom: kitUom,
          tests_per_kit: 50,
          shelf_life_days: 730,
          shelf_life_months: 24,
          tccs_code: "TCCS 08:2025/ABT",
          registration_no: "2300045/ĐKLH-BYT-TB-CT",
          responsible_person_name: "Phạm Quốc Cường (Chuyên viên Pha chế Buffer)",
          qc_assignee_name: "Đỗ Hoàng Yến (Chuyên viên QC Hóa lý)",
          specification: "Hộp 50 test (Cột thu hồi Silica + Hệ đệm VBL/WB1/WB2/RBB)",
          storage_condition: "15°C...25°C (Proteinase K & Carrier RNA bảo quản -20°C)",
          qc_retention_qty: 1,
          ph_min: null,
          ph_max: null,
        },
      ];

      for (const sb of seedBoms) {
        const itRow = (await tx.query("SELECT id FROM master.item WHERE code = $1 LIMIT 1", [sb.item_code])).rows[0];
        if (!itRow) continue;
        const gtinSeed = [...String(sb.item_code)].reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) % 1000, 0);
        const gtin13 = `0893619283${String(gtinSeed).padStart(3, "0")}`;
        const gtinSum = [...gtin13].reduce((acc, d, idx) => acc + Number(d) * (idx % 2 === 0 ? 3 : 1), 0);
        const gtinCheck = (10 - (gtinSum % 10)) % 10;
        const gtin14 = `(01)${gtin13}${gtinCheck}`;

        const insertedBom = (
          await tx.query(
            `INSERT INTO kit.bom
               (code, org_unit_id, product_item_id, bom_version, name, base_qty, base_uom, tests_per_kit,
                shelf_life_days, shelf_life_months, status, bom_type, bom_category, tccs_code, registration_no,
                responsible_person_name, qc_assignee_name, specification, storage_condition, qc_retention_qty,
                ph_min, ph_max, label_template_code, label_dimensions, udi_di, ifu_code, ifu_version,
                ifu_file_name, ifu_file_size, ifu_aliquoted_file_name, ifu_aliquoted_file_size)
             VALUES ($1,$2,$3,1,$4,$5,$6,$7,$8,$9,'EFFECTIVE',$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,'Rev 02',$25,'460 KB (PDF)',$26,'485 KB (PDF)')
             ON CONFLICT DO NOTHING
             RETURNING id`,
            [
              sb.bom_code,
              kitOrg,
              itRow.id,
              sb.name,
              sb.base_qty,
              sb.base_uom,
              sb.tests_per_kit,
              sb.shelf_life_days,
              sb.shelf_life_months,
              sb.bom_type,
              sb.bom_category,
              sb.tccs_code,
              (sb as { registration_no?: string }).registration_no ?? null,
              sb.responsible_person_name,
              sb.qc_assignee_name,
              sb.specification,
              sb.storage_condition,
              sb.qc_retention_qty,
              sb.ph_min,
              sb.ph_max,
              `LBL-${sb.item_code}-V1`,
              sb.bom_type === "semi_finished" ? "Nhãn Chai BTP: 70×40 mm" : "Nhãn Hộp ngoài: 100×50 mm · Nhãn Ống: 35×15 mm",
              gtin14,
              `IFU-${sb.item_code}`,
              `HDSD_${sb.item_code}_Rev02.pdf`,
              `HDSD_${sb.item_code}.D.IC_Rev02.pdf`,
            ]
          )
        ).rows[0];

        if (insertedBom && rawItems.length >= 2) {
          const filteredComps = rawItems.filter((r) => r.id !== itRow.id).slice(0, 3);
          let ln = 1;
          for (const comp of filteredComps) {
            await tx.query(
              `INSERT INTO kit.bom_line
                 (bom_id, line_no, component_item_id, qty_per_base, uom, scrap_pct, box_no, component_role, is_critical, is_mix_component, include_in_qc_retention, notes)
               VALUES ($1, $2, $3, $4, $5, 2, 1, 'REAGENT', true, true, true, $6)
               ON CONFLICT DO NOTHING`,
              [
                insertedBom.id,
                ln++,
                comp.id,
                sb.bom_type === "semi_finished" ? 12.5 : 1,
                comp.base_uom,
                sb.bom_type === "semi_finished" ? "Cân/đong chính xác trong tủ ATSH, kiểm tra pH sau khuấy từ" : "Thành phần đóng gói theo định mức chuẩn",
              ]
            );
          }
        }
      }
    }
  }

  kitBomRoutingIfuSchemaEnsured = true;
}

export async function updateBomLabelIfuSpec(tx: Tx, actor: AuthzActor, bomId: string, input: Record<string, unknown>) {
  await ensureKitBomRoutingAndIfuSchema(tx);
  const bom = (await tx.query("SELECT * FROM kit.bom WHERE id = $1 FOR UPDATE", [bomId])).rows[0] as Record<string, unknown> | undefined;
  if (!bom) throw notFound("định mức BOM");
  await authorize(tx, actor, "kit.bom.manage", String(bom.org_unit_id));

  const labelDesignJson =
    input.label_design_json !== undefined
      ? typeof input.label_design_json === "string"
        ? input.label_design_json
        : JSON.stringify(input.label_design_json ?? {})
      : JSON.stringify(bom.label_design_json ?? {});

  const updated = (
    await tx.query(
      `UPDATE kit.bom
          SET label_template_code = $2,
              label_dimensions = $3,
              udi_di = $4,
              ifu_code = $5,
              ifu_version = $6,
              ifu_intended_use = $7,
              ifu_thermal_profile = $8,
              ifu_channels = $9,
              ifu_interpretation = $10,
              ifu_file_name = $11,
              ifu_file_url = $12,
              ifu_file_size = $13,
              ifu_updated_at = now(),
              ifu_aliquoted_file_name = $14,
              ifu_aliquoted_file_url = $15,
              ifu_aliquoted_file_size = $16,
              label_design_json = $17::jsonb,
              updated_at = now(),
              updated_by = $18
        WHERE id = $1
        RETURNING *`,
      [
        bomId,
        input.label_template_code !== undefined ? (input.label_template_code ? String(input.label_template_code).trim() : null) : bom.label_template_code,
        input.label_dimensions !== undefined ? (input.label_dimensions ? String(input.label_dimensions).trim() : null) : bom.label_dimensions,
        input.udi_di !== undefined ? (input.udi_di ? String(input.udi_di).trim() : null) : bom.udi_di,
        input.ifu_code !== undefined ? (input.ifu_code ? String(input.ifu_code).trim() : null) : bom.ifu_code,
        input.ifu_version !== undefined ? (input.ifu_version ? String(input.ifu_version).trim() : null) : bom.ifu_version,
        input.ifu_intended_use !== undefined ? (input.ifu_intended_use ? String(input.ifu_intended_use).trim() : null) : bom.ifu_intended_use,
        input.ifu_thermal_profile !== undefined ? (input.ifu_thermal_profile ? String(input.ifu_thermal_profile).trim() : null) : bom.ifu_thermal_profile,
        input.ifu_channels !== undefined ? (input.ifu_channels ? String(input.ifu_channels).trim() : null) : bom.ifu_channels,
        input.ifu_interpretation !== undefined ? (input.ifu_interpretation ? String(input.ifu_interpretation).trim() : null) : bom.ifu_interpretation,
        input.ifu_file_name !== undefined ? (input.ifu_file_name ? String(input.ifu_file_name).trim() : null) : bom.ifu_file_name,
        input.ifu_file_url !== undefined ? (input.ifu_file_url ? String(input.ifu_file_url) : null) : bom.ifu_file_url,
        input.ifu_file_size !== undefined ? (input.ifu_file_size ? String(input.ifu_file_size).trim() : null) : bom.ifu_file_size,
        input.ifu_aliquoted_file_name !== undefined ? (input.ifu_aliquoted_file_name ? String(input.ifu_aliquoted_file_name).trim() : null) : bom.ifu_aliquoted_file_name,
        input.ifu_aliquoted_file_url !== undefined ? (input.ifu_aliquoted_file_url ? String(input.ifu_aliquoted_file_url) : null) : bom.ifu_aliquoted_file_url,
        input.ifu_aliquoted_file_size !== undefined ? (input.ifu_aliquoted_file_size ? String(input.ifu_aliquoted_file_size).trim() : null) : bom.ifu_aliquoted_file_size,
        labelDesignJson,
        actor.userId,
      ]
    )
  ).rows[0];
  await writeAudit(tx, actor, {
    entityType: "kit_bom",
    entityId: bomId,
    action: "update_label_ifu_spec",
    changes: {
      ifu_code: [null, updated.ifu_code],
      ifu_file_name: [null, updated.ifu_file_name],
      label_template_code: [null, updated.label_template_code],
    },
  });
  return updated;
}

export async function fastActivateBom(tx: Tx, actor: AuthzActor, bomId: string) {
  const bom = (await tx.query("SELECT * FROM kit.bom WHERE id = $1 FOR UPDATE", [bomId])).rows[0] as KitBomRow | undefined;
  if (!bom) throw notFound("định mức BOM");
  await authorize(tx, actor, "kit.bom.approve", bom.org_unit_id);
  if ((bom as any).created_by === actor.userId || (bom as any).updated_by === actor.userId) {
    throw invalid("Người tạo hoặc chỉnh sửa định mức BOM không được tự phê duyệt hiệu lực (Nguyên tắc tách nhiệm ISO 13485).", undefined, "SELF_APPROVAL");
  }
  const lastAuthor = (
    await tx.query(
      `SELECT user_id FROM core.audit_log
        WHERE entity_type IN ('kit_bom', 'kit.bom', 'bom') AND entity_id = $1
          AND action IN ('create', 'update', 'submit_review', 'update_label_ifu_spec')
        ORDER BY id DESC LIMIT 1`,
      [bomId]
    )
  ).rows[0];
  if (lastAuthor && Number(lastAuthor.user_id) === actor.userId) {
    throw invalid("Người tạo hoặc chỉnh sửa định mức BOM không được tự phê duyệt hiệu lực (Nguyên tắc tách nhiệm ISO 13485).", undefined, "SELF_APPROVAL");
  }
  const lineCount = Number((await tx.query("SELECT count(*)::int AS c FROM kit.bom_line WHERE bom_id = $1", [bomId])).rows[0]?.c ?? 0);
  if (lineCount === 0) throw invalid("Định mức BOM phải có ít nhất 1 dòng nguyên vật liệu trước khi kích hoạt hiệu lực (EFFECTIVE).");
  await tx.query(
    "UPDATE kit.bom SET status = 'OBSOLETE', updated_at = now() WHERE product_item_id = $1 AND status = 'EFFECTIVE' AND id <> $2",
    [bom.product_item_id, bomId]
  );
  const updated = (
    await tx.query(
      "UPDATE kit.bom SET status = 'EFFECTIVE', approved_by = $2, approved_at = now(), version = version + 1, updated_at = now() WHERE id = $1 RETURNING *",
      [bomId, actor.userId]
    )
  ).rows[0];
  await writeAudit(tx, actor, {
    entityType: "kit_bom",
    entityId: bomId,
    action: "fast_activate",
    changes: { status: [bom.status, "EFFECTIVE"], approved_by: [(bom as any).approved_by ?? null, actor.userId] },
  });
  return updated;
}

export async function cloneRouting(tx: Tx, actor: AuthzActor, routingId: string) {
  const src = (await tx.query("SELECT * FROM kit.routing WHERE id = $1", [routingId])).rows[0] as KitRoutingRow | undefined;
  if (!src) throw notFound("quy trình Routing");
  await authorize(tx, actor, "kit.bom.manage", src.org_unit_id);
  const nextVer = Number(
    (
      await tx.query("SELECT coalesce(max(routing_version), 0) + 1 AS v FROM kit.routing WHERE product_item_id = $1", [
        src.product_item_id,
      ])
    ).rows[0].v
  );
  const code = await nextNumber(tx, "KIT_ROUTING");
  const created = await insertRecord<KitRoutingRow>(tx, actor, "kit.routing", "kit_routing", {
    code,
    org_unit_id: src.org_unit_id,
    product_item_id: src.product_item_id,
    routing_version: nextVer,
    name: `${src.name} (Bản sao v${nextVer})`,
    notes: src.notes ?? null,
  });
  await tx.query(
    `INSERT INTO kit.routing_step
       (routing_id, seq, step_code, step_name, category, instructions, sop_doc_code, required_training_doc_code,
        required_asset_id, param_schema, is_qc, qc_spec_id, requires_check_signature, allow_skip, std_duration_min)
     SELECT $1, seq, step_code, step_name, category, instructions, sop_doc_code, required_training_doc_code,
            required_asset_id, param_schema, is_qc, qc_spec_id, requires_check_signature, allow_skip, std_duration_min
       FROM kit.routing_step WHERE routing_id = $2 ORDER BY seq`,
    [created.id, routingId]
  );
  return created;
}

export async function loadStandardKitRoutingSteps(tx: Tx, actor: AuthzActor, routingId: string) {
  const rtg = (await tx.query("SELECT * FROM kit.routing WHERE id = $1 FOR UPDATE", [routingId])).rows[0] as KitRoutingRow | undefined;
  if (!rtg) throw notFound("quy trình Routing");
  await authorize(tx, actor, "kit.bom.manage", rtg.org_unit_id);
  if (rtg.status !== "DRAFT") {
    throw invalid("Chỉ được nạp mẫu bước công đoạn khi quy trình (Routing) đang ở trạng thái Bản nháp (DRAFT). Hãy bấm 'Nhân bản phiên bản mới' trước.");
  }
  await tx.query("DELETE FROM kit.routing_step WHERE routing_id = $1", [routingId]);

  const stdSteps = [
    {
      seq: 10,
      step_code: "STEP-CLEAR-PREP",
      step_name: "Dọn dây chuyền (Line Clearance), Khử trùng UV & Rã đông Hóa chất",
      category: "PREPARATION",
      instructions: "Kiểm tra vệ sinh phòng sạch, chiếu UV 30 phút, rã đông Enzyme/MasterMix và Oligo trên đá lạnh (2–8°C).",
      sop_doc_code: "SOP-KIT-001",
      requires_check_signature: true,
      is_qc: false,
      param_schema: [
        { key: "room_temp_c", label: "Nhiệt độ phòng pha chế", type: "number", unit: "°C", min: 18, max: 25, required: true },
      ],
    },
    {
      seq: 20,
      step_code: "STEP-MIX-PH",
      step_name: "Pha chế MasterMix / Dung dịch đệm trong Tủ ATSH & Đo kiểm pH",
      category: "FORMULATION",
      instructions: "Phối trộn MasterMix 2X, Primer/Probe Mix theo đúng bảng nổ BOM trên block lạnh, vortex nhẹ và đo pH thực tế.",
      sop_doc_code: "SOP-KIT-002",
      requires_check_signature: true,
      is_qc: true,
      param_schema: [
        { key: "actual_ph", label: "Giá trị pH thực tế đo được", type: "number", unit: "pH", min: 8.1, max: 8.5, required: true },
        { key: "cold_block_c", label: "Nhiệt độ block lạnh khi pha", type: "number", unit: "°C", min: 2, max: 8, required: true },
      ],
    },
    {
      seq: 30,
      step_code: "STEP-ALIQUOT",
      step_name: "Chia lẻ (Aliquot) vào Ống thành phần theo Chế độ PO (Thường / .D.IC / Demo)",
      category: "FILLING",
      instructions: "Chia lẻ chính xác thể tích vào từng ống thành phần theo cấu trúc Hộp/Ống của BOM, đóng nắp kín chống nhiễm chéo.",
      sop_doc_code: "SOP-KIT-003",
      requires_check_signature: true,
      is_qc: false,
      param_schema: [
        { key: "fill_vol_ul", label: "Thể tích chiết rót kiểm tra", type: "number", unit: "µL", min: 15, max: 1500, required: true },
      ],
    },
    {
      seq: 40,
      step_code: "STEP-LABEL-IFU-PACK",
      step_name: "In & Dán Nhãn Ống/Hộp, Đóng kèm Tờ HDSD (IFU) & Bàn giao Mẫu QC",
      category: "PACKAGING",
      instructions: "In bộ nhãn Lô (LOT/MFG/EXP/QR) và Tờ Hướng dẫn sử dụng (IFU) hiệu lực, dán nhãn ống/hộp, tách mẫu lưu và gửi FQC.",
      sop_doc_code: "SOP-KIT-004",
      requires_check_signature: true,
      is_qc: false,
      param_schema: [
        { key: "ifu_checked", label: "Tỷ lệ kiểm tra khớp Nhãn & Tờ HDSD (IFU)", type: "number", unit: "%", min: 100, max: 100, required: true },
      ],
    },
  ];

  for (const s of stdSteps) {
    await tx.query(
      `INSERT INTO kit.routing_step
         (routing_id, seq, step_code, step_name, category, instructions, sop_doc_code, param_schema, is_qc, requires_check_signature, allow_skip, std_duration_min)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, false, 30)`,
      [routingId, s.seq, s.step_code, s.step_name, s.category, s.instructions, s.sop_doc_code, JSON.stringify(s.param_schema), s.is_qc, s.requires_check_signature]
    );
  }

  await writeAudit(tx, actor, {
    entityType: "kit_routing",
    entityId: routingId,
    action: "load_standard_steps",
    changes: { step_count: [0, stdSteps.length] },
  });
}

export async function fastActivateRouting(tx: Tx, actor: AuthzActor, routingId: string) {
  const rtg = (await tx.query("SELECT * FROM kit.routing WHERE id = $1 FOR UPDATE", [routingId])).rows[0] as KitRoutingRow | undefined;
  if (!rtg) throw notFound("quy trình Routing");
  await authorize(tx, actor, "kit.bom.approve", rtg.org_unit_id);
  const stepCount = Number((await tx.query("SELECT count(*)::int AS c FROM kit.routing_step WHERE routing_id = $1", [routingId])).rows[0]?.c ?? 0);
  if (stepCount === 0) {
    if (rtg.status === "DRAFT") {
      await loadStandardKitRoutingSteps(tx, actor, routingId);
    } else {
      throw invalid("Quy trình Routing phải có ít nhất 1 bước công đoạn trước khi kích hoạt hiệu lực.");
    }
  }
  await tx.query(
    "UPDATE kit.routing SET status = 'OBSOLETE', updated_at = now() WHERE product_item_id = $1 AND status = 'EFFECTIVE' AND id <> $2",
    [rtg.product_item_id, routingId]
  );
  const updated = (
    await tx.query(
      "UPDATE kit.routing SET status = 'EFFECTIVE', approved_by = $2, approved_at = now(), version = version + 1, updated_at = now() WHERE id = $1 RETURNING *",
      [routingId, actor.userId]
    )
  ).rows[0];
  await writeAudit(tx, actor, {
    entityType: "kit_routing",
    entityId: routingId,
    action: "fast_activate",
    changes: { status: [rtg.status, "EFFECTIVE"] },
  });
  return updated;
}

export async function listBoms(tx: Tx, actor: AuthzActor, filter: ListFormulaFilter = {}) {
  await ensureKitBomRoutingAndIfuSchema(tx);
  await authorizeAnywhere(tx, actor, "kit.view");
  const units = await visibleKitOrgUnits(tx, actor, "kit.view");
  if (units !== "ALL" && !units.length) return [];

  const q = filter.q?.trim() ? `%${filter.q.trim().toLowerCase()}%` : null;
  const status = filter.status?.trim() || null;
  const productItemId = filter.product_item_id?.trim() || null;
  const bomType = filter.bom_type?.trim() || null;
  const bomCategory = filter.bom_category?.trim() || null;
  const limit = Math.min(Math.max(Number(filter.limit) || 500, 1), 2000);
  const offset = Math.max(Number(filter.offset) || 0, 0);

  return (
    await tx.query(
      `SELECT b.*, b.base_qty::float AS base_qty, u.name AS org_unit_name,
              it.code AS product_code, it.name AS product_name, it.item_type AS product_type,
              qs.code AS qc_spec_code, qs.name AS qc_spec_name,
              (SELECT count(*)::int FROM kit.bom_line bl WHERE bl.bom_id = b.id) AS line_count,
              (SELECT count(*)::int FROM kit.kit_packaging kp WHERE kp.bom_id = b.id) AS packaging_count
         FROM kit.bom b
         JOIN core.org_unit u ON u.id = b.org_unit_id
         JOIN master.item it ON it.id = b.product_item_id
         LEFT JOIN qms.qc_spec qs ON qs.id = b.qc_spec_id
        WHERE ($1::uuid[] IS NULL OR b.org_unit_id = ANY($1::uuid[]))
          AND ($2::text IS NULL OR b.status = $2)
          AND ($3::uuid IS NULL OR b.product_item_id = $3)
          AND ($4::text IS NULL OR lower(b.code) LIKE $4 OR lower(b.name) LIKE $4 OR lower(it.code) LIKE $4 OR lower(it.name) LIKE $4 OR lower(coalesce(b.tccs_code, '')) LIKE $4 OR lower(coalesce(b.responsible_person_name, '')) LIKE $4)
          AND ($5::text IS NULL OR coalesce(b.bom_type, 'finished_good') = $5)
          AND ($6::text IS NULL OR coalesce(b.bom_category, 'PCR Kit') = $6)
        ORDER BY CASE WHEN coalesce(b.bom_type, 'finished_good') = 'finished_good' THEN 0 ELSE 1 END ASC, it.code ASC, b.bom_version DESC
        LIMIT $7 OFFSET $8`,
      [units === "ALL" ? null : units, status, productItemId, q, bomType, bomCategory, limit, offset]
    )
  ).rows;
}

export async function getBomDetail(
  tx: Tx,
  actor: AuthzActor,
  id: string,
  opts: { q?: string | null; box_no?: number | null; limit?: number; offset?: number } = {}
) {
  await ensureKitBomRoutingAndIfuSchema(tx);
  const bom = (
    await tx.query(
      `SELECT b.*, b.base_qty::float AS base_qty, u.name AS org_unit_name,
              it.code AS product_code, it.name AS product_name,
              qs.code AS qc_spec_code, qs.name AS qc_spec_name,
              ap.display_name AS approved_by_name
         FROM kit.bom b
         JOIN core.org_unit u ON u.id = b.org_unit_id
         JOIN master.item it ON it.id = b.product_item_id
         LEFT JOIN qms.qc_spec qs ON qs.id = b.qc_spec_id
         LEFT JOIN core.user_profile ap ON ap.user_id = b.approved_by
        WHERE b.id = $1`,
      [id]
    )
  ).rows[0];
  if (!bom) throw notFound("định mức BOM");
  await authorize(tx, actor, "kit.view", bom.org_unit_id);

  const q = opts.q?.trim() ? `%${opts.q.trim().toLowerCase()}%` : null;
  const boxNo = opts.box_no ? Number(opts.box_no) : null;
  const limit = Math.min(Math.max(Number(opts.limit) || 2000, 1), 5000);
  const offset = Math.max(Number(opts.offset) || 0, 0);

  const lines = (
    await tx.query(
      `SELECT bl.*, bl.qty_per_base::float AS qty_per_base,
              bl.qty_per_base_aliquoted::float AS qty_per_base_aliquoted,
              bl.scrap_pct::float AS scrap_pct,
              it.code AS item_code, it.name AS item_name, it.code AS component_code, it.name AS component_name, it.item_type
         FROM kit.bom_line bl
         JOIN master.item it ON it.id = bl.component_item_id
        WHERE bl.bom_id = $1
          AND ($2::int IS NULL OR bl.box_no = $2)
          AND (
            $3::text IS NULL
            OR lower(it.code) LIKE $3
            OR lower(it.name) LIKE $3
            OR lower(coalesce(bl.notes, '')) LIKE $3
          )
        ORDER BY bl.box_no ASC, bl.line_no ASC
        LIMIT $4 OFFSET $5`,
      [id, boxNo, q, limit, offset]
    )
  ).rows;

  const substitutes = (
    await tx.query(
      `SELECT s.*, s.conversion_factor::float AS conversion_factor,
              it.code AS substitute_code, it.name AS substitute_name, it.base_uom AS substitute_uom,
              bl.line_no
         FROM kit.bom_line_substitute s
         JOIN kit.bom_line bl ON bl.id = s.bom_line_id
         JOIN master.item it ON it.id = s.substitute_item_id
        WHERE bl.bom_id = $1
        ORDER BY bl.line_no ASC, s.priority ASC`,
      [id]
    )
  ).rows;

  const total_lines = Number(
    (await tx.query("SELECT count(*)::int AS c FROM kit.bom_line WHERE bom_id = $1", [id])).rows[0].c
  );

  const packaging = (
    await tx.query(
      `SELECT kp.*, kp.fill_qty::float AS fill_qty
         FROM kit.kit_packaging kp
        WHERE kp.bom_id = $1 ORDER BY kp.box_no ASC, kp.id ASC`,
      [id]
    )
  ).rows;

  const actions = await listAllowedActions(tx, bomMachine, actor, bom);
  return { ...bom, bom, lines, substitutes, total_lines, packaging, actions, allowed_actions: actions };
}

export async function listRoutings(tx: Tx, actor: AuthzActor, filter: ListFormulaFilter = {}) {
  await ensureKitBomRoutingAndIfuSchema(tx);
  await authorizeAnywhere(tx, actor, "kit.view");
  const units = await visibleKitOrgUnits(tx, actor, "kit.view");
  if (units !== "ALL" && !units.length) return [];

  const q = filter.q?.trim() ? `%${filter.q.trim().toLowerCase()}%` : null;
  const status = filter.status?.trim() || null;
  const productItemId = filter.product_item_id?.trim() || null;
  const limit = Math.min(Math.max(Number(filter.limit) || 500, 1), 2000);
  const offset = Math.max(Number(filter.offset) || 0, 0);

  return (
    await tx.query(
      `SELECT r.*, u.name AS org_unit_name, it.code AS product_code, it.name AS product_name,
              (SELECT count(*)::int FROM kit.routing_step rs WHERE rs.routing_id = r.id) AS step_count
         FROM kit.routing r
         JOIN core.org_unit u ON u.id = r.org_unit_id
         JOIN master.item it ON it.id = r.product_item_id
        WHERE ($1::uuid[] IS NULL OR r.org_unit_id = ANY($1::uuid[]))
          AND ($2::text IS NULL OR r.status = $2)
          AND ($3::uuid IS NULL OR r.product_item_id = $3)
          AND (
            $4::text IS NULL
            OR lower(r.code) LIKE $4
            OR lower(r.name) LIKE $4
            OR lower(it.code) LIKE $4
            OR lower(it.name) LIKE $4
          )
        ORDER BY it.code ASC, r.routing_version DESC
        LIMIT $5 OFFSET $6`,
      [units === "ALL" ? null : units, status, productItemId, q, limit, offset]
    )
  ).rows;
}

export async function getRoutingDetail(tx: Tx, actor: AuthzActor, id: string) {
  await ensureKitBomRoutingAndIfuSchema(tx);
  const rtg = (
    await tx.query(
      `SELECT r.*, u.name AS org_unit_name, it.code AS product_code, it.name AS product_name,
              ap.display_name AS approved_by_name
         FROM kit.routing r
         JOIN core.org_unit u ON u.id = r.org_unit_id
         JOIN master.item it ON it.id = r.product_item_id
         LEFT JOIN core.user_profile ap ON ap.user_id = r.approved_by
        WHERE r.id = $1`,
      [id]
    )
  ).rows[0];
  if (!rtg) throw notFound("quy trình công đoạn (Routing)");
  await authorize(tx, actor, "kit.view", rtg.org_unit_id);

  const steps = (
    await tx.query(
      `SELECT rs.*, a.code AS asset_code, a.name AS asset_name
         FROM kit.routing_step rs
         LEFT JOIN asset.asset a ON a.id = rs.required_asset_id
        WHERE rs.routing_id = $1 ORDER BY rs.seq ASC`,
      [id]
    )
  ).rows;

  const actions = await listAllowedActions(tx, routingMachine, actor, rtg);
  return { ...rtg, routing: rtg, steps, actions, allowed_actions: actions };
}
