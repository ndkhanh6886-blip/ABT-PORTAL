import { z } from "zod";
import type { Tx } from "../core/db";
import { writeAudit } from "../core/audit";
import { authorize, authorizeAnywhere, hasFactoryPermission, registerPermissions, type AuthzActor } from "../core/authz";
import { vnToday } from "../core/dates";
import { invalid, notFound } from "../core/errors";
import { nextNumber } from "../core/numbering";
import { insertRecord, parseInput } from "../core/records";
import { defineMachine, listAllowedActions, runTransition } from "../core/stateMachine";
import { assertUsable } from "../asset/service";
import { allocate, findCandidates } from "../inv/allocation";
import { createStockDocument, stockDocumentMachine } from "../inv/documents";
import { getItem, toBaseQty } from "../master/service";
import { notifyUsers, usersWithPermissionAnywhere } from "../core/notifications";
import { createQcTest, registerQcSubject } from "../qms/qcTests";
import { raiseDeviation } from "../qms/incidents";
import "./permissions";

registerPermissions([
  { code: "device.qa.release", description: "QA giải phóng xuất xưởng thiết bị", gxpCritical: true },
  { code: "qms.qc.record", description: "Ghi nhận kết quả đo kiểm QC thiết bị", gxpCritical: true },
]);

export type DeviceOrderStatus =
  | "RECEIVED"
  | "APPROVED"
  | "IN_PRODUCTION"
  | "QC_TESTING"
  | "READY"
  | "DELIVERED"
  | "CANCELLED";

export type DeviceUnitStatus =
  | "IN_ASSEMBLY"
  | "BURN_IN"
  | "FQC"
  | "QA_PASSED"
  | "DELIVERED"
  | "IN_SERVICE_FIELD"
  | "UNDER_SERVICE"
  | "DECOMMISSIONED";

export interface DeviceOrderRow {
  id: string;
  code: string;
  org_unit_id: string;
  internal_order_line_id: string | null;
  model_id: string;
  model_revision_id: string;
  warehouse_id: string;
  qty: number;
  custom_specs: string | null;
  priority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  due_date: string | null;
  lead_engineer_id: number | null;
  approved_by: number | null;
  approved_at: string | null;
  cancel_reason: string | null;
  lot_no: string | null;
  status: DeviceOrderStatus;
  version: number;
  created_by: number | null;
}

export interface DeviceUnitRow {
  id: string;
  serial_no: string;
  order_id: string;
  model_id: string;
  model_revision_id: string;
  firmware_version: string | null;
  fqc_test_id: string | null;
  fqc_passed: boolean;
  fqc_summary: string | null;
  assembled_by?: number | null;
  qa_released_by: number | null;
  qa_released_at: string | null;
  customer_name: string | null;
  partner_id: string | null;
  delivered_at: string | null;
  warranty_start: string | null;
  warranty_end: string | null;
  handover_accessories?: unknown[];
  decommission_note: string | null;
  status: DeviceUnitStatus;
  version: number;
  created_by: number | null;
}

async function unitOrgUnit(tx: Tx, orderId: string): Promise<string> {
  const o = (await tx.query("SELECT org_unit_id FROM device.device_order WHERE id = $1", [orderId])).rows[0];
  if (!o) throw notFound("lệnh lắp ráp thiết bị");
  return o.org_unit_id;
}

function addMonths(dateStr: string, months: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + months, d));
  return dt.toISOString().slice(0, 10);
}

/**
 * Recalculates the parent `device.device_order.status` from the statuses of its `device.device_unit` rows
 * in the same transaction (docs/nha-may/02 §10.1 & §11).
 */
export async function syncOrderStatusFromUnits(tx: Tx, orderId: string, actorId: number) {
  const order = (await tx.query("SELECT * FROM device.device_order WHERE id = $1 FOR UPDATE", [orderId])).rows[0] as
    | DeviceOrderRow
    | undefined;
  if (!order || ["RECEIVED", "APPROVED", "CANCELLED"].includes(order.status)) return;
  const units = (await tx.query("SELECT status FROM device.device_unit WHERE order_id = $1", [orderId])).rows as {
    status: DeviceUnitStatus;
  }[];
  if (!units.length) return;

  const allDelivered = units.every((u) =>
    ["DELIVERED", "IN_SERVICE_FIELD", "UNDER_SERVICE", "DECOMMISSIONED"].includes(u.status)
  );
  const allReady = units.every((u) =>
    ["QA_PASSED", "DELIVERED", "IN_SERVICE_FIELD", "UNDER_SERVICE", "DECOMMISSIONED"].includes(u.status)
  );
  const anyFqc = units.some((u) => u.status === "FQC");

  let nextStatus: DeviceOrderStatus = "IN_PRODUCTION";
  if (allDelivered) nextStatus = "DELIVERED";
  else if (allReady) nextStatus = "READY";
  else if (anyFqc) nextStatus = "QC_TESTING";

  if (nextStatus !== order.status) {
    await tx.query(
      "UPDATE device.device_order SET status = $2, version = version + 1, updated_at = now(), updated_by = $3 WHERE id = $1",
      [orderId, nextStatus, actorId]
    );
  }
}

/**
 * Device Order state machine (docs/nha-may/02 §10.1):
 * RECEIVED → APPROVED ✍ → IN_PRODUCTION (assign_serials) → QC_TESTING → READY → DELIVERED
 * RECEIVED/APPROVED → CANCELLED 📝
 */
export const deviceOrderMachine = defineMachine<DeviceOrderStatus, DeviceOrderRow>({
  entityType: "device_order",
  table: "device.device_order",
  states: ["RECEIVED", "APPROVED", "IN_PRODUCTION", "QC_TESTING", "READY", "DELIVERED", "CANCELLED"],
  terminal: ["DELIVERED", "CANCELLED"],
  scopeOf: (row) => row.org_unit_id,
  transitions: [
    {
      action: "approve",
      from: "RECEIVED",
      to: "APPROVED",
      permission: "device.order.manage",
      signature: "APPROVED",
      guards: [
        {
          code: "REVISION_NOT_RELEASED",
          message: "Phiên bản thiết kế (DMR) phải ở trạng thái đã phát hành (RELEASED) mới được duyệt lệnh lắp ráp.",
          check: async ({ tx, row }) => {
            const rev = (await tx.query("SELECT status FROM device.model_revision WHERE id = $1", [row.model_revision_id])).rows[0];
            return rev?.status === "RELEASED";
          },
        },
      ],
      patch: ({ actor }) => ({ approved_by: actor.userId, approved_at: new Date() }),
    },
    {
      action: "assign_serials",
      from: "APPROVED",
      to: "IN_PRODUCTION",
      permission: "device.order.manage",
      effects: async ({ tx, actor, updated, payload }) => {
        await allocateOrderSerials(tx, actor, updated, {
          serial_numbers: (payload?.serial_numbers as string[] | string | null | undefined) ?? null,
        });
      },
    },
    {
      action: "cancel",
      from: ["RECEIVED", "APPROVED"],
      to: "CANCELLED",
      permission: "device.order.manage",
      reasonRequired: true,
      patch: ({ reason }) => ({ cancel_reason: reason }),
    },
  ],
});

/**
 * Serialized Device Unit (DHR) state machine (docs/nha-may/02 §10.3):
 * IN_ASSEMBLY → BURN_IN → FQC → QA_PASSED ✍ → DELIVERED → IN_SERVICE_FIELD ⇄ UNDER_SERVICE → DECOMMISSIONED 📝
 * With rework loops: BURN_IN → IN_ASSEMBLY 📝 and FQC → IN_ASSEMBLY 📝 (auto-opens NCR).
 */
export const deviceUnitMachine = defineMachine<DeviceUnitStatus, DeviceUnitRow>({
  entityType: "device_unit",
  table: "device.device_unit",
  states: [
    "IN_ASSEMBLY",
    "BURN_IN",
    "FQC",
    "QA_PASSED",
    "DELIVERED",
    "IN_SERVICE_FIELD",
    "UNDER_SERVICE",
    "DECOMMISSIONED",
  ],
  terminal: ["DECOMMISSIONED"],
  scopeOf: (row, tx) => unitOrgUnit(tx!, row.order_id),
  transitions: [
    {
      action: "start_burn_in",
      from: "IN_ASSEMBLY",
      to: "BURN_IN",
      permission: "device.assembly.execute",
      guards: [
        {
          code: "FIRMWARE_REQUIRED",
          message: "Cần nạp và ghi nhận phiên bản Firmware (firmware_version) trước khi đưa máy vào lão hóa (Burn-in).",
          check: ({ row, payload }) => Boolean((payload.firmware_version as string)?.trim() || row.firmware_version?.trim()),
        },
        {
          code: "NO_COMPONENTS_INSTALLED",
          message: "Máy chưa được ghi nhận lắp đặt linh kiện nào trong hồ sơ DHR (Trạm 1–3).",
          check: async ({ tx, row }) => {
            const c = await tx.query("SELECT 1 FROM device.device_unit_component WHERE unit_id = $1 LIMIT 1", [row.id]);
            return (c.rowCount ?? 0) > 0;
          },
        },
      ],
      patch: ({ row, payload }) => ({
        firmware_version: ((payload.firmware_version as string)?.trim() || row.firmware_version) ?? null,
      }),
    },
    {
      action: "return_assembly",
      from: "BURN_IN",
      to: "IN_ASSEMBLY",
      permission: "device.assembly.execute",
      reasonRequired: true,
    },
    {
      action: "to_fqc",
      from: "BURN_IN",
      to: "FQC",
      permission: "device.assembly.execute",
      guards: [
        {
          code: "BURN_IN_NOT_PASSED",
          message: "Chỉ được chuyển sang FQC khi có kết quả chạy lão hóa (Burn-in) đạt PASS và số giờ chạy ≥ số giờ quy định của model.",
          check: async ({ tx, row }) => {
            const run = await tx.query(
              "SELECT 1 FROM device.burn_in_run WHERE unit_id = $1 AND result = 'PASS' AND hours >= required_hours LIMIT 1",
              [row.id]
            );
            return (run.rowCount ?? 0) > 0;
          },
        },
        {
          // QT 21: the finished device goes to QC-QA on a QC task, so the model needs an effective FQC spec
          code: "FQC_SPEC_MISSING",
          message: "Model chưa có tiêu chuẩn kiểm tra xuất xưởng (FQC) có hiệu lực — nhờ QA/QC ban hành tiêu chuẩn trước khi chuyển thiết bị sang QC.",
          check: async ({ tx, row }) => Boolean(row.fqc_test_id) || Boolean(await fqcSpecFor(tx, row.model_id)),
        },
        {
          code: "FQC_ASSIGNEE",
          message: "QC phụ trách được chọn phải có quyền kiểm nghiệm / ghi kết quả QC thiết bị.",
          check: async ({ tx, payload }) => {
            const id = Number(payload.fqc_assignee_id ?? 0);
            if (!id) return true;
            for (const p of ["qms.qc.analyze", "qms.qc.record", "device.unit.release"]) if ((await usersWithPermissionAnywhere(tx, p)).includes(id)) return true;
            return false;
          },
        },
      ],
      patch: ({ payload }) => (Number(payload.fqc_assignee_id) ? { fqc_assignee_id: Number(payload.fqc_assignee_id) } : {}),
      effects: async ({ tx, actor, updated }) => {
        // FQC test in QMS, assigned to the chosen QC person when there is one
        if (!updated.fqc_test_id) {
          const specId = await fqcSpecFor(tx, updated.model_id);
          if (specId) {
            const qcTest = await createQcTest(tx, actor, {
              spec_id: specId,
              test_kind: "FQC",
              entity_type: "DEVICE_UNIT",
              entity_id: updated.id,
            });
            await tx.query("UPDATE device.device_unit SET fqc_test_id = $2 WHERE id = $1", [updated.id, qcTest.id]);
          }
        }
        const assignee = Number((updated as DeviceUnitRow & { fqc_assignee_id?: number | null }).fqc_assignee_id ?? 0);
        if (assignee) {
          await notifyUsers(tx, [assignee], {
            type: "DEVICE_FQC_ASSIGNED",
            title: `Bạn được giao kiểm tra xuất xưởng (FQC) máy ${updated.serial_no}`,
            body: "Phòng Kỹ thuật – Công nghệ đã chạy thử đạt, chuyển thiết bị sang QC-QA.",
            entityType: "device_unit",
            entityId: updated.id,
            link: "/?tab=factory-device",
            sourceKey: `device_fqc_assigned_${updated.id}_${updated.version}`,
          });
        }
        await syncOrderStatusFromUnits(tx, updated.order_id, actor.userId);
      },
    },
    {
      action: "fail_fqc",
      from: "FQC",
      to: "IN_ASSEMBLY",
      permission: "device.assembly.execute",
      reasonRequired: true,
      patch: ({ reason }) => ({ fqc_passed: false, fqc_summary: reason }),
      effects: async ({ tx, actor, updated, reason }) => {
        // Automatically open a Deviation + NCR in QMS when FQC fails (docs/nha-may/02 §10.3)
        const devCode = await nextNumber(tx, "DEVIATION");
        const dev = (
          await tx.query(
            `INSERT INTO qms.deviation (code, source_module, entity_type, entity_id, title, severity, description, detected_by, created_by, updated_by)
             VALUES ($1, 'DEVICE', 'DEVICE_UNIT', $2, $3, 'HIGH', $4, $5, $5, $5) RETURNING id`,
            [devCode, updated.id, `FQC không đạt trên máy ${updated.serial_no}`, reason ?? "Lỗi kiểm tra xuất xưởng FQC", actor.userId]
          )
        ).rows[0];
        const ncrCode = await nextNumber(tx, "NCR");
        await tx.query(
          `INSERT INTO qms.ncr (code, deviation_id, entity_type, entity_id, qty_affected, description, disposition, status, created_by, updated_by)
           VALUES ($1, $2, 'DEVICE_UNIT', $3, 1, $4, 'REWORK', 'OPEN', $5, $5)`,
          [ncrCode, dev.id, updated.id, `FQC Fail (${updated.serial_no}): ${reason}`, actor.userId]
        );
        await syncOrderStatusFromUnits(tx, updated.order_id, actor.userId);
      },
    },
    {
      action: "qa_pass",
      from: "FQC",
      to: "QA_PASSED",
      permission: "device.unit.release",
      signature: "RELEASED",
      guards: [
        {
          code: "SELF_RELEASE",
          message: "Người ký QA giải phóng xuất xưởng phải độc lập với kỹ thuật viên đã lắp ráp linh kiện trên máy này.",
          check: async ({ tx, actor, row }) => {
            if (row.assembled_by && row.assembled_by === actor.userId) return false;
            const inst = await tx.query(
              "SELECT 1 FROM device.device_unit_component WHERE unit_id = $1 AND installed_by = $2 LIMIT 1",
              [row.id, actor.userId]
            );
            return !inst.rowCount;
          },
        },
        {
          code: "CRITICAL_DHR_INCOMPLETE",
          message: "Hồ sơ DHR chưa lắp đủ các dòng linh kiện trọng yếu (is_critical = true) theo cấu trúc BOM của phiên bản thiết kế.",
          check: async ({ tx, row }) => {
            const missing = await tx.query(
              `SELECT bl.id
                 FROM device.model_bom_line bl
                WHERE bl.revision_id = $1 AND bl.is_critical = true
                  AND COALESCE((
                    SELECT sum(c.qty) FROM device.device_unit_component c
                     WHERE c.unit_id = $2 AND (c.bom_line_id = bl.id OR c.item_id = bl.component_item_id)
                  ), 0) < bl.qty_per_unit
                LIMIT 1`,
              [row.model_revision_id, row.id]
            );
            return !missing.rowCount;
          },
        },
        {
          code: "FQC_NOT_PASSED",
          message: "Máy phải được ghi nhận kết quả kiểm tra xuất xưởng FQC Đạt (PASS) và Phiếu QC FQC đã được QA/QC duyệt Đạt trước khi QA ký giải phóng.",
          check: async ({ tx, row }) => {
            if (row.fqc_test_id) {
              const qt = (
                await tx.query("SELECT status, overall_result FROM qms.qc_test WHERE id = $1", [row.fqc_test_id])
              ).rows[0];
              if (qt) {
                return qt.status === "REVIEWED" && qt.overall_result === "PASS";
              }
            }
            return row.fqc_passed === true;
          },
        },
      ],
      patch: ({ actor }) => ({ qa_released_by: actor.userId, qa_released_at: new Date() }),
      effects: async ({ tx, actor, updated }) => {
        await syncOrderStatusFromUnits(tx, updated.order_id, actor.userId);
      },
    },
    {
      action: "deliver",
      from: "QA_PASSED",
      to: "DELIVERED",
      permission: "device.order.manage",
      guards: [
        {
          code: "CUSTOMER_REQUIRED",
          message: "Nhập tên khách hàng / đơn vị nhận máy (customer_name) khi bàn giao xuất xưởng.",
          check: ({ row, payload }) => Boolean((payload.customer_name as string)?.trim() || row.customer_name?.trim()),
        },
      ],
      patch: ({ row, payload }) => {
        const deliveredAt = ((payload.delivered_at as string)?.trim() || vnToday());
        return {
          customer_name: ((payload.customer_name as string)?.trim() || row.customer_name) ?? null,
          delivered_at: deliveredAt,
          warranty_start: deliveredAt,
          handover_accessories: Array.isArray(payload.handover_accessories)
            ? JSON.stringify(payload.handover_accessories)
            : JSON.stringify(row.handover_accessories ?? []),
        };
      },
      effects: async ({ tx, actor, updated }) => {
        const model = (await tx.query("SELECT warranty_months FROM device.device_model WHERE id = $1", [updated.model_id])).rows[0];
        const wMonths = Number(model?.warranty_months ?? 12);
        const start = String(updated.warranty_start || vnToday()).slice(0, 10);
        const wEnd = addMonths(start, wMonths);
        const nextDue = addMonths(start, 6);
        await tx.query("UPDATE device.device_unit SET warranty_end = $2 WHERE id = $1", [updated.id, wEnd]);
        await tx.query(
          `INSERT INTO device.service_schedule (unit_id, interval_months, last_service_at, next_due, notes)
           VALUES ($1, 6, $2, $3, 'Lịch bảo trì định kỳ tự động khi bàn giao máy')
           ON CONFLICT (unit_id) DO UPDATE SET last_service_at = EXCLUDED.last_service_at, next_due = EXCLUDED.next_due`,
          [updated.id, start, nextDue]
        );
        await syncOrderStatusFromUnits(tx, updated.order_id, actor.userId);
      },
    },
    {
      action: "commission",
      from: "DELIVERED",
      to: "IN_SERVICE_FIELD",
      permission: "device.service.manage",
    },
    {
      action: "under_service",
      from: ["DELIVERED", "IN_SERVICE_FIELD"],
      to: "UNDER_SERVICE",
      permission: "device.service.manage",
    },
    {
      action: "return_to_service",
      from: ["DELIVERED", "UNDER_SERVICE"],
      to: "IN_SERVICE_FIELD",
      permission: "device.service.manage",
    },
    {
      action: "decommission",
      from: ["IN_SERVICE_FIELD", "UNDER_SERVICE"],
      to: "DECOMMISSIONED",
      permission: "device.service.manage",
      reasonRequired: true,
      patch: ({ reason }) => ({ decommission_note: reason }),
    },
  ],
});

registerQcSubject("DEVICE_UNIT", {
  label: async (tx, id) => {
    const u = (await tx.query("SELECT serial_no FROM device.device_unit WHERE id = $1", [id])).rows[0];
    return u ? `Máy ${u.serial_no}` : id;
  },
  onReviewed: async (tx, actor, test) => {
    const unit = (await tx.query("SELECT * FROM device.device_unit WHERE id = $1 FOR UPDATE", [test.entity_id])).rows[0] as
      | DeviceUnitRow
      | undefined;
    if (!unit) return;
    if (test.overall_result === "PASS") {
      await tx.query(
        `UPDATE device.device_unit
            SET fqc_passed = true, fqc_test_id = $2, fqc_summary = $3,
                version = version + 1, updated_at = now(), updated_by = $4
          WHERE id = $1`,
        [unit.id, test.id, `Đạt phiếu FQC ${test.code}`, actor.userId]
      );
    } else if (test.overall_result === "FAIL" && unit.status === "FQC") {
      await runTransition(
        tx,
        deviceUnitMachine,
        actor,
        {
          id: unit.id,
          action: "fail_fqc",
          expectedVersion: unit.version,
          reason: `Phiếu FQC ${test.code} kết luận KHÔNG ĐẠT (FAIL)`,
        },
        { trusted: true }
      );
    }
  },
});

function parseCustomSerials(raw?: string[] | string | null): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map((s) => String(s).trim()).filter(Boolean);
  return String(raw)
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Effective FQC spec of a model: the one set on the model, else the latest effective spec of its finished item. */
async function fqcSpecFor(tx: Tx, modelId: string): Promise<string | null> {
  const r = (
    await tx.query(
      `SELECT COALESCE(
                (SELECT s.id FROM qms.qc_spec s WHERE s.id = m.fqc_spec_id AND s.status = 'EFFECTIVE'),
                (SELECT s.id FROM qms.qc_spec s WHERE s.item_id = m.item_id AND s.status = 'EFFECTIVE' ORDER BY s.spec_version DESC LIMIT 1)
              ) AS spec_id
         FROM device.device_model m WHERE m.id = $1`,
      [modelId]
    )
  ).rows[0];
  return r?.spec_id ?? null;
}

const pad = (n: number, width: number) => String(n).padStart(width, "0");

/**
 * Lô thiết bị (QT 21, đề xuất P.KTCN): Model-YYMMDD-Cỡ lô, ví dụ PCRWD8-261028-05 — gợi ý theo ngày phát lệnh,
 * người lập lệnh được sửa. A taken lot gets a -B, -C… suffix.
 */
export async function suggestDeviceLot(tx: Tx, modelCode: string, qty: number, date = vnToday()): Promise<string> {
  const base = `${modelCode.trim().toUpperCase()}-${date.slice(2, 4)}${date.slice(5, 7)}${date.slice(8, 10)}-${pad(qty, 2)}`;
  for (let i = 0; i < 26; i++) {
    const lot = i === 0 ? base : `${base}-${String.fromCharCode(65 + i)}`;
    if (!(await tx.query("SELECT 1 FROM device.device_order WHERE lower(lot_no) = lower($1)", [lot])).rowCount) return lot;
  }
  throw invalid(`Đã có quá nhiều lô ${base} trong ngày. Nhập số Lô khác.`);
}

/**
 * Serials of a lot: YYMMDD + cỡ lô, dấu gạch, số thứ tự máy trong lô — PCRWD8-261028-05 → 26102805-01 … 26102805-05.
 * The model is not part of the serial (P.KTCN), so serials of different lots can collide: callers check uniqueness.
 */
export function serialsForLot(lotNo: string, qty: number, from = 1, count = qty): string[] {
  const m = /(\d{6})-(\d{1,3})(?:-[A-Z])?$/i.exec(lotNo.trim());
  const stem = m ? `${m[1]}${pad(Number(m[2]), 2)}` : lotNo.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
  const width = qty >= 100 ? 3 : 2;
  return Array.from({ length: count }, (_, i) => `${stem}-${pad(from + i, width)}`);
}

/** Lot number for a new order: the one typed (must be free) or the suggestion. */
export async function resolveLotNo(tx: Tx, modelId: string, qty: number, typed?: string | null): Promise<string> {
  const lot = typed?.trim().toUpperCase();
  if (!lot) {
    const model = (await tx.query("SELECT code FROM device.device_model WHERE id = $1", [modelId])).rows[0];
    return suggestDeviceLot(tx, model?.code ?? "TB", qty);
  }
  if (!/^[A-Z0-9][A-Z0-9._-]{2,49}$/.test(lot)) throw invalid("Số Lô chỉ gồm chữ, số, dấu chấm, gạch nối (3–50 ký tự), không có khoảng trắng.");
  if ((await tx.query("SELECT 1 FROM device.device_order WHERE lower(lot_no) = lower($1)", [lot])).rowCount) {
    throw invalid(`Số Lô ${lot} đã được dùng cho lệnh lắp ráp khác.`, undefined, "LOT_TAKEN");
  }
  return lot;
}

/** Serials already used elsewhere (case-insensitive): every serial on a label must be unique. */
async function takenSerials(tx: Tx, serials: string[]): Promise<string[]> {
  if (!serials.length) return [];
  const res = await tx.query("SELECT serial_no FROM device.device_unit WHERE lower(serial_no) = ANY($1::text[])", [serials.map((s) => s.toLowerCase())]);
  return res.rows.map((r) => r.serial_no);
}

/** Preview for the order form: suggested lot, the serials it gives and which of them are already used. */
export async function previewDeviceLot(tx: Tx, actor: AuthzActor, input: { model_id: string; qty: number; lot_no?: string | null }) {
  await authorizeAnywhere(tx, actor, "device.order.manage");
  const qty = Math.max(1, Math.min(500, Math.round(Number(input.qty) || 1)));
  const model = (await tx.query("SELECT code FROM device.device_model WHERE id = $1", [input.model_id])).rows[0];
  if (!model) throw notFound("model thiết bị");
  const lot = input.lot_no?.trim().toUpperCase() || (await suggestDeviceLot(tx, model.code, qty));
  const serials = serialsForLot(lot, qty);
  const lotTaken = Boolean((await tx.query("SELECT 1 FROM device.device_order WHERE lower(lot_no) = lower($1)", [lot])).rowCount);
  return { lot_no: lot, suggested: await suggestDeviceLot(tx, model.code, qty), serials, lot_taken: lotTaken, taken_serials: await takenSerials(tx, serials) };
}

export async function allocateOrderSerials(
  tx: Tx,
  actor: AuthzActor,
  order: DeviceOrderRow,
  opts?: { serial_numbers?: string[] | string | null }
) {
  const existingCount = Number(
    (await tx.query("SELECT count(*)::int AS cnt FROM device.device_unit WHERE order_id = $1", [order.id])).rows[0]?.cnt ?? 0
  );
  const needed = order.qty - existingCount;
  if (needed <= 0) return [];

  const rev = (
    await tx.query("SELECT firmware_version, firmware_release_id FROM device.model_revision WHERE id = $1", [order.model_revision_id])
  ).rows[0];

  const customList = parseCustomSerials(opts?.serial_numbers);
  if (customList.length > 0 && customList.length !== needed) {
    throw invalid(`Danh sách Số Serial nhập tay (${customList.length} số) phải khớp với số lượng máy cần cấp (${needed} máy).`);
  }
  let lotNo = order.lot_no;
  if (!lotNo) {
    // orders made before lots existed get the suggested lot now
    lotNo = await resolveLotNo(tx, order.model_id, order.qty, null);
    await tx.query("UPDATE device.device_order SET lot_no = $2 WHERE id = $1", [order.id, lotNo]);
  }
  const serials = customList.length ? customList : serialsForLot(lotNo, order.qty, existingCount + 1, needed);
  if (new Set(serials.map((s) => s.toLowerCase())).size !== serials.length) throw invalid("Danh sách Số Serial có số bị lặp.");
  const taken = await takenSerials(tx, serials);
  if (taken.length) {
    throw invalid(
      `Số Serial đã tồn tại: ${taken.join(", ")}. Sửa số Lô (phần ngày / cỡ lô) hoặc nhập danh sách Serial thủ công.`,
      { taken },
      "SERIAL_TAKEN"
    );
  }
  const createdUnits: DeviceUnitRow[] = [];

  for (let i = 0; i < needed; i++) {
    const serialNo = serials[i];
    const u = await insertRecord<DeviceUnitRow>(tx, actor, "device.device_unit", "device_unit", {
      serial_no: serialNo,
      order_id: order.id,
      model_id: order.model_id,
      model_revision_id: order.model_revision_id,
      firmware_version: rev?.firmware_version ?? null,
      firmware_release_id: rev?.firmware_release_id ?? null,
      status: "IN_ASSEMBLY",
    });
    createdUnits.push(u);
  }
  return createdUnits;
}

const createOrderSchema = z.object({
  org_unit_id: z.string().uuid("chọn phòng Kỹ thuật – Công nghệ"),
  model_id: z.string().uuid("chọn model thiết bị"),
  model_revision_id: z.string().uuid().optional().nullable(),
  warehouse_id: z.string().uuid("chọn kho linh kiện KT-CN"),
  qty: z.coerce.number().int().min(1, "số lượng máy ≥ 1").max(500),
  lot_no: z.string().trim().max(50).optional().nullable(),
  serial_numbers: z.union([z.array(z.string()), z.string()]).optional().nullable(),
  auto_assign_serials: z.boolean().optional().default(true),
  custom_specs: z.string().trim().max(2000).optional().nullable(),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).default("NORMAL"),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  lead_engineer_id: z.coerce.number().int().optional().nullable(),
});

export async function createDeviceOrder(tx: Tx, actor: AuthzActor, input: unknown) {
  const d = parseInput(createOrderSchema, input);
  await authorize(tx, actor, "device.order.manage", d.org_unit_id);
  const model = (await tx.query("SELECT * FROM device.device_model WHERE id = $1", [d.model_id])).rows[0];
  if (!model) throw notFound("model thiết bị");
  const revId = d.model_revision_id ?? model.current_revision_id;
  if (!revId) throw invalid("Model chưa có phiên bản thiết kế (DMR) hiện hành.");

  const code = await nextNumber(tx, "DEVICE_ORDER");
  const order = await insertRecord<DeviceOrderRow>(tx, actor, "device.device_order", "device_order", {
    code,
    org_unit_id: d.org_unit_id,
    model_id: d.model_id,
    model_revision_id: revId,
    warehouse_id: d.warehouse_id,
    qty: d.qty,
    lot_no: await resolveLotNo(tx, d.model_id, d.qty, d.lot_no),
    custom_specs: d.custom_specs ?? null,
    priority: d.priority,
    due_date: d.due_date ?? null,
    lead_engineer_id: d.lead_engineer_id ?? actor.userId,
  });

  if (d.auto_assign_serials !== false) {
    await allocateOrderSerials(tx, actor, order, { serial_numbers: d.serial_numbers ?? null });
  }

  return order;
}

export async function updateDeviceUnitSerial(
  tx: Tx,
  actor: AuthzActor,
  orderId: string,
  input: { unit_id: string; serial_no: string }
) {
  const order = (await tx.query("SELECT * FROM device.device_order WHERE id = $1 FOR UPDATE", [orderId])).rows[0] as
    | DeviceOrderRow
    | undefined;
  if (!order) throw notFound("lệnh lắp ráp thiết bị");
  await authorize(tx, actor, "device.order.manage", order.org_unit_id);
  const unit = (
    await tx.query("SELECT * FROM device.device_unit WHERE id = $1 AND order_id = $2 FOR UPDATE", [input.unit_id, orderId])
  ).rows[0] as DeviceUnitRow | undefined;
  if (!unit) throw notFound("máy (serial) thuộc lệnh này");
  if (!["IN_ASSEMBLY", "BURN_IN"].includes(unit.status)) {
    throw invalid("Chỉ được đổi Số Serial khi máy đang trong công đoạn lắp ráp / chạy thử (trước khi vào FQC & giải phóng QA).");
  }
  const nextSerial = String(input.serial_no ?? "").trim();
  if (!nextSerial) throw invalid("Số Serial không được để trống.");
  if (nextSerial !== unit.serial_no) {
    const dup = await tx.query("SELECT 1 FROM device.device_unit WHERE lower(serial_no) = lower($1) AND id <> $2 LIMIT 1", [
      nextSerial,
      unit.id,
    ]);
    if (dup.rowCount) throw invalid(`Số Serial '${nextSerial}' đã tồn tại trên hệ thống.`);
    await tx.query(
      "UPDATE device.device_unit SET serial_no = $2, version = version + 1, updated_at = now(), updated_by = $3 WHERE id = $1",
      [unit.id, nextSerial, actor.userId]
    );
    await writeAudit(tx, actor, {
      entityType: "device_unit",
      entityId: unit.id,
      action: "update_serial",
      changes: { serial_no: [unit.serial_no, nextSerial] },
    });
  }
}

const installComponentSchema = z.object({
  bom_line_id: z.string().uuid("chọn dòng BOM linh kiện"),
  lot_id: z.string().uuid().optional().nullable(),
  component_serial: z.string().trim().max(100).optional().nullable(),
  qty: z.coerce.number().positive("số lượng lắp phải > 0").optional(),
  notes: z.string().trim().max(500).optional().nullable(),
});

/**
 * Installs a BOM component onto a serialized `device_unit` (Stations 1–3, docs/nha-may/02 §10.3):
 * - Enforces `requires_serial` when configured on the BOM line.
 * - Allocates released, unexpired stock via FEFO/FIFO from the order's warehouse and posts an `ISSUE` stock document.
 * - Appends the traceability record into `device.device_unit_component` (DHR).
 */
export async function installUnitComponent(tx: Tx, actor: AuthzActor, unitId: string, input: unknown) {
  const d = parseInput(installComponentSchema, input);
  const unit = (await tx.query("SELECT * FROM device.device_unit WHERE id = $1 FOR UPDATE", [unitId])).rows[0] as
    | DeviceUnitRow
    | undefined;
  if (!unit) throw notFound("máy (serial)");
  const order = (await tx.query("SELECT * FROM device.device_order WHERE id = $1", [unit.order_id])).rows[0] as DeviceOrderRow;
  await authorize(tx, actor, "device.assembly.execute", order.org_unit_id);
  if (unit.status !== "IN_ASSEMBLY") {
    throw invalid(`Chỉ lắp linh kiện khi máy đang ở trạng thái IN_ASSEMBLY (hiện tại: ${unit.status}).`);
  }

  const bomLine = (
    await tx.query("SELECT * FROM device.model_bom_line WHERE id = $1 AND revision_id = $2", [d.bom_line_id, unit.model_revision_id])
  ).rows[0];
  if (!bomLine) throw notFound("dòng cấu trúc BOM của phiên bản thiết kế");
  if (bomLine.requires_serial && !d.component_serial?.trim()) {
    throw invalid("Linh kiện trọng yếu này bắt buộc nhập mã Serial linh kiện (component_serial) vào hồ sơ DHR.", undefined, "COMPONENT_SERIAL_REQUIRED");
  }

  const qtyToInstall = Number(d.qty ?? bomLine.qty_per_unit);
  const item = await getItem(tx, bomLine.component_item_id);
  const needBase = Math.round((await toBaseQty(tx, item, qtyToInstall, bomLine.uom)) * 1e6) / 1e6;

  let cands = await findCandidates(tx, item.id, [order.warehouse_id], { lock: true });
  if (d.lot_id) cands = cands.filter((c) => c.lot_id === d.lot_id);
  const plan = allocate(cands, needBase);
  if (plan.shortfall > 1e-9) {
    throw invalid(
      `Không đủ tồn kho khả dụng cho linh kiện ${item.code} tại kho lắp ráp: cần ${needBase} ${item.base_uom}, thiếu ${plan.shortfall}.`,
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
      warehouse_id: order.warehouse_id,
      source_entity_type: "DEVICE_UNIT",
      source_entity_id: unit.id,
      notes: `Xuất lắp ráp DHR máy ${unit.serial_no} (${bomLine.station_code})`,
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
           (unit_id, bom_line_id, station_code, item_id, lot_id, component_serial, qty, uom, stock_document_id, installed_by, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
        [
          unit.id,
          bomLine.id,
          bomLine.station_code,
          item.id,
          p.candidate.lot_id,
          d.component_serial ?? null,
          p.qty,
          item.base_uom,
          doc.id,
          actor.userId,
          d.notes ?? null,
        ]
      )
    ).rows[0];
    inserted.push(row);
  }
  await tx.query("UPDATE device.device_unit SET assembled_by = COALESCE(assembled_by, $2) WHERE id = $1", [unit.id, actor.userId]);
  await writeAudit(tx, actor, {
    entityType: "device_unit",
    entityId: unit.id,
    action: "install_component",
    changes: { component: [null, `${item.code} (${needBase} ${item.base_uom}) @ ${bomLine.station_code}`] },
  });
  return inserted;
}

const burnInSchema = z.object({
  hours: z.coerce.number().min(0, "số giờ lão hóa ≥ 0").max(1000),
  max_temp_c: z.coerce.number().optional().nullable(),
  cycles_completed: z.coerce.number().int().min(0).optional().nullable(),
  result: z.enum(["PASS", "FAIL"]),
  test_asset_id: z.string().uuid().optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
});

export async function recordBurnInRun(tx: Tx, actor: AuthzActor, unitId: string, input: unknown) {
  const d = parseInput(burnInSchema, input);
  const unit = (await tx.query("SELECT * FROM device.device_unit WHERE id = $1 FOR UPDATE", [unitId])).rows[0] as
    | DeviceUnitRow
    | undefined;
  if (!unit) throw notFound("máy (serial)");
  const orgId = await unitOrgUnit(tx, unit.order_id);
  await authorize(tx, actor, "device.assembly.execute", orgId);
  if (unit.status !== "BURN_IN") {
    throw invalid("Máy phải đang ở trạng thái Chạy lão hóa (BURN_IN) mới ghi được kết quả lão hóa.");
  }
  if (d.test_asset_id) {
    await assertUsable(tx, d.test_asset_id);
  }
  const model = (
    await tx.query("SELECT required_burn_in_hours::float AS req FROM device.device_model WHERE id = $1", [unit.model_id])
  ).rows[0];
  const reqHours = Number(model?.req ?? 48);

  const run = (
    await tx.query(
      `INSERT INTO device.burn_in_run (unit_id, ended_at, hours, required_hours, max_temp_c, cycles_completed, result, notes, recorded_by)
       VALUES ($1, now(), $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [unit.id, d.hours, reqHours, d.max_temp_c ?? null, d.cycles_completed ?? null, d.result, d.notes ?? null, actor.userId]
    )
  ).rows[0];
  await writeAudit(tx, actor, {
    entityType: "device_unit",
    entityId: unit.id,
    action: "record_burn_in",
    changes: { burn_in: [null, `${d.hours}h / ${reqHours}h — ${d.result}`] },
  });
  if (d.result === "FAIL") {
    await raiseDeviation(tx, actor, {
      source_module: "DEVICE",
      entity_type: "DEVICE_UNIT",
      entity_id: unit.id,
      step_ref: "BURN_IN",
      severity: "HIGH",
      description: `Lão hóa (Burn-In) máy SN ${unit.serial_no} không đạt (${d.hours}h/${reqHours}h)${d.notes ? ": " + d.notes : ""}`,
    });
  }
  return run;
}

const fqcResultSchema = z.object({
  passed: z.boolean(),
  test_asset_id: z.string().uuid().optional().nullable(),
  summary: z.string().trim().min(3, "nhập tóm tắt biên bản đo kiểm FQC").max(2000),
});

export async function recordUnitFqcResult(tx: Tx, actor: AuthzActor, unitId: string, input: unknown) {
  const d = parseInput(fqcResultSchema, input);
  const unit = (await tx.query("SELECT * FROM device.device_unit WHERE id = $1 FOR UPDATE", [unitId])).rows[0] as
    | DeviceUnitRow
    | undefined;
  if (!unit) throw notFound("máy (serial)");
  const orgId = await unitOrgUnit(tx, unit.order_id);
  const canRecordFqc =
    (await hasFactoryPermission(tx, actor, "qms.qc.record", orgId)) ||
    (await hasFactoryPermission(tx, actor, "device.qa.release", orgId)) ||
    (await hasFactoryPermission(tx, actor, "device.unit.release", orgId)) ||
    (await hasFactoryPermission(tx, actor, "qms.qc.analyze", orgId));
  if (!canRecordFqc) {
    await authorize(tx, actor, "qms.qc.record", orgId);
  }
  if (unit.status !== "FQC") {
    throw invalid("Máy phải đang ở trạng thái Kiểm tra xuất xưởng (FQC) mới ghi được kết quả FQC.");
  }
  if (d.test_asset_id) {
    await assertUsable(tx, d.test_asset_id);
  }
  const inst = await tx.query(
    "SELECT 1 FROM device.device_unit_component WHERE unit_id = $1 AND installed_by = $2 LIMIT 1",
    [unit.id, actor.userId]
  );
  if (unit.assembled_by === actor.userId || inst.rowCount) {
    throw invalid(
      "Nhân sự kiểm tra xuất xưởng (FQC) phải độc lập với kỹ thuật viên đã lắp ráp thiết bị này (Segregation of Duties).",
      undefined,
      "SELF_FQC"
    );
  }
  if (!d.passed) {
    return runTransition(
      tx,
      deviceUnitMachine,
      actor,
      { id: unit.id, action: "fail_fqc", expectedVersion: unit.version, reason: d.summary },
      { trusted: true }
    );
  }
  const upd = (
    await tx.query(
      "UPDATE device.device_unit SET fqc_passed = true, fqc_summary = $2, version = version + 1, updated_at = now(), updated_by = $3 WHERE id = $1 RETURNING *",
      [unit.id, d.summary, actor.userId]
    )
  ).rows[0];
  await writeAudit(tx, actor, {
    entityType: "device_unit",
    entityId: unit.id,
    action: "fqc_pass",
    changes: { fqc_passed: [unit.fqc_passed, true], fqc_summary: [unit.fqc_summary, d.summary] },
  });
  return upd;
}

export async function listDeviceOrders(tx: Tx, actor: AuthzActor) {
  await authorizeAnywhere(tx, actor, "device.view");
  const rows = (
    await tx.query(
      `SELECT o.*, o.due_date::text AS due_date, u.name AS org_unit_name,
              m.code AS model_code, m.name AS model_name, r.revision AS revision_code,
              w.code AS warehouse_code, le.display_name AS lead_engineer_name,
              (SELECT count(*)::int FROM device.device_unit du WHERE du.order_id = o.id) AS unit_count,
              (SELECT count(*)::int FROM device.device_unit du WHERE du.order_id = o.id AND du.status IN ('QA_PASSED', 'DELIVERED', 'IN_SERVICE_FIELD')) AS ready_count,
              ARRAY(SELECT du.serial_no FROM device.device_unit du WHERE du.order_id = o.id ORDER BY du.serial_no ASC) AS serial_numbers
         FROM device.device_order o
         JOIN core.org_unit u ON u.id = o.org_unit_id
         JOIN device.device_model m ON m.id = o.model_id
         JOIN device.model_revision r ON r.id = o.model_revision_id
         JOIN master.warehouse w ON w.id = o.warehouse_id
         LEFT JOIN core.user_profile le ON le.user_id = o.lead_engineer_id
        ORDER BY o.created_at DESC LIMIT 200`
    )
  ).rows;
  const visible = [];
  for (const r of rows) {
    if (await hasFactoryPermission(tx, actor, "device.view", r.org_unit_id)) visible.push(r);
  }
  return visible;
}

export async function getDeviceOrderDetail(tx: Tx, actor: AuthzActor, id: string) {
  const order = (
    await tx.query(
      `SELECT o.*, o.due_date::text AS due_date, u.name AS org_unit_name,
              m.code AS model_code, m.name AS model_name, m.required_burn_in_hours::float AS required_burn_in_hours,
              r.revision AS revision_code, r.firmware_version AS default_firmware,
              w.code AS warehouse_code, le.display_name AS lead_engineer_name
         FROM device.device_order o
         JOIN core.org_unit u ON u.id = o.org_unit_id
         JOIN device.device_model m ON m.id = o.model_id
         JOIN device.model_revision r ON r.id = o.model_revision_id
         JOIN master.warehouse w ON w.id = o.warehouse_id
         LEFT JOIN core.user_profile le ON le.user_id = o.lead_engineer_id
        WHERE o.id = $1`,
      [id]
    )
  ).rows[0];
  if (!order) throw notFound("lệnh lắp ráp thiết bị");
  await authorize(tx, actor, "device.view", order.org_unit_id);

  const units = (
    await tx.query(
      `SELECT du.*, du.delivered_at::text AS delivered_at, du.warranty_start::text AS warranty_start, du.warranty_end::text AS warranty_end,
              qa.display_name AS qa_released_by_name,
              (SELECT count(*)::int FROM device.device_unit_component c WHERE c.unit_id = du.id) AS component_count,
              (SELECT max(hours)::float FROM device.burn_in_run br WHERE br.unit_id = du.id AND br.result = 'PASS') AS passed_burn_in_hours
         FROM device.device_unit du
         LEFT JOIN core.user_profile qa ON qa.user_id = du.qa_released_by
        WHERE du.order_id = $1 ORDER BY du.serial_no ASC`,
      [id]
    )
  ).rows;

  const bomLines = (
    await tx.query(
      `SELECT bl.*, bl.qty_per_unit::float AS qty_per_unit, it.code AS item_code, it.name AS item_name,
              COALESCE((
                SELECT sum(c.qty)::float
                  FROM device.device_unit_component c
                  JOIN device.device_unit du ON du.id = c.unit_id
                 WHERE du.order_id = $2
                   AND (c.bom_line_id = bl.id OR c.item_id = bl.component_item_id)
              ), 0) AS qty_installed,
              COALESCE((
                SELECT sum(b.qty_on_hand - b.qty_reserved)::float
                  FROM inv.stock_balance b
                  JOIN inv.lot l ON l.id = b.lot_id
                  JOIN master.location loc ON loc.id = b.location_id
                 WHERE loc.warehouse_id = $3
                   AND b.item_id = bl.component_item_id
                   AND l.status = 'RELEASED'
                   AND NOT loc.is_quarantine
                   AND (b.qty_on_hand - b.qty_reserved) > 0
              ), 0) AS qty_available
         FROM device.model_bom_line bl
         JOIN master.item it ON it.id = bl.component_item_id
        WHERE bl.revision_id = $1 ORDER BY bl.line_no ASC`,
      [order.model_revision_id, order.id, order.warehouse_id]
    )
  ).rows;

  const kittingSummary = bomLines.map((bl) => {
    const totalRequired = Number((Number(bl.qty_per_unit) * Number(order.qty)).toFixed(4));
    const qtyInstalled = Number(bl.qty_installed ?? 0);
    const qtyAvailable = Number(bl.qty_available ?? 0);
    const remainingToInstall = Math.max(0, Number((totalRequired - qtyInstalled).toFixed(4)));
    const shortage = Math.max(0, Number((remainingToInstall - qtyAvailable).toFixed(4)));
    return {
      ...bl,
      total_required: totalRequired,
      qty_installed: qtyInstalled,
      qty_available: qtyAvailable,
      remaining_to_install: remainingToInstall,
      shortage,
    };
  });

  const actions = await listAllowedActions(tx, deviceOrderMachine, actor, order);
  return { ...order, units, bom_lines: bomLines, kitting_summary: kittingSummary, actions };
}

export async function getDeviceUnitDetail(tx: Tx, actor: AuthzActor, unitId: string) {
  const unit = (
    await tx.query(
      `SELECT du.*, du.delivered_at::text AS delivered_at, du.warranty_start::text AS warranty_start, du.warranty_end::text AS warranty_end,
              o.code AS order_code, o.org_unit_id, o.warehouse_id,
              m.code AS model_code, m.name AS model_name, m.required_burn_in_hours::float AS required_burn_in_hours,
              m.specs_json AS model_specs_json, m.accessories_standard, m.accessories_optional, m.warranty_months,
              r.revision AS revision_code, qa.display_name AS qa_released_by_name
         FROM device.device_unit du
         JOIN device.device_order o ON o.id = du.order_id
         JOIN device.device_model m ON m.id = du.model_id
         JOIN device.model_revision r ON r.id = du.model_revision_id
         LEFT JOIN core.user_profile qa ON qa.user_id = du.qa_released_by
        WHERE du.id = $1`,
      [unitId]
    )
  ).rows[0];
  if (!unit) throw notFound("máy (serial)");
  await authorize(tx, actor, "device.view", unit.org_unit_id);

  const components = (
    await tx.query(
      `SELECT c.*, c.qty::float AS qty, it.code AS item_code, it.name AS item_name,
              l.code AS lot_code, sd.code AS document_code, up.display_name AS installed_by_name
         FROM device.device_unit_component c
         JOIN master.item it ON it.id = c.item_id
         LEFT JOIN inv.lot l ON l.id = c.lot_id
         LEFT JOIN inv.stock_document sd ON sd.id = c.stock_document_id
         LEFT JOIN core.user_profile up ON up.user_id = c.installed_by
        WHERE c.unit_id = $1 ORDER BY c.installed_at ASC`,
      [unitId]
    )
  ).rows;

  const burnInRuns = (
    await tx.query(
      `SELECT br.*, br.hours::float AS hours, br.required_hours::float AS required_hours,
              br.max_temp_c::float AS max_temp_c, up.display_name AS recorded_by_name
         FROM device.burn_in_run br
         LEFT JOIN core.user_profile up ON up.user_id = br.recorded_by
        WHERE br.unit_id = $1 ORDER BY br.created_at DESC`,
      [unitId]
    )
  ).rows;

  const bomLines = (
    await tx.query(
      `SELECT bl.*, bl.qty_per_unit::float AS qty_per_unit, it.code AS item_code, it.name AS item_name
         FROM device.model_bom_line bl
         JOIN master.item it ON it.id = bl.component_item_id
        WHERE bl.revision_id = $1 ORDER BY bl.line_no ASC`,
      [unit.model_revision_id]
    )
  ).rows;

  const actions = await listAllowedActions(tx, deviceUnitMachine, actor, unit);
  return { ...unit, components, burn_in_runs: burnInRuns, bom_lines: bomLines, actions };
}

/** QC-QA people who may run a device FQC: the choices for "QC phụ trách" when devices go to FQC. */
export async function listFqcPeople(tx: Tx, actor: AuthzActor) {
  await authorizeAnywhere(tx, actor, "device.view");
  const ids = new Set<number>();
  for (const p of ["qms.qc.analyze", "qms.qc.record", "device.unit.release"]) for (const id of await usersWithPermissionAnywhere(tx, p)) ids.add(id);
  return (await tx.query("SELECT user_id AS id, display_name AS name FROM core.user_profile WHERE user_id = ANY($1::int[]) ORDER BY display_name", [[...ids]])).rows;
}
