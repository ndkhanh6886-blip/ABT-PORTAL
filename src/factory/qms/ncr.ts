import { z } from "zod";
import type { Tx } from "../core/db";
import { authorize, type AuthzActor } from "../core/authz";
import { invalid, notFound } from "../core/errors";
import { defineMachine, runTransition, type Guard } from "../core/stateMachine";
import { lotMachine } from "../inv/lots";
import "./permissions";

type NcrStatus = "OPEN" | "DISPOSITION_PROPOSED" | "PENDING_BOD" | "APPROVED" | "CLOSED";
export const DISPOSITIONS = ["SCRAP", "REWORK", "RESYNTHESIZE", "USE_AS_IS", "RETURN_TO_SUPPLIER"] as const;
export interface Ncr {
  id: string;
  code: string;
  entity_type: string;
  entity_id: string;
  lot_id: string | null;
  disposition: string;
  proposed_by: number | null;
  qa_approved_by?: number | null;
  status: NcrStatus;
  version: number;
}

/**
 * What a module does with an approved disposition of its own subject (e.g. an Oligo sequence: resynthesize,
 * rework, use as is). `check` refuses a disposition that makes no sense for the subject, with the reason.
 */
export interface NcrSubjectHandler {
  check?(tx: Tx, ncr: Ncr, disposition: string): Promise<string | null>;
  onApproved?(tx: Tx, actor: AuthzActor, ncr: Ncr): Promise<void>;
}
const subjects = new Map<string, NcrSubjectHandler>();
export function registerNcrSubject(entityType: string, handler: NcrSubjectHandler) {
  subjects.set(entityType, handler);
}

const notProposer: Guard<Ncr> = { code: "SAME_PERSON", message: "Người duyệt phải khác người đề xuất hướng xử lý.", check: ({ actor, row }) => row.proposed_by !== actor.userId };

/** Scrap / return: the lot leaves the usable stock (REJECTED) as soon as the disposition is approved. */
async function applyDisposition(tx: Tx, actor: AuthzActor, ncr: Ncr): Promise<void> {
  await subjects.get(ncr.entity_type)?.onApproved?.(tx, actor, ncr);
  if (!ncr.lot_id || !["SCRAP", "RETURN_TO_SUPPLIER"].includes(ncr.disposition)) return;
  const lot = (await tx.query("SELECT status, version FROM inv.lot WHERE id = $1", [ncr.lot_id])).rows[0];
  if (lot && ["PENDING_QC", "ON_HOLD"].includes(lot.status)) {
    await runTransition(tx, lotMachine, actor, { id: ncr.lot_id, action: "reject", expectedVersion: lot.version, reason: `NCR ${ncr.code}: ${ncr.disposition}` }, { trusted: true });
  }
}

export const ncrMachine = defineMachine<NcrStatus, Ncr>({
  entityType: "ncr",
  table: "qms.ncr",
  states: ["OPEN", "DISPOSITION_PROPOSED", "PENDING_BOD", "APPROVED", "CLOSED"],
  terminal: ["CLOSED"],
  transitions: [
    {
      action: "propose",
      from: "OPEN",
      to: "DISPOSITION_PROPOSED",
      permission: "qms.ncr.propose",
      guards: [
        {
          code: "DISPOSITION",
          message: "Chọn hướng xử lý: hủy, làm lại, tổng hợp lại, chấp nhận đặc cách hoặc trả nhà cung cấp.",
          check: ({ payload }) => (DISPOSITIONS as readonly string[]).includes(String(payload.disposition)),
        },
        { code: "NOTE", message: "Ghi rõ căn cứ đề xuất.", check: ({ payload }) => String(payload.note ?? "").trim().length >= 5 },
        {
          code: "DISPOSITION_FIT",
          message: "Hướng xử lý không phù hợp với đối tượng của NCR.",
          check: async ({ tx, row, payload }) => {
            const h = subjects.get(row.entity_type);
            if (!h?.check || !(DISPOSITIONS as readonly string[]).includes(String(payload?.disposition))) return true;
            const why = await h.check(tx, row, String(payload.disposition));
            if (why) throw invalid(why, undefined, "DISPOSITION_FIT");
            return true;
          },
        },
      ],
      patch: ({ actor, payload }) => ({ disposition: payload.disposition, proposed_by: actor.userId, proposal_note: String(payload.note).trim() }),
    },
    {
      action: "approve",
      from: "DISPOSITION_PROPOSED",
      to: "APPROVED",
      permission: "qms.ncr.approve",
      signature: "APPROVED",
      guards: [notProposer, { code: "CONCESSION", message: "Chấp nhận đặc cách cần QA rồi Ban giám đốc duyệt.", check: ({ row }) => row.disposition !== "USE_AS_IS" }],
      patch: ({ actor }) => ({ disposition_approved_by: actor.userId }),
      effects: ({ tx, actor, updated }) => applyDisposition(tx, actor, updated),
    },
    {
      action: "qa_approve_concession",
      from: "DISPOSITION_PROPOSED",
      to: "PENDING_BOD",
      permission: "qms.ncr.approve",
      signature: "REVIEWED",
      guards: [notProposer, { code: "NOT_CONCESSION", message: "Chỉ dùng cho chấp nhận đặc cách.", check: ({ row }) => row.disposition === "USE_AS_IS" }],
      patch: ({ actor }) => ({ qa_approved_by: actor.userId, qa_approved_at: new Date() }),
    },
    {
      action: "bod_approve",
      from: "PENDING_BOD",
      to: "APPROVED",
      permission: "qms.ncr.approve_bod",
      signature: "APPROVED",
      guards: [
        notProposer,
        {
          code: "SOD_QA_BOD",
          message: "Người phê duyệt Ban Giám Đốc phải khác người đã duyệt QA.",
          check: ({ actor, row }) => Boolean(actor.isRootAdmin || !row.qa_approved_by || row.qa_approved_by !== actor.userId),
        },
      ],
      patch: ({ actor }) => ({ disposition_approved_by: actor.userId }),
      effects: ({ tx, actor, updated }) => applyDisposition(tx, actor, updated),
    },
    { action: "reject", from: ["DISPOSITION_PROPOSED", "PENDING_BOD"], to: "OPEN", permission: "qms.ncr.approve", reasonRequired: true, patch: () => ({ disposition: "PENDING" }) },
    {
      action: "close",
      from: "APPROVED",
      to: "CLOSED",
      permission: "qms.ncr.approve",
      signature: "APPROVED",
      reasonRequired: true,
      guards: [
        {
          code: "STOCK_LEFT",
          message: "Lô hủy / trả nhà cung cấp vẫn còn tồn. Lập phiếu xuất hủy hoặc xuất trả trước khi đóng NCR.",
          check: async ({ tx, row }) =>
            !row.lot_id ||
            !["SCRAP", "RETURN_TO_SUPPLIER"].includes(row.disposition) ||
            !(await tx.query("SELECT 1 FROM inv.stock_balance WHERE lot_id = $1 AND qty_on_hand > 0 LIMIT 1", [row.lot_id])).rowCount,
        },
      ],
      patch: ({ actor }) => ({ closed_by: actor.userId }),
    },
  ],
});

type DevStatus = "OPEN" | "UNDER_INVESTIGATION" | "ACTION_DEFINED" | "CLOSED";
interface Deviation {
  id: string;
  severity: string;
  status: DevStatus;
  version: number;
  detected_by?: number | null;
  reported_by?: number | null;
  root_cause?: string | null;
  corrective_action?: string | null;
  preventive_action?: string | null;
  effectiveness_summary?: string | null;
}

const capaSchema = z.object({
  root_cause: z.string().trim().min(5, "ghi nguyên nhân gốc").max(4000),
  corrective_action: z.string().trim().min(5, "ghi biện pháp khắc phục").max(4000),
  preventive_action: z.string().trim().max(4000).optional().nullable(),
  action_owner: z.string().trim().max(200).optional().nullable(),
  action_due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
});
const serious = (severity: string) => ["HIGH", "CRITICAL"].includes(severity);

export const deviationMachine = defineMachine<DevStatus, Deviation>({
  entityType: "deviation",
  table: "qms.deviation",
  states: ["OPEN", "UNDER_INVESTIGATION", "ACTION_DEFINED", "CLOSED"],
  terminal: ["CLOSED"],
  transitions: [
    { action: "investigate", from: "OPEN", to: "UNDER_INVESTIGATION", permission: "qms.ncr.propose" },
    {
      // the CAPA record: root cause and corrective action; serious deviations also need a preventive action
      action: "define_action",
      from: "UNDER_INVESTIGATION",
      to: "ACTION_DEFINED",
      permission: "qms.ncr.propose",
      guards: [
        {
          code: "CAPA",
          message: "Ghi nguyên nhân gốc và biện pháp khắc phục; sai lệch HIGH/CRITICAL cần cả biện pháp phòng ngừa.",
          check: ({ row, payload }) => {
            const p = capaSchema.safeParse(payload);
            return p.success && (!serious(row.severity) || Boolean(p.data.preventive_action && p.data.preventive_action.length >= 5));
          },
        },
      ],
      patch: ({ payload }) => {
        const d = capaSchema.parse(payload);
        return { root_cause: d.root_cause, corrective_action: d.corrective_action, preventive_action: d.preventive_action ?? null, action_owner: d.action_owner ?? null, action_due: d.action_due ?? null };
      },
    },
    {
      action: "close",
      from: ["OPEN", "UNDER_INVESTIGATION", "ACTION_DEFINED"],
      to: "CLOSED",
      permission: "qms.ncr.approve",
      signature: "APPROVED",
      reasonRequired: true,
      guards: [
        {
          code: "OPEN_NCR",
          message: "Sai lệch còn NCR chưa đóng.",
          check: async ({ tx, row }) => !(await tx.query("SELECT 1 FROM qms.ncr WHERE deviation_id = $1 AND status <> 'CLOSED' LIMIT 1", [row.id])).rowCount,
        },
        {
          code: "CAPA_REQUIRED",
          message: "Phải ghi nhận nguyên nhân gốc (root_cause / lý do) trước khi đóng sai lệch; sai lệch mức HIGH/CRITICAL phải có đầy đủ CAPA và đánh giá hiệu lực (effectiveness_summary).",
          check: ({ row: d, reason, payload }) => {
            if (!serious(d.severity)) {
              return Boolean((d.root_cause && d.root_cause.trim()) || (reason && reason.trim()));
            }
            const eff = String(payload?.effectiveness_summary ?? d.effectiveness_summary ?? "").trim();
            return Boolean(d.root_cause?.trim() && d.corrective_action?.trim() && d.preventive_action?.trim() && eff.length >= 5);
          },
        },
        {
          code: "NOT_REPORTER",
          message: "Người đóng sai lệch phải khác người đã mở / báo cáo sai lệch.",
          check: ({ row: d, actor }) => (d.reported_by ?? d.detected_by) !== actor.userId,
        },
      ],
      patch: ({ actor, row, reason, payload }) => ({
        closed_at: new Date(),
        root_cause: row.root_cause?.trim() ? row.root_cause : reason?.trim() || null,
        effectiveness_summary: String(payload?.effectiveness_summary ?? row.effectiveness_summary ?? "").trim() || null,
        capa_verified_by: serious(row.severity) ? actor.userId : null,
        capa_verified_at: serious(row.severity) ? new Date() : null,
      }),
    },
  ],
});

export async function getNcr(tx: Tx, actor: AuthzActor, id: string) {
  await authorize(tx, actor, "qms.qc.view");
  const ncr = (
    await tx.query(
      `SELECT n.*, d.code AS deviation_code, d.severity, d.status AS deviation_status, d.version AS deviation_version, d.description AS deviation_description,
              l.code AS lot_code, i.code AS item_code, i.name AS item_name, sq.code AS sequence_code, sq.name AS sequence_name,
              pp.display_name AS proposed_by_name, ap.display_name AS approved_by_name
         FROM qms.ncr n LEFT JOIN qms.deviation d ON d.id = n.deviation_id
         LEFT JOIN inv.lot l ON l.id = n.lot_id LEFT JOIN master.item i ON i.id = n.item_id
         LEFT JOIN oligo.oligo_sequence sq ON n.entity_type = 'OLIGO_SEQUENCE' AND sq.id = n.entity_id
         LEFT JOIN core.user_profile pp ON pp.user_id = n.proposed_by LEFT JOIN core.user_profile ap ON ap.user_id = n.disposition_approved_by
        WHERE n.id = $1`,
      [id]
    )
  ).rows[0];
  if (!ncr) throw notFound("NCR");
  return ncr;
}
