import { z } from "zod/v3";
import type { Tx } from "../core/db";
import { writeAudit } from "../core/audit";
import { authorize, hasFactoryPermission, type AuthzActor } from "../core/authz";
import { addDays, vnToday } from "../core/dates";
import { invalid, notFound } from "../core/errors";
import { readAttachment, saveAttachment } from "../core/files";
import { notifyUsers, usersWithPermission } from "../core/notifications";
import { nextNumber } from "../core/numbering";
import { parseInput } from "../core/records";
import { defineMachine, listAllowedActions, runTransition, type GuardContext } from "../core/stateMachine";
import { ensureAssetExtraColumnsSchema, ensureDepartmentEquipmentSeed, syncOverdueCalibrationAssets } from "./service";
import { allocate, findCandidates } from "../inv/allocation";
import { createStockDocument, stockDocumentMachine } from "../inv/documents";
import { getItem, toBaseQty } from "../master/service";

type EventStatus = "PLANNED" | "DONE" | "CANCELLED";
export interface AssetEvent {
  id: string;
  code: string;
  asset_id: string;
  kind: "MAINTENANCE" | "CALIBRATION" | "REPAIR" | "CLEANING" | "QUALIFICATION";
  status: EventStatus;
  out_of_service: boolean;
  version: number;
}
const SIGNED = ["CALIBRATION", "REPAIR", "QUALIFICATION"];

const doneSchema = z.object({
  done_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "nhập ngày thực hiện"),
  performed_by: z.string().trim().min(1, "nhập người / đơn vị thực hiện").max(200),
  result: z.string().trim().min(3, "nhập kết quả / linh kiện thay thế").max(4000),
  spare_parts: z.string().trim().max(2000).optional().nullable(),
  passed: z.boolean().optional().nullable(),
  next_due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  cost_vnd: z.coerce.number().min(0).optional().nullable(),
});

const ownerOf = async (tx: Tx, assetId: string) => (await tx.query("SELECT owner_org_unit_id FROM asset.asset WHERE id = $1", [assetId])).rows[0]?.owner_org_unit_id;
// Phòng Kỹ thuật – Thiết bị services the instruments of every department
const techUnitOf = async (tx: Tx) => (await tx.query("SELECT id FROM core.org_unit WHERE code = 'P-DEVICE' LIMIT 1")).rows[0]?.id ?? null;
async function isTechDept(tx: Tx, actor: AuthzActor) {
  const unit = await techUnitOf(tx);
  return Boolean(unit) && hasFactoryPermission(tx, actor, "device.view", unit);
}

/** What a completed event does to the instrument: calibration sets the due date or takes it out; repair brings it back. */
async function applyToAsset(tx: Tx, actor: AuthzActor, ev: AssetEvent & Record<string, any>) {
  const a = (await tx.query("SELECT * FROM asset.asset WHERE id = $1 FOR UPDATE", [ev.asset_id])).rows[0];
  const next: Record<string, unknown> = {};
  if (ev.kind === "CALIBRATION") {
    if (ev.passed) {
      next.next_calibration_due = ev.next_due ?? (a.calibration_interval_days ? addDays(ev.done_date, a.calibration_interval_days) : a.next_calibration_due);
      if (a.status === "OUT_OF_CALIBRATION") next.status = "IN_SERVICE";
    } else next.status = "OUT_OF_CALIBRATION";
  }
  if (ev.kind === "QUALIFICATION" && ev.passed === false) next.status = "UNDER_MAINTENANCE";
  if ((ev.out_of_service || ev.kind === "REPAIR") && a.status === "UNDER_MAINTENANCE") {
    const open = await tx.query(
      "SELECT 1 FROM asset.event WHERE asset_id = $1 AND (out_of_service OR kind = 'REPAIR') AND status = 'PLANNED' AND id <> $2",
      [ev.asset_id, ev.id]
    );
    if (!open.rowCount && next.status === undefined) next.status = "IN_SERVICE";
  }
  const keys = Object.keys(next);
  if (!keys.length) return;
  await tx.query(`UPDATE asset.asset SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")}, version = version + 1, updated_at = now(), updated_by = $${keys.length + 2} WHERE id = $1`, [
    ev.asset_id, ...keys.map((k) => next[k]), actor.userId,
  ]);
  await writeAudit(tx, actor, { entityType: "asset", entityId: ev.asset_id, action: `event_${ev.kind.toLowerCase()}`, changes: Object.fromEntries(keys.map((k) => [k, [a[k], next[k]]])), reason: `Phiếu ${ev.code}` });

  if (next.status === "OUT_OF_CALIBRATION") {
    const devCode = await nextNumber(tx, "DEVIATION");
    const sinceSql = a.last_calibration_date
      ? new Date(a.last_calibration_date).toISOString()
      : new Date(Date.now() - 90 * 86400_000).toISOString();
    const kitOrders = (
      await tx.query(
        `SELECT DISTINCT po.id, po.code, po.lot_id
           FROM kit.production_step ps
           JOIN kit.production_order po ON po.id = ps.order_id
          WHERE ps.asset_id = $1
            AND COALESCE(ps.completed_at, ps.started_at, ps.checked_at, po.created_at) >= $2::timestamptz`,
        [ev.asset_id, sinceSql]
      )
    ).rows;
    const qcTests = (
      await tx.query(
        `SELECT DISTINCT qt.id, qt.code, qt.entity_type, qt.entity_id
           FROM qms.qc_result qr
           JOIN qms.qc_test qt ON qt.id = qr.test_id
          WHERE qr.instrument_asset_id = $1
            AND qr.entered_at >= $2::timestamptz`,
        [ev.asset_id, sinceSql]
      )
    ).rows;
    const oligoBatches = (
      await tx.query(
        `SELECT DISTINCT sb.id, sb.code
           FROM oligo.synthesis_batch sb
          WHERE sb.synthesizer_id = $1
            AND COALESCE(sb.finished_at, sb.started_at, sb.created_at) >= $2::timestamptz`,
        [ev.asset_id, sinceSql]
      )
    ).rows;
    const totalCount = kitOrders.length + qcTests.length + oligoBatches.length;
    const affectedPayload = {
      since: sinceSql,
      kit_orders: kitOrders,
      qc_tests: qcTests,
      oligo_batches: oligoBatches,
      total_count: totalCount,
    };

    const title = `Thiết bị lệch chuẩn / không đạt hiệu chuẩn: ${a.code} (${a.name})`;
    const description = `[Tự động từ Phiếu ${ev.code}] Thiết bị ${a.code} (${a.name}) chuyển trạng thái OUT_OF_CALIBRATION. Truy vết tự động từ ${sinceSql.slice(0, 10)}: phát hiện ${totalCount} hồ sơ/lô bị ảnh hưởng (${kitOrders.length} lệnh Kit, ${qcTests.length} phiếu QC, ${oligoBatches.length} mẻ Oligo). Yêu cầu QA/QC đánh giá tác động hồi cứu (Retrospective Impact Assessment).`;
    const dev = (
      await tx.query(
        `INSERT INTO qms.deviation
           (code, source_module, category, entity_type, entity_id, step_ref, severity, title, description, affected_batches_json, detected_by, created_by, updated_by)
         VALUES ($1, 'ASSET', 'INSTRUMENT', 'ASSET', $2, $3, 'HIGH', $4, $5, $7::jsonb, $6, $6, $6)
         RETURNING id`,
        [devCode, ev.asset_id, ev.code, title, description, actor.userId, JSON.stringify(affectedPayload)]
      )
    ).rows[0];
    await writeAudit(tx, actor, {
      entityType: "deviation",
      entityId: dev.id,
      action: "create_instrument_out_of_calibration",
      changes: {
        code: [null, devCode],
        severity: [null, "HIGH"],
        category: [null, "INSTRUMENT"],
        entity_type: [null, "ASSET"],
        entity_id: [null, ev.asset_id],
        affected_count: [null, String(totalCount)],
      },
      reason: `Phiếu ${ev.code}`,
    });
    await notifyUsers(tx, await usersWithPermission(tx, "qms.qc.review", null), {
      type: "QMS_DEVIATION",
      title: `Cảnh báo lệch chuẩn TB ${a.code} — ${devCode} (${totalCount} hồ sơ ảnh hưởng)`,
      body: description.slice(0, 300),
      entityType: "deviation",
      entityId: dev.id,
      link: "/?tab=factory-qa",
      sourceKey: `deviation:${dev.id}`,
    });
  }
}

const completePatch = ({ payload }: GuardContext<AssetEvent>) => {
  const d = doneSchema.parse(payload);
  return {
    done_date: d.done_date,
    performed_by: d.performed_by,
    result: d.result,
    spare_parts: d.spare_parts?.trim() || null,
    passed: d.passed ?? null,
    next_due: d.next_due ?? null,
    cost_vnd: d.cost_vnd ?? null,
  };
};
const resultGuard = {
  code: "RESULT",
  message: "Nhập ngày thực hiện (không ở tương lai), người thực hiện, kết quả; hiệu chuẩn / thẩm định phải chọn Đạt hoặc Không đạt.",
  check: ({ row, payload }: GuardContext<AssetEvent>) => {
    const p = doneSchema.safeParse(payload);
    if (!p.success || p.data.done_date > vnToday()) return false;
    return !["CALIBRATION", "QUALIFICATION"].includes(row.kind) || typeof p.data.passed === "boolean";
  },
};

/**
 * Event life cycle: PLANNED → DONE (routine maintenance / cleaning by an operator; calibration, repair and
 * qualification signed with meaning PERFORMED by someone managing equipment) or → CANCELLED with a reason.
 */
export const assetEventMachine = defineMachine<EventStatus, AssetEvent>({
  entityType: "asset_event",
  table: "asset.event",
  states: ["PLANNED", "DONE", "CANCELLED"],
  terminal: ["DONE", "CANCELLED"],
  scopeOf: (row, tx) => ownerOf(tx!, row.asset_id),
  transitions: [
    {
      action: "complete",
      from: "PLANNED",
      to: "DONE",
      permission: "asset.operate",
      guards: [{ code: "SIGNED_KIND", message: "Hiệu chuẩn, sửa chữa, thẩm định: dùng “Hoàn thành (ký)”.", check: ({ row }) => !SIGNED.includes(row.kind) }, resultGuard],
      patch: completePatch,
      effects: ({ tx, actor, updated }) => applyToAsset(tx, actor, updated as any),
    },
    {
      action: "complete_signed",
      from: "PLANNED",
      to: "DONE",
      permission: "asset.manage",
      signature: "PERFORMED",
      guards: [{ code: "ROUTINE_KIND", message: "Bảo trì định kỳ / vệ sinh: dùng “Hoàn thành”.", check: ({ row }) => SIGNED.includes(row.kind) }, resultGuard],
      patch: completePatch,
      effects: ({ tx, actor, updated }) => applyToAsset(tx, actor, updated as any),
    },
    {
      // done by Phòng Kỹ thuật – Thiết bị on any department's instrument
      action: "tech_complete",
      from: "PLANNED",
      to: "DONE",
      permission: "device.view",
      scopeOf: (_row, tx) => techUnitOf(tx),
      guards: [resultGuard],
      patch: completePatch,
      effects: async ({ tx, actor, updated }) => {
        await applyToAsset(tx, actor, updated as any);
        const a = (
          await tx.query(
            "SELECT a.code, a.name, a.owner_org_unit_id, o.name AS owner_name FROM asset.asset a JOIN core.org_unit o ON o.id = a.owner_org_unit_id WHERE a.id = $1",
            [updated.asset_id]
          )
        ).rows[0];
        if (a) {
          const deptUsers = await usersWithPermission(tx, "asset.view", a.owner_org_unit_id);
          await notifyUsers(tx, deptUsers, {
            type: "ASSET_EVENT_DONE",
            title: `Đã hoàn tất bảo trì / hiệu chuẩn: ${a.code} (${a.name})`,
            body: `Phòng Kỹ thuật – Thiết bị đã hoàn thành phiếu ${updated.code}. Thiết bị đã sẵn sàng vận hành.`,
            entityType: "asset_event",
            entityId: updated.id,
            sourceKey: `asset_event_done_${updated.id}`,
          });
        }
      },
    },
    {
      action: "cancel",
      from: "PLANNED",
      to: "CANCELLED",
      permission: "asset.manage",
      reasonRequired: true,
      patch: ({ reason }) => ({ cancel_reason: reason }),
      effects: async ({ tx, actor, updated }) => applyToAsset(tx, actor, { ...(updated as any), kind: "MAINTENANCE" }),
    },
  ],
});

const planSchema = z.object({
  asset_id: z.string().uuid("chọn thiết bị"),
  kind: z.enum(["MAINTENANCE", "CALIBRATION", "REPAIR", "CLEANING", "QUALIFICATION"]),
  planned_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "chọn ngày dự kiến"),
  assignee: z.string().trim().max(200).optional().nullable(),
  description: z.string().trim().max(4000).optional().nullable(),
  // a breakdown report: the instrument is out of service at once (machines, batches and SOP steps refuse it)
  out_of_service: z.boolean().default(false),
});

export async function planEvent(tx: Tx, actor: AuthzActor, input: unknown) {
  const d = parseInput(planSchema, input);
  const a = (
    await tx.query(
      "SELECT a.*, o.code AS owner_code, o.name AS owner_name FROM asset.asset a JOIN core.org_unit o ON o.id = a.owner_org_unit_id WHERE a.id = $1 FOR UPDATE OF a",
      [d.asset_id]
    )
  ).rows[0];
  if (!a) throw notFound("thiết bị");
  // whoever operates the instrument may report a breakdown or propose care of any kind (completion stays signed / with the tech department)
  if (!(await isTechDept(tx, actor))) await authorize(tx, actor, "asset.operate", a.owner_org_unit_id);
  if (a.status === "RETIRED") throw invalid("Thiết bị đã ngừng sử dụng.");
  const code = await nextNumber(tx, "ASSET_EVENT");
  const assignee = d.assignee?.trim() || "Phòng Kỹ thuật – Thiết bị";
  const outOfService = Boolean(d.out_of_service || d.kind === "REPAIR");
  const ev = (
    await tx.query(
      `INSERT INTO asset.event (code, asset_id, kind, planned_date, assignee, description, out_of_service, created_by, updated_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8) RETURNING *`,
      [code, d.asset_id, d.kind, d.planned_date, assignee, d.description ?? null, outOfService, actor.userId]
    )
  ).rows[0];
  if (outOfService && a.status !== "UNDER_MAINTENANCE") {
    await tx.query("UPDATE asset.asset SET status = 'UNDER_MAINTENANCE', version = version + 1, updated_at = now(), updated_by = $2 WHERE id = $1", [a.id, actor.userId]);
    await writeAudit(tx, actor, { entityType: "asset", entityId: a.id, action: "out_of_service", changes: { status: [a.status, "UNDER_MAINTENANCE"] }, reason: `Phiếu ${code}: ${d.description ?? ""}`.trim() });
  }
  await writeAudit(tx, actor, { entityType: "asset_event", entityId: ev.id, action: "plan", changes: { code: [null, code], kind: [null, d.kind], planned_date: [null, d.planned_date] } });

  // Notify Engineering & Technology (`P-DEVICE`) immediately
  const techDept = (await tx.query("SELECT id FROM core.org_unit WHERE code = 'P-DEVICE' LIMIT 1")).rows[0];
  const techUsers = await usersWithPermission(tx, "device.view", techDept?.id ?? null);
  const kindLabel: Record<string, string> = {
    MAINTENANCE: "Bảo trì định kỳ",
    CALIBRATION: "Hiệu chuẩn",
    REPAIR: "Sửa chữa / Báo hỏng",
    CLEANING: "Vệ sinh",
    QUALIFICATION: "Thẩm định IQ/OQ/PQ",
  };
  await notifyUsers(tx, techUsers, {
    type: "ASSET_EVENT_REQUEST",
    title: `[${a.owner_name}] Đề xuất ${kindLabel[d.kind] ?? d.kind}: ${a.code} — ${a.name}`,
    body: `${d.out_of_service ? "🚨 NGỪNG MÁY KHẨN CẤP · " : ""}Ngày dự kiến: ${d.planned_date} · Nội dung: ${d.description ?? "Yêu cầu Phòng Kỹ thuật – Thiết bị kiểm tra xử lý"}`,
    entityType: "asset_event",
    entityId: ev.id,
    link: "/?tab=factory-device",
    sourceKey: `asset_event_plan_${ev.id}`,
  });

  return ev;
}

const listSchema = z.object({
  status: z.enum(["PLANNED", "DONE", "CANCELLED"]).optional(),
  asset_id: z.string().uuid().optional(),
  dept: z.string().trim().optional(),
});

/** Events of the instruments across departments, plus instruments whose calibration falls due within 30 days. */
export async function listEvents(tx: Tx, actor: AuthzActor, query: unknown) {
  await ensureAssetExtraColumnsSchema(tx);
  await ensureDepartmentEquipmentSeed(tx);
  await syncOverdueCalibrationAssets(tx);
  const q = parseInput(listSchema, query);
  const rows = (
    await tx.query(
      `SELECT e.*, e.cost_vnd::float AS cost_vnd,
              COALESCE(e.parts_json, '[]'::jsonb) AS parts_json,
              a.code AS asset_code, a.name AS asset_name, a.asset_type, a.model AS asset_model, a.serial_no AS asset_serial,
              a.status AS asset_status, a.owner_org_unit_id,
              o.code AS owner_code, o.name AS owner_name,
              (SELECT count(*)::int FROM core.attachment f WHERE f.entity_type = 'asset_event' AND f.entity_id = e.id::text AND f.voided_at IS NULL) AS files,
              COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                  'id', f.id,
                  'file_name', f.file_name,
                  'mime_type', f.mime_type,
                  'size_bytes', f.size_bytes,
                  'uploaded_at', f.uploaded_at
                ) ORDER BY f.uploaded_at)
                FROM core.attachment f
                WHERE f.entity_type = 'asset_event' AND f.entity_id = e.id::text AND f.voided_at IS NULL
              ), '[]'::jsonb) AS attachments
         FROM asset.event e
         JOIN asset.asset a ON a.id = e.asset_id
         JOIN core.org_unit o ON o.id = a.owner_org_unit_id
        WHERE ($1::text IS NULL OR e.status = $1)
          AND ($2::uuid IS NULL OR e.asset_id = $2)
          AND ($3::text IS NULL OR o.code = $3)
        ORDER BY CASE e.status WHEN 'PLANNED' THEN 0 ELSE 1 END, e.planned_date ASC, e.created_at DESC LIMIT 300`,
      [q.status ?? null, q.asset_id ?? null, q.dept ?? null]
    )
  ).rows;
  const visible = [];
  for (const r of rows) {
    if (await canSee(tx, actor, r.owner_org_unit_id)) visible.push({ ...r, actions: await listAllowedActions(tx, assetEventMachine, actor, r) });
  }
  const due = (
    await tx.query(
      `SELECT a.id, a.code, a.name, a.asset_type, a.model, a.serial_no, a.next_calibration_due, a.status, a.owner_org_unit_id,
              o.code AS owner_code, o.name AS owner_name,
              EXISTS (SELECT 1 FROM asset.event e WHERE e.asset_id = a.id AND e.kind IN ('CALIBRATION', 'MAINTENANCE') AND e.status = 'PLANNED') AS planned
         FROM asset.asset a
         JOIN core.org_unit o ON o.id = a.owner_org_unit_id
        WHERE a.status <> 'RETIRED'
          AND ($2::text IS NULL OR o.code = $2)
          AND a.next_calibration_due IS NOT NULL
          AND a.next_calibration_due <= $1::date
        ORDER BY a.next_calibration_due`,
      [addDays(vnToday(), 30), q.dept ?? null]
    )
  ).rows;
  const dueVisible = [];
  for (const r of due) if (await canSee(tx, actor, r.owner_org_unit_id)) dueVisible.push(r);
  return { events: visible, calibration_due: dueVisible };
}

async function canSee(tx: Tx, actor: AuthzActor, unit: string) {
  return (await hasFactoryPermission(tx, actor, "asset.view", unit)) || isTechDept(tx, actor);
}

async function eventFor(tx: Tx, actor: AuthzActor, id: string, permission: string) {
  const e = (await tx.query("SELECT e.*, a.owner_org_unit_id FROM asset.event e JOIN asset.asset a ON a.id = e.asset_id WHERE e.id = $1", [id])).rows[0];
  if (!e) throw notFound("phiếu thiết bị");
  const allowed =
    permission === "view"
      ? await canSee(tx, actor, e.owner_org_unit_id)
      : (await hasFactoryPermission(tx, actor, permission, e.owner_org_unit_id)) || (await isTechDept(tx, actor));
  if (!allowed) throw notFound("phiếu thiết bị");
  return e;
}

const issueEventPartSchema = z.object({
  warehouse_id: z.string().uuid().optional().nullable(),
  item_id: z.string().uuid().optional().nullable(),
  part_name: z.string().trim().min(1, "Nhập tên phụ tùng / linh kiện thay thế").max(300),
  part_code: z.string().trim().max(100).optional().nullable(),
  serial_or_lot: z.string().trim().max(120).optional().nullable(),
  qty: z.coerce.number().positive("Số lượng > 0").default(1),
  uom: z.string().trim().max(40).default("pcs"),
  unit_cost_vnd: z.coerce.number().min(0).default(0),
  deduct_warehouse: z.boolean().default(false),
  notes: z.string().trim().max(500).optional().nullable(),
});

/**
 * Records a replaced spare part on an internal lab equipment maintenance/repair event (`asset.event`).
 * If `deduct_warehouse = true` and `warehouse_id` + `item_id` are provided, automatically creates and posts
 * an inventory `ISSUE` stock document (FEFO/FIFO) and appends the part entry to `parts_json` + `spare_parts`.
 */
export async function recordEventSparePart(tx: Tx, actor: AuthzActor, eventId: string, input: unknown) {
  await ensureAssetExtraColumnsSchema(tx);
  const d = parseInput(issueEventPartSchema, input);
  const ev = await eventFor(tx, actor, eventId, "asset.operate");
  if (ev.status === "CANCELLED") throw invalid("Không thể ghi nhận phụ tùng cho phiếu đã hủy.");

  let stockDocCode: string | null = null;
  let stockDocId: string | null = null;
  let pickedLotCodes: string[] = [];
  let partCode = d.part_code?.trim() || null;
  let partName = d.part_name.trim();
  let uom = d.uom.trim() || "pcs";

  if (d.deduct_warehouse && d.warehouse_id && d.item_id) {
    const item = await getItem(tx, d.item_id);
    partCode = item.code;
    partName = item.name;
    uom = item.base_uom;
    const needBase = Math.round((await toBaseQty(tx, item, d.qty, d.uom || item.base_uom)) * 1e6) / 1e6;
    const cands = await findCandidates(tx, item.id, [d.warehouse_id], { lock: true });
    const plan = allocate(cands, needBase);
    if (plan.shortfall > 1e-9) {
      throw invalid(
        `Không đủ tồn kho khả dụng cho phụ tùng ${item.code} (${item.name}): cần ${needBase} ${item.base_uom}, thiếu ${plan.shortfall}.`,
        undefined,
        "INSUFFICIENT_STOCK"
      );
    }
    const doc = await createStockDocument(
      tx,
      actor,
      {
        doc_type: "ISSUE",
        reason_code: "PRODUCTION",
        warehouse_id: d.warehouse_id,
        source_entity_type: "ASSET_EVENT",
        source_entity_id: ev.id,
        notes: `Xuất phụ tùng sửa chữa/bảo trì máy theo phiếu ${ev.code}`,
        lines: plan.picks.map((p) => ({
          item_id: item.id,
          lot_id: p.candidate.lot_id,
          from_location_id: p.candidate.location_id,
          qty: p.qty,
          uom: item.base_uom,
        })),
      },
      { trusted: true }
    );
    await runTransition(tx, stockDocumentMachine, actor, { id: doc.id, action: "post", expectedVersion: doc.version }, { trusted: true });
    stockDocId = doc.id;
    stockDocCode = doc.code;
    pickedLotCodes = plan.picks.map((p) => p.candidate.lot_code).filter(Boolean);
  }

  const currentParts: any[] = Array.isArray(ev.parts_json) ? [...ev.parts_json] : [];
  const lineCost = Math.round(Number(d.qty) * Number(d.unit_cost_vnd || 0));
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    part_code: partCode,
    part_name: partName,
    serial_or_lot: d.serial_or_lot?.trim() || (pickedLotCodes.length ? pickedLotCodes.join(", ") : null),
    qty: Number(d.qty),
    uom,
    unit_cost_vnd: Number(d.unit_cost_vnd || 0),
    line_cost_vnd: lineCost,
    stock_document_id: stockDocId,
    stock_document_code: stockDocCode,
    notes: d.notes?.trim() || null,
    added_at: new Date().toISOString(),
  };
  currentParts.push(entry);

  const summaryStr = currentParts
    .map((p) => `${p.part_code ? `[${p.part_code}] ` : ""}${p.part_name} (SL: ${p.qty} ${p.uom}${p.serial_or_lot ? ` · Lot/SN: ${p.serial_or_lot}` : ""}${p.stock_document_code ? ` · PXK: ${p.stock_document_code}` : ""})`)
    .join("; ");

  const nextCost = Number(ev.cost_vnd || 0) + lineCost;

  const updated = (
    await tx.query(
      `UPDATE asset.event
          SET parts_json = $2::jsonb,
              spare_parts = $3,
              cost_vnd = CASE WHEN $4::numeric > 0 THEN COALESCE(cost_vnd, 0) + $4::numeric ELSE cost_vnd END,
              updated_at = now(),
              updated_by = $5
        WHERE id = $1
        RETURNING *, cost_vnd::float AS cost_vnd`,
      [eventId, JSON.stringify(currentParts), summaryStr, lineCost, actor.userId]
    )
  ).rows[0];

  await writeAudit(tx, actor, {
    entityType: "asset_event",
    entityId: eventId,
    action: "add_spare_part",
    changes: { spare_part: [null, `${partName} (${d.qty} ${uom})`] },
    reason: stockDocCode ? `Phiếu xuất kho ${stockDocCode}` : "Ghi nhận phụ tùng thay thế",
  });

  return { event: updated, part: entry, TotalCostVnd: nextCost };
}

/** Hand-over record, invoice, service report … attached to an event (PDF, Office or image; checked by content). */
export async function attachToEvent(tx: Tx, actor: AuthzActor, id: string, file: { fileName: string; mimeType: string; data: Buffer }) {
  await eventFor(tx, actor, id, "asset.operate");
  const category = file.mimeType.startsWith("image/") ? "IMAGE" : "DOCUMENT";
  return saveAttachment(tx, actor, { entityType: "asset_event", entityId: id, category, ...file });
}

export async function listEventFiles(tx: Tx, actor: AuthzActor, id: string) {
  await eventFor(tx, actor, id, "view");
  return (
    await tx.query(
      "SELECT f.id, f.file_name, f.mime_type, f.size_bytes, f.uploaded_at, p.display_name AS uploaded_by_name FROM core.attachment f LEFT JOIN core.user_profile p ON p.user_id = f.uploaded_by WHERE f.entity_type = 'asset_event' AND f.entity_id = $1 AND f.voided_at IS NULL ORDER BY f.uploaded_at",
      [id]
    )
  ).rows;
}

export async function readEventFile(tx: Tx, actor: AuthzActor, id: string, fileId: string) {
  await eventFor(tx, actor, id, "view");
  const f = (await tx.query("SELECT 1 FROM core.attachment WHERE id = $1 AND entity_type = 'asset_event' AND entity_id = $2", [fileId, id])).rows[0];
  if (!f) throw notFound("file đính kèm");
  return readAttachment(tx, fileId);
}
