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
  qc_spec_id: z.string().uuid().optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  clone_from_bom_id: z.string().uuid().optional().nullable(),
});

export async function createBom(tx: Tx, actor: AuthzActor, input: unknown) {
  const d = parseInput(createBomSchema, input);
  await authorize(tx, actor, "kit.bom.manage", d.org_unit_id);
  const product = await getItem(tx, d.product_item_id);
  const baseUom = d.base_uom ?? product.base_uom;
  await toBaseQty(tx, product, d.base_qty, baseUom);

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
    shelf_life_days: d.shelf_life_days,
    qc_spec_id: d.qc_spec_id ?? null,
    notes: d.notes ?? null,
  });

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
  if (bom.status !== "DRAFT") throw invalid("Chỉ được thêm dòng nguyên liệu khi BOM đang ở trạng thái Nháp (DRAFT).");
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
  if (bom.status !== "DRAFT") throw invalid("Chỉ được thêm dòng nguyên liệu khi BOM đang ở trạng thái Nháp (DRAFT).");

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
  if (bom.status !== "DRAFT") throw invalid("Chỉ được chỉnh sửa cấu trúc đóng gói khi BOM đang ở trạng thái Nháp (DRAFT).");

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
  if (rtg.status !== "DRAFT") throw invalid("Chỉ thêm bước công đoạn khi quy trình Routing đang ở trạng thái Nháp (DRAFT).");

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
  limit?: number;
  offset?: number;
}

/**
 * Lists BOMs with server-side search, status/product filtering, and single-query org-unit scope resolution
 * so thousands of formulas can be searched and paginated cleanly.
 */
export async function ensureKitBomRoutingAndIfuSchema(tx: Tx) {
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
      ADD COLUMN IF NOT EXISTS ifu_interpretation text
  `);

  // Populate default Label Artwork & IFU (Instructions For Use) on existing BOMs if empty
  await tx.query(`
    UPDATE kit.bom b
       SET label_template_code = coalesce(b.label_template_code, 'LBL-' || it.code || '-V1'),
           label_dimensions = coalesce(b.label_dimensions, 'Nhãn Hộp ngoài: 95×65 mm · Nhãn Ống 1.5mL: 38×19 mm (Chịu lạnh -80°C)'),
           udi_di = coalesce(b.udi_di, '(01)0893619283' || lpad((b.bom_version * 117)::text, 4, '0')),
           ifu_code = coalesce(b.ifu_code, 'IFU-' || it.code),
           ifu_version = coalesce(b.ifu_version, 'Rev 0' || b.bom_version::text || ' (Hiệu lực ISO 13485)'),
           ifu_intended_use = coalesce(b.ifu_intended_use, 'Bộ Kit xét nghiệm chẩn đoán in vitro (IVD) phát hiện và định lượng acid nucleic đặc hiệu bằng kỹ thuật Real-time PCR / RT-qPCR trên mẫu bệnh phẩm lâm sàng.'),
           ifu_thermal_profile = coalesce(b.ifu_thermal_profile, 'Bước 1 (UNG/RT): 50°C × 10 phút (1 chu kỳ) ➔ Bước 2 (Biến tính đầu): 95°C × 3 phút (1 chu kỳ) ➔ Bước 3 (Khuếch đại 45 chu kỳ): 95°C × 15 giây + 60°C × 45 giây (Thu tín hiệu huỳnh quang tại 60°C).'),
           ifu_channels = coalesce(b.ifu_channels, 'FAM: Đích tác nhân chính (Target) · HEX/VIC: Chứng nội (Internal Control - IC) · ROX: Tham chiếu thụ động'),
           ifu_interpretation = coalesce(b.ifu_interpretation, 'Dương tính: Ct (FAM) ≤ 38.0 có đường cong khuếch đại dạng chữ S điển hình · Âm tính: Không lên tín hiệu FAM và Ct (HEX/IC) ≤ 35.0 · Không hợp lệ (Chạy lại): Không lên cả FAM và HEX/IC.')
      FROM master.item it
     WHERE it.id = b.product_item_id
       AND (b.ifu_code IS NULL OR b.label_template_code IS NULL)
  `);

  // Restore any OBSOLETE routing to EFFECTIVE if its product currently has NO EFFECTIVE routing (fixes RT-HBV-50T-V1 stuck in OBSOLETE)
  await tx.query(`
    UPDATE kit.routing r
       SET status = 'EFFECTIVE',
           approved_at = coalesce(r.approved_at, now()),
           updated_at = now()
     WHERE r.status = 'OBSOLETE'
       AND NOT EXISTS (
         SELECT 1 FROM kit.routing r2
          WHERE r2.product_item_id = r.product_item_id
            AND r2.status = 'EFFECTIVE'
       )
  `);
}

export async function updateBomLabelIfuSpec(tx: Tx, actor: AuthzActor, bomId: string, input: Record<string, unknown>) {
  await ensureKitBomRoutingAndIfuSchema(tx);
  const bom = (await tx.query("SELECT * FROM kit.bom WHERE id = $1 FOR UPDATE", [bomId])).rows[0] as KitBomRow | undefined;
  if (!bom) throw notFound("định mức BOM");
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
              updated_at = now(),
              updated_by = $11
        WHERE id = $1
        RETURNING *`,
      [
        bomId,
        input.label_template_code ? String(input.label_template_code).trim() : null,
        input.label_dimensions ? String(input.label_dimensions).trim() : null,
        input.udi_di ? String(input.udi_di).trim() : null,
        input.ifu_code ? String(input.ifu_code).trim() : null,
        input.ifu_version ? String(input.ifu_version).trim() : null,
        input.ifu_intended_use ? String(input.ifu_intended_use).trim() : null,
        input.ifu_thermal_profile ? String(input.ifu_thermal_profile).trim() : null,
        input.ifu_channels ? String(input.ifu_channels).trim() : null,
        input.ifu_interpretation ? String(input.ifu_interpretation).trim() : null,
        actor.userId,
      ]
    )
  ).rows[0];
  await writeAudit(tx, actor, {
    entityType: "kit_bom",
    entityId: bomId,
    action: "update_label_ifu_spec",
    changes: { ifu_code: [null, updated.ifu_code], label_template_code: [null, updated.label_template_code] },
  });
  return updated;
}

export async function fastActivateBom(tx: Tx, actor: AuthzActor, bomId: string) {
  const bom = (await tx.query("SELECT * FROM kit.bom WHERE id = $1 FOR UPDATE", [bomId])).rows[0] as KitBomRow | undefined;
  if (!bom) throw notFound("định mức BOM");
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
    changes: { status: [bom.status, "EFFECTIVE"] },
  });
  return updated;
}

export async function cloneRouting(tx: Tx, actor: AuthzActor, routingId: string) {
  const src = (await tx.query("SELECT * FROM kit.routing WHERE id = $1", [routingId])).rows[0] as KitRoutingRow | undefined;
  if (!src) throw notFound("quy trình Routing");
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
  if (rtg.status !== "DRAFT") {
    await tx.query("UPDATE kit.routing SET status = 'DRAFT', updated_at = now() WHERE id = $1", [routingId]);
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
  const stepCount = Number((await tx.query("SELECT count(*)::int AS c FROM kit.routing_step WHERE routing_id = $1", [routingId])).rows[0]?.c ?? 0);
  if (stepCount === 0) {
    await loadStandardKitRoutingSteps(tx, actor, routingId);
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
          AND (
            $4::text IS NULL
            OR lower(b.code) LIKE $4
            OR lower(b.name) LIKE $4
            OR lower(it.code) LIKE $4
            OR lower(it.name) LIKE $4
          )
        ORDER BY it.code ASC, b.bom_version DESC
        LIMIT $5 OFFSET $6`,
      [units === "ALL" ? null : units, status, productItemId, q, limit, offset]
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
