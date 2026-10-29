import type { Tx } from "../core/db";
import { authorize, type AuthzActor } from "../core/authz";
import { notFound } from "../core/errors";
import { defineMachine, runTransition, type Guard } from "../core/stateMachine";
import { lotMachine } from "../inv/lots";
import "./permissions";

type NcrStatus = "OPEN" | "DISPOSITION_PROPOSED" | "PENDING_BOD" | "APPROVED" | "CLOSED";
export const DISPOSITIONS = ["SCRAP", "REWORK", "RESYNTHESIZE", "USE_AS_IS", "RETURN_TO_SUPPLIER"] as const;
export interface Ncr {
  id: string;
  code: string;
  lot_id: string | null;
  disposition: string;
  proposed_by: number | null;
  status: NcrStatus;
  version: number;
}

const notProposer: Guard<Ncr> = { code: "SAME_PERSON", message: "Người duyệt phải khác người đề xuất hướng xử lý.", check: ({ actor, row }) => row.proposed_by !== actor.userId };

/** Scrap / return: the lot leaves the usable stock (REJECTED) as soon as the disposition is approved. */
async function applyDisposition(tx: Tx, actor: AuthzActor, ncr: Ncr): Promise<void> {
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
    },
    {
      action: "bod_approve",
      from: "PENDING_BOD",
      to: "APPROVED",
      permission: "qms.ncr.approve_bod",
      signature: "APPROVED",
      guards: [notProposer],
      patch: ({ actor }) => ({ disposition_approved_by: actor.userId }),
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
}

export const deviationMachine = defineMachine<DevStatus, Deviation>({
  entityType: "deviation",
  table: "qms.deviation",
  states: ["OPEN", "UNDER_INVESTIGATION", "ACTION_DEFINED", "CLOSED"],
  terminal: ["CLOSED"],
  transitions: [
    { action: "investigate", from: "OPEN", to: "UNDER_INVESTIGATION", permission: "qms.ncr.propose" },
    { action: "define_action", from: "UNDER_INVESTIGATION", to: "ACTION_DEFINED", permission: "qms.ncr.propose", reasonRequired: true },
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
          message: "Sai lệch mức HIGH/CRITICAL cần CAPA trước khi đóng (phân hệ CAPA chưa có).",
          check: ({ row }) => !["HIGH", "CRITICAL"].includes(row.severity),
        },
      ],
    },
  ],
});

export async function getNcr(tx: Tx, actor: AuthzActor, id: string) {
  await authorize(tx, actor, "qms.qc.view");
  const ncr = (
    await tx.query(
      `SELECT n.*, d.code AS deviation_code, d.severity, d.status AS deviation_status, d.version AS deviation_version, d.description AS deviation_description,
              l.code AS lot_code, i.code AS item_code, i.name AS item_name,
              pp.display_name AS proposed_by_name, ap.display_name AS approved_by_name
         FROM qms.ncr n LEFT JOIN qms.deviation d ON d.id = n.deviation_id
         LEFT JOIN inv.lot l ON l.id = n.lot_id LEFT JOIN master.item i ON i.id = n.item_id
         LEFT JOIN core.user_profile pp ON pp.user_id = n.proposed_by LEFT JOIN core.user_profile ap ON ap.user_id = n.disposition_approved_by
        WHERE n.id = $1`,
      [id]
    )
  ).rows[0];
  if (!ncr) throw notFound("NCR");
  return ncr;
}
