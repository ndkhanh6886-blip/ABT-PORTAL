import { z } from "zod";
import type { Tx } from "../core/db";
import { writeAudit } from "../core/audit";
import { authorize, authorizeAnywhere, hasFactoryPermission, type AuthzActor } from "../core/authz";
import { invalid, notFound } from "../core/errors";
import { nextNumber } from "../core/numbering";
import { insertRecord, parseInput, updateRecord } from "../core/records";
import { defineMachine, listAllowedActions, runTransition } from "../core/stateMachine";
import "./permissions";

export type IdeaStatus = "DRAFT" | "SUBMITTED" | "EVALUATION" | "EVALUATED" | "APPROVED" | "REJECTED" | "CONVERTED";

export interface IdeaRow {
  id: string;
  code: string;
  org_unit_id: string;
  title: string;
  description: string;
  target_domain: "KIT" | "OLIGO" | "DEVICE" | "SOFTWARE" | "OTHER";
  goal_id: string | null;
  proposer_id: number;
  expected_roi: string | null;
  market_summary: string | null;
  vote_count: number;
  status: IdeaStatus;
  version: number;
}

export const ideaMachine = defineMachine<IdeaStatus, IdeaRow>({
  entityType: "rd_idea",
  table: "rd.idea",
  states: ["DRAFT", "SUBMITTED", "EVALUATION", "EVALUATED", "APPROVED", "REJECTED", "CONVERTED"],
  terminal: ["REJECTED", "CONVERTED"],
  scopeOf: (row) => row.org_unit_id,
  transitions: [
    {
      action: "submit",
      from: "DRAFT",
      to: "SUBMITTED",
      permission: "rd.idea.propose",
    },
    {
      action: "start_evaluation",
      from: "SUBMITTED",
      to: "EVALUATION",
      permission: "rd.idea.evaluate",
    },
    {
      action: "complete_evaluation",
      from: "EVALUATION",
      to: "EVALUATED",
      permission: "rd.idea.evaluate",
      guards: [
        {
          code: "TECH_AND_BIZ_REQUIRED",
          message: "Cần ít nhất một đánh giá Kỹ thuật (TECH) và một đánh giá Kinh doanh (BIZ) trước khi chốt kết quả hội đồng.",
          check: async ({ tx, row }) => {
            const res = await tx.query(
              "SELECT count(DISTINCT eval_type)::int AS n FROM rd.idea_evaluation WHERE idea_id = $1",
              [row.id]
            );
            return Number(res.rows[0]?.n ?? 0) >= 2;
          },
        },
      ],
    },
    {
      action: "approve",
      from: "EVALUATED",
      to: "APPROVED",
      permission: "rd.idea.approve",
      signature: "APPROVED",
      guards: [
        {
          code: "SELF_APPROVAL",
          message: "Người đề xuất ý tưởng không được tự ký phê duyệt ý tưởng của chính mình.",
          check: ({ actor, row }) => row.proposer_id !== actor.userId,
        },
      ],
    },
    {
      action: "reject",
      from: ["SUBMITTED", "EVALUATION", "EVALUATED"],
      to: "REJECTED",
      permission: "rd.idea.approve",
      reasonRequired: true,
    },
    {
      action: "re_evaluate",
      from: "EVALUATED",
      to: "EVALUATION",
      permission: "rd.idea.approve",
      reasonRequired: true,
    },
    {
      action: "convert",
      from: "APPROVED",
      to: "CONVERTED",
      permission: "rd.project.manage",
    },
  ],
});

const goalSchema = z.object({
  name: z.string().trim().min(2, "nhập tên mục tiêu chiến lược").max(250),
  period: z.string().trim().min(2, "nhập kỳ mục tiêu (ví dụ 2026, 2026-Q4)").max(40),
  description: z.string().trim().max(2000).optional().nullable(),
  status: z.enum(["ACTIVE", "COMPLETED", "ARCHIVED"]).default("ACTIVE"),
});

export async function createStrategicGoal(tx: Tx, actor: AuthzActor, input: unknown) {
  await authorizeAnywhere(tx, actor, "rd.idea.approve");
  const d = parseInput(goalSchema, input);
  const code = await nextNumber(tx, "RD_GOAL");
  return insertRecord<{ id: string; code: string; name: string; period: string }>(tx, actor, "rd.strategic_goal", "rd_goal", {
    code,
    name: d.name,
    period: d.period,
    description: d.description ?? null,
    owner_id: actor.userId,
    status: d.status,
  });
}

export async function listStrategicGoals(tx: Tx, actor: AuthzActor) {
  await authorizeAnywhere(tx, actor, "rd.view");
  return (
    await tx.query(
      `SELECT g.*, p.display_name AS owner_name,
              (SELECT count(*)::int FROM rd.idea i WHERE i.goal_id = g.id) AS idea_count
         FROM rd.strategic_goal g LEFT JOIN core.user_profile p ON p.user_id = g.owner_id
        ORDER BY g.period DESC, g.code DESC`
    )
  ).rows;
}

const criterionSchema = z.object({
  eval_type: z.enum(["TECH", "BIZ"]),
  code: z.string().trim().regex(/^[A-Z0-9_]{3,40}$/, "Mã tiêu chí chữ hoa, số, _"),
  name: z.string().trim().min(2).max(200),
  weight: z.coerce.number().positive("Trọng số > 0").max(100),
  scale_max: z.coerce.number().int().min(3).max(10).default(5),
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
});

export async function saveEvaluationCriterion(tx: Tx, actor: AuthzActor, id: string | null, input: unknown) {
  await authorizeAnywhere(tx, actor, "rd.idea.approve");
  const raw = (input ?? {}) as Record<string, unknown>;
  const d = parseInput(criterionSchema, input);
  if (!id) {
    return insertRecord(tx, actor, "rd.evaluation_criterion", "rd_criterion", d);
  }
  return updateRecord(tx, actor, "rd.evaluation_criterion", "rd_criterion", id, Number(raw.version ?? 0), {
    name: d.name,
    weight: d.weight,
    scale_max: d.scale_max,
    status: d.status,
  });
}

export async function listEvaluationCriteria(tx: Tx, actor: AuthzActor) {
  await authorizeAnywhere(tx, actor, "rd.view");
  return (
    await tx.query(
      "SELECT id, eval_type, code, name, weight::float AS weight, scale_max, status, version FROM rd.evaluation_criterion ORDER BY eval_type, code"
    )
  ).rows;
}

const ideaSchema = z.object({
  org_unit_id: z.string().uuid("chọn phòng R&D / KT-CN"),
  title: z.string().trim().min(3, "nhập tiêu đề ý tưởng").max(300),
  description: z.string().trim().min(5, "nhập mô tả & giải pháp kỹ thuật").max(4000),
  target_domain: z.enum(["KIT", "OLIGO", "DEVICE", "SOFTWARE", "OTHER"]).default("KIT"),
  goal_id: z.string().uuid().optional().nullable(),
  expected_roi: z.string().trim().max(500).optional().nullable(),
  market_summary: z.string().trim().max(2000).optional().nullable(),
  submit_now: z.boolean().default(false),
});

export async function createIdea(tx: Tx, actor: AuthzActor, input: unknown) {
  const d = parseInput(ideaSchema, input);
  await authorize(tx, actor, "rd.idea.propose", d.org_unit_id);
  const code = await nextNumber(tx, "RD_IDEA");
  const idea = await insertRecord<IdeaRow>(tx, actor, "rd.idea", "rd_idea", {
    code,
    org_unit_id: d.org_unit_id,
    title: d.title,
    description: d.description,
    target_domain: d.target_domain,
    goal_id: d.goal_id ?? null,
    proposer_id: actor.userId,
    expected_roi: d.expected_roi ?? null,
    market_summary: d.market_summary ?? null,
  });
  if (d.submit_now) {
    return runTransition(tx, ideaMachine, actor, { id: idea.id, action: "submit", expectedVersion: idea.version });
  }
  return idea;
}

export async function updateIdeaDraft(tx: Tx, actor: AuthzActor, id: string, input: unknown) {
  const raw = (input ?? {}) as Record<string, unknown>;
  const cur = (await tx.query("SELECT * FROM rd.idea WHERE id = $1 FOR UPDATE", [id])).rows[0] as IdeaRow | undefined;
  if (!cur) throw notFound("ý tưởng R&D");
  await authorize(tx, actor, "rd.idea.propose", cur.org_unit_id);
  if (cur.status !== "DRAFT") throw invalid("Chỉ sửa được ý tưởng khi đang ở trạng thái Nháp.");
  const d = parseInput(ideaSchema.omit({ org_unit_id: true, submit_now: true }), input);
  return updateRecord<IdeaRow>(tx, actor, "rd.idea", "rd_idea", id, Number(raw.version ?? cur.version), {
    title: d.title,
    description: d.description,
    target_domain: d.target_domain,
    goal_id: d.goal_id ?? null,
    expected_roi: d.expected_roi ?? null,
    market_summary: d.market_summary ?? null,
  });
}

const evalSubmitSchema = z.object({
  eval_type: z.enum(["TECH", "BIZ"]),
  scores: z.record(z.coerce.number().min(0).max(10)),
  analysis: z.string().trim().max(3000).optional().nullable(),
  recommendation: z.enum(["APPROVE", "REJECT", "REVISE"]),
});

/**
 * Submits a committee evaluation (TECH or BIZ) for an idea.
 * Weighted score (0..100 scale) is computed on the server from active criteria of that eval_type.
 * When an idea is in SUBMITTED, the first evaluation automatically moves it to EVALUATION;
 * once both TECH and BIZ evaluations are present, it automatically advances to EVALUATED.
 */
export async function evaluateIdea(tx: Tx, actor: AuthzActor, ideaId: string, input: unknown) {
  const d = parseInput(evalSubmitSchema, input);
  const idea = (await tx.query("SELECT * FROM rd.idea WHERE id = $1 FOR UPDATE", [ideaId])).rows[0] as IdeaRow | undefined;
  if (!idea) throw notFound("ý tưởng R&D");
  await authorize(tx, actor, "rd.idea.evaluate", idea.org_unit_id);
  if (!["SUBMITTED", "EVALUATION", "EVALUATED"].includes(idea.status)) {
    throw invalid(`Không thể chấm điểm khi ý tưởng đang ở trạng thái ${idea.status}.`);
  }
  const criteria = (
    await tx.query(
      "SELECT code, name, weight::float AS weight, scale_max FROM rd.evaluation_criterion WHERE eval_type = $1 AND status = 'ACTIVE' ORDER BY code",
      [d.eval_type]
    )
  ).rows;
  if (!criteria.length) throw invalid(`Chưa cấu hình tiêu chí chấm điểm cho nhóm ${d.eval_type}.`);

  let totalWeight = 0;
  let weightedSum = 0;
  const cleanScores: Record<string, number> = {};
  for (const c of criteria) {
    const val = d.scores[c.code];
    if (val == null || Number.isNaN(Number(val))) {
      throw invalid(`Thiếu điểm cho tiêu chí "${c.name}" (${c.code}).`);
    }
    if (val < 0 || val > c.scale_max) {
      throw invalid(`Điểm tiêu chí "${c.name}" phải từ 0 đến ${c.scale_max}.`);
    }
    cleanScores[c.code] = Number(val);
    totalWeight += Number(c.weight);
    weightedSum += (Number(val) / Number(c.scale_max)) * Number(c.weight);
  }
  const weightedScore = totalWeight > 0 ? Math.round((weightedSum / totalWeight) * 10000) / 100 : 0;

  await tx.query(
    `INSERT INTO rd.idea_evaluation (idea_id, eval_type, evaluator_id, scores, weighted_score, analysis, recommendation, submitted_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())
     ON CONFLICT (idea_id, eval_type, evaluator_id)
     DO UPDATE SET scores = EXCLUDED.scores, weighted_score = EXCLUDED.weighted_score,
                   analysis = EXCLUDED.analysis, recommendation = EXCLUDED.recommendation, submitted_at = now()`,
    [ideaId, d.eval_type, actor.userId, JSON.stringify(cleanScores), weightedScore, d.analysis ?? null, d.recommendation]
  );

  await writeAudit(tx, actor, {
    entityType: "rd_idea",
    entityId: ideaId,
    action: `evaluate_${d.eval_type.toLowerCase()}`,
    changes: { weighted_score: [null, weightedScore], recommendation: [null, d.recommendation] },
  });

  let current = idea;
  if (current.status === "SUBMITTED") {
    current = await runTransition(tx, ideaMachine, actor, { id: ideaId, action: "start_evaluation", expectedVersion: current.version }, { trusted: true });
  }
  if (current.status === "EVALUATION") {
    const types = (await tx.query("SELECT count(DISTINCT eval_type)::int AS n FROM rd.idea_evaluation WHERE idea_id = $1", [ideaId])).rows[0];
    if (Number(types?.n ?? 0) >= 2) {
      current = await runTransition(tx, ideaMachine, actor, { id: ideaId, action: "complete_evaluation", expectedVersion: current.version }, { trusted: true });
    }
  }
  return getIdeaDetail(tx, actor, ideaId);
}

export async function listIdeas(tx: Tx, actor: AuthzActor, status?: string) {
  await authorizeAnywhere(tx, actor, "rd.view");
  const rows = (
    await tx.query(
      `SELECT i.*, u.name AS org_unit_name, p.display_name AS proposer_name, g.code AS goal_code, g.name AS goal_name,
              (SELECT round(avg(weighted_score), 1)::float FROM rd.idea_evaluation e WHERE e.idea_id = i.id AND e.eval_type = 'TECH') AS tech_score,
              (SELECT round(avg(weighted_score), 1)::float FROM rd.idea_evaluation e WHERE e.idea_id = i.id AND e.eval_type = 'BIZ') AS biz_score,
              (SELECT id FROM rd.project pr WHERE pr.idea_id = i.id LIMIT 1) AS project_id,
              (SELECT code FROM rd.project pr WHERE pr.idea_id = i.id LIMIT 1) AS project_code
         FROM rd.idea i
         JOIN core.org_unit u ON u.id = i.org_unit_id
         LEFT JOIN core.user_profile p ON p.user_id = i.proposer_id
         LEFT JOIN rd.strategic_goal g ON g.id = i.goal_id
        WHERE ($1::text IS NULL OR i.status = $1)
        ORDER BY i.created_at DESC LIMIT 300`,
      [status ?? null]
    )
  ).rows;
  const visible = [];
  for (const r of rows) {
    if (await hasFactoryPermission(tx, actor, "rd.view", r.org_unit_id)) visible.push(r);
  }
  return visible;
}

export async function getIdeaDetail(tx: Tx, actor: AuthzActor, id: string) {
  const idea = (
    await tx.query(
      `SELECT i.*, u.name AS org_unit_name, p.display_name AS proposer_name, g.code AS goal_code, g.name AS goal_name,
              (SELECT id FROM rd.project pr WHERE pr.idea_id = i.id LIMIT 1) AS project_id,
              (SELECT code FROM rd.project pr WHERE pr.idea_id = i.id LIMIT 1) AS project_code
         FROM rd.idea i
         JOIN core.org_unit u ON u.id = i.org_unit_id
         LEFT JOIN core.user_profile p ON p.user_id = i.proposer_id
         LEFT JOIN rd.strategic_goal g ON g.id = i.goal_id
        WHERE i.id = $1`,
      [id]
    )
  ).rows[0];
  if (!idea) throw notFound("ý tưởng R&D");
  await authorize(tx, actor, "rd.view", idea.org_unit_id);
  const evaluations = (
    await tx.query(
      `SELECT e.id, e.eval_type, e.evaluator_id, p.display_name AS evaluator_name, e.scores,
              e.weighted_score::float AS weighted_score, e.analysis, e.recommendation, e.submitted_at
         FROM rd.idea_evaluation e LEFT JOIN core.user_profile p ON p.user_id = e.evaluator_id
        WHERE e.idea_id = $1 ORDER BY e.submitted_at DESC`,
      [id]
    )
  ).rows;
  const actions = await listAllowedActions(tx, ideaMachine, actor, idea);
  return { ...idea, evaluations, actions };
}
