import { z } from "zod";
import type { Tx } from "../core/db";
import { writeAudit } from "../core/audit";
import { authorize, authorizeAnywhere, type AuthzActor } from "../core/authz";
import { addDays, vnToday } from "../core/dates";
import { invalid, notFound } from "../core/errors";
import { nextNumber } from "../core/numbering";
import { insertRecord, parseInput } from "../core/records";
import { defineMachine, listAllowedActions, runTransition } from "../core/stateMachine";
import { allocate, findCandidates } from "../inv/allocation";
import { createStockDocument, stockDocumentMachine } from "../inv/documents";
import { getItem, toBaseQty } from "../master/service";
import { raiseDeviation } from "../qms/incidents";
import { productionOrderMachine } from "./ordersEbr";
import "./permissions";

export type ReworkOrderStatus = "DRAFT" | "APPROVED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
export type RetainSampleStatus = "STORED" | "INSPECTED" | "DISPOSED";
export type StabilityStudyStatus = "ACTIVE" | "COMPLETED" | "CANCELLED";

export interface ReworkOrderRow {
  id: string;
  code: string;
  org_unit_id: string;
  production_order_id: string;
  ncr_id: string | null;
  scope: "FULL" | "PARTIAL";
  box_no: number | null;
  component_item_id: string | null;
  qty_to_rework: string;
  uom: string;
  warehouse_id: string;
  instructions: string;
  resolution_summary: string | null;
  used_lot_id: string | null;
  stock_document_id: string | null;
  approved_by: number | null;
  approved_at: string | null;
  completed_by: number | null;
  completed_at: string | null;
  status: ReworkOrderStatus;
  version: number;
  created_by: number | null;
}

export interface RetainSampleRow {
  id: string;
  code: string;
  org_unit_id: string;
  lot_id: string;
  production_order_id: string | null;
  location_id: string | null;
  qty: string;
  uom: string;
  storage_condition: string;
  retain_until: string;
  inspection_note: string | null;
  disposed_reason: string | null;
  status: RetainSampleStatus;
  version: number;
  created_by: number | null;
}

export interface StabilityStudyRow {
  id: string;
  code: string;
  org_unit_id: string;
  lot_id: string;
  study_type: "REAL_TIME" | "ACCELERATED" | "IN_USE";
  storage_condition: string;
  protocol_ref: string;
  start_date: string;
  status: StabilityStudyStatus;
  notes: string | null;
  version: number;
  created_by: number | null;
}

/**
 * Kit Rework Order State Machine (Full or Partial Box Replacement):
 * DRAFT → APPROVED ✍ → IN_PROGRESS → COMPLETED
 *       ↘ CANCELLED 📝
 */
export const reworkOrderMachine = defineMachine<ReworkOrderStatus, ReworkOrderRow>({
  entityType: "kit_rework_order",
  table: "kit.rework_order",
  states: ["DRAFT", "APPROVED", "IN_PROGRESS", "COMPLETED", "CANCELLED"],
  terminal: ["COMPLETED", "CANCELLED"],
  scopeOf: (row) => row.org_unit_id,
  transitions: [
    {
      action: "approve",
      from: "DRAFT",
      to: "APPROVED",
      permission: "kit.rework.manage",
      signature: "APPROVED",
      patch: ({ actor }) => ({ approved_by: actor.userId, approved_at: new Date() }),
    },
    {
      action: "start",
      from: "APPROVED",
      to: "IN_PROGRESS",
      permission: "kit.rework.manage",
    },
    {
      action: "complete",
      from: "IN_PROGRESS",
      to: "COMPLETED",
      permission: "kit.rework.manage",
      signature: "PERFORMED",
      patch: ({ actor, payload, row }) => ({
        completed_by: actor.userId,
        completed_at: new Date(),
        resolution_summary: payload.resolution_summary
          ? String(payload.resolution_summary)
          : row.resolution_summary ?? "Hoàn tất làm lại / thay thế thành phần hộp Kit",
      }),
      effects: async ({ tx, actor, updated }) => {
        const order = (
          await tx.query("SELECT id, code, lot_id, status, version FROM kit.production_order WHERE id = $1 FOR UPDATE", [
            updated.production_order_id,
          ])
        ).rows[0];
        if (!order) throw notFound("lệnh sản xuất Kit gốc");

        // If a replacement component item is specified, issue FEFO stock and append to lot_genealogy
        if (updated.component_item_id) {
          const item = await getItem(tx, updated.component_item_id);
          const qtyBase = Math.round((await toBaseQty(tx, item, Number(updated.qty_to_rework), updated.uom)) * 1e6) / 1e6;
          const candidates = await findCandidates(tx, updated.component_item_id, [updated.warehouse_id], { lock: true });
          const alloc = allocate(candidates, qtyBase);
          if (alloc.shortfall > 1e-9) {
            throw invalid(
              `Không đủ tồn kho khả dụng của ${item.code} để cấp phát làm lại: còn thiếu ${alloc.shortfall} ${item.base_uom}.`,
              undefined,
              "INSUFFICIENT_STOCK"
            );
          }

          const doc = await createStockDocument(
            tx,
            actor,
            {
              doc_type: "ISSUE",
              warehouse_id: updated.warehouse_id,
              reason_code: "PRODUCTION_ISSUE",
              ref_entity_type: "KIT_REWORK",
              ref_entity_id: updated.id,
              notes: `Xuất vật tư bổ sung làm lại ${updated.code} (Hộp ${updated.box_no ?? "Toàn bộ"})`,
              lines: alloc.picks.map((p) => ({
                item_id: p.candidate.item_id,
                lot_id: p.candidate.lot_id,
                from_location_id: p.candidate.location_id,
                qty: p.qty,
                uom: item.base_uom,
              })),
            },
            { trusted: true }
          );
          await runTransition(
            tx,
            stockDocumentMachine,
            actor,
            { id: doc.id, action: "post", expectedVersion: doc.version },
            { trusted: true }
          );

          const firstPickLot = alloc.picks[0]?.candidate.lot_id ?? null;
          await tx.query("UPDATE kit.rework_order SET used_lot_id = $2, stock_document_id = $3 WHERE id = $1", [
            updated.id,
            firstPickLot,
            doc.id,
          ]);

          if (order.lot_id) {
            for (const p of alloc.picks) {
              if (!p.candidate.lot_id || p.candidate.lot_id === order.lot_id) continue;
              await tx.query(
                `INSERT INTO kit.lot_genealogy
                   (parent_lot_id, child_lot_id, production_order_id, rework_order_id, qty_used, uom)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [p.candidate.lot_id, order.lot_id, order.id, updated.id, p.qty, item.base_uom]
              );
            }
          }
        }

        // Restore parent production order from ON_HOLD back to PENDING_QC via state machine
        if (order.status === "ON_HOLD") {
          await runTransition(
            tx,
            productionOrderMachine,
            actor,
            {
              id: order.id,
              action: "resume_from_hold",
              expectedVersion: order.version,
              reason: `Hoàn tất lệnh làm lại ${updated.code}`,
            },
            { trusted: true }
          );
        }
      },
    },
    {
      action: "cancel",
      from: ["DRAFT", "APPROVED"],
      to: "CANCELLED",
      permission: "kit.rework.manage",
      reasonRequired: true,
    },
  ],
});

const createReworkSchema = z.object({
  org_unit_id: z.string().uuid("chọn phòng Sản xuất Kit"),
  production_order_id: z.string().uuid("chọn lệnh sản xuất Kit cần làm lại"),
  ncr_id: z.string().uuid().optional().nullable(),
  scope: z.enum(["FULL", "PARTIAL"]).default("PARTIAL"),
  box_no: z.coerce.number().int().positive().optional().nullable(),
  component_item_id: z.string().uuid().optional().nullable(),
  qty_to_rework: z.coerce.number().positive("số lượng làm lại phải > 0"),
  uom: z.string().trim().min(1),
  warehouse_id: z.string().uuid("chọn kho xuất nguyên vật liệu thay thế"),
  instructions: z.string().trim().min(5, "nhập hướng dẫn làm lại / thay thế thành phần").max(2000),
});

export async function createReworkOrder(tx: Tx, actor: AuthzActor, input: unknown) {
  const d = parseInput(createReworkSchema, input);
  await authorize(tx, actor, "kit.rework.manage", d.org_unit_id);
  if (d.scope === "PARTIAL" && !d.box_no) {
    throw invalid("Lệnh làm lại một phần (PARTIAL) phải chỉ rõ số thứ tự Hộp (box_no) cần làm lại.");
  }
  const code = await nextNumber(tx, "KIT_REWORK");
  return insertRecord<ReworkOrderRow>(tx, actor, "kit.rework_order", "kit_rework_order", {
    code,
    org_unit_id: d.org_unit_id,
    production_order_id: d.production_order_id,
    ncr_id: d.ncr_id ?? null,
    scope: d.scope,
    box_no: d.box_no ?? null,
    component_item_id: d.component_item_id ?? null,
    qty_to_rework: d.qty_to_rework,
    uom: d.uom,
    warehouse_id: d.warehouse_id,
    instructions: d.instructions,
  });
}

export async function listReworkOrders(tx: Tx, actor: AuthzActor) {
  await authorizeAnywhere(tx, actor, "kit.view");
  const rows = (
    await tx.query(
      `SELECT rw.*, o.code AS order_code, l.code AS kit_lot_code,
              ci.code AS component_code, ci.name AS component_name,
              ul.code AS used_lot_code, n.code AS ncr_code
         FROM kit.rework_order rw
         JOIN kit.production_order o ON o.id = rw.production_order_id
         LEFT JOIN inv.lot l ON l.id = o.lot_id
         LEFT JOIN master.item ci ON ci.id = rw.component_item_id
         LEFT JOIN inv.lot ul ON ul.id = rw.used_lot_id
         LEFT JOIN qms.ncr n ON n.id = rw.ncr_id
        ORDER BY rw.created_at DESC`
    )
  ).rows as (ReworkOrderRow & Record<string, unknown>)[];

  const out = [];
  for (const r of rows) {
    out.push({ ...r, allowed_actions: await listAllowedActions(tx, reworkOrderMachine, actor, r) });
  }
  return out;
}

/**
 * Retain Sample State Machine (Mẫu lưu đối chứng theo lô Kit):
 * STORED → INSPECTED → DISPOSED 📝
 */
export const retainSampleMachine = defineMachine<RetainSampleStatus, RetainSampleRow>({
  entityType: "kit_retain_sample",
  table: "kit.retain_sample",
  states: ["STORED", "INSPECTED", "DISPOSED"],
  terminal: ["DISPOSED"],
  scopeOf: (row) => row.org_unit_id,
  transitions: [
    {
      action: "inspect",
      from: ["STORED", "INSPECTED"],
      to: "INSPECTED",
      permission: "kit.quality.manage",
      patch: ({ payload, row }) => ({
        inspection_note: payload.inspection_note ? String(payload.inspection_note) : row.inspection_note ?? "Đã kiểm tra định kỳ mẫu lưu",
      }),
    },
    {
      action: "dispose",
      from: ["STORED", "INSPECTED"],
      to: "DISPOSED",
      permission: "kit.quality.manage",
      reasonRequired: true,
      patch: ({ reason }) => ({ disposed_reason: reason ?? null }),
    },
  ],
});

const retainSampleSchema = z.object({
  org_unit_id: z.string().uuid("chọn phòng Sản xuất Kit"),
  lot_id: z.string().uuid("chọn lô thành phẩm Kit"),
  production_order_id: z.string().uuid().optional().nullable(),
  location_id: z.string().uuid().optional().nullable(),
  qty: z.coerce.number().positive("số lượng mẫu lưu phải > 0").default(2),
  uom: z.string().trim().min(1).default("KIT"),
  storage_condition: z.string().trim().min(1).default("-20°C"),
  retain_until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
});

export async function createRetainSample(tx: Tx, actor: AuthzActor, input: unknown) {
  const d = parseInput(retainSampleSchema, input);
  await authorize(tx, actor, "kit.quality.manage", d.org_unit_id);
  const lot = (await tx.query("SELECT id, expiry_date FROM inv.lot WHERE id = $1", [d.lot_id])).rows[0];
  if (!lot) throw notFound("lô thành phẩm Kit");

  // Retain sample is kept at least 1 year past lot expiry date (ISO 13485 / GMP)
  const retainUntil = d.retain_until ?? addDays(lot.expiry_date ?? vnToday(), 365);
  const code = await nextNumber(tx, "KIT_RETAIN");
  return insertRecord<RetainSampleRow>(tx, actor, "kit.retain_sample", "kit_retain_sample", {
    code,
    org_unit_id: d.org_unit_id,
    lot_id: d.lot_id,
    production_order_id: d.production_order_id ?? null,
    location_id: d.location_id ?? null,
    qty: d.qty,
    uom: d.uom,
    storage_condition: d.storage_condition,
    retain_until: retainUntil,
  });
}

/**
 * Stability Study State Machine:
 * ACTIVE → COMPLETED | CANCELLED 📝
 */
export const stabilityStudyMachine = defineMachine<StabilityStudyStatus, StabilityStudyRow>({
  entityType: "kit_stability_study",
  table: "kit.stability_study",
  states: ["ACTIVE", "COMPLETED", "CANCELLED"],
  terminal: ["COMPLETED", "CANCELLED"],
  scopeOf: (row) => row.org_unit_id,
  transitions: [
    {
      action: "complete",
      from: "ACTIVE",
      to: "COMPLETED",
      permission: "kit.quality.manage",
      signature: "APPROVED",
    },
    {
      action: "cancel",
      from: "ACTIVE",
      to: "CANCELLED",
      permission: "kit.quality.manage",
      reasonRequired: true,
    },
  ],
});

const stabilitySchema = z.object({
  org_unit_id: z.string().uuid("chọn phòng Sản xuất Kit"),
  lot_id: z.string().uuid("chọn lô Kit đưa vào theo dõi độ ổn định"),
  study_type: z.enum(["REAL_TIME", "ACCELERATED", "IN_USE"]).default("REAL_TIME"),
  storage_condition: z.string().trim().min(2).default("-20°C ± 5°C"),
  protocol_ref: z.string().trim().min(3, "nhập mã đề cương độ ổn định").max(150),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  months: z.array(z.coerce.number().int().min(0)).default([0, 3, 6, 9, 12]),
  notes: z.string().trim().max(1000).optional().nullable(),
});

export async function createStabilityStudy(tx: Tx, actor: AuthzActor, input: unknown) {
  const d = parseInput(stabilitySchema, input);
  await authorize(tx, actor, "kit.quality.manage", d.org_unit_id);
  const startDate = d.start_date ?? vnToday();
  const code = await nextNumber(tx, "KIT_STABILITY");

  const study = await insertRecord<StabilityStudyRow>(tx, actor, "kit.stability_study", "kit_stability_study", {
    code,
    org_unit_id: d.org_unit_id,
    lot_id: d.lot_id,
    study_type: d.study_type,
    storage_condition: d.storage_condition,
    protocol_ref: d.protocol_ref,
    start_date: startDate,
    notes: d.notes ?? null,
  });

  for (const m of d.months) {
    const dueDate = addDays(startDate, m * 30);
    await tx.query(
      `INSERT INTO kit.stability_timepoint (study_id, month_mark, label, due_date)
       VALUES ($1, $2, $3, $4) ON CONFLICT (study_id, month_mark) DO NOTHING`,
      [study.id, m, `T${m} (${m} tháng)`, dueDate]
    );
  }
  return study;
}

const timepointResultSchema = z.object({
  timepoint_id: z.string().uuid("chọn mốc thời gian kiểm tra"),
  result: z.enum(["PASS", "FAIL"]),
  summary: z.string().trim().min(3, "nhập kết quả đo Ct / độ nhạy tại mốc thời gian").max(1000),
});

export async function recordStabilityTimepoint(tx: Tx, actor: AuthzActor, studyId: string, input: unknown) {
  const d = parseInput(timepointResultSchema, input);
  const study = (await tx.query("SELECT * FROM kit.stability_study WHERE id = $1 FOR UPDATE", [studyId])).rows[0] as
    | StabilityStudyRow
    | undefined;
  if (!study) throw notFound("đề cương độ ổn định");
  await authorize(tx, actor, "kit.quality.manage", study.org_unit_id);

  const tp = (
    await tx.query(
      `UPDATE kit.stability_timepoint
          SET result = $2, summary = $3, tested_at = $4, tested_by = $5
        WHERE id = $1 AND study_id = $6 RETURNING *`,
      [d.timepoint_id, d.result, d.summary, vnToday(), actor.userId, studyId]
    )
  ).rows[0];
  if (!tp) throw notFound("mốc thời gian độ ổn định");

  await writeAudit(tx, actor, {
    entityType: "kit_stability_study",
    entityId: studyId,
    action: "record_timepoint",
    changes: { [tp.label]: ["PENDING", `${d.result}: ${d.summary}`] },
  });

  if (d.result === "FAIL") {
    await raiseDeviation(tx, actor, {
      source_module: "KIT",
      entity_type: "KIT_STABILITY",
      entity_id: studyId,
      step_ref: tp.label,
      severity: "HIGH",
      description: `Mốc độ ổn định ${tp.label} của đề cương ${study.code} không đạt: ${d.summary}`,
      ncr: { lot_id: study.lot_id },
    });
  }
  return tp;
}

export async function listQualityRecords(tx: Tx, actor: AuthzActor) {
  await authorizeAnywhere(tx, actor, "kit.view");
  const retainsRaw = (
    await tx.query(
      `SELECT rs.*, l.code AS lot_code, l.expiry_date, i.code AS product_code, i.name AS product_name,
              loc.code AS location_code, o.code AS order_code
         FROM kit.retain_sample rs
         JOIN inv.lot l ON l.id = rs.lot_id
         JOIN master.item i ON i.id = l.item_id
         LEFT JOIN master.location loc ON loc.id = rs.location_id
         LEFT JOIN kit.production_order o ON o.id = rs.production_order_id
        ORDER BY rs.created_at DESC`
    )
  ).rows as (RetainSampleRow & Record<string, unknown>)[];

  const retain_samples = [];
  for (const r of retainsRaw) {
    retain_samples.push({ ...r, allowed_actions: await listAllowedActions(tx, retainSampleMachine, actor, r) });
  }

  const studiesRaw = (
    await tx.query(
      `SELECT ss.*, l.code AS lot_code, l.expiry_date, i.code AS product_code, i.name AS product_name
         FROM kit.stability_study ss
         JOIN inv.lot l ON l.id = ss.lot_id
         JOIN master.item i ON i.id = l.item_id
        ORDER BY ss.created_at DESC`
    )
  ).rows as (StabilityStudyRow & Record<string, unknown>)[];

  const stability_studies = [];
  for (const s of studiesRaw) {
    const timepoints = (
      await tx.query(
        `SELECT tp.*, up.display_name AS tested_by_name
           FROM kit.stability_timepoint tp
           LEFT JOIN core.user_profile up ON up.user_id = tp.tested_by
          WHERE tp.study_id = $1 ORDER BY tp.month_mark`,
        [s.id]
      )
    ).rows;
    stability_studies.push({
      ...s,
      timepoints,
      allowed_actions: await listAllowedActions(tx, stabilityStudyMachine, actor, s),
    });
  }

  const coas = (
    await tx.query(
      `SELECT c.*, po.actual_ph::float AS actual_ph,
              (c.superseded_by_id IS NOT NULL OR EXISTS (SELECT 1 FROM kit.coa_certificate child WHERE child.amended_from_id = c.id)) AS is_superseded
         FROM kit.coa_certificate c
         LEFT JOIN kit.production_order po ON po.id = c.production_order_id
        ORDER BY c.issued_at DESC, c.revision_no DESC LIMIT 100`
    )
  ).rows;

  return { retain_samples, stability_studies, coas };
}

/**
 * Bidirectional Lot Genealogy Traceability:
 * - Upstream (`upstream_parents`): Which raw material / semi-finished / oligo lots went into this Kit lot?
 * - Downstream (`downstream_children`): Which finished Kit lots (and customer deliveries) used this raw/semi-finished lot?
 */
export async function traceKitLotGenealogy(tx: Tx, actor: AuthzActor, lotId: string) {
  await authorizeAnywhere(tx, actor, "kit.view");
  const lot = (
    await tx.query(
      `SELECT l.*, i.code AS item_code, i.name AS item_name, i.item_type
         FROM inv.lot l JOIN master.item i ON i.id = l.item_id
        WHERE l.id = $1`,
      [lotId]
    )
  ).rows[0];
  if (!lot) throw notFound("lô cần truy xuất");

  const upstream_parents = (
    await tx.query(
      `SELECT g.*, pl.code AS parent_lot_code, pl.mfr_lot_no, pl.expiry_date AS parent_expiry_date,
              pi.code AS parent_item_code, pi.name AS parent_item_name, pi.item_type AS parent_item_type,
              o.code AS order_code, rw.code AS rework_code
         FROM kit.lot_genealogy g
         JOIN inv.lot pl ON pl.id = g.parent_lot_id
         JOIN master.item pi ON pi.id = pl.item_id
         LEFT JOIN kit.production_order o ON o.id = g.production_order_id
         LEFT JOIN kit.rework_order rw ON rw.id = g.rework_order_id
        WHERE g.child_lot_id = $1
        ORDER BY g.created_at`,
      [lotId]
    )
  ).rows;

  const downstream_children = (
    await tx.query(
      `SELECT g.*, cl.code AS child_lot_code, cl.expiry_date AS child_expiry_date, cl.status AS child_lot_status,
              ci.code AS child_item_code, ci.name AS child_item_name,
              o.code AS order_code, rw.code AS rework_code
         FROM kit.lot_genealogy g
         JOIN inv.lot cl ON cl.id = g.child_lot_id
         JOIN master.item ci ON ci.id = cl.item_id
         LEFT JOIN kit.production_order o ON o.id = g.production_order_id
         LEFT JOIN kit.rework_order rw ON rw.id = g.rework_order_id
        WHERE g.parent_lot_id = $1
        ORDER BY g.created_at`,
      [lotId]
    )
  ).rows;

  const coa = (
    await tx.query(
      `SELECT c.*,
              (c.superseded_by_id IS NOT NULL OR EXISTS (SELECT 1 FROM kit.coa_certificate child WHERE child.amended_from_id = c.id)) AS is_superseded
         FROM kit.coa_certificate c
        WHERE c.lot_id = $1
        ORDER BY is_superseded ASC, c.revision_no DESC, c.issued_at DESC
        LIMIT 1`,
      [lotId]
    )
  ).rows[0] ?? null;

  const targetLotIds = [lotId, ...downstream_children.map((c: { child_lot_id: string }) => c.child_lot_id)];
  const downstream_deliveries = (
    await tx.query(
      `SELECT sdl.id, sdl.lot_id, l.code AS lot_code, sdl.qty, sdl.uom,
              sd.code AS document_code, sd.doc_type, sd.reason_code, sd.posted_at, sd.notes,
              w.code AS warehouse_code, w.name AS warehouse_name
         FROM inv.stock_document_line sdl
         JOIN inv.stock_document sd ON sd.id = sdl.document_id
         JOIN inv.lot l ON l.id = sdl.lot_id
         JOIN master.warehouse w ON w.id = sd.warehouse_id
        WHERE sdl.lot_id = ANY($1::uuid[])
          AND sd.status = 'POSTED'
          AND sd.doc_type = 'ISSUE'
        ORDER BY sd.posted_at DESC NULLS LAST`,
      [targetLotIds]
    )
  ).rows;

  return { lot, upstream_parents, downstream_children, downstream_deliveries, coa };
}
