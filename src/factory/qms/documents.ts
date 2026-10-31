import { z } from "zod";
import type { Tx } from "../core/db";
import { writeAudit } from "../core/audit";
import { authorize, authorizeAnywhere, type AuthzActor } from "../core/authz";
import { vnToday } from "../core/dates";
import { conflict, invalid, notFound } from "../core/errors";
import { nextNumber } from "../core/numbering";
import { insertRecord, parseInput } from "../core/records";
import { defineMachine, listAllowedActions, runTransition } from "../core/stateMachine";
import "./permissions";

export type ControlledDocStatus = "DRAFT" | "IN_REVIEW" | "EFFECTIVE" | "SUPERSEDED" | "OBSOLETE";

export interface ControlledDocumentRow {
  id: string;
  code: string;
  doc_version: number;
  title: string;
  doc_type: "SOP" | "WI" | "FORM" | "SPEC" | "POLICY";
  org_unit_id: string | null;
  effective_date: string | null;
  review_due_date: string | null;
  content_summary: string | null;
  attachment_id: string | null;
  status: ControlledDocStatus;
  approved_by: number | null;
  approved_at: string | null;
  created_by: number | null;
  version: number;
}

export interface TrainingRecordRow {
  id: string;
  document_id: string;
  doc_code: string;
  doc_version: number;
  user_id: number;
  trained_at: string;
  expires_at: string | null;
  assessment_score: string | null;
  result: "PASS" | "FAIL";
  trainer_id: number | null;
  notes: string | null;
}

/**
 * Controlled Document (SOP/WI) State Machine (ISO 13485 §4.2.4 & GMP):
 * DRAFT → IN_REVIEW → EFFECTIVE ✍ → SUPERSEDED / OBSOLETE
 * Approving a new revision uses `beforeUpdate` to transition any prior EFFECTIVE revision of the same `code`
 * to `SUPERSEDED` via `runTransition` (preserving complete audit trail and avoiding GET side-effects).
 */
export const controlledDocMachine = defineMachine<ControlledDocStatus, ControlledDocumentRow>({
  entityType: "qms_controlled_document",
  table: "qms.controlled_document",
  states: ["DRAFT", "IN_REVIEW", "EFFECTIVE", "SUPERSEDED", "OBSOLETE"],
  terminal: ["SUPERSEDED", "OBSOLETE"],
  transitions: [
    {
      action: "submit_review",
      from: "DRAFT",
      to: "IN_REVIEW",
      permission: "qms.doc.manage",
    },
    {
      action: "return_draft",
      from: "IN_REVIEW",
      to: "DRAFT",
      permission: "qms.doc.approve",
      reasonRequired: true,
    },
    {
      action: "approve",
      from: "IN_REVIEW",
      to: "EFFECTIVE",
      permission: "qms.doc.approve",
      signature: "APPROVED",
      guards: [
        {
          code: "SELF_APPROVAL",
          message: "Người phê duyệt ban hành SOP phải khác người soạn thảo.",
          check: ({ actor, row }) => row.created_by !== actor.userId,
        },
      ],
      beforeUpdate: async ({ tx, actor, row }) => {
        const prev = (
          await tx.query(
            "SELECT * FROM qms.controlled_document WHERE code = $1 AND status = 'EFFECTIVE' AND id <> $2 FOR UPDATE",
            [row.code, row.id]
          )
        ).rows as ControlledDocumentRow[];
        for (const p of prev) {
          await runTransition(
            tx,
            controlledDocMachine,
            actor,
            { id: p.id, action: "supersede", expectedVersion: p.version, reason: `Thay thế bởi phiên bản v${row.doc_version}` },
            { trusted: true }
          );
        }
      },
      patch: ({ actor, row }) => ({
        approved_by: actor.userId,
        approved_at: new Date(),
        effective_date: row.effective_date ?? vnToday(),
      }),
    },
    {
      action: "supersede",
      from: "EFFECTIVE",
      to: "SUPERSEDED",
      permission: "qms.doc.approve",
    },
    {
      action: "obsolete",
      from: "EFFECTIVE",
      to: "OBSOLETE",
      permission: "qms.doc.approve",
      reasonRequired: true,
    },
  ],
});

const createDocSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_.-]{3,60}$/, "Mã tài liệu SOP hợp lệ (ví dụ SOP-KIT-001)")
    .transform((s) => s.toUpperCase())
    .optional(),
  title: z.string().trim().min(3, "nhập tiêu đề tài liệu SOP/WI").max(300),
  doc_type: z.enum(["SOP", "WI", "FORM", "SPEC", "POLICY"]).default("SOP"),
  org_unit_id: z.string().uuid().optional().nullable(),
  effective_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  review_due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  content_summary: z.string().trim().max(4000).optional().nullable(),
});

export async function createControlledDocument(tx: Tx, actor: AuthzActor, input: unknown) {
  await authorize(tx, actor, "qms.doc.manage");
  const d = parseInput(createDocSchema, input);
  const code = d.code ?? (await nextNumber(tx, "QMS_DOC"));
  const nextVer = Number(
    (await tx.query("SELECT coalesce(max(doc_version), 0) + 1 AS v FROM qms.controlled_document WHERE code = $1", [code])).rows[0].v
  );
  const existingDraft = await tx.query(
    "SELECT 1 FROM qms.controlled_document WHERE code = $1 AND status IN ('DRAFT', 'IN_REVIEW') LIMIT 1",
    [code]
  );
  if (existingDraft.rowCount) {
    throw conflict(`Tài liệu ${code} đang có phiên bản nháp/chờ duyệt chưa hoàn tất.`, "DRAFT_EXISTS");
  }
  return insertRecord<ControlledDocumentRow>(tx, actor, "qms.controlled_document", "qms_controlled_document", {
    code,
    doc_version: nextVer,
    title: d.title,
    doc_type: d.doc_type,
    org_unit_id: d.org_unit_id ?? null,
    effective_date: d.effective_date ?? null,
    review_due_date: d.review_due_date ?? null,
    content_summary: d.content_summary ?? null,
  });
}

const trainingSchema = z.object({
  document_id: z.string().uuid("chọn tài liệu SOP/WI"),
  user_id: z.coerce.number().int().positive("chọn nhân sự được đào tạo"),
  trained_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  expires_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  assessment_score: z.coerce.number().min(0).max(100).optional().nullable(),
  result: z.enum(["PASS", "FAIL"]).default("PASS"),
  notes: z.string().trim().max(1000).optional().nullable(),
});

export async function recordTraining(tx: Tx, actor: AuthzActor, input: unknown) {
  await authorize(tx, actor, "qms.doc.manage");
  const d = parseInput(trainingSchema, input);
  const doc = (await tx.query("SELECT * FROM qms.controlled_document WHERE id = $1", [d.document_id])).rows[0] as
    | ControlledDocumentRow
    | undefined;
  if (!doc) throw notFound("tài liệu SOP/WI");
  const trainedAt = d.trained_at ?? vnToday();
  const row = (
    await tx.query(
      `INSERT INTO qms.training_record
         (document_id, doc_code, doc_version, user_id, trained_at, expires_at, assessment_score, result, trainer_id, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $9)
       ON CONFLICT (document_id, user_id) DO UPDATE
         SET trained_at = EXCLUDED.trained_at,
             expires_at = EXCLUDED.expires_at,
             assessment_score = EXCLUDED.assessment_score,
             result = EXCLUDED.result,
             trainer_id = EXCLUDED.trainer_id,
             notes = EXCLUDED.notes
       RETURNING *`,
      [
        doc.id,
        doc.code,
        doc.doc_version,
        d.user_id,
        trainedAt,
        d.expires_at ?? null,
        d.assessment_score ?? null,
        d.result,
        actor.userId,
        d.notes ?? null,
      ]
    )
  ).rows[0] as TrainingRecordRow;

  await writeAudit(tx, actor, {
    entityType: "qms_controlled_document",
    entityId: doc.id,
    action: "record_training",
    changes: { [`user_${d.user_id}`]: [null, `${doc.code} v${doc.doc_version}: ${d.result}`] },
  });
  return row;
}

/**
 * Checks whether `userId` is qualified on the currently EFFECTIVE revision of `docCode` (ISO 13485 §6.2 & GMP):
 * - If no EFFECTIVE controlled document with `code = docCode` exists in `qms.controlled_document`, returns `true`
 *   (backward-compatible with informal reference codes).
 * - If an EFFECTIVE controlled document exists, the user must have a `PASS` training record on that document
 *   whose `expires_at` is null or >= today.
 */
export async function isUserTrainedForSop(tx: Tx, userId: number, docCode: string | null | undefined): Promise<boolean> {
  if (!docCode?.trim()) return true;
  const enforce = (await tx.query("SELECT value FROM core.setting WHERE key = 'qms.enforce_sop_training'")).rows[0]?.value;
  if (enforce === "false") return true;

  const effDoc = (
    await tx.query("SELECT id, doc_version FROM qms.controlled_document WHERE code = $1 AND status = 'EFFECTIVE' LIMIT 1", [
      docCode.trim().toUpperCase(),
    ])
  ).rows[0];
  if (!effDoc) return true;

  const tr = await tx.query(
    `SELECT 1 FROM qms.training_record
      WHERE document_id = $1 AND user_id = $2 AND result = 'PASS'
        AND (expires_at IS NULL OR expires_at >= CURRENT_DATE)
      LIMIT 1`,
    [effDoc.id, userId]
  );
  return (tr.rowCount ?? 0) > 0;
}

export async function listControlledDocuments(tx: Tx, actor: AuthzActor) {
  await authorizeAnywhere(tx, actor, "qms.qc.view");
  const docs = (
    await tx.query(
      `SELECT d.*, d.effective_date::text AS effective_date, d.review_due_date::text AS review_due_date,
              u.name AS org_unit_name, ap.display_name AS approved_by_name,
              (SELECT count(*)::int FROM qms.training_record tr WHERE tr.document_id = d.id AND tr.result = 'PASS') AS trained_count
         FROM qms.controlled_document d
         LEFT JOIN core.org_unit u ON u.id = d.org_unit_id
         LEFT JOIN core.user_profile ap ON ap.user_id = d.approved_by
        ORDER BY d.code ASC, d.doc_version DESC LIMIT 200`
    )
  ).rows;
  for (const doc of docs) {
    doc.actions = await listAllowedActions(tx, controlledDocMachine, actor, doc);
  }
  return docs;
}

export async function listTrainingRecords(tx: Tx, actor: AuthzActor, documentId?: string) {
  await authorizeAnywhere(tx, actor, "qms.qc.view");
  return (
    await tx.query(
      `SELECT tr.*, tr.trained_at::text AS trained_at, tr.expires_at::text AS expires_at,
              tr.assessment_score::float AS assessment_score,
              up.display_name AS user_name, tp.display_name AS trainer_name,
              d.title AS doc_title, d.status AS doc_status
         FROM qms.training_record tr
         JOIN qms.controlled_document d ON d.id = tr.document_id
         LEFT JOIN core.user_profile up ON up.user_id = tr.user_id
         LEFT JOIN core.user_profile tp ON tp.user_id = tr.trainer_id
        WHERE ($1::uuid IS NULL OR tr.document_id = $1)
        ORDER BY tr.trained_at DESC LIMIT 300`,
      [documentId ?? null]
    )
  ).rows;
}
