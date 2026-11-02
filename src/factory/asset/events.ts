import { z } from "zod";
import type { Tx } from "../core/db";
import { writeAudit } from "../core/audit";
import { authorize, hasFactoryPermission, type AuthzActor } from "../core/authz";
import { addDays, vnToday } from "../core/dates";
import { invalid, notFound } from "../core/errors";
import { readAttachment, saveAttachment } from "../core/files";
import { notifyUsers, usersWithPermission } from "../core/notifications";
import { nextNumber } from "../core/numbering";
import { parseInput } from "../core/records";
import { defineMachine, listAllowedActions, type GuardContext } from "../core/stateMachine";
import { ensureDepartmentEquipmentSeed, syncOverdueCalibrationAssets } from "./service";

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
    await tx.query("ALTER TABLE qms.deviation ADD COLUMN IF NOT EXISTS category TEXT");
    const devCode = await nextNumber(tx, "DEVIATION");
    const title = `Thiết bị lệch chuẩn / không đạt hiệu chuẩn: ${a.code} (${a.name})`;
    const description = `[Tự động từ Phiếu ${ev.code}] Thiết bị ${a.code} (${a.name}) chuyển trạng thái OUT_OF_CALIBRATION. Yêu cầu QA/QC đánh giá tác động hồi cứu (Retrospective Impact Assessment) các lô đã kiểm nghiệm / sản xuất trên thiết bị này.`;
    const dev = (
      await tx.query(
        `INSERT INTO qms.deviation
           (code, source_module, category, entity_type, entity_id, step_ref, severity, title, description, detected_by, created_by, updated_by)
         VALUES ($1, 'ASSET', 'INSTRUMENT', 'ASSET', $2, $3, 'HIGH', $4, $5, $6, $6, $6)
         RETURNING id`,
        [devCode, ev.asset_id, ev.code, title, description, actor.userId]
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
      },
      reason: `Phiếu ${ev.code}`,
    });
  }
}

const completePatch = ({ payload }: GuardContext<AssetEvent>) => {
  const d = doneSchema.parse(payload);
  return { done_date: d.done_date, performed_by: d.performed_by, result: d.result, passed: d.passed ?? null, next_due: d.next_due ?? null, cost_vnd: d.cost_vnd ?? null };
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
  await ensureDepartmentEquipmentSeed(tx);
  await syncOverdueCalibrationAssets(tx);
  const q = parseInput(listSchema, query);
  const rows = (
    await tx.query(
      `SELECT e.*, e.cost_vnd::float AS cost_vnd,
              a.code AS asset_code, a.name AS asset_name, a.asset_type, a.model AS asset_model, a.serial_no AS asset_serial,
              a.status AS asset_status, a.owner_org_unit_id,
              o.code AS owner_code, o.name AS owner_name,
              (SELECT count(*)::int FROM core.attachment f WHERE f.entity_type = 'asset_event' AND f.entity_id = e.id::text AND f.voided_at IS NULL) AS files
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
  if (permission === "view" ? !(await canSee(tx, actor, e.owner_org_unit_id)) : !(await hasFactoryPermission(tx, actor, permission, e.owner_org_unit_id))) throw notFound("phiếu thiết bị");
  return e;
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
