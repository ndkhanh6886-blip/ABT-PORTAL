import { z } from "zod";
import type { Tx } from "../core/db";
import { writeAudit } from "../core/audit";
import { authorize, authorizeAnywhere, hasFactoryPermission, type AuthzActor } from "../core/authz";
import { vnToday } from "../core/dates";
import { invalid, notFound } from "../core/errors";
import { nextNumber } from "../core/numbering";
import { insertRecord, parseInput } from "../core/records";
import { defineMachine, listAllowedActions, runTransition } from "../core/stateMachine";
import { allocate, findCandidates } from "../inv/allocation";
import { createStockDocument, stockDocumentMachine } from "../inv/documents";
import { getItem, toBaseQty } from "../master/service";
import { deviceUnitMachine } from "./assembly";
import "./permissions";

export type ServiceTicketStatus =
  | "OPEN"
  | "DIAGNOSING"
  | "AWAITING_PARTS"
  | "IN_REPAIR"
  | "RESOLVED"
  | "CLOSED"
  | "CANCELLED";

export interface ServiceTicketRow {
  id: string;
  code: string;
  org_unit_id: string;
  unit_id: string;
  ticket_type: "PREVENTIVE" | "REPAIR" | "WARRANTY" | "COMPLAINT" | "INSTALLATION";
  reported_at: string;
  symptom: string;
  diagnosis: string | null;
  resolution: string | null;
  is_warranty: boolean;
  service_cost: string;
  capa_evaluated: boolean;
  capa_required: boolean;
  deviation_id: string | null;
  assigned_to: number | null;
  customer_confirmer: string | null;
  closed_by: number | null;
  closed_at: string | null;
  status: ServiceTicketStatus;
  version: number;
}

function addMonths(dateStr: string, months: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + months, d));
  return dt.toISOString().slice(0, 10);
}

/**
 * Field Service Ticket state machine (docs/nha-may/02 §10.5):
 * OPEN → DIAGNOSING → AWAITING_PARTS → IN_REPAIR → RESOLVED → CLOSED ✍
 * OPEN → CANCELLED 📝
 * - Automatically synchronizes the serialized `device_unit` status between `UNDER_SERVICE` and `IN_SERVICE_FIELD`.
 * - For `COMPLAINT` tickets, closing requires a documented CAPA evaluation (`capa_evaluated = true`).
 */
export const serviceTicketMachine = defineMachine<ServiceTicketStatus, ServiceTicketRow>({
  entityType: "device_service_ticket",
  table: "device.service_ticket",
  states: ["OPEN", "DIAGNOSING", "AWAITING_PARTS", "IN_REPAIR", "RESOLVED", "CLOSED", "CANCELLED"],
  terminal: ["CLOSED", "CANCELLED"],
  scopeOf: (row) => row.org_unit_id,
  transitions: [
    {
      action: "diagnose",
      from: "OPEN",
      to: "DIAGNOSING",
      permission: "device.service.manage",
      effects: async ({ tx, actor, updated }) => {
        const u = (
          await tx.query("SELECT id, status, version FROM device.device_unit WHERE id = $1 FOR UPDATE", [updated.unit_id])
        ).rows[0];
        if (u && ["DELIVERED", "IN_SERVICE_FIELD"].includes(u.status)) {
          await runTransition(
            tx,
            deviceUnitMachine,
            actor,
            { id: u.id, action: "under_service", expectedVersion: u.version },
            { trusted: true }
          );
        }
      },
    },
    {
      action: "await_parts",
      from: "DIAGNOSING",
      to: "AWAITING_PARTS",
      permission: "device.service.manage",
      patch: ({ row, payload }) => ({
        diagnosis: ((payload.diagnosis as string)?.trim() || row.diagnosis) ?? null,
      }),
    },
    {
      action: "start_repair",
      from: ["DIAGNOSING", "AWAITING_PARTS"],
      to: "IN_REPAIR",
      permission: "device.service.manage",
      patch: ({ row, payload }) => ({
        diagnosis: ((payload.diagnosis as string)?.trim() || row.diagnosis) ?? null,
      }),
    },
    {
      action: "resolve",
      from: ["DIAGNOSING", "IN_REPAIR"],
      to: "RESOLVED",
      permission: "device.service.manage",
      guards: [
        {
          code: "RESOLUTION_REQUIRED",
          message: "Nhập biên bản xử lý / kết quả khắc phục (resolution) trước khi hoàn tất sửa chữa.",
          check: ({ row, payload }) => Boolean((payload.resolution as string)?.trim() || row.resolution?.trim()),
        },
      ],
      patch: ({ row, payload }) => ({
        diagnosis: ((payload.diagnosis as string)?.trim() || row.diagnosis) ?? null,
        resolution: ((payload.resolution as string)?.trim() || row.resolution) ?? null,
      }),
    },
    {
      action: "close",
      from: "RESOLVED",
      to: "CLOSED",
      permission: "device.service.manage",
      signature: "APPROVED",
      guards: [
        {
          code: "CAPA_EVAL_REQUIRED",
          message:
            "Phiếu khiếu nại chất lượng (COMPLAINT) bắt buộc đánh giá có cần mở CAPA hay không trước khi đóng phiếu.",
          check: ({ row }) => {
            if (row.ticket_type !== "COMPLAINT") return true;
            if (!row.capa_evaluated) return false;
            if (row.capa_required && !row.deviation_id) return false;
            return true;
          },
        },
      ],
      patch: ({ actor, row, payload }) => ({
        customer_confirmer: ((payload.customer_confirmer as string)?.trim() || row.customer_confirmer) ?? null,
        closed_by: actor.userId,
        closed_at: new Date(),
      }),
      effects: async ({ tx, actor, updated }) => {
        const u = (
          await tx.query("SELECT id, status, version FROM device.device_unit WHERE id = $1 FOR UPDATE", [updated.unit_id])
        ).rows[0];
        if (u && ["DELIVERED", "UNDER_SERVICE"].includes(u.status)) {
          await runTransition(
            tx,
            deviceUnitMachine,
            actor,
            { id: u.id, action: "return_to_service", expectedVersion: u.version },
            { trusted: true }
          );
        }
        if (updated.ticket_type === "PREVENTIVE") {
          const sched = (
            await tx.query("SELECT * FROM device.service_schedule WHERE unit_id = $1 FOR UPDATE", [updated.unit_id])
          ).rows[0];
          const today = vnToday();
          const interval = Number(sched?.interval_months ?? 6);
          const nextDue = addMonths(today, interval);
          await tx.query(
            `INSERT INTO device.service_schedule (unit_id, interval_months, last_service_at, next_due, notes, updated_at)
             VALUES ($1, $2, $3, $4, $5, now())
             ON CONFLICT (unit_id) DO UPDATE
               SET last_service_at = EXCLUDED.last_service_at, next_due = EXCLUDED.next_due, updated_at = now()`,
            [updated.unit_id, interval, today, nextDue, `Bảo trì định kỳ theo phiếu ${updated.code}`]
          );
        }
      },
    },
    {
      action: "cancel",
      from: "OPEN",
      to: "CANCELLED",
      permission: "device.service.manage",
      reasonRequired: true,
    },
  ],
});

const createTicketSchema = z.object({
  org_unit_id: z.string().uuid("chọn phòng KT-CN"),
  unit_id: z.string().uuid("chọn số serial máy"),
  ticket_type: z.enum(["PREVENTIVE", "REPAIR", "WARRANTY", "COMPLAINT", "INSTALLATION"]),
  reported_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  symptom: z.string().trim().min(3, "nhập mô tả tình trạng / yêu cầu dịch vụ").max(3000),
  service_cost: z.coerce.number().min(0).default(0),
  assigned_to: z.coerce.number().int().optional().nullable(),
});

/**
 * Creates a Field Service Ticket.
 * `is_warranty` is automatically determined by comparing `reported_at` against `device_unit.warranty_end` (docs/nha-may/02 §10.5).
 */
export async function createServiceTicket(tx: Tx, actor: AuthzActor, input: unknown) {
  const d = parseInput(createTicketSchema, input);
  await authorize(tx, actor, "device.service.manage", d.org_unit_id);
  const unit = (
    await tx.query("SELECT id, serial_no, warranty_end::text AS warranty_end FROM device.device_unit WHERE id = $1", [d.unit_id])
  ).rows[0];
  if (!unit) throw notFound("máy (serial)");

  const reportedAt = d.reported_at ?? vnToday();
  const isWarranty = Boolean(unit.warranty_end && reportedAt <= unit.warranty_end);
  const code = await nextNumber(tx, "SERVICE_TICKET");

  return insertRecord<ServiceTicketRow>(tx, actor, "device.service_ticket", "device_service_ticket", {
    code,
    org_unit_id: d.org_unit_id,
    unit_id: d.unit_id,
    ticket_type: d.ticket_type,
    reported_at: reportedAt,
    symptom: d.symptom,
    is_warranty: isWarranty,
    service_cost: isWarranty ? 0 : d.service_cost,
    assigned_to: d.assigned_to ?? actor.userId,
  });
}

const evalCapaSchema = z.object({
  capa_required: z.boolean(),
  root_cause: z.string().trim().max(2000).optional().nullable(),
  corrective_action: z.string().trim().max(2000).optional().nullable(),
  notes: z.string().trim().min(3, "nhập nhận định đánh giá CAPA").max(2000),
});

/**
 * Evaluates whether a COMPLAINT service ticket requires a CAPA in QMS (docs/nha-may/02 §10.5).
 * When `capa_required = true`, automatically creates a `qms.deviation` record linked to the ticket.
 */
export async function evaluateComplaintCapa(tx: Tx, actor: AuthzActor, ticketId: string, input: unknown) {
  const d = parseInput(evalCapaSchema, input);
  const ticket = (await tx.query("SELECT * FROM device.service_ticket WHERE id = $1 FOR UPDATE", [ticketId])).rows[0] as
    | ServiceTicketRow
    | undefined;
  if (!ticket) throw notFound("phiếu dịch vụ kỹ thuật");
  await authorize(tx, actor, "device.service.manage", ticket.org_unit_id);

  let deviationId = ticket.deviation_id;
  if (d.capa_required && !deviationId) {
    const devCode = await nextNumber(tx, "DEVIATION");
    const dev = (
      await tx.query(
        `INSERT INTO qms.deviation
           (code, source_module, entity_type, entity_id, title, severity, description, root_cause, corrective_action, detected_by, created_by, updated_by)
         VALUES ($1, 'DEVICE', 'SERVICE_TICKET', $2, $3, 'HIGH', $4, $5, $6, $7, $7, $7) RETURNING id`,
        [
          devCode,
          ticket.id,
          `CAPA từ khiếu nại thiết bị (${ticket.code})`,
          `${ticket.symptom} — Đánh giá: ${d.notes}`,
          d.root_cause ?? null,
          d.corrective_action ?? null,
          actor.userId,
        ]
      )
    ).rows[0];
    deviationId = dev.id;
  }

  const upd = (
    await tx.query(
      `UPDATE device.service_ticket
          SET capa_evaluated = true, capa_required = $2, deviation_id = $3,
              version = version + 1, updated_at = now(), updated_by = $4
        WHERE id = $1 RETURNING *`,
      [ticketId, d.capa_required, deviationId, actor.userId]
    )
  ).rows[0];

  await writeAudit(tx, actor, {
    entityType: "device_service_ticket",
    entityId: ticketId,
    action: "evaluate_capa",
    changes: { capa_evaluated: [ticket.capa_evaluated, true], capa_required: [ticket.capa_required, d.capa_required] },
    reason: d.notes,
  });
  return upd;
}

const replacePartSchema = z.object({
  warehouse_id: z.string().uuid("chọn kho xuất linh kiện thay thế"),
  item_id: z.string().uuid("chọn linh kiện thay thế"),
  lot_id: z.string().uuid().optional().nullable(),
  component_serial: z.string().trim().max(100).optional().nullable(),
  qty: z.coerce.number().positive("số lượng thay thế > 0"),
  uom: z.string().trim().min(1),
  notes: z.string().trim().max(500).optional().nullable(),
});

/**
 * Issues a replacement spare part for a service ticket from the warehouse and appends it directly
 * into the serialized unit's Device History Record (`device.device_unit_component` with `is_replacement = true`).
 */
export async function replaceTicketComponent(tx: Tx, actor: AuthzActor, ticketId: string, input: unknown) {
  const d = parseInput(replacePartSchema, input);
  const ticket = (await tx.query("SELECT * FROM device.service_ticket WHERE id = $1 FOR UPDATE", [ticketId])).rows[0] as
    | ServiceTicketRow
    | undefined;
  if (!ticket) throw notFound("phiếu dịch vụ kỹ thuật");
  await authorize(tx, actor, "device.service.manage", ticket.org_unit_id);
  if (["CLOSED", "CANCELLED"].includes(ticket.status)) {
    throw invalid("Không thể xuất linh kiện thay thế cho phiếu dịch vụ đã đóng hoặc đã hủy.");
  }

  const item = await getItem(tx, d.item_id);
  const needBase = Math.round((await toBaseQty(tx, item, d.qty, d.uom)) * 1e6) / 1e6;
  let cands = await findCandidates(tx, item.id, [d.warehouse_id], { lock: true });
  if (d.lot_id) cands = cands.filter((c) => c.lot_id === d.lot_id);
  const plan = allocate(cands, needBase);
  if (plan.shortfall > 1e-9) {
    throw invalid(
      `Không đủ tồn khả dụng cho linh kiện thay thế ${item.code}: cần ${needBase} ${item.base_uom}, thiếu ${plan.shortfall}.`,
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
      source_entity_type: "SERVICE_TICKET",
      source_entity_id: ticket.id,
      notes: `Xuất linh kiện bảo hành/sửa chữa theo phiếu ${ticket.code}`,
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

  const inserted = [];
  for (const p of plan.picks) {
    const row = (
      await tx.query(
        `INSERT INTO device.device_unit_component
           (unit_id, station_code, item_id, lot_id, component_serial, qty, uom, stock_document_id, service_ticket_id, is_replacement, installed_by, notes)
         VALUES ($1, 'FIELD_SERVICE', $2, $3, $4, $5, $6, $7, $8, true, $9, $10) RETURNING *`,
        [
          ticket.unit_id,
          item.id,
          p.candidate.lot_id,
          d.component_serial ?? null,
          p.qty,
          item.base_uom,
          doc.id,
          ticket.id,
          actor.userId,
          d.notes ?? `Thay thế theo phiếu dịch vụ ${ticket.code}`,
        ]
      )
    ).rows[0];
    inserted.push(row);
  }

  await writeAudit(tx, actor, {
    entityType: "device_service_ticket",
    entityId: ticket.id,
    action: "replace_component",
    changes: { replacement: [null, `${item.code} (${needBase} ${item.base_uom}) — phiếu kho ${doc.code}`] },
  });
  return inserted;
}

export async function listServiceTickets(tx: Tx, actor: AuthzActor) {
  await authorizeAnywhere(tx, actor, "device.view");
  const rows = (
    await tx.query(
      `SELECT st.*, st.reported_at::text AS reported_at, st.service_cost::float AS service_cost,
              du.serial_no, du.customer_name, du.warranty_end::text AS warranty_end,
              m.code AS model_code, m.name AS model_name,
              u.name AS org_unit_name, asg.display_name AS assigned_to_name,
              dv.code AS deviation_code
         FROM device.service_ticket st
         JOIN device.device_unit du ON du.id = st.unit_id
         JOIN device.device_model m ON m.id = du.model_id
         JOIN core.org_unit u ON u.id = st.org_unit_id
         LEFT JOIN core.user_profile asg ON asg.user_id = st.assigned_to
         LEFT JOIN qms.deviation dv ON dv.id = st.deviation_id
        ORDER BY st.created_at DESC LIMIT 200`
    )
  ).rows;
  const visible = [];
  for (const r of rows) {
    if (await hasFactoryPermission(tx, actor, "device.view", r.org_unit_id)) {
      r.actions = await listAllowedActions(tx, serviceTicketMachine, actor, r);
      visible.push(r);
    }
  }
  return visible;
}

export async function listServiceSchedules(tx: Tx, actor: AuthzActor) {
  await authorizeAnywhere(tx, actor, "device.view");
  return (
    await tx.query(
      `SELECT ss.*, ss.last_service_at::text AS last_service_at, ss.next_due::text AS next_due,
              (ss.next_due <= CURRENT_DATE) AS is_due,
              du.serial_no, du.customer_name, du.status AS unit_status,
              m.code AS model_code, m.name AS model_name
         FROM device.service_schedule ss
         JOIN device.device_unit du ON du.id = ss.unit_id
         JOIN device.device_model m ON m.id = du.model_id
        ORDER BY ss.next_due ASC LIMIT 200`
    )
  ).rows;
}
