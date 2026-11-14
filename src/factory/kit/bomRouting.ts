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
  routing_id?: string | null;
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
  updated_by?: number | null;
  version: number;
}

export interface KitRoutingRow {
  id: string;
  code: string;
  org_unit_id: string;
  product_item_id: string | null;
  routing_category?: string | null;
  routing_version: number;
  name: string;
  notes: string | null;
  status: SpecDocStatus;
  approved_by: number | null;
  approved_at: string | null;
  created_by: number | null;
  updated_by?: number | null;
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
        const varCode = String((row as any).variant_code || "BASE").trim().toUpperCase();
        const prevRows = (
          await tx.query(
            `SELECT * FROM kit.bom
              WHERE product_item_id = $1
                AND upper(coalesce(nullif(trim(variant_code), ''), 'BASE')) = $2
                AND status = 'EFFECTIVE'
                AND id <> $3
              FOR UPDATE`,
            [row.product_item_id, varCode, row.id]
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
              reason: `Thay thế bởi BOM ${row.code} (v${row.bom_version} · Mã phụ ${varCode})`,
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
        if (!row.product_item_id) return;
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
  routing_id: z.string().uuid().optional().nullable().or(z.literal("")),
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
  variant_code: z.string().trim().max(40).optional().nullable(),
  supply_form: z.enum(["NO_SPLIT_NO_IC", "NO_SPLIT_WITH_IC", "SPLIT_NO_IC", "SPLIT_WITH_IC"]).optional().nullable(),
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

  let resolvedRoutingId: string | null = d.routing_id ? String(d.routing_id).trim() || null : null;
  if (!resolvedRoutingId && d.clone_from_bom_id) {
    const srcBom = (await tx.query("SELECT routing_id FROM kit.bom WHERE id = $1", [d.clone_from_bom_id])).rows[0];
    if (srcBom?.routing_id) resolvedRoutingId = String(srcBom.routing_id);
  }
  if (!resolvedRoutingId) {
    const prefCode =
      inferredBomType === "semi_finished"
        ? "RTG-BTP-MIX"
        : /đông khô|lyo/i.test(`${product.code} ${product.name} ${d.name}`)
          ? "RTG-PCR-LYO"
          : inferredCategory === "PCR Kit"
            ? "RTG-PCR-STD"
            : "RTG-EXT-BUF";
    const defRt = (
      await tx.query(
        "SELECT id FROM kit.routing WHERE status <> 'OBSOLETE' ORDER BY CASE WHEN code = $1 THEN 0 WHEN status = 'EFFECTIVE' THEN 1 ELSE 2 END, routing_version DESC LIMIT 1",
        [prefCode]
      )
    ).rows[0];
    if (defRt?.id) resolvedRoutingId = String(defRt.id);
  }

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
            ifu_aliquoted_file_size = $23,
            variant_code = $24,
            supply_form = $25,
            routing_id = $26
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
      d.variant_code?.trim().toUpperCase() || "BASE",
      d.supply_form || "NO_SPLIT_NO_IC",
      resolvedRoutingId,
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
  if (bom.status !== "DRAFT") {
    throw invalid("Chỉ được chỉnh sửa thông tin định mức BOM ở trạng thái Nháp (DRAFT). Vui lòng tạo phiên bản mới.", undefined, "IMMUTABLE_EFFECTIVE_SPEC");
  }

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
              variant_code = $22,
              supply_form = $23,
              routing_id = $24,
              updated_at = now(),
              updated_by = $25
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
        input.variant_code !== undefined ? (String(input.variant_code).trim().toUpperCase() || "BASE") : String(bom.variant_code || "BASE"),
        input.supply_form !== undefined ? String(input.supply_form || "NO_SPLIT_NO_IC") : String(bom.supply_form || "NO_SPLIT_NO_IC"),
        input.routing_id !== undefined
          ? input.routing_id
            ? String(input.routing_id).trim()
            : null
          : bom.routing_id ?? null,
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
      routing_id: [bom.routing_id ?? null, updated.routing_id ?? null],
    },
  });
  return updated;
}

export async function assignBomRouting(
  tx: Tx,
  actor: AuthzActor,
  bomId: string,
  routingId: string | null
) {
  await ensureKitBomRoutingAndIfuSchema(tx);
  const bom = (await tx.query("SELECT * FROM kit.bom WHERE id = $1 FOR UPDATE", [bomId])).rows[0] as Record<string, unknown> | undefined;
  if (!bom) throw notFound("định mức BOM");
  await authorize(tx, actor, "kit.bom.manage", String(bom.org_unit_id));

  const cleanRoutingId = routingId && String(routingId).trim() ? String(routingId).trim() : null;
  const rt = cleanRoutingId
    ? (await tx.query("SELECT id, code, name, status FROM kit.routing WHERE id = $1", [cleanRoutingId])).rows[0]
    : null;
  if (cleanRoutingId && !rt) throw notFound("quy trình công đoạn (Routing)");

  const allowInitialLegacyBind =
    bom.status === "EFFECTIVE" && !bom.routing_id && Boolean(cleanRoutingId) && rt?.status === "EFFECTIVE";
  if (bom.status !== "DRAFT" && !allowInitialLegacyBind) {
    throw invalid(
      "Chỉ được thay đổi quy trình Routing trên BOM Nháp (DRAFT), hoặc gắn lần đầu quy trình EFFECTIVE cho BOM chưa có Routing. Vui lòng tạo phiên bản BOM mới.",
      undefined,
      "IMMUTABLE_EFFECTIVE_SPEC"
    );
  }

  const updated = (
    await tx.query(
      `UPDATE kit.bom
          SET routing_id = $2,
              updated_at = now(),
              updated_by = $3
        WHERE id = $1
        RETURNING *`,
      [bomId, cleanRoutingId, actor.userId]
    )
  ).rows[0];

  await writeAudit(tx, actor, {
    entityType: "kit_bom",
    entityId: bomId,
    action: "assign_routing",
    changes: {
      routing_id: [bom.routing_id ?? null, cleanRoutingId],
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
      "INTERNAL_CONTROL",
      "POSITIVE_CONTROL",
      "NEGATIVE_CONTROL",
      "EXTRACTION_BUFFER",
      "PCR_TUBE_STRIP",
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
  if (bom.status !== "DRAFT") throw invalid("Chỉ được chỉnh sửa BOM ở trạng thái Nháp (DRAFT). Vui lòng tạo phiên bản mới.", undefined, "IMMUTABLE_EFFECTIVE_SPEC");
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
  if (bom.status !== "DRAFT") throw invalid("Chỉ được chỉnh sửa BOM ở trạng thái Nháp (DRAFT). Vui lòng tạo phiên bản mới.", undefined, "IMMUTABLE_EFFECTIVE_SPEC");

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
  const bundleParentCode =
    input.bundle_parent_code !== undefined
      ? input.bundle_parent_code
        ? String(input.bundle_parent_code).trim()
        : null
      : existing.bundle_parent_code ?? null;
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
              bundle_parent_code = $10,
              allow_substitute = $11,
              is_demo_fixed_component = $12,
              is_mix_component = $13,
              include_in_qc_retention = $14,
              updated_by = $15,
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
        bundleParentCode,
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
  if (bom.status !== "DRAFT") throw invalid("Chỉ được chỉnh sửa BOM ở trạng thái Nháp (DRAFT). Vui lòng tạo phiên bản mới.", undefined, "IMMUTABLE_EFFECTIVE_SPEC");

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
  if (bom.status !== "DRAFT") throw invalid("Chỉ được chỉnh sửa cấu trúc đóng gói khi BOM đang ở trạng thái Nháp (DRAFT). Vui lòng tạo phiên bản mới.", undefined, "IMMUTABLE_EFFECTIVE_SPEC");

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
  if (bom.status !== "DRAFT") throw invalid("Chỉ được chỉnh sửa cấu trúc đóng gói khi BOM đang ở trạng thái Nháp (DRAFT). Vui lòng tạo phiên bản mới.", undefined, "IMMUTABLE_EFFECTIVE_SPEC");

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
  if (bom.status !== "DRAFT") throw invalid("Chỉ được xóa quy cách đóng gói khi BOM đang ở trạng thái Nháp (DRAFT). Vui lòng tạo phiên bản mới.", undefined, "IMMUTABLE_EFFECTIVE_SPEC");

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

function parsePrimaryContainerLineSpec(code: string, name: string): {
  isContainer: boolean;
  containerType: "TUBE_0_5ML" | "TUBE_1_5ML" | "TUBE_2_0ML" | "BOTTLE_10ML" | "BOTTLE_50ML";
  capacityMl: number;
} {
  const c = code.trim().toUpperCase();
  const n = name.trim().toLowerCase();
  // Exclude bulk sample tubes (e.g. T1.5B = 100/200 tubes BIOFIL for user sample prep)
  if (/^T1\.5B$/i.test(c) || n.includes("biofil")) {
    return { isContainer: false, containerType: "TUBE_1_5ML", capacityMl: 1.5 };
  }
  const isCryoOrBottle =
    /^(CTN|CTT|CPP|CN\d|CT\d|CHAI|LO-|TUBE-)/i.test(c) ||
    n.includes("cryotube") ||
    n.includes("chai nhựa") ||
    n.includes("chai thủy tinh") ||
    n.includes("lọ nhựa") ||
    n.includes("lọ thủy tinh") ||
    n.includes("microtube");
  if (!isCryoOrBottle) {
    return { isContainer: false, containerType: "TUBE_1_5ML", capacityMl: 1.5 };
  }
  const volMatch = `${c} ${n}`.match(/(\d+(?:[.,]\d+)?)\s*ml/i);
  const cap = volMatch ? Number(volMatch[1].replace(",", ".")) : c.startsWith("CPP") ? Number(c.replace(/\D+/g, "")) || 15 : 2.0;
  if (cap <= 0.6) return { isContainer: true, containerType: "TUBE_0_5ML", capacityMl: cap || 0.5 };
  if (cap <= 1.6) return { isContainer: true, containerType: "TUBE_1_5ML", capacityMl: cap || 1.5 };
  if (cap <= 2.5) return { isContainer: true, containerType: "TUBE_2_0ML", capacityMl: cap || 2.0 };
  if (cap <= 25) return { isContainer: true, containerType: "BOTTLE_10ML", capacityMl: cap || 15 };
  return { isContainer: true, containerType: "BOTTLE_50ML", capacityMl: cap || 60 };
}

function isNonFillablePackagingOrAccessory(code: string, name: string, role: string): boolean {
  const c = code.trim().toUpperCase();
  const n = name.trim().toLowerCase();
  const r = role.trim().toUpperCase();
  if (r === "PACKAGING" || r === "PCR_TUBE_STRIP") return true;
  if (
    /^(HGM|DGM|HGPK|HGT|DGT|HGU|DGU|CNM|CNN|CNV|FAL|TIP|VT-TUBE-|TEM|NHAN|HDSD|CSR|T1\.5B|MN5N)/i.test(c)
  ) {
    return true;
  }
  if (
    n.includes("hộp giấy") ||
    n.includes("đế giấy") ||
    n.includes("đế hộp") ||
    n.includes("cột silica") ||
    n.includes("chày nghiền") ||
    n.includes("máng nhựa") ||
    n.includes("túi zip") ||
    n.includes("túi nhôm") ||
    n.includes("tem nhãn")
  ) {
    return true;
  }
  return false;
}

export async function syncPackagingFromBomLines(tx: Tx, actor: AuthzActor, bomId: string) {
  await ensureKitBomRoutingAndIfuSchema(tx);
  const bom = (await tx.query("SELECT * FROM kit.bom WHERE id = $1 FOR UPDATE", [bomId])).rows[0] as KitBomRow | undefined;
  if (!bom) throw notFound("định mức BOM");
  await authorize(tx, actor, "kit.bom.manage", bom.org_unit_id);
  if (bom.status === "OBSOLETE") throw invalid("Không thể đồng bộ quy cách đóng gói khi BOM đã hết hiệu lực (OBSOLETE).");

  const lines = (
    await tx.query(
      `SELECT bl.*, bl.qty_per_base::float AS qty_per_base,
              it.code AS component_code, it.name AS component_name, it.item_type, it.storage_condition
         FROM kit.bom_line bl
         JOIN master.item it ON it.id = bl.component_item_id
        WHERE bl.bom_id = $1
        ORDER BY bl.box_no ASC, bl.line_no ASC`,
      [bomId]
    )
  ).rows as Array<Record<string, unknown>>;

  // Rebuild packaging specs cleanly from BOM lines + container pairings
  await tx.query("DELETE FROM kit.kit_packaging WHERE bom_id = $1", [bomId]);

  const isPcrKit = String((bom as any).bom_category || "PCR Kit") === "PCR Kit";
  const defaultStorage = String((bom as any).storage_condition || (isPcrKit ? "-20°C" : "15-25°C")).slice(0, 60);

  type ContainerSlot = {
    lineId: string;
    boxNo: number;
    code: string;
    name: string;
    totalUnits: number;
    remainingUnits: number;
    containerType: "TUBE_0_5ML" | "TUBE_1_5ML" | "TUBE_2_0ML" | "BOTTLE_10ML" | "BOTTLE_50ML";
    capacityMl: number;
    linkedToSolutionCode: string | null;
  };

  const containerSlots: ContainerSlot[] = [];
  const fillableLines: Array<Record<string, unknown>> = [];

  for (const l of lines) {
    const code = String(l.component_code || "").trim();
    const name = String(l.component_name || "").trim();
    const role = String(l.component_role || "REAGENT").trim();
    const cSpec = parsePrimaryContainerLineSpec(code, name);
    if (cSpec.isContainer) {
      const units = Math.max(1, Math.round(Number(l.qty_per_base || 1)));
      containerSlots.push({
        lineId: String(l.id),
        boxNo: Number(l.box_no || 1),
        code,
        name,
        totalUnits: units,
        remainingUnits: units,
        containerType: cSpec.containerType,
        capacityMl: cSpec.capacityMl,
        linkedToSolutionCode: l.bundle_parent_code ? String(l.bundle_parent_code).trim().toUpperCase() : null,
      });
      continue;
    }
    if (isNonFillablePackagingOrAccessory(code, name, role)) {
      continue;
    }
    fillableLines.push(l);
  }

  const targetLines = fillableLines.length > 0 ? fillableLines : lines.filter((l) => !parsePrimaryContainerLineSpec(String(l.component_code || ""), String(l.component_name || "")).isContainer);

  // Count how many fillable lines explicitly reference each container code
  const explicitRefCount = new Map<string, number>();
  for (const l of targetLines) {
    const parentCode = String(l.bundle_parent_code || "").trim().toUpperCase();
    if (parentCode) {
      explicitRefCount.set(parentCode, (explicitRefCount.get(parentCode) ?? 0) + 1);
    }
  }

  let added = 0;
  for (const l of targetLines) {
    const lineId = String(l.id);
    const role = String(l.component_role || "REAGENT").toUpperCase();
    const code = String(l.component_code || "");
    const name = String(l.component_name || code);
    const boxNo = Number(l.box_no || 1);
    const totalQty = Number(l.qty_per_base || 1);
    const uom = String(l.uom || (isPcrKit ? "µL" : "mL"));
    const uomLower = uom.toLowerCase();
    const volMl = uomLower === "µl" || uomLower === "ul" ? totalQty / 1000 : uomLower === "ml" ? totalQty : 0;

    // 1. Check explicit pairing (solution -> container OR container -> solution)
    const explicitCode = String(l.bundle_parent_code || "").trim().toUpperCase();
    let matchedSlot: ContainerSlot | undefined = containerSlots.find(
      (cs) =>
        (explicitCode && cs.code.toUpperCase() === explicitCode) ||
        (cs.linkedToSolutionCode && cs.linkedToSolutionCode === code.toUpperCase())
    );

    let allocatedUnits = 1;
    if (matchedSlot) {
      const refCnt = explicitRefCount.get(matchedSlot.code.toUpperCase()) || 1;
      if (refCnt === 1) {
        allocatedUnits = matchedSlot.totalUnits;
        matchedSlot.remainingUnits = 0;
      } else {
        allocatedUnits = Math.max(1, Math.floor(matchedSlot.totalUnits / refCnt));
        matchedSlot.remainingUnits = Math.max(0, matchedSlot.remainingUnits - allocatedUnits);
      }
    } else {
      // 2. Smart auto-pairing within the same box
      const boxLines = targetLines.filter((x) => Number(x.box_no || 1) === boxNo);
      const boxContainers = containerSlots.filter((cs) => cs.boxNo === boxNo && cs.remainingUnits > 0);

      if (boxLines.length === 1 && boxContainers.length === 1) {
        // Classic 1-solution + 1-container-type case (e.g., ST044 5 mL + CTN2 5 cái -> 5 tubes x 1 mL)
        matchedSlot = boxContainers[0];
        allocatedUnits = matchedSlot.remainingUnits;
        matchedSlot.remainingUnits = 0;
      } else if (volMl > 0 && boxContainers.length > 0) {
        // First check if a single unit of an available container fits volMl
        const singleFit = boxContainers
          .filter((cs) => cs.capacityMl >= volMl * 0.85)
          .sort((a, b) => a.capacityMl - b.capacityMl)[0];
        if (singleFit) {
          matchedSlot = singleFit;
          allocatedUnits = 1;
          matchedSlot.remainingUnits -= 1;
        } else {
          // Check if splitting across remainingUnits of a container fits (e.g., 5 mL across 5 x 2.0 mL tubes)
          const multiFit = boxContainers.find(
            (cs) => cs.remainingUnits > 1 && volMl / cs.remainingUnits <= cs.capacityMl * 1.05
          );
          if (multiFit) {
            matchedSlot = multiFit;
            allocatedUnits = multiFit.remainingUnits;
            multiFit.remainingUnits = 0;
          }
        }
      }

      if (matchedSlot) {
        await tx.query("UPDATE kit.bom_line SET bundle_parent_code = $2 WHERE id = $1", [lineId, matchedSlot.code]);
      }
    }

    let containerType: string = isPcrKit ? "TUBE_1_5ML" : "BOTTLE_10ML";
    if (matchedSlot) {
      containerType = matchedSlot.containerType;
    } else if (role === "PCR_TUBE_STRIP") {
      containerType = "STRIP_8";
    } else if (uomLower === "ml" && totalQty >= 25) {
      containerType = "BOTTLE_50ML";
    } else if (uomLower === "ml" && totalQty >= 3) {
      containerType = "BOTTLE_10ML";
    } else if (uomLower === "ml" && totalQty < 3) {
      containerType = "TUBE_2_0ML";
    } else if ((uomLower === "µl" || uomLower === "ul") && totalQty <= 500) {
      containerType = "TUBE_0_5ML";
    } else if ((uomLower === "µl" || uomLower === "ul") && totalQty > 1500) {
      containerType = "TUBE_2_0ML";
    }

    const unitsPerKit = Math.max(1, allocatedUnits);
    const fillQtyPerUnit =
      unitsPerKit > 1 && totalQty > 0 ? Math.round((totalQty / unitsPerKit) * 1000) / 1000 : totalQty > 0 ? totalQty : 1;

    const compTitle = `${code} — ${name}`;
    const boxName =
      boxNo === 1
        ? isPcrKit
          ? "Hộp 1: Hóa chất Khuếch đại PCR"
          : "Hộp 1: Hóa chất & Đệm Tách chiết"
        : `Hộp ${boxNo}: Thành phần phụ trợ`;
    const storageTemp = String(l.storage_condition || defaultStorage).slice(0, 60);
    const labelSpec = matchedSlot
      ? `Đựng trong: ${matchedSlot.code} (${matchedSlot.name}) · ${unitsPerKit} nhãn giống nhau × ${fillQtyPerUnit} ${uom}`
      : `Tem ống/chai ${code} (${unitsPerKit} × ${fillQtyPerUnit} ${uom})`;

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
        fillQtyPerUnit,
        uom,
        unitsPerKit,
        storageTemp,
        labelSpec.slice(0, 300),
      ]
    );
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

export const STEP_FUNCTION_ENUM = [
  "LINE_CLEARANCE",
  "MATERIAL_VERIFY_FEFO",
  "FORMULATION_MIXING",
  "IPQC_PH_GATE",
  "DISPENSING_ALIQUOT",
  "LYOPHILIZATION",
  "LABELING_IFU_PACKAGING",
  "FQC_RELEASE_HANDOVER",
] as const;

export type RoutingStepFunction = (typeof STEP_FUNCTION_ENUM)[number];

const functionalFlagsSchema = z
  .object({
    qc_gate: z.boolean().optional(),
    dual_sign: z.boolean().optional(),
    require_line_clearance: z.boolean().optional(),
    require_material_scan: z.boolean().optional(),
    require_env_log: z.boolean().optional(),
    require_yield_reconcile: z.boolean().optional(),
    require_label_ifu_check: z.boolean().optional(),
    expected_output: z.string().trim().max(300).optional().nullable(),
  })
  .passthrough()
  .default({});

const routingStepItemSchema = z.object({
  seq: z.coerce.number().int().positive().optional(),
  step_code: z.string().trim().min(2).max(40),
  step_name: z.string().trim().min(2, "nhập tên bước công đoạn").max(250),
  category: z
    .enum(["PREPARATION", "FORMULATION", "FILLING", "LYOPHILIZATION", "QC", "PACKAGING", "LABELING"])
    .default("FORMULATION"),
  step_function: z.string().trim().max(60).optional().nullable(),
  work_center: z.string().trim().max(160).optional().nullable(),
  functional_flags: functionalFlagsSchema.optional(),
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

const routingStepSchema = routingStepItemSchema.extend({
  routing_id: z.string().uuid("chọn quy trình Routing"),
});

const createRoutingSchema = z.object({
  org_unit_id: z.string().uuid("chọn phòng Sản xuất Kit"),
  product_item_id: z.string().uuid().optional().nullable().or(z.literal("")),
  routing_category: z.string().trim().max(80).optional().nullable(),
  name: z.string().trim().min(3, "nhập tên quy trình công đoạn (Routing)").max(250),
  notes: z.string().trim().max(2000).optional().nullable(),
  template_key: z.string().trim().max(60).optional().nullable(),
  steps: z.array(routingStepItemSchema).max(100).optional(),
});

export function inferCategoryFromFunction(stepFn: string | null | undefined, fallback = "FORMULATION"): string {
  switch (stepFn) {
    case "LINE_CLEARANCE":
    case "MATERIAL_VERIFY_FEFO":
      return "PREPARATION";
    case "FORMULATION_MIXING":
      return "FORMULATION";
    case "IPQC_PH_GATE":
    case "FQC_RELEASE_HANDOVER":
      return "QC";
    case "DISPENSING_ALIQUOT":
      return "FILLING";
    case "LYOPHILIZATION":
      return "LYOPHILIZATION";
    case "LABELING_IFU_PACKAGING":
      return "PACKAGING";
    default:
      return fallback;
  }
}

export async function createRouting(tx: Tx, actor: AuthzActor, input: unknown) {
  await ensureKitBomRoutingAndIfuSchema(tx);
  const d = parseInput(createRoutingSchema, input);
  await authorize(tx, actor, "kit.bom.manage", d.org_unit_id);
  const cleanProductId = d.product_item_id && String(d.product_item_id).trim() ? String(d.product_item_id).trim() : null;
  const nextVer = cleanProductId
    ? Number(
        (
          await tx.query("SELECT coalesce(max(routing_version), 0) + 1 AS v FROM kit.routing WHERE product_item_id = $1", [
            cleanProductId,
          ])
        ).rows[0].v
      )
    : Number(
        (
          await tx.query(
            "SELECT coalesce(max(routing_version), 0) + 1 AS v FROM kit.routing WHERE product_item_id IS NULL AND lower(name) = lower($1)",
            [d.name]
          )
        ).rows[0].v
      );
  const code = await nextNumber(tx, "KIT_ROUTING");
  const created = await insertRecord<KitRoutingRow>(tx, actor, "kit.routing", "kit_routing", {
    code,
    org_unit_id: d.org_unit_id,
    product_item_id: cleanProductId,
    routing_version: nextVer,
    name: d.name,
    notes: d.notes ?? null,
  });

  if (d.routing_category) {
    await tx.query("UPDATE kit.routing SET routing_category = $2 WHERE id = $1", [created.id, d.routing_category.trim()]);
  }

  if (d.steps && d.steps.length > 0) {
    await replaceAllRoutingSteps(tx, actor, created.id, d.steps);
  } else if (d.template_key) {
    await loadStandardKitRoutingSteps(tx, actor, created.id, d.template_key);
  }
  return created;
}

export async function addRoutingStep(tx: Tx, actor: AuthzActor, input: unknown) {
  await ensureKitBomRoutingAndIfuSchema(tx);
  const d = parseInput(routingStepSchema, input);
  const rtg = (await tx.query("SELECT * FROM kit.routing WHERE id = $1 FOR UPDATE", [d.routing_id])).rows[0] as
    | KitRoutingRow
    | undefined;
  if (!rtg) throw notFound("quy trình công đoạn (Routing)");
  await authorize(tx, actor, "kit.bom.manage", rtg.org_unit_id);
  if (rtg.status !== "DRAFT") throw invalid("Chỉ được thêm bước công đoạn khi quy trình Routing đang ở trạng thái Nháp (DRAFT). Vui lòng tạo phiên bản mới.", undefined, "IMMUTABLE_EFFECTIVE_SPEC");

  const seq =
    d.seq ??
    Number(
      (await tx.query("SELECT coalesce(max(seq), 0) + 10 AS s FROM kit.routing_step WHERE routing_id = $1", [d.routing_id])).rows[0].s
    );
  const dup = await tx.query("SELECT 1 FROM kit.routing_step WHERE routing_id = $1 AND seq = $2", [d.routing_id, seq]);
  if (dup.rowCount) {
    // Auto-shift subsequent steps by +10 so users can easily insert a step between existing steps
    await tx.query("UPDATE kit.routing_step SET seq = seq + 10 WHERE routing_id = $1 AND seq >= $2", [d.routing_id, seq]);
  }

  const stepFn = d.step_function?.trim() || "FORMULATION_MIXING";
  const category = d.category || (inferCategoryFromFunction(stepFn) as any);
  const isQc = Boolean(d.is_qc || d.functional_flags?.qc_gate || stepFn === "IPQC_PH_GATE");
  const dualSign = Boolean(d.requires_check_signature || d.functional_flags?.dual_sign);
  const flags = {
    qc_gate: isQc,
    dual_sign: dualSign,
    require_line_clearance: Boolean(d.functional_flags?.require_line_clearance ?? stepFn === "LINE_CLEARANCE"),
    require_material_scan: Boolean(d.functional_flags?.require_material_scan ?? stepFn === "MATERIAL_VERIFY_FEFO"),
    require_env_log: Boolean(d.functional_flags?.require_env_log ?? ["LINE_CLEARANCE", "FORMULATION_MIXING", "LYOPHILIZATION"].includes(stepFn)),
    require_yield_reconcile: Boolean(d.functional_flags?.require_yield_reconcile ?? ["DISPENSING_ALIQUOT", "FQC_RELEASE_HANDOVER"].includes(stepFn)),
    require_label_ifu_check: Boolean(d.functional_flags?.require_label_ifu_check ?? stepFn === "LABELING_IFU_PACKAGING"),
    expected_output: d.functional_flags?.expected_output ?? null,
  };

  const row = (
    await tx.query(
      `INSERT INTO kit.routing_step
         (routing_id, seq, step_code, step_name, category, step_function, work_center, functional_flags,
          instructions, sop_doc_code, required_training_doc_code,
          required_asset_id, param_schema, is_qc, qc_spec_id, requires_check_signature, allow_skip, std_duration_min)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13::jsonb, $14, $15, $16, $17, $18) RETURNING *`,
      [
        d.routing_id,
        seq,
        d.step_code,
        d.step_name,
        category,
        stepFn,
        d.work_center?.trim() || "Phòng sạch Class 10.000 (ISO 7)",
        JSON.stringify(flags),
        d.instructions,
        d.sop_doc_code ?? null,
        d.required_training_doc_code ?? null,
        d.required_asset_id || null,
        JSON.stringify(d.param_schema),
        isQc,
        d.qc_spec_id || null,
        dualSign,
        d.allow_skip,
        d.std_duration_min,
      ]
    )
  ).rows[0];
  await writeAudit(tx, actor, {
    entityType: "kit_routing",
    entityId: d.routing_id,
    action: "add_routing_step",
    changes: { step: [null, `#${seq} [${stepFn}] ${d.step_code} — ${d.step_name}`] },
  });
  return row;
}

export async function updateRoutingStep(tx: Tx, actor: AuthzActor, routingId: string, stepId: string, input: unknown) {
  await ensureKitBomRoutingAndIfuSchema(tx);
  const d = parseInput(routingStepItemSchema, input);
  const rtg = (await tx.query("SELECT * FROM kit.routing WHERE id = $1 FOR UPDATE", [routingId])).rows[0] as
    | KitRoutingRow
    | undefined;
  if (!rtg) throw notFound("quy trình công đoạn (Routing)");
  await authorize(tx, actor, "kit.bom.manage", rtg.org_unit_id);
  if (rtg.status !== "DRAFT") throw invalid("Chỉ được chỉnh sửa bước công đoạn khi quy trình Routing đang ở trạng thái Nháp (DRAFT). Vui lòng tạo phiên bản mới.", undefined, "IMMUTABLE_EFFECTIVE_SPEC");

  const existing = (await tx.query("SELECT * FROM kit.routing_step WHERE id = $1 AND routing_id = $2", [stepId, routingId])).rows[0];
  if (!existing) throw notFound("bước công đoạn Routing");

  const seq = d.seq ?? Number(existing.seq);
  const stepFn = d.step_function?.trim() || existing.step_function || "FORMULATION_MIXING";
  const category = d.category || existing.category || inferCategoryFromFunction(stepFn);
  const isQc = Boolean(d.is_qc || d.functional_flags?.qc_gate || stepFn === "IPQC_PH_GATE");
  const dualSign = Boolean(d.requires_check_signature || d.functional_flags?.dual_sign);
  const flags = {
    qc_gate: isQc,
    dual_sign: dualSign,
    require_line_clearance: Boolean(d.functional_flags?.require_line_clearance ?? stepFn === "LINE_CLEARANCE"),
    require_material_scan: Boolean(d.functional_flags?.require_material_scan ?? stepFn === "MATERIAL_VERIFY_FEFO"),
    require_env_log: Boolean(d.functional_flags?.require_env_log ?? ["LINE_CLEARANCE", "FORMULATION_MIXING", "LYOPHILIZATION"].includes(stepFn)),
    require_yield_reconcile: Boolean(d.functional_flags?.require_yield_reconcile ?? ["DISPENSING_ALIQUOT", "FQC_RELEASE_HANDOVER"].includes(stepFn)),
    require_label_ifu_check: Boolean(d.functional_flags?.require_label_ifu_check ?? stepFn === "LABELING_IFU_PACKAGING"),
    expected_output: d.functional_flags?.expected_output ?? null,
  };

  if (seq !== Number(existing.seq)) {
    const conflictStep = (
      await tx.query("SELECT id FROM kit.routing_step WHERE routing_id = $1 AND seq = $2 AND id <> $3", [routingId, seq, stepId])
    ).rows[0];
    if (conflictStep) {
      await tx.query("UPDATE kit.routing_step SET seq = $1 WHERE id = $2", [existing.seq, conflictStep.id]);
    }
  }

  const row = (
    await tx.query(
      `UPDATE kit.routing_step
          SET seq = $3,
              step_code = $4,
              step_name = $5,
              category = $6,
              step_function = $7,
              work_center = $8,
              functional_flags = $9::jsonb,
              instructions = $10,
              sop_doc_code = $11,
              required_training_doc_code = $12,
              required_asset_id = $13,
              param_schema = $14::jsonb,
              is_qc = $15,
              qc_spec_id = $16,
              requires_check_signature = $17,
              allow_skip = $18,
              std_duration_min = $19
        WHERE id = $1 AND routing_id = $2
        RETURNING *`,
      [
        stepId,
        routingId,
        seq,
        d.step_code,
        d.step_name,
        category,
        stepFn,
        d.work_center?.trim() || "Phòng sạch Class 10.000 (ISO 7)",
        JSON.stringify(flags),
        d.instructions,
        d.sop_doc_code ?? null,
        d.required_training_doc_code ?? null,
        d.required_asset_id || null,
        JSON.stringify(d.param_schema),
        isQc,
        d.qc_spec_id || null,
        dualSign,
        d.allow_skip,
        d.std_duration_min,
      ]
    )
  ).rows[0];

  await writeAudit(tx, actor, {
    entityType: "kit_routing",
    entityId: routingId,
    action: "update_routing_step",
    changes: {
      step: [
        `#${existing.seq} ${existing.step_code} — ${existing.step_name}`,
        `#${seq} [${stepFn}] ${d.step_code} — ${d.step_name}`,
      ],
    },
  });
  return row;
}

export async function deleteRoutingStep(tx: Tx, actor: AuthzActor, routingId: string, stepId: string) {
  await ensureKitBomRoutingAndIfuSchema(tx);
  const rtg = (await tx.query("SELECT * FROM kit.routing WHERE id = $1 FOR UPDATE", [routingId])).rows[0] as
    | KitRoutingRow
    | undefined;
  if (!rtg) throw notFound("quy trình công đoạn (Routing)");
  await authorize(tx, actor, "kit.bom.manage", rtg.org_unit_id);
  if (rtg.status !== "DRAFT") throw invalid("Chỉ được xóa bước công đoạn khi quy trình Routing đang ở trạng thái Nháp (DRAFT). Vui lòng tạo phiên bản mới.", undefined, "IMMUTABLE_EFFECTIVE_SPEC");

  const existing = (await tx.query("SELECT * FROM kit.routing_step WHERE id = $1 AND routing_id = $2", [stepId, routingId])).rows[0];
  if (!existing) throw notFound("bước công đoạn Routing");

  await tx.query("DELETE FROM kit.routing_step WHERE id = $1 AND routing_id = $2", [stepId, routingId]);
  await tx.query(
    `WITH ordered AS (
       SELECT id, (row_number() OVER (ORDER BY seq ASC, id ASC)) * 10 AS new_seq
         FROM kit.routing_step WHERE routing_id = $1
     )
     UPDATE kit.routing_step rs SET seq = ordered.new_seq FROM ordered WHERE rs.id = ordered.id`,
    [routingId]
  );

  await writeAudit(tx, actor, {
    entityType: "kit_routing",
    entityId: routingId,
    action: "delete_routing_step",
    changes: { step: [`#${existing.seq} ${existing.step_code} — ${existing.step_name}`, null] },
  });
  return { deleted: true, id: stepId };
}

export async function moveRoutingStep(
  tx: Tx,
  actor: AuthzActor,
  routingId: string,
  stepId: string,
  direction: "UP" | "DOWN"
) {
  await ensureKitBomRoutingAndIfuSchema(tx);
  const rtg = (await tx.query("SELECT * FROM kit.routing WHERE id = $1 FOR UPDATE", [routingId])).rows[0] as
    | KitRoutingRow
    | undefined;
  if (!rtg) throw notFound("quy trình công đoạn (Routing)");
  await authorize(tx, actor, "kit.bom.manage", rtg.org_unit_id);
  if (rtg.status === "OBSOLETE") throw invalid("Không thể đổi thứ tự bước khi quy trình Routing đã hết hiệu lực (OBSOLETE).");

  const steps = (
    await tx.query("SELECT id, seq FROM kit.routing_step WHERE routing_id = $1 ORDER BY seq ASC, id ASC", [routingId])
  ).rows as { id: string; seq: number }[];
  const idx = steps.findIndex((s) => s.id === stepId);
  if (idx < 0) throw notFound("bước công đoạn Routing");
  const targetIdx = direction === "UP" ? idx - 1 : idx + 1;
  if (targetIdx < 0 || targetIdx >= steps.length) return { moved: false };

  const reordered = [...steps];
  const [picked] = reordered.splice(idx, 1);
  reordered.splice(targetIdx, 0, picked);

  // Temporarily offset sequences to avoid unique constraint collision on (routing_id, seq)
  await tx.query("UPDATE kit.routing_step SET seq = seq + 10000 WHERE routing_id = $1", [routingId]);
  for (let i = 0; i < reordered.length; i++) {
    await tx.query("UPDATE kit.routing_step SET seq = $2 WHERE id = $1", [reordered[i].id, (i + 1) * 10]);
  }
  return { moved: true };
}

export async function replaceAllRoutingSteps(
  tx: Tx,
  actor: AuthzActor,
  routingId: string,
  rawSteps: unknown[]
) {
  await ensureKitBomRoutingAndIfuSchema(tx);
  const rtg = (await tx.query("SELECT * FROM kit.routing WHERE id = $1 FOR UPDATE", [routingId])).rows[0] as
    | KitRoutingRow
    | undefined;
  if (!rtg) throw notFound("quy trình công đoạn (Routing)");
  await authorize(tx, actor, "kit.bom.manage", rtg.org_unit_id);
  if (rtg.status === "OBSOLETE") throw invalid("Không thể cập nhật bước công đoạn khi quy trình Routing đã hết hiệu lực (OBSOLETE).");

  const parsedSteps = z.array(routingStepItemSchema).min(1, "Quy trình phải có ít nhất 1 bước công đoạn").max(100).parse(rawSteps);
  await tx.query("DELETE FROM kit.routing_step WHERE routing_id = $1", [routingId]);

  for (let i = 0; i < parsedSteps.length; i++) {
    const s = parsedSteps[i];
    const seq = s.seq && s.seq > 0 ? s.seq : (i + 1) * 10;
    await addRoutingStep(tx, actor, { ...s, routing_id: routingId, seq });
  }
  return { count: parsedSteps.length };
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
  await tx.query("SELECT pg_advisory_xact_lock(2026111401)");
  if (kitBomRoutingIfuSchemaEnsured) return;

  // Backfill neutral operational defaults (never inject fake registration numbers or PDF file sizes)
  await tx.query(`
    UPDATE kit.bom_line
       SET component_role = 'REAGENT'
     WHERE component_role IS NULL
        OR component_role NOT IN (
          'MASTER_MIX',
          'PRIMER_PROBE',
          'ENZYME',
          'INTERNAL_CONTROL',
          'POSITIVE_CONTROL',
          'NEGATIVE_CONTROL',
          'EXTRACTION_BUFFER',
          'PCR_TUBE_STRIP',
          'PACKAGING',
          'SEMI_FINISHED',
          'REAGENT'
        );
    UPDATE kit.routing_step
       SET step_function = CASE
             WHEN category = 'PREPARATION' AND (step_code ~* 'CLEAR' OR step_name ~* 'Line Clearance|UV') THEN 'LINE_CLEARANCE'
             WHEN category = 'PREPARATION' THEN 'MATERIAL_VERIFY_FEFO'
             WHEN is_qc = true OR category = 'QC' THEN 'IPQC_PH_GATE'
             WHEN category = 'FILLING' THEN 'DISPENSING_ALIQUOT'
             WHEN category = 'LYOPHILIZATION' THEN 'LYOPHILIZATION'
             WHEN category IN ('PACKAGING', 'LABELING') THEN 'LABELING_IFU_PACKAGING'
             ELSE 'FORMULATION_MIXING'
           END,
           work_center = coalesce(nullif(work_center, ''), 'Phòng sạch Class 10.000 (ISO 7)'),
           functional_flags = jsonb_build_object(
             'qc_gate', is_qc,
             'dual_sign', requires_check_signature,
             'require_line_clearance', (category = 'PREPARATION'),
             'require_material_scan', (category IN ('PREPARATION', 'FORMULATION')),
             'require_env_log', (category IN ('PREPARATION', 'FORMULATION', 'LYOPHILIZATION')),
             'require_yield_reconcile', (category IN ('FILLING', 'PACKAGING')),
             'require_label_ifu_check', (category IN ('PACKAGING', 'LABELING'))
           )
     WHERE step_function IS NULL OR functional_flags = '{}'::jsonb
  `);

  // Ensure the 8 standard PCR Tube / Strip items (T02, T01, S02, S01, LQ02, MIC, R01, LP02) exist in master.item
  const uomCheckRows = (await tx.query("SELECT code FROM master.uom WHERE status = 'ACTIVE'")).rows as Array<{ code: string }>;
  const tubeBaseUom =
    uomCheckRows.find((u) => ["tube", "pcs", "ea", "cai", "ống"].includes(u.code.toLowerCase()))?.code ??
    uomCheckRows[0]?.code ??
    "pcs";
  const stdTubeItems = [
    { code: "VT-TUBE-T02", name: "Strip 0.2 mL trong (Strip-8 · Mã nhận diện T02)" },
    { code: "VT-TUBE-T01", name: "Strip 0.1 mL trong (Strip-8 · Mã nhận diện T01)" },
    { code: "VT-TUBE-S02", name: "Strip 0.2 mL trắng đục (Strip-8 · Mã nhận diện S02)" },
    { code: "VT-TUBE-S01", name: "Strip 0.1 mL trắng đục (Strip-8 · Mã nhận diện S01)" },
    { code: "VT-TUBE-LQ02", name: "Tube qPCR 0.2 mL rời (Mã nhận diện LQ02)" },
    { code: "VT-TUBE-MIC", name: "MIC TUBES and CAPS (Strip-4 · Mã nhận diện MIC)" },
    { code: "VT-TUBE-R01", name: "Strip-4 0.1 mL trong (Strip-4 · Mã nhận diện R01)" },
    { code: "VT-TUBE-LP02", name: "Tube PCR 0.2 mL rời (Mã nhận diện LP02)" },
  ];
  for (const ti of stdTubeItems) {
    await tx.query(
      `INSERT INTO master.item (code, name, item_type, base_uom, tracking, storage_condition, receipt_qc_required, is_purchasable, is_saleable, is_manufacturable, status)
       VALUES ($1, $2, 'CONSUMABLE', $3, 'LOT', 'RT', false, true, false, false, 'ACTIVE')
       ON CONFLICT (code) DO NOTHING`,
      [ti.code, ti.name, tubeBaseUom]
    );
  }

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

  // Ensure the 4 Standard Shared Master Routings (dùng chung cho nhiều công thức BOM) exist and have steps
  const defaultKitOrg =
    (await tx.query("SELECT id FROM core.org_unit WHERE code = 'P-KIT' LIMIT 1")).rows[0]?.id ??
    (await tx.query("SELECT id FROM core.org_unit WHERE status = 'ACTIVE' ORDER BY code LIMIT 1")).rows[0]?.id;
  if (defaultKitOrg) {
    const sharedMasterRoutings = [
      {
        code: "RTG-PCR-STD",
        name: "Quy trình Chuẩn 5 bước Sản xuất & Đóng gói Kit Real-time PCR / RT-qPCR (Dùng chung)",
        routing_category: "PCR Kit",
        template_key: "PCR_5_STEPS",
        notes: "Quy trình dùng chung cho các công thức BOM Thành phẩm nhóm Kit Real-time PCR / RT-qPCR",
      },
      {
        code: "RTG-PCR-LYO",
        name: "Quy trình Chuẩn 6 bước Sản xuất Kit PCR Đông khô — Lyophilized (Dùng chung)",
        routing_category: "Kit PCR Đông khô",
        template_key: "LYO_6_STEPS",
        notes: "Quy trình dùng chung cho các công thức BOM Kit PCR Đông khô chân không",
      },
      {
        code: "RTG-EXT-BUF",
        name: "Quy trình Chuẩn 5 bước Sản xuất Kit Tách chiết DNA/RNA & Hệ đệm Buffer (Dùng chung)",
        routing_category: "Tách chiết / Khác",
        template_key: "EXTRACTION_5_STEPS",
        notes: "Quy trình dùng chung cho các công thức BOM Thành phẩm Kit Tách chiết, Dung dịch Đệm và Điện di",
      },
      {
        code: "RTG-BTP-MIX",
        name: "Quy trình Chuẩn 4 bước Pha chế Bán thành phẩm MasterMix / Primer / Đệm BTP (Dùng chung)",
        routing_category: "Bán thành phẩm (BTP)",
        template_key: "SEMI_FINISHED_4_STEPS",
        notes: "Quy trình dùng chung cho toàn bộ công thức BOM Bán thành phẩm (MasterMix gốc, Primer/Probe Mix, Đệm BTP)",
      },
    ];

    for (const sr of sharedMasterRoutings) {
      await tx.query(
        `INSERT INTO kit.routing
           (code, org_unit_id, product_item_id, routing_category, routing_version, name, notes, status, approved_at)
         VALUES ($1, $2, NULL, $3, 1, $4, $5, 'EFFECTIVE', now())
         ON CONFLICT (code) DO UPDATE
           SET routing_category = coalesce(nullif(kit.routing.routing_category, ''), EXCLUDED.routing_category)`,
        [sr.code, defaultKitOrg, sr.routing_category, sr.name, sr.notes]
      );
      const rtRow = (await tx.query("SELECT id FROM kit.routing WHERE code = $1 LIMIT 1", [sr.code])).rows[0];
      if (rtRow?.id) {
        const sc = Number(
          (await tx.query("SELECT count(*)::int AS c FROM kit.routing_step WHERE routing_id = $1", [rtRow.id])).rows[0]?.c ?? 0
        );
        if (sc === 0) {
          const tplSteps = STANDARD_ROUTING_STEP_TEMPLATES[sr.template_key] ?? STANDARD_ROUTING_STEP_TEMPLATES.PCR_5_STEPS;
          for (const s of tplSteps) {
            await tx.query(
              `INSERT INTO kit.routing_step
                 (routing_id, seq, step_code, step_name, category, step_function, work_center, functional_flags,
                  instructions, sop_doc_code, param_schema, is_qc, requires_check_signature, allow_skip, std_duration_min)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11::jsonb, $12, $13, false, $14)
               ON CONFLICT DO NOTHING`,
              [
                rtRow.id,
                s.seq,
                s.step_code,
                s.step_name,
                s.category,
                s.step_function,
                s.work_center,
                JSON.stringify(s.functional_flags ?? {}),
                s.instructions,
                s.sop_doc_code,
                JSON.stringify(s.param_schema ?? []),
                s.is_qc,
                s.requires_check_signature,
                s.std_duration_min ?? 30,
              ]
            );
          }
        }
      }
    }

    // Auto-assign shared Routing onto any BOM where routing_id is still NULL
    await tx.query(`
      UPDATE kit.bom b
         SET routing_id = CASE
               WHEN coalesce(b.bom_type, 'finished_good') = 'semi_finished'
                 THEN (SELECT id FROM kit.routing WHERE code = 'RTG-BTP-MIX' LIMIT 1)
               WHEN b.name ~* 'đông khô|lyo'
                 THEN (SELECT id FROM kit.routing WHERE code = 'RTG-PCR-LYO' LIMIT 1)
               WHEN coalesce(b.bom_category, 'PCR Kit') = 'PCR Kit'
                 THEN (SELECT id FROM kit.routing WHERE code = 'RTG-PCR-STD' LIMIT 1)
               ELSE (SELECT id FROM kit.routing WHERE code = 'RTG-EXT-BUF' LIMIT 1)
             END
       WHERE b.routing_id IS NULL
    `);
  }

  kitBomRoutingIfuSchemaEnsured = true;
}

export async function updateBomLabelIfuSpec(tx: Tx, actor: AuthzActor, bomId: string, input: Record<string, unknown>) {
  await ensureKitBomRoutingAndIfuSchema(tx);
  const bom = (await tx.query("SELECT * FROM kit.bom WHERE id = $1 FOR UPDATE", [bomId])).rows[0] as Record<string, unknown> | undefined;
  if (!bom) throw notFound("định mức BOM");
  await authorize(tx, actor, "kit.bom.manage", String(bom.org_unit_id));
  if (bom.status !== "DRAFT") {
    throw invalid("Chỉ được chỉnh sửa thông tin định mức BOM ở trạng thái Nháp (DRAFT). Vui lòng tạo phiên bản mới.", undefined, "IMMUTABLE_EFFECTIVE_SPEC");
  }

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
  const varCode = String((bom as any).variant_code || "BASE").trim().toUpperCase();
  await tx.query(
    `UPDATE kit.bom
        SET status = 'OBSOLETE', updated_at = now()
      WHERE product_item_id = $1
        AND upper(coalesce(nullif(trim(variant_code), ''), 'BASE')) = $2
        AND status = 'EFFECTIVE'
        AND id <> $3`,
    [bom.product_item_id, varCode, bomId]
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
  await ensureKitBomRoutingAndIfuSchema(tx);
  const src = (await tx.query("SELECT * FROM kit.routing WHERE id = $1", [routingId])).rows[0] as KitRoutingRow | undefined;
  if (!src) throw notFound("quy trình Routing");
  await authorize(tx, actor, "kit.bom.manage", src.org_unit_id);
  const nextVer = src.product_item_id
    ? Number(
        (
          await tx.query("SELECT coalesce(max(routing_version), 0) + 1 AS v FROM kit.routing WHERE product_item_id = $1", [
            src.product_item_id,
          ])
        ).rows[0].v
      )
    : Number(
        (
          await tx.query(
            "SELECT coalesce(max(routing_version), 0) + 1 AS v FROM kit.routing WHERE product_item_id IS NULL AND routing_category IS NOT DISTINCT FROM $1",
            [src.routing_category ?? null]
          )
        ).rows[0].v
      );
  const code = await nextNumber(tx, "KIT_ROUTING");
  const created = await insertRecord<KitRoutingRow>(tx, actor, "kit.routing", "kit_routing", {
    code,
    org_unit_id: src.org_unit_id,
    product_item_id: src.product_item_id ?? null,
    routing_version: nextVer,
    name: `${src.name.replace(/\s*\(Bản sao v\d+\)$/i, "")} (Bản sao v${nextVer})`,
    notes: src.notes ?? null,
  });
  if (src.routing_category) {
    await tx.query("UPDATE kit.routing SET routing_category = $2 WHERE id = $1", [created.id, src.routing_category]);
  }
  await tx.query(
    `INSERT INTO kit.routing_step
       (routing_id, seq, step_code, step_name, category, step_function, work_center, functional_flags,
        instructions, sop_doc_code, required_training_doc_code,
        required_asset_id, param_schema, is_qc, qc_spec_id, requires_check_signature, allow_skip, std_duration_min)
     SELECT $1, seq, step_code, step_name, category, step_function, work_center, functional_flags,
            instructions, sop_doc_code, required_training_doc_code,
            required_asset_id, param_schema, is_qc, qc_spec_id, requires_check_signature, allow_skip, std_duration_min
       FROM kit.routing_step WHERE routing_id = $2 ORDER BY seq`,
    [created.id, routingId]
  );
  return created;
}

export const STANDARD_ROUTING_STEP_TEMPLATES: Record<string, Array<Record<string, any>>> = {
    PCR_5_STEPS: [
      {
        seq: 10,
        step_code: "STEP-10-CLEAR",
        step_name: "Dọn dây chuyền (Line Clearance), Khử trùng UV & Cấp phát Lô NVL FEFO",
        category: "PREPARATION",
        step_function: "LINE_CLEARANCE",
        work_center: "Phòng sạch Chuẩn bị & Cấp phát (ISO 7)",
        instructions:
          "Kiểm tra vệ sinh dây chuyền, hủy toàn bộ nhãn thừa lô cũ, chiếu UV 30 phút, đối chiếu mã lô FEFO và rã đông Enzyme/MasterMix/Oligo trên block lạnh (2–8°C).",
        sop_doc_code: "SOP-KIT-001",
        std_duration_min: 30,
        requires_check_signature: true,
        is_qc: false,
        functional_flags: {
          qc_gate: false,
          dual_sign: true,
          require_line_clearance: true,
          require_material_scan: true,
          require_env_log: true,
          require_yield_reconcile: false,
          require_label_ifu_check: false,
          expected_output: "Dây chuyền sạch 100%, đủ lô NVL theo phiếu xuất kho FEFO",
        },
        param_schema: [
          { key: "room_temp_c", label: "Nhiệt độ phòng pha chế", type: "number", unit: "°C", min: 18, max: 25, required: true },
          { key: "room_rh_pct", label: "Độ ẩm tương đối (RH)", type: "number", unit: "%", min: 35, max: 65, required: true },
          { key: "uv_time_min", label: "Thời gian chiếu khử trùng UV", type: "number", unit: "phút", min: 30, max: 60, required: true },
        ],
      },
      {
        seq: 20,
        step_code: "STEP-20-MIX",
        step_name: "Pha chế Bán thành phẩm MasterMix & Hỗn hợp Primer/Probe trong Tủ BSC-II",
        category: "FORMULATION",
        step_function: "FORMULATION_MIXING",
        work_center: "Phòng Pha chế MasterMix / PCR Hood (ISO 6)",
        instructions:
          "Phối trộn qPCR MasterMix 2X, Primer/Probe Mix và Chứng dương/Chứng âm theo đúng định mức nổ BOM trên block lạnh (2–8°C), vortex nhẹ 15 giây và spin-down ngắn.",
        sop_doc_code: "SOP-KIT-002",
        std_duration_min: 45,
        requires_check_signature: true,
        is_qc: false,
        functional_flags: {
          qc_gate: false,
          dual_sign: true,
          require_line_clearance: false,
          require_material_scan: true,
          require_env_log: true,
          require_yield_reconcile: false,
          require_label_ifu_check: false,
          expected_output: "Dung dịch bán thành phẩm đồng nhất, bảo quản lạnh 2–8°C",
        },
        param_schema: [
          { key: "cold_block_c", label: "Nhiệt độ block lạnh khi pha", type: "number", unit: "°C", min: 2, max: 8, required: true },
          { key: "vortex_sec", label: "Thời gian trộn đồng nhất (Vortex)", type: "number", unit: "giây", min: 10, max: 30, required: true },
        ],
      },
      {
        seq: 30,
        step_code: "STEP-30-IPQC",
        step_name: "Kiểm soát Chất lượng Bán thành phẩm Xen kẽ (IPQC Gate: Đo pH & Chạy Ct thử nghiệm)",
        category: "QC",
        step_function: "IPQC_PH_GATE",
        work_center: "Phòng Kiểm nghiệm QC Sinh học Phân tử",
        instructions:
          "Lấy mẫu bán thành phẩm đo pH thực tế và chạy kiểm tra tín hiệu khuếch đại Real-time PCR (Chứng dương FAM/HEX đạt ngưỡng Ct mục tiêu, Chứng âm NTC không lên tín hiệu). Khóa công đoạn chia lẻ cho tới khi QA/QC ký duyệt PASS.",
        sop_doc_code: "SOP-QC-KIT-01",
        std_duration_min: 60,
        requires_check_signature: true,
        is_qc: true,
        functional_flags: {
          qc_gate: true,
          dual_sign: true,
          require_line_clearance: false,
          require_material_scan: false,
          require_env_log: false,
          require_yield_reconcile: false,
          require_label_ifu_check: false,
          expected_output: "Phiếu IPQC đạt (PASS) — Cho phép mở khóa bước Chia lẻ Aliquot",
        },
        param_schema: [
          { key: "actual_ph", label: "Giá trị pH thực tế đo được", type: "number", unit: "pH", min: 8.1, max: 8.5, required: true },
          { key: "pc_ct_fam", label: "Giá trị Ct Chứng dương (FAM)", type: "number", unit: "Ct", min: 22, max: 30, required: true },
        ],
      },
      {
        seq: 40,
        step_code: "STEP-40-ALIQUOT",
        step_name: "Chia lẻ (Aliquot) vào Ống / Strip theo Chế độ PO (Thường / Chia sẵn .D.IC / Demo)",
        category: "FILLING",
        step_function: "DISPENSING_ALIQUOT",
        work_center: "Phòng Chiết rót Định lượng (ISO 7)",
        instructions:
          "Chia lẻ chính xác thể tích từng thành phần vào ống 1.5mL hoặc dải 8-strip (.D.IC) theo quy cách Hộp/Ống của BOM. Kiểm tra độ kín nắp và cân bằng lượng bán thành phẩm.",
        sop_doc_code: "SOP-KIT-003",
        std_duration_min: 60,
        requires_check_signature: true,
        is_qc: false,
        functional_flags: {
          qc_gate: false,
          dual_sign: true,
          require_line_clearance: false,
          require_material_scan: false,
          require_env_log: true,
          require_yield_reconcile: true,
          require_label_ifu_check: false,
          expected_output: "Đủ số lượng ống thành phần theo cỡ lô, sai số thể tích ≤ ±2%",
        },
        param_schema: [
          { key: "fill_vol_ul", label: "Thể tích chiết rót kiểm tra", type: "number", unit: "µL", min: 15, max: 1500, required: true },
          { key: "yield_check_pct", label: "Tỷ lệ thu hồi bán thành phẩm", type: "number", unit: "%", min: 95, max: 100, required: true },
        ],
      },
      {
        seq: 50,
        step_code: "STEP-50-LABEL-PACK",
        step_name: "In & Dán Nhãn Ống/Hộp, Đính kèm Tờ HDSD (IFU), Tách Mẫu Lưu & Bàn giao FQC",
        category: "PACKAGING",
        step_function: "LABELING_IFU_PACKAGING",
        work_center: "Khu vực Đóng gói Hoàn thiện & Biệt trữ",
        instructions:
          "In bộ nhãn Lô (LOT/MFG/EXP/UDI-DI) và Tờ Hướng dẫn sử dụng (IFU) hiệu lực, dán nhãn ống/hộp phụ/hộp ngoài, tách mẫu lưu QC (Retention Sample) và bàn giao lô sang chờ FQC giải phóng.",
        sop_doc_code: "SOP-KIT-004",
        std_duration_min: 45,
        requires_check_signature: true,
        is_qc: false,
        functional_flags: {
          qc_gate: false,
          dual_sign: true,
          require_line_clearance: false,
          require_material_scan: false,
          require_env_log: false,
          require_yield_reconcile: true,
          require_label_ifu_check: true,
          expected_output: "Bộ Kit hoàn chỉnh + Mẫu lưu QC + Hồ sơ lô EBR chuyển FQC",
        },
        param_schema: [
          { key: "ifu_checked", label: "Tỷ lệ kiểm tra khớp Nhãn & Tờ HDSD (IFU)", type: "number", unit: "%", min: 100, max: 100, required: true },
        ],
      },
    ],
    LYO_6_STEPS: [
      {
        seq: 10,
        step_code: "LYO-10-CLEAR",
        step_name: "Dọn dây chuyền (Line Clearance), Khử ẩm & Chuẩn bị Lô NVL Đông khô",
        category: "PREPARATION",
        step_function: "LINE_CLEARANCE",
        work_center: "Phòng sạch Đông khô (RH < 40%)",
        instructions: "Vệ sinh khử trùng UV, kiểm soát độ ẩm phòng < 40%, đối chiếu mã lô FEFO cho chất bảo vệ đông khô (Trehalose/Mannitol) và Enzyme.",
        sop_doc_code: "SOP-LYO-001",
        std_duration_min: 30,
        requires_check_signature: true,
        is_qc: false,
        functional_flags: { qc_gate: false, dual_sign: true, require_line_clearance: true, require_material_scan: true, require_env_log: true },
        param_schema: [
          { key: "room_rh_pct", label: "Độ ẩm phòng đông khô", type: "number", unit: "%", min: 20, max: 40, required: true },
        ],
      },
      {
        seq: 20,
        step_code: "LYO-20-MIX",
        step_name: "Pha chế Dịch Lyophilization MasterMix (Không Glycerol) & Primer/Probe",
        category: "FORMULATION",
        step_function: "FORMULATION_MIXING",
        work_center: "Tủ ATSH BSC-II Phòng Pha chế",
        instructions: "Phối trộn Glycerol-free Taq/RT Enzyme, dNTPs, Trehalose và Primer/Probe theo BOM trên block lạnh.",
        sop_doc_code: "SOP-LYO-002",
        std_duration_min: 45,
        requires_check_signature: true,
        is_qc: false,
        functional_flags: { qc_gate: false, dual_sign: true, require_material_scan: true, require_env_log: true },
        param_schema: [
          { key: "cold_block_c", label: "Nhiệt độ block lạnh", type: "number", unit: "°C", min: 2, max: 8, required: true },
        ],
      },
      {
        seq: 30,
        step_code: "LYO-30-FILL",
        step_name: "Chiết rót Định lượng vào Dải 8-Strip / Ống Đông khô & Đặt nắp hờ",
        category: "FILLING",
        step_function: "DISPENSING_ALIQUOT",
        work_center: "Hệ thống Chiết rót Tự động",
        instructions: "Chiết rót 20 µL/giếng vào strip 8 giếng chuyên dụng, đặt nắp thông khí và xếp lên khay inox máy đông khô.",
        sop_doc_code: "SOP-LYO-003",
        std_duration_min: 45,
        requires_check_signature: true,
        is_qc: false,
        functional_flags: { qc_gate: false, dual_sign: true, require_yield_reconcile: true },
        param_schema: [
          { key: "fill_vol_ul", label: "Thể tích chiết rót mỗi giếng", type: "number", unit: "µL", min: 19.5, max: 20.5, required: true },
        ],
      },
      {
        seq: 40,
        step_code: "LYO-40-FREEZEDRY",
        step_name: "Chạy Chu trình Đông khô Chân không (Cấp đông -45°C ➔ Sơ cấp ➔ Thứ cấp)",
        category: "LYOPHILIZATION",
        step_function: "LYOPHILIZATION",
        work_center: "Buồng Đông khô Chân không",
        instructions: "Chạy chu trình đông khô tự động 18–24h, kiểm tra áp suất chân không và đóng nắp kín trong môi trường khí Nitơ khô.",
        sop_doc_code: "SOP-LYO-004",
        std_duration_min: 1080,
        requires_check_signature: true,
        is_qc: false,
        functional_flags: { qc_gate: false, dual_sign: true, require_env_log: true },
        param_schema: [
          { key: "shelf_min_temp_c", label: "Nhiệt độ cấp đông sâu", type: "number", unit: "°C", min: -55, max: -40, required: true },
          { key: "vacuum_mtorr", label: "Áp suất chân không buồng sấy", type: "number", unit: "mTorr", min: 30, max: 120, required: true },
        ],
      },
      {
        seq: 50,
        step_code: "LYO-50-IPQC",
        step_name: "Cổng Kiểm soát Chất lượng Bánh Đông khô (IPQC Gate: Độ ẩm tồn dư & Hoạt tính Ct)",
        category: "QC",
        step_function: "IPQC_PH_GATE",
        work_center: "Phòng Kiểm nghiệm QC",
        instructions: "Kiểm tra cảm quan bánh đông khô (trắng xốp, không sụp), độ ẩm tồn dư < 3% và chạy qPCR sau hoàn nguyên.",
        sop_doc_code: "SOP-QC-LYO-01",
        std_duration_min: 60,
        requires_check_signature: true,
        is_qc: true,
        functional_flags: { qc_gate: true, dual_sign: true },
        param_schema: [
          { key: "residual_moisture_pct", label: "Độ ẩm tồn dư bánh đông khô", type: "number", unit: "%", min: 0.5, max: 3.0, required: true },
        ],
      },
      {
        seq: 60,
        step_code: "LYO-60-PACK",
        step_name: "Hàn túi Nhôm chống ẩm kèm Gói hút ẩm, Dán nhãn Hộp & Đính kèm IFU",
        category: "PACKAGING",
        step_function: "LABELING_IFU_PACKAGING",
        work_center: "Khu Đóng gói Khô",
        instructions: "Hàn kín túi nhôm phức hợp kèm gói hút ẩm Silica, dán nhãn hộp ngoài + IFU và bàn giao FQC.",
        sop_doc_code: "SOP-KIT-004",
        std_duration_min: 45,
        requires_check_signature: true,
        is_qc: false,
        functional_flags: { qc_gate: false, dual_sign: true, require_label_ifu_check: true, require_yield_reconcile: true },
        param_schema: [
          { key: "ifu_checked", label: "Tỷ lệ kiểm tra khớp Nhãn & IFU", type: "number", unit: "%", min: 100, max: 100, required: true },
        ],
      },
    ],
    EXTRACTION_5_STEPS: [
      {
        seq: 10,
        step_code: "EXT-10-CLEAR",
        step_name: "Dọn dây chuyền (Line Clearance) & Cân đong Hóa chất Pha đệm (Guanidine / Tris / Muối)",
        category: "PREPARATION",
        step_function: "MATERIAL_VERIFY_FEFO",
        work_center: "Phòng Cân & Chuẩn bị Hóa chất",
        instructions: "Kiểm tra dọn dây chuyền, quét mã lô FEFO các hóa chất rắn/lỏng, cân chính xác trên cân phân tích đã hiệu chuẩn.",
        sop_doc_code: "SOP-EXT-001",
        std_duration_min: 30,
        requires_check_signature: true,
        is_qc: false,
        functional_flags: { qc_gate: false, dual_sign: true, require_line_clearance: true, require_material_scan: true },
        param_schema: [
          { key: "room_temp_c", label: "Nhiệt độ phòng cân", type: "number", unit: "°C", min: 18, max: 26, required: true },
        ],
      },
      {
        seq: 20,
        step_code: "EXT-20-FORMULATE",
        step_name: "Hòa tan Khuấy từ Gia nhiệt, Hiệu chỉnh pH & Lọc vô trùng 0.22 µm",
        category: "FORMULATION",
        step_function: "FORMULATION_MIXING",
        work_center: "Phòng Pha chế Đệm Tách chiết",
        instructions: "Hòa tan hoàn toàn các thành phần đệm (Lysis/Wash/Elution Buffer) bằng máy khuấy từ, chuẩn độ pH và lọc qua màng 0.22 µm.",
        sop_doc_code: "SOP-EXT-002",
        std_duration_min: 60,
        requires_check_signature: true,
        is_qc: false,
        functional_flags: { qc_gate: false, dual_sign: true, require_env_log: true },
        param_schema: [
          { key: "stir_rpm", label: "Tốc độ khuấy từ", type: "number", unit: "rpm", min: 200, max: 600, required: true },
        ],
      },
      {
        seq: 30,
        step_code: "EXT-30-IPQC",
        step_name: "Cổng Kiểm soát Chất lượng Hệ đệm (IPQC Gate: Đo pH, Độ dẫn điện & Độ trong)",
        category: "QC",
        step_function: "IPQC_PH_GATE",
        work_center: "Phòng Kiểm nghiệm QC Hóa lý",
        instructions: "Đo kiểm pH thực tế, kiểm tra độ trong suốt (không kết tủa) và hiệu suất thu hồi ADN/ARN trên mẫu chuẩn trước khi chiết rót.",
        sop_doc_code: "SOP-QC-EXT-01",
        std_duration_min: 45,
        requires_check_signature: true,
        is_qc: true,
        functional_flags: { qc_gate: true, dual_sign: true },
        param_schema: [
          { key: "actual_ph", label: "Giá trị pH thực tế đo được", type: "number", unit: "pH", min: 6.4, max: 8.6, required: true },
        ],
      },
      {
        seq: 40,
        step_code: "EXT-40-FILL",
        step_name: "Chiết rót Đệm vào Chai HDPE / Ống Proteinase K & Siết nắp Màng seal",
        category: "FILLING",
        step_function: "DISPENSING_ALIQUOT",
        work_center: "Dây chuyền Chiết rót Chai Buffer",
        instructions: "Chiết rót thể tích định mức vào chai HDPE 10mL/50mL, siết nắp lực chuẩn và kiểm tra độ kín.",
        sop_doc_code: "SOP-EXT-003",
        std_duration_min: 50,
        requires_check_signature: true,
        is_qc: false,
        functional_flags: { qc_gate: false, dual_sign: true, require_yield_reconcile: true },
        param_schema: [
          { key: "fill_vol_ml", label: "Thể tích chiết rót chai", type: "number", unit: "mL", min: 5, max: 60, required: true },
        ],
      },
      {
        seq: 50,
        step_code: "EXT-50-PACK",
        step_name: "Đóng hộp Cột lọc Silica / Hạt từ + Bộ chai Đệm, Dán nhãn & Kèm Tờ HDSD (IFU)",
        category: "PACKAGING",
        step_function: "LABELING_IFU_PACKAGING",
        work_center: "Khu Đóng gói Kit Tách chiết",
        instructions: "Tập hợp đủ túi Cột thu hồi Silica, ống Collection Tube, các chai đệm VBL/WB1/WB2/Elution, dán nhãn Lô và kèm IFU.",
        sop_doc_code: "SOP-KIT-004",
        std_duration_min: 45,
        requires_check_signature: true,
        is_qc: false,
        functional_flags: { qc_gate: false, dual_sign: true, require_label_ifu_check: true, require_yield_reconcile: true },
        param_schema: [
          { key: "ifu_checked", label: "Tỷ lệ kiểm tra khớp Nhãn & IFU", type: "number", unit: "%", min: 100, max: 100, required: true },
        ],
      },
    ],
    SEMI_FINISHED_4_STEPS: [
      {
        seq: 10,
        step_code: "BTP-10-PREP",
        step_name: "Dọn dây chuyền (Line Clearance) & Cấp phát Nguyên liệu gốc FEFO",
        category: "PREPARATION",
        step_function: "LINE_CLEARANCE",
        work_center: "Phòng sạch Pha chế Bán thành phẩm",
        instructions: "Khử trùng UV buồng pha chế, đối chiếu mã lô nguyên liệu gốc theo BOM Bán thành phẩm.",
        sop_doc_code: "SOP-BTP-001",
        std_duration_min: 20,
        requires_check_signature: true,
        is_qc: false,
        functional_flags: { qc_gate: false, dual_sign: true, require_line_clearance: true, require_material_scan: true },
        param_schema: [
          { key: "room_temp_c", label: "Nhiệt độ phòng pha chế", type: "number", unit: "°C", min: 18, max: 25, required: true },
        ],
      },
      {
        seq: 20,
        step_code: "BTP-20-MIX",
        step_name: "Phối trộn Bán thành phẩm (MasterMix gốc / Primer-Probe 10X / Đệm BTP)",
        category: "FORMULATION",
        step_function: "FORMULATION_MIXING",
        work_center: "Tủ ATSH BSC-II / Máy Khuấy từ",
        instructions: "Phối trộn theo đúng công thức BOM Bán thành phẩm, đồng nhất dung dịch và kiểm soát nhiệt độ.",
        sop_doc_code: "SOP-BTP-002",
        std_duration_min: 40,
        requires_check_signature: true,
        is_qc: false,
        functional_flags: { qc_gate: false, dual_sign: true, require_env_log: true },
        param_schema: [
          { key: "batch_vol_ml", label: "Tổng thể tích mẻ pha chế", type: "number", unit: "mL", min: 1, max: 5000, required: true },
        ],
      },
      {
        seq: 30,
        step_code: "BTP-30-IPQC",
        step_name: "Cổng Kiểm soát Chất lượng Bán thành phẩm (IPQC Gate: Đo pH / OD260 / Ct)",
        category: "QC",
        step_function: "IPQC_PH_GATE",
        work_center: "Phòng Kiểm nghiệm QC",
        instructions: "Đo kiểm pH thực tế và chỉ tiêu chất lượng bán thành phẩm trước khi nhập kho bán thành phẩm.",
        sop_doc_code: "SOP-QC-BTP-01",
        std_duration_min: 45,
        requires_check_signature: true,
        is_qc: true,
        functional_flags: { qc_gate: true, dual_sign: true },
        param_schema: [
          { key: "actual_ph", label: "Giá trị pH thực tế đo được", type: "number", unit: "pH", min: 6.5, max: 8.6, required: true },
        ],
      },
      {
        seq: 40,
        step_code: "BTP-40-STORE",
        step_name: "Chiết chai/ống Bán thành phẩm, Dán nhãn BTP & Bàn giao Nhập kho",
        category: "PACKAGING",
        step_function: "FQC_RELEASE_HANDOVER",
        work_center: "Kho Bán thành phẩm (-20°C / +4°C / RT)",
        instructions: "Chiết vào chai/ống Falcon bảo quản, dán nhãn Lô Bán thành phẩm, tách mẫu lưu và nhập kho.",
        sop_doc_code: "SOP-BTP-003",
        std_duration_min: 25,
        requires_check_signature: true,
        is_qc: false,
        functional_flags: { qc_gate: false, dual_sign: true, require_yield_reconcile: true, require_label_ifu_check: true },
        param_schema: [
          { key: "yield_pct", label: "Hiệu suất thu hồi mẻ BTP", type: "number", unit: "%", min: 95, max: 100, required: true },
        ],
      },
    ],
  };

export async function loadStandardKitRoutingSteps(
  tx: Tx,
  actor: AuthzActor,
  routingId: string,
  templateKey = "PCR_5_STEPS",
  opts: { trusted?: boolean } = {}
) {
  await ensureKitBomRoutingAndIfuSchema(tx);
  const rtg = (await tx.query("SELECT * FROM kit.routing WHERE id = $1 FOR UPDATE", [routingId])).rows[0] as KitRoutingRow | undefined;
  if (!rtg) throw notFound("quy trình Routing");
  if (!opts.trusted) {
    await authorize(tx, actor, "kit.bom.manage", rtg.org_unit_id);
  }
  if (rtg.status !== "DRAFT") {
    throw invalid("Chỉ được nạp mẫu bước công đoạn khi quy trình (Routing) đang ở trạng thái Bản nháp (DRAFT). Hãy bấm 'Nhân bản phiên bản mới' trước.");
  }
  await tx.query("DELETE FROM kit.routing_step WHERE routing_id = $1", [routingId]);

  const stdSteps = STANDARD_ROUTING_STEP_TEMPLATES[templateKey] ?? STANDARD_ROUTING_STEP_TEMPLATES.PCR_5_STEPS;

  for (const s of stdSteps) {
    await tx.query(
      `INSERT INTO kit.routing_step
         (routing_id, seq, step_code, step_name, category, step_function, work_center, functional_flags,
          instructions, sop_doc_code, param_schema, is_qc, requires_check_signature, allow_skip, std_duration_min)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11::jsonb, $12, $13, false, $14)`,
      [
        routingId,
        s.seq,
        s.step_code,
        s.step_name,
        s.category,
        s.step_function,
        s.work_center,
        JSON.stringify(s.functional_flags ?? {}),
        s.instructions,
        s.sop_doc_code,
        JSON.stringify(s.param_schema ?? []),
        s.is_qc,
        s.requires_check_signature,
        s.std_duration_min ?? 30,
      ]
    );
  }

  await writeAudit(tx, actor, {
    entityType: "kit_routing",
    entityId: routingId,
    action: "load_standard_steps",
    changes: { template: [null, templateKey], step_count: [0, stdSteps.length] },
  });
}

export async function fastActivateRouting(tx: Tx, actor: AuthzActor, routingId: string) {
  const rtg = (await tx.query("SELECT * FROM kit.routing WHERE id = $1 FOR UPDATE", [routingId])).rows[0] as KitRoutingRow | undefined;
  if (!rtg) throw notFound("quy trình Routing");
  await authorize(tx, actor, "kit.bom.approve", rtg.org_unit_id);
  if (!actor.isRootAdmin && (rtg.created_by === actor.userId || rtg.updated_by === actor.userId)) {
    throw invalid(
      "Vi phạm Bất kiêm nhiệm (SoD): Người tạo/sửa Quy trình không được tự kích hoạt hiệu lực.",
      undefined,
      "SOD_SELF_APPROVAL"
    );
  }
  const stepCount = Number((await tx.query("SELECT count(*)::int AS c FROM kit.routing_step WHERE routing_id = $1", [routingId])).rows[0]?.c ?? 0);
  if (stepCount === 0) {
    if (rtg.status === "DRAFT") {
      await loadStandardKitRoutingSteps(tx, actor, routingId);
    } else {
      throw invalid("Quy trình Routing phải có ít nhất 1 bước công đoạn trước khi kích hoạt hiệu lực.");
    }
  }
  if (rtg.product_item_id) {
    await tx.query(
      "UPDATE kit.routing SET status = 'OBSOLETE', updated_at = now() WHERE product_item_id = $1 AND status = 'EFFECTIVE' AND id <> $2",
      [rtg.product_item_id, routingId]
    );
  }
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
              rt.code AS routing_code, rt.name AS routing_name, rt.status AS routing_status, rt.routing_category AS routing_category,
              (SELECT count(*)::int FROM kit.routing_step rs WHERE rs.routing_id = b.routing_id) AS routing_step_count,
              (SELECT count(*)::int FROM kit.bom_line bl WHERE bl.bom_id = b.id) AS line_count,
              (SELECT count(*)::int FROM kit.kit_packaging kp WHERE kp.bom_id = b.id) AS packaging_count
         FROM kit.bom b
         JOIN core.org_unit u ON u.id = b.org_unit_id
         JOIN master.item it ON it.id = b.product_item_id
         LEFT JOIN qms.qc_spec qs ON qs.id = b.qc_spec_id
         LEFT JOIN kit.routing rt ON rt.id = b.routing_id
        WHERE ($1::uuid[] IS NULL OR b.org_unit_id = ANY($1::uuid[]))
          AND ($2::text IS NULL OR b.status = $2)
          AND ($3::uuid IS NULL OR b.product_item_id = $3)
          AND ($4::text IS NULL OR lower(b.code) LIKE $4 OR lower(b.name) LIKE $4 OR lower(it.code) LIKE $4 OR lower(it.name) LIKE $4 OR lower(coalesce(b.tccs_code, '')) LIKE $4 OR lower(coalesce(b.responsible_person_name, '')) LIKE $4 OR lower(coalesce(rt.code, '')) LIKE $4)
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
              ap.display_name AS approved_by_name,
              rt.code AS routing_code, rt.name AS routing_name, rt.status AS routing_status, rt.routing_category AS routing_category,
              (SELECT count(*)::int FROM kit.routing_step rs WHERE rs.routing_id = b.routing_id) AS routing_step_count
         FROM kit.bom b
         JOIN core.org_unit u ON u.id = b.org_unit_id
         JOIN master.item it ON it.id = b.product_item_id
         LEFT JOIN qms.qc_spec qs ON qs.id = b.qc_spec_id
         LEFT JOIN core.user_profile ap ON ap.user_id = b.approved_by
         LEFT JOIN kit.routing rt ON rt.id = b.routing_id
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
              (SELECT count(*)::int FROM kit.routing_step rs WHERE rs.routing_id = r.id) AS step_count,
              (SELECT count(*)::int FROM kit.bom b WHERE b.routing_id = r.id) AS linked_bom_count
         FROM kit.routing r
         JOIN core.org_unit u ON u.id = r.org_unit_id
         LEFT JOIN master.item it ON it.id = r.product_item_id
        WHERE ($1::uuid[] IS NULL OR r.org_unit_id = ANY($1::uuid[]))
          AND ($2::text IS NULL OR r.status = $2)
          AND ($3::uuid IS NULL OR r.product_item_id = $3)
          AND (
            $4::text IS NULL
            OR lower(r.code) LIKE $4
            OR lower(r.name) LIKE $4
            OR lower(coalesce(r.routing_category, '')) LIKE $4
            OR lower(coalesce(it.code, '')) LIKE $4
            OR lower(coalesce(it.name, '')) LIKE $4
          )
        ORDER BY CASE WHEN r.product_item_id IS NULL THEN 0 ELSE 1 END ASC, r.code ASC, r.routing_version DESC
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
              ap.display_name AS approved_by_name,
              (SELECT count(*)::int FROM kit.bom b WHERE b.routing_id = r.id) AS linked_bom_count
         FROM kit.routing r
         JOIN core.org_unit u ON u.id = r.org_unit_id
         LEFT JOIN master.item it ON it.id = r.product_item_id
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

  const linked_boms = (
    await tx.query(
      `SELECT b.id, b.code, b.name, b.bom_version, b.status, b.bom_type, b.bom_category, b.variant_code,
              it.code AS product_code, it.name AS product_name
         FROM kit.bom b
         JOIN master.item it ON it.id = b.product_item_id
        WHERE b.routing_id = $1
        ORDER BY it.code ASC, b.bom_version DESC
        LIMIT 60`,
      [id]
    )
  ).rows;

  const actions = await listAllowedActions(tx, routingMachine, actor, rtg);
  return { ...rtg, routing: rtg, steps, linked_boms, actions, allowed_actions: actions };
}
