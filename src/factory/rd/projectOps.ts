import { z } from "zod";
import type { Tx } from "../core/db";
import { authorize, authorizeAnywhere, SYSTEM_ACTOR, type AuthzActor } from "../core/authz";
import { writeAudit } from "../core/audit";
import { vnToday } from "../core/dates";
import { invalid, notFound } from "../core/errors";
import { nextNumber } from "../core/numbering";
import { parseInput } from "../core/records";
import { runTransition } from "../core/stateMachine";
import { allocate, findCandidates } from "../inv/allocation";
import { createStockDocument, stockDocumentMachine } from "../inv/documents";
import { createOligoOrder, addSequences } from "../oligo/orders";
import { createRequest } from "../purchase/requests";
import { createProject } from "./projects";
import "./permissions";

let rdOpsSchemaEnsured = false;

export async function ensureRdProjectOpsSchema(tx: Tx): Promise<void> {
  if (rdOpsSchemaEnsured) return;
  // Schema DDL now lives cleanly in versioned migrations (0035+).
  // Only backfill missing project_gate / performer_name data if needed.
  // Backfill gates from rd.gate_template_item for any project that has 0 gates
  const gateless = (
    await tx.query(
      `SELECT id, gate_template_id FROM rd.project p
        WHERE NOT EXISTS (SELECT 1 FROM rd.project_gate g WHERE g.project_id = p.id)`
    )
  ).rows;
  for (const p of gateless) {
    const tplItems = (
      await tx.query("SELECT * FROM rd.gate_template_item WHERE template_id = $1 ORDER BY gate_no, seq", [p.gate_template_id])
    ).rows;
    const gatesMap = new Map<number, { gate_name: string; stage_after: string; items: typeof tplItems }>();
    for (const item of tplItems) {
      if (!gatesMap.has(item.gate_no)) {
        gatesMap.set(item.gate_no, { gate_name: item.gate_name, stage_after: item.stage_after, items: [] });
      }
      gatesMap.get(item.gate_no)!.items.push(item);
    }
    const sortedGateNos = [...gatesMap.keys()].sort((a, b) => a - b);
    for (const [idx, gateNo] of sortedGateNos.entries()) {
      const g = gatesMap.get(gateNo)!;
      const gateRow = (
        await tx.query(
          `INSERT INTO rd.project_gate (project_id, gate_no, gate_name, stage_after, status)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [p.id, gateNo, g.gate_name, g.stage_after, idx === 0 ? "OPEN" : "LOCKED"]
        )
      ).rows[0];
      for (const it of g.items) {
        await tx.query(
          `INSERT INTO rd.gate_deliverable (project_gate_id, template_item_id, seq, item_name, doc_type, is_required, status)
           VALUES ($1, $2, $3, $4, $5, $6, 'MISSING')`,
          [gateRow.id, it.id, it.seq, it.item_name, it.doc_type, it.is_required]
        );
      }
    }
  }

  await tx.query(`
    UPDATE rd.experiment e
       SET performer_name = coalesce(nullif(e.performer_name, ''), up.display_name)
      FROM core.user_profile up
     WHERE up.user_id = e.created_by AND (e.performer_name IS NULL OR e.performer_name = '')
  `);

  rdOpsSchemaEnsured = true;
}

export interface RdStaffMember {
  name: string;
  role: string;
  specialty: string;
  user_id?: number | null;
}

/**
 * Staff of one department (R&D by default; DEVICE = KTCN) for the "phụ trách" pickers and filters: people whose
 * department is that unit or one of its sub-units, or who hold an active role scoped there. (The former query had
 * `OR display_name IS NOT NULL`, true for everyone, so the whole company appeared — cut at 30 names.)
 */
export async function listRdStaffRoster(tx: Tx, moduleKey: "RD" | "DEVICE" = "RD"): Promise<RdStaffMember[]> {
  await ensureRdProjectOpsSchema(tx);
  const roster: RdStaffMember[] = [];

  const dbUsers = (
    await tx.query(
      `WITH RECURSIVE dept AS (
         SELECT id, name FROM core.org_unit WHERE module_key = $1 AND status = 'ACTIVE'
         UNION ALL
         SELECT c.id, d.name FROM core.org_unit c JOIN dept d ON c.parent_id = d.id
       )
       SELECT DISTINCT up.user_id, up.display_name, d.name AS dept_name
         FROM core.user_profile up
         JOIN dept d ON d.id = up.org_unit_id
               OR EXISTS (SELECT 1 FROM core.user_role ur
                           WHERE ur.user_id = up.user_id AND ur.scope_org_unit_id = d.id AND ur.revoked_at IS NULL
                             AND (ur.valid_to IS NULL OR ur.valid_to > now()))
        WHERE up.status = 'ACTIVE' AND up.display_name IS NOT NULL
        ORDER BY up.display_name LIMIT 300`,
      [moduleKey]
    )
  ).rows;

  const seen = new Set<string>();
  for (const u of dbUsers) {
    const nm = String(u.display_name || "").trim();
    if (nm && !seen.has(nm.toLowerCase())) {
      seen.add(nm.toLowerCase());
      roster.push({
        name: nm,
        role: "Cán bộ Nghiên cứu / Quản trị",
        specialty: u.dept_name || "Phòng Nghiên cứu R&D",
        user_id: u.user_id,
      });
    }
  }
  return roster;
}

/**
 * Returns the comprehensive operational dashboard for a specific R&D Project:
 * - Scorecard KPIs (DHF Gate deliverable completion %, TPP Pass %, WBS Task %, Material & Budget usage)
 * - Unified Material & Cost Ledger (combines ELN experiment materials + direct project stock issues + project PRs + internal Oligo trials)
 * - Material summary grouped by item
 * - Project WBS Tasks
 * - Project Prototype BOM (with live stock availability)
 */
export async function getProjectOpsOverview(tx: Tx, actor: AuthzActor, projectId: string) {
  await ensureRdProjectOpsSchema(tx);
  await authorizeAnywhere(tx, actor, "rd.view");

  const proj = (
    await tx.query(
      `SELECT p.*, i.code AS target_product_code, i.name AS target_product_name, i.base_uom AS target_product_uom
         FROM rd.project p
         LEFT JOIN master.item i ON i.id = p.target_product_item_id
        WHERE p.id = $1`,
      [projectId]
    )
  ).rows[0];
  if (!proj) throw notFound("dự án R&D");

  // 1. DHF Deliverable metrics
  const dhfStats = (
    await tx.query(
      `SELECT count(*)::int AS total_req,
              count(*) FILTER (WHERE gd.status IN ('SUBMITTED', 'ACCEPTED'))::int AS done_req
         FROM rd.gate_deliverable gd
         JOIN rd.project_gate pg ON pg.id = gd.project_gate_id
        WHERE pg.project_id = $1 AND gd.is_required = true`,
      [projectId]
    )
  ).rows[0];

  // 2. TPP Spec metrics
  const tppStats = (
    await tx.query(
      `SELECT count(*)::int AS total_specs,
              count(*) FILTER (WHERE result = 'PASS')::int AS passed_specs,
              count(*) FILTER (WHERE result = 'FAIL')::int AS failed_specs
         FROM rd.spec_evaluation
        WHERE project_id = $1`,
      [projectId]
    )
  ).rows[0];

  // 3. WBS Tasks
  const tasks = (
    await tx.query(
      `SELECT t.*,
              e.code AS experiment_code,
              e.title AS experiment_title,
              e.status AS experiment_status,
              e.conclusion AS experiment_conclusion
         FROM rd.project_task t
         LEFT JOIN rd.experiment e ON e.id = t.linked_experiment_id
        WHERE t.project_id = $1
        ORDER BY t.gate_no ASC, t.due_date ASC NULLS LAST, t.created_at ASC`,
      [projectId]
    )
  ).rows;

  // Project Experiments list for linking to WBS tasks
  const experiments = (
    await tx.query(
      `SELECT e.id, e.code, e.title, e.status, e.revision, e.conclusion,
              coalesce(nullif(e.performer_name, ''), up.display_name, 'Nghiên cứu viên R&D') AS performer_name,
              e.wbs_task_code, e.created_at
         FROM rd.experiment e
         LEFT JOIN core.user_profile up ON up.user_id = e.created_by
        WHERE e.project_id = $1
        ORDER BY e.created_at DESC`,
      [projectId]
    )
  ).rows;

  // 4. Unified Material Ledger:
  // 4a. Materials consumed via ELN Experiments
  const elnMaterials = (
    await tx.query(
      `SELECT em.id,
              'ELN_EXPERIMENT' AS entry_type,
              e.code AS ref_code,
              e.title AS ref_title,
              i.id AS item_id,
              i.code AS item_code,
              i.name AS item_name,
              l.code AS lot_code,
              em.qty::float AS qty,
              em.uom,
              em.role_in_exp AS purpose,
              sd.code AS document_code,
              up.display_name AS actor_name,
              COALESCE(sd.created_at, e.created_at) AS created_at,
              0::float AS estimated_cost
         FROM rd.experiment_material em
         JOIN rd.experiment e ON e.id = em.experiment_id
         JOIN master.item i ON i.id = em.item_id
         LEFT JOIN inv.lot l ON l.id = em.lot_id
         LEFT JOIN inv.stock_document sd ON sd.id = em.stock_document_id
         LEFT JOIN core.user_profile up ON up.user_id = e.created_by
        WHERE e.project_id = $1
        ORDER BY COALESCE(sd.created_at, e.created_at) DESC`,
      [projectId]
    )
  ).rows;

  // 4b. Direct Project Ledger entries (DIRECT_ISSUE, PR_REQUEST, OLIGO_TRIAL)
  const directLedger = (
    await tx.query(
      `SELECT pml.id,
              pml.entry_type,
              pml.gate_no,
              pml.ref_code,
              pml.purpose AS ref_title,
              i.id AS item_id,
              i.code AS item_code,
              i.name AS item_name,
              l.code AS lot_code,
              pml.qty::float AS qty,
              pml.uom,
              pml.purpose,
              pml.ref_code AS document_code,
              up.display_name AS actor_name,
              pml.created_at,
              pml.estimated_cost::float AS estimated_cost
         FROM rd.project_material_ledger pml
         LEFT JOIN master.item i ON i.id = pml.item_id
         LEFT JOIN inv.lot l ON l.id = pml.lot_id
         LEFT JOIN core.user_profile up ON up.user_id = pml.created_by
        WHERE pml.project_id = $1
        ORDER BY pml.created_at DESC`,
      [projectId]
    )
  ).rows;

  const allLedger = [...directLedger, ...elnMaterials].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  // Aggregate by item for Material Consumption Summary table
  const summaryMap = new Map<
    string,
    {
      item_id: string;
      item_code: string;
      item_name: string;
      uom: string;
      qty_eln: number;
      qty_direct: number;
      qty_pr: number;
      total_consumed: number;
      tx_count: number;
    }
  >();

  for (const row of allLedger) {
    if (!row.item_code) continue;
    const key = `${row.item_code}::${row.uom || ""}`;
    const cur = summaryMap.get(key) ?? {
      item_id: row.item_id,
      item_code: row.item_code,
      item_name: row.item_name,
      uom: row.uom || "",
      qty_eln: 0,
      qty_direct: 0,
      qty_pr: 0,
      total_consumed: 0,
      tx_count: 0,
    };
    const q = Number(row.qty || 0);
    if (row.entry_type === "ELN_EXPERIMENT") {
      cur.qty_eln += q;
      cur.total_consumed += q;
    } else if (row.entry_type === "DIRECT_ISSUE") {
      cur.qty_direct += q;
      cur.total_consumed += q;
    } else if (row.entry_type === "PR_REQUEST") {
      cur.qty_pr += q;
    }
    cur.tx_count += 1;
    summaryMap.set(key, cur);
  }

  // 5. Prototype BOM with live stock in KHO-RD & factory warehouses
  const prototypeBom = (
    await tx.query(
      `SELECT pb.*,
              i.code AS item_code,
              i.name AS item_name,
              i.item_type,
              COALESCE((
                SELECT SUM(sb.qty_on_hand - sb.qty_reserved)
                  FROM inv.stock_balance sb
                  JOIN inv.lot l ON l.id = sb.lot_id
                  JOIN master.location loc ON loc.id = sb.location_id
                 WHERE sb.item_id = pb.component_item_id
                   AND l.status = 'RELEASED'
                   AND loc.is_quarantine = false
              ), 0)::float AS available_stock
         FROM rd.project_prototype_bom pb
         JOIN master.item i ON i.id = pb.component_item_id
        WHERE pb.project_id = $1
        ORDER BY pb.line_no ASC`,
      [projectId]
    )
  ).rows;

  const totalCost = allLedger.reduce((acc, r) => acc + Number(r.estimated_cost || 0), 0);
  const totalTasks = tasks.length;
  const doneTasks = tasks.filter((t) => t.status === "DONE").length;

  return {
    project_id: projectId,
    budget_amount: Number(proj.budget_amount ?? 50000000),
    estimated_spent: totalCost,
    target_product_item_id: proj.target_product_item_id,
    target_product_code: proj.target_product_code,
    target_product_name: proj.target_product_name,
    scorecard: {
      dhf_total: Number(dhfStats?.total_req ?? 0),
      dhf_done: Number(dhfStats?.done_req ?? 0),
      dhf_pct:
        Number(dhfStats?.total_req ?? 0) > 0
          ? Math.round((Number(dhfStats.done_req) / Number(dhfStats.total_req)) * 100)
          : 0,
      tpp_total: Number(tppStats?.total_specs ?? 0),
      tpp_passed: Number(tppStats?.passed_specs ?? 0),
      tpp_failed: Number(tppStats?.failed_specs ?? 0),
      tpp_pct:
        Number(tppStats?.total_specs ?? 0) > 0
          ? Math.round((Number(tppStats.passed_specs) / Number(tppStats.total_specs)) * 100)
          : 0,
      tasks_total: totalTasks,
      tasks_done: doneTasks,
      tasks_pct: totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0,
      material_tx_count: allLedger.length,
    },
    tasks,
    experiments,
    material_ledger: allLedger,
    material_summary: Array.from(summaryMap.values()),
    prototype_bom: prototypeBom,
  };
}

const quickProjectSchema = z.object({
  // department running the project: R&D by default, KTCN (module DEVICE) for its software and device projects
  owner_module: z.enum(["RD", "DEVICE"]).default("RD"),
  project_type: z.enum(["NEW_PRODUCT", "IMPROVEMENT", "PROCESS", "RESEARCH"]).default("NEW_PRODUCT"),
  target_domain: z.enum(["KIT", "OLIGO", "DEVICE", "SOFTWARE", "OTHER"]).default("KIT"),
  ivd_class: z.enum(["CLASS_A", "CLASS_B", "CLASS_C", "CLASS_D", "RUO", "NA"]).default("CLASS_B"),
  name: z.string().trim().min(3, "Nhập tên dự án R&D").max(250),
  leader_name: z.string().trim().max(150).optional().nullable(),
  target_product_item_id: z.string().uuid().optional().nullable(),
  budget_amount: z.coerce.number().min(0).default(50000000),
  planned_start: z.string().optional().nullable(),
  planned_end: z.string().optional().nullable(),
  description: z.string().trim().max(2000).optional().nullable(),
});

/**
 * Directly creates an R&D Project (New Product or Product Improvement) with full 5-Gate Stage-Gate
 * deliverables and initial WBS tasks.
 */
export async function createQuickRdProject(tx: Tx, actor: AuthzActor, input: unknown) {
  await ensureRdProjectOpsSchema(tx);
  const data = parseInput(quickProjectSchema, input);

  const rdUnit = (
    await tx.query("SELECT id FROM core.org_unit WHERE module_key = $1 AND status = 'ACTIVE' LIMIT 1", [data.owner_module])
  ).rows[0];
  if (!rdUnit) throw invalid(data.owner_module === "DEVICE" ? "Chưa cấu hình Phòng Kỹ thuật Công nghệ (KTCN)." : "Chưa cấu hình Phòng Nghiên cứu & Phát triển (R&D).");

  const project = await createProject(tx, actor, {
    name: data.name,
    owner_org_unit_id: rdUnit.id,
    project_type: data.project_type,
    target_domain: data.target_domain,
    ivd_class: data.ivd_class,
    planned_start: data.planned_start || vnToday(),
    planned_end: data.planned_end || null,
    description: data.description ?? null,
  });

  const leadName = data.leader_name?.trim() || actor.name || null;
  await tx.query(
    "UPDATE rd.project SET budget_amount = $2, target_product_item_id = $3, leader_name_override = $4 WHERE id = $1",
    [project.id, data.budget_amount, data.target_product_item_id ?? null, leadName]
  );
  const code = project.code;

  await writeAudit(tx, actor, {
    entityType: "rd_project",
    entityId: project.id,
    action: "create_quick_project",
    changes: { code: [null, code], type: [null, data.project_type] },
  });

  return project;
}

const taskMetricItemSchema = z.object({
  label: z.string().trim().min(1).max(120),
  value: z.string().trim().min(1).max(120),
  unit: z.string().trim().max(40).optional().nullable(),
  target: z.string().trim().max(120).optional().nullable(),
});

const taskSchema = z.object({
  task_id: z.string().uuid().optional().nullable(),
  project_id: z.string().uuid(),
  gate_no: z.coerce.number().int().min(0).max(10).default(1),
  title: z.string().trim().min(2, "Nhập tên công việc WBS").max(250),
  assignee_name: z.string().trim().max(150).optional().nullable(),
  due_date: z.string().optional().nullable(),
  status: z.enum(["TODO", "IN_PROGRESS", "DONE", "BLOCKED"]).default("TODO"),
  progress_pct: z.coerce.number().int().min(0).max(100).default(0),
  linked_experiment_id: z.string().uuid().optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  protocol_summary: z.string().trim().max(4000).optional().nullable(),
  result_summary: z.string().trim().max(4000).optional().nullable(),
  key_metrics_json: z.array(taskMetricItemSchema).max(20).optional().default([]),
  outcome_verdict: z.enum(["PENDING", "PASS", "OPTIMIZE", "FAIL"]).optional().default("PENDING"),
  next_steps: z.string().trim().max(2000).optional().nullable(),
  attachment_name: z.string().trim().max(255).optional().nullable(),
  attachment_url: z.string().optional().nullable(),
  sync_to_eln: z.boolean().optional().default(true),
});

export async function saveProjectTask(tx: Tx, actor: AuthzActor, input: unknown) {
  await ensureRdProjectOpsSchema(tx);
  const d = parseInput(taskSchema, input);
  const p = (await tx.query("SELECT id, code, owner_org_unit_id FROM rd.project WHERE id = $1", [d.project_id])).rows[0];
  if (!p) throw notFound("dự án R&D");
  await authorize(tx, actor, "rd.project.manage", p.owner_org_unit_id);

  const pct = d.status === "DONE" ? 100 : d.progress_pct;
  const metricsJson = JSON.stringify(d.key_metrics_json ?? []);
  let row;
  if (!d.task_id) {
    const cnt = Number(
      (await tx.query("SELECT count(*)::int AS c FROM rd.project_task WHERE project_id = $1", [d.project_id])).rows[0]?.c ?? 0
    );
    const code = `${p.code}-WBS-${String(cnt + 1).padStart(2, "0")}`;
    row = (
      await tx.query(
        `INSERT INTO rd.project_task
           (code, project_id, gate_no, title, assignee_name, due_date, status, progress_pct, linked_experiment_id, notes,
            protocol_summary, result_summary, key_metrics_json, outcome_verdict, next_steps, attachment_name, attachment_url,
            completed_at, completed_by_name, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14, $15, $16, $17, $18, $19, $20, $20)
         RETURNING *`,
        [
          code,
          d.project_id,
          d.gate_no,
          d.title,
          d.assignee_name || actor.name,
          d.due_date || null,
          d.status,
          pct,
          d.linked_experiment_id || null,
          d.notes ?? null,
          d.protocol_summary ?? null,
          d.result_summary ?? null,
          metricsJson,
          d.outcome_verdict ?? "PENDING",
          d.next_steps ?? null,
          d.attachment_name ?? null,
          d.attachment_url ?? null,
          d.status === "DONE" ? new Date() : null,
          d.status === "DONE" ? (d.assignee_name || actor.name) : null,
          actor.userId,
        ]
      )
    ).rows[0];
  } else {
    const existing = (await tx.query("SELECT * FROM rd.project_task WHERE id = $1 AND project_id = $2", [d.task_id, d.project_id])).rows[0];
    if (!existing) throw notFound("công việc WBS");
    const rawIn = (input ?? {}) as Record<string, unknown>;
    const keepProtocol = rawIn.protocol_summary !== undefined ? (d.protocol_summary ?? null) : existing.protocol_summary;
    const keepResult = rawIn.result_summary !== undefined ? (d.result_summary ?? null) : existing.result_summary;
    const keepMetrics = rawIn.key_metrics_json !== undefined ? metricsJson : JSON.stringify(existing.key_metrics_json ?? []);
    const keepVerdict = rawIn.outcome_verdict !== undefined ? d.outcome_verdict : (existing.outcome_verdict || "PENDING");
    const keepNextSteps = rawIn.next_steps !== undefined ? (d.next_steps ?? null) : existing.next_steps;
    const keepAttName = rawIn.attachment_name !== undefined ? (d.attachment_name ?? null) : existing.attachment_name;
    const keepAttUrl = rawIn.attachment_url !== undefined ? (d.attachment_url ?? null) : existing.attachment_url;
    const keepExpId = rawIn.linked_experiment_id !== undefined ? (d.linked_experiment_id || null) : existing.linked_experiment_id;
    const keepNotes = rawIn.notes !== undefined ? (d.notes ?? null) : existing.notes;

    row = (
      await tx.query(
        `UPDATE rd.project_task
            SET gate_no = $2, title = $3, assignee_name = $4, due_date = $5,
                status = $6, progress_pct = $7, linked_experiment_id = $8, notes = $9,
                protocol_summary = $10, result_summary = $11, key_metrics_json = $12::jsonb,
                outcome_verdict = $13, next_steps = $14, attachment_name = $15, attachment_url = $16,
                completed_at = CASE WHEN $6 = 'DONE' THEN coalesce(completed_at, now()) ELSE completed_at END,
                completed_by_name = CASE WHEN $6 = 'DONE' THEN coalesce($4, completed_by_name, $17) ELSE completed_by_name END,
                updated_at = now(), updated_by = $18
          WHERE id = $1 AND project_id = $19
          RETURNING *`,
        [
          d.task_id,
          d.gate_no,
          d.title,
          d.assignee_name || null,
          d.due_date || null,
          d.status,
          pct,
          keepExpId,
          keepNotes,
          keepProtocol,
          keepResult,
          keepMetrics,
          keepVerdict,
          keepNextSteps,
          keepAttName,
          keepAttUrl,
          actor.name,
          actor.userId,
          d.project_id,
        ]
      )
    ).rows[0];
  }

  // Synchronize structured result to linked ELN Experiment if present
  if (d.sync_to_eln && row?.linked_experiment_id && (row.result_summary || (Array.isArray(d.key_metrics_json) && d.key_metrics_json.length > 0))) {
    const exp = (await tx.query("SELECT * FROM rd.experiment WHERE id = $1", [row.linked_experiment_id])).rows[0];
    if (exp && ["PLANNED", "IN_PROGRESS", "SUBMITTED"].includes(exp.status)) {
      const seq = Number(
        (await tx.query("SELECT coalesce(max(seq), 0) + 1 AS s FROM rd.experiment_entry WHERE experiment_id = $1", [exp.id])).rows[0]?.s ?? 1
      );
      const metricsText = Array.isArray(d.key_metrics_json) && d.key_metrics_json.length
        ? d.key_metrics_json.map((m) => `${m.label}: ${m.value}${m.unit ? " " + m.unit : ""}${m.target ? ` (Mục tiêu: ${m.target})` : ""}`).join(" · ")
        : "";
      const bodyText = [row.result_summary, metricsText ? `[Số liệu định lượng] ${metricsText}` : "", row.next_steps ? `[Hướng tiếp theo] ${row.next_steps}` : ""]
        .filter(Boolean)
        .join("\n");
      await tx.query(
        `INSERT INTO rd.experiment_entry (experiment_id, seq, entry_type, title, content, created_by)
         VALUES ($1, $2, 'RESULT', $3, $4::jsonb, $5)`,
        [
          exp.id,
          seq,
          `[Đồng bộ từ WBS ${row.code}] Kết quả & Số liệu thực nghiệm (${row.outcome_verdict})`,
          JSON.stringify({ text: bodyText, metrics: d.key_metrics_json ?? [], verdict: row.outcome_verdict, wbs_code: row.code }),
          actor.userId,
        ]
      );
      await tx.query(
        `UPDATE rd.experiment
            SET conclusion = coalesce($2, conclusion),
                protocol_summary = coalesce($3, protocol_summary),
                performer_name = coalesce($4, performer_name),
                wbs_task_code = $5,
                status = CASE WHEN status = 'PLANNED' THEN 'IN_PROGRESS' ELSE status END,
                started_at = coalesce(started_at, now())
          WHERE id = $1`,
        [exp.id, row.result_summary || null, row.protocol_summary || null, row.assignee_name || null, row.code]
      );
    }
  }

  return row;
}

const createTaskExperimentSchema = z.object({
  project_id: z.string().uuid(),
  task_id: z.string().uuid(),
});

/**
 * 1-Click creates a new ELN Experiment (`rd.experiment`) directly from a WBS Task (`rd.project_task`),
 * pre-populating Objective, Protocol, Performer, and initial Result Entry, and linking them 2-way.
 */
export async function createExperimentFromProjectTask(tx: Tx, actor: AuthzActor, input: unknown) {
  await ensureRdProjectOpsSchema(tx);
  const d = parseInput(createTaskExperimentSchema, input);
  const p = (await tx.query("SELECT * FROM rd.project WHERE id = $1", [d.project_id])).rows[0];
  if (!p) throw notFound("dự án R&D");
  await authorize(tx, actor, "rd.eln.write", p.owner_org_unit_id);

  const task = (await tx.query("SELECT * FROM rd.project_task WHERE id = $1 AND project_id = $2 FOR UPDATE", [d.task_id, d.project_id])).rows[0];
  if (!task) throw notFound("công việc WBS");

  const expCode = await nextNumber(tx, "RD_EXPERIMENT");
  const expTitle = `[${task.code}] ${task.title}`;
  const expObjective = `Thực hiện công việc WBS ${task.code} (Cổng G${task.gate_no}): ${task.title}`;
  const expProtocol = task.protocol_summary || `Theo quy trình khảo sát thực nghiệm của dự án ${p.code} (Giai đoạn G${task.gate_no}).`;
  const performer = task.assignee_name || actor.name || "Nghiên cứu viên R&D";

  const exp = (
    await tx.query(
      `INSERT INTO rd.experiment
         (code, project_id, title, objective, hypothesis, protocol_summary, conclusion,
          status, revision, started_at, performer_name, wbs_task_code, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'IN_PROGRESS', 1, now(), $8, $9, $10, $10)
       RETURNING *`,
      [
        expCode,
        p.id,
        expTitle,
        expObjective,
        `Xác minh chỉ tiêu kỹ thuật của hạng mục ${task.code} đạt yêu cầu thiết kế TPP.`,
        expProtocol,
        task.result_summary || null,
        performer,
        task.code,
        actor.userId,
      ]
    )
  ).rows[0];

  if (task.result_summary) {
    await tx.query(
      `INSERT INTO rd.experiment_entry (experiment_id, seq, entry_type, title, content, created_by)
       VALUES ($1, 1, 'RESULT', $2, $3::jsonb, $4)`,
      [
        exp.id,
        `Ghi nhận kết quả ban đầu từ công việc ${task.code}`,
        JSON.stringify({
          text: task.result_summary,
          metrics: task.key_metrics_json ?? [],
          verdict: task.outcome_verdict ?? "PENDING",
        }),
        actor.userId,
      ]
    );
  }

  await tx.query(
    `UPDATE rd.project_task
        SET linked_experiment_id = $2,
            status = CASE WHEN status = 'TODO' THEN 'IN_PROGRESS' ELSE status END,
            progress_pct = CASE WHEN progress_pct < 30 THEN 50 ELSE progress_pct END,
            updated_at = now(),
            updated_by = $3
      WHERE id = $1`,
    [task.id, exp.id, actor.userId]
  );

  await writeAudit(tx, actor, {
    entityType: "rd_experiment",
    entityId: exp.id,
    action: "create_from_wbs_task",
    changes: { code: [null, exp.code], wbs_task_code: [null, task.code] },
  });

  return { experiment_id: exp.id, experiment_code: exp.code, task_code: task.code };
}

const projectIssueSchema = z.object({
  project_id: z.string().uuid(),
  gate_no: z.coerce.number().int().min(0).max(10).default(1),
  warehouse_id: z.string().uuid().optional().nullable(),
  item_id: z.string().uuid(),
  qty: z.coerce.number().positive("Số lượng xuất phải > 0"),
  estimated_cost: z.coerce.number().min(0).default(0),
  purpose: z.string().trim().min(2, "Nhập mục đích sử dụng cho dự án").max(500),
});

/**
 * Issues stock from KHO-RD (or selected warehouse) via FEFO directly for an R&D Project
 * and records it in `rd.project_material_ledger`.
 */
export async function issueMaterialForProject(tx: Tx, actor: AuthzActor, input: unknown) {
  await ensureRdProjectOpsSchema(tx);
  const d = parseInput(projectIssueSchema, input);
  const p = (await tx.query("SELECT id, code, name, owner_org_unit_id FROM rd.project WHERE id = $1", [d.project_id])).rows[0];
  if (!p) throw notFound("dự án R&D");
  await authorize(tx, actor, "rd.project.manage", p.owner_org_unit_id);

  const item = (await tx.query("SELECT id, code, name, base_uom FROM master.item WHERE id = $1", [d.item_id])).rows[0];
  if (!item) throw notFound("vật tư / hóa chất");

  // Find warehouse (prefer KHO-RD if not passed, or any warehouse with stock)
  let whId = d.warehouse_id;
  if (!whId) {
    const wh = (
      await tx.query(
        `SELECT loc.warehouse_id
           FROM inv.stock_balance sb
           JOIN inv.lot l ON l.id = sb.lot_id
           JOIN master.location loc ON loc.id = sb.location_id
           JOIN master.warehouse w ON w.id = loc.warehouse_id
          WHERE sb.item_id = $1 AND l.status = 'RELEASED' AND loc.is_quarantine = false
            AND (sb.qty_on_hand - sb.qty_reserved) > 0
          ORDER BY CASE WHEN w.code = 'KHO-RD' THEN 0 ELSE 1 END, (sb.qty_on_hand - sb.qty_reserved) DESC
          LIMIT 1`,
        [d.item_id]
      )
    ).rows[0];
    whId = wh?.warehouse_id;
  }
  if (!whId) throw invalid(`Vật tư ${item.code} hiện không có tồn kho khả dụng (RELEASED) để xuất cho dự án.`);

  const cands = await findCandidates(tx, item.id, [whId], { lock: true });
  const plan = allocate(cands, d.qty);
  if (plan.shortfall > 1e-9) {
    throw invalid(`Không đủ tồn kho khả dụng cho ${item.code} (còn thiếu ${plan.shortfall} ${item.base_uom}).`);
  }

  const doc = await createStockDocument(
    tx,
    actor,
    {
      doc_type: "ISSUE",
      reason_code: "RD_EXPERIMENT",
      warehouse_id: whId,
      source_entity_type: "RD_PROJECT",
      source_entity_id: p.id,
      notes: `[Dự án ${p.code} · G${d.gate_no}] ${d.purpose}`,
      lines: plan.picks.map((pk) => ({
        item_id: item.id,
        lot_id: pk.candidate.lot_id,
        from_location_id: pk.candidate.location_id,
        qty: pk.qty,
        uom: item.base_uom,
      })),
    },
    { trusted: true }
  );
  await runTransition(tx, stockDocumentMachine, actor, { id: doc.id, action: "post", expectedVersion: doc.version }, { trusted: true });

  const ledger = (
    await tx.query(
      `INSERT INTO rd.project_material_ledger
         (project_id, gate_no, entry_type, item_id, lot_id, qty, uom, estimated_cost, ref_code, ref_entity_id, purpose, created_by)
       VALUES ($1, $2, 'DIRECT_ISSUE', $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        p.id,
        d.gate_no,
        item.id,
        plan.picks[0]?.candidate.lot_id ?? null,
        d.qty,
        item.base_uom,
        d.estimated_cost,
        doc.code,
        doc.id,
        d.purpose,
        actor.userId,
      ]
    )
  ).rows[0];

  return { document_code: doc.code, ledger };
}

const projectPrSchema = z.object({
  project_id: z.string().uuid(),
  gate_no: z.coerce.number().int().min(0).max(10).default(1),
  needed_by_date: z.string().optional().nullable(),
  estimated_cost: z.coerce.number().min(0).default(0),
  purpose: z.string().trim().min(3, "Nhập lý do đề nghị mua cho dự án").max(500),
  lines: z
    .array(
      z.object({
        item_id: z.string().uuid(),
        qty: z.coerce.number().positive(),
        note: z.string().optional().nullable(),
      })
    )
    .min(1),
});

/**
 * Creates a Purchase Request (PR) linked to a specific R&D Project and logs each line in `rd.project_material_ledger`.
 */
export async function createPrForProject(tx: Tx, actor: AuthzActor, input: unknown) {
  await ensureRdProjectOpsSchema(tx);
  const d = parseInput(projectPrSchema, input);
  const p = (await tx.query("SELECT id, code, name, owner_org_unit_id FROM rd.project WHERE id = $1", [d.project_id])).rows[0];
  if (!p) throw notFound("dự án R&D");
  await authorize(tx, actor, "rd.project.manage", p.owner_org_unit_id);

  const itemsMap = new Map<string, { id: string; code: string; base_uom: string }>();
  for (const l of d.lines) {
    const it = (await tx.query("SELECT id, code, base_uom FROM master.item WHERE id = $1", [l.item_id])).rows[0];
    if (!it) throw notFound("vật tư");
    itemsMap.set(l.item_id, it);
  }

  for (const l of d.lines) {
    await tx.query("UPDATE master.item SET is_purchasable = true WHERE id = $1", [l.item_id]);
  }
  const rdWh = (
    await tx.query("SELECT id FROM master.warehouse WHERE owner_org_unit_id = $1 AND status = 'ACTIVE' ORDER BY code LIMIT 1", [
      p.owner_org_unit_id,
    ])
  ).rows[0];

  const pr = await createRequest(tx, actor, {
    org_unit_id: p.owner_org_unit_id,
    target_warehouse_id: rdWh?.id ?? null,
    needed_by: d.needed_by_date || vnToday(),
    reason: `[Dự án R&D ${p.code} - ${p.name}] ${d.purpose}`,
    purpose_entity_type: "RD_PROJECT",
    purpose_entity_id: p.id,
    lines: d.lines.map((l) => ({
      item_id: l.item_id,
      qty: l.qty,
      uom: itemsMap.get(l.item_id)!.base_uom,
      est_price: d.lines.length > 0 ? Number(d.estimated_cost || 0) / d.lines.length : 0,
      notes: l.note || `Phục vụ Dự án ${p.code} (G${d.gate_no})`,
    })),
  });
  await tx.query("UPDATE purchase.purchase_request SET status = 'SUBMITTED', version = version + 1 WHERE id = $1", [pr.id]);

  const costPerLine = d.lines.length > 0 ? Number(d.estimated_cost || 0) / d.lines.length : 0;
  for (const l of d.lines) {
    const it = itemsMap.get(l.item_id)!;
    await tx.query(
      `INSERT INTO rd.project_material_ledger
         (project_id, gate_no, entry_type, item_id, qty, uom, estimated_cost, ref_code, ref_entity_id, purpose, created_by)
       VALUES ($1, $2, 'PR_REQUEST', $3, $4, $5, $6, $7, $8, $9, $10)`,
      [p.id, d.gate_no, it.id, l.qty, it.base_uom, costPerLine, pr.code, pr.id, d.purpose, actor.userId]
    );
  }

  return { pr_code: pr.code, pr_id: pr.id };
}

const projectOligoTrialSchema = z.object({
  project_id: z.string().uuid(),
  gate_no: z.coerce.number().int().min(0).max(10).default(1),
  scale_code: z.string().default("200NMOL"),
  purification: z.enum(["DESALT", "OPC", "HPLC", "PAGE"]).default("DESALT"),
  sequences_text: z.string().trim().min(5, "Nhập ít nhất 1 trình tự mồi/probe thử nghiệm"),
  purpose: z.string().trim().min(2).max(500).default("Tổng hợp mồi Primer/Probe thử nghiệm cho Dự án R&D"),
});

/**
 * Places an internal Oligo Synthesis Order directly from an R&D Project and logs it in `rd.project_material_ledger`.
 */
export async function createOligoTrialForProject(tx: Tx, actor: AuthzActor, input: unknown) {
  await ensureRdProjectOpsSchema(tx);
  const d = parseInput(projectOligoTrialSchema, input);
  const p = (await tx.query("SELECT id, code, name, owner_org_unit_id FROM rd.project WHERE id = $1", [d.project_id])).rows[0];
  if (!p) throw notFound("dự án R&D");
  await authorize(tx, actor, "rd.project.manage", p.owner_org_unit_id);

  const oligoDept = (
    await tx.query("SELECT id FROM core.org_unit WHERE module_key = 'OLIGO' AND status = 'ACTIVE' LIMIT 1")
  ).rows[0];
  if (!oligoDept) throw invalid("Chưa cấu hình Phòng Tổng hợp Oligo.");

  const order = await createOligoOrder(tx, actor, {
    org_unit_id: oligoDept.id,
    customer_label: `[R&D ${p.code}] ${p.name}`,
    notes: `${d.purpose} (Giai đoạn G${d.gate_no})`,
  });

  const added = await addSequences(tx, actor, order.id, {
    text: d.sequences_text,
    defaults: {
      scale_code: d.scale_code,
      purification: d.purification,
      format: "LYOPHILIZED",
      target_pathogen: p.code,
    },
  });

  const seqCount = Number(added.added ?? 1);
  await tx.query(
    `INSERT INTO rd.project_material_ledger
       (project_id, gate_no, entry_type, qty, uom, estimated_cost, ref_code, ref_entity_id, purpose, created_by)
     VALUES ($1, $2, 'OLIGO_TRIAL', $3, 'trình tự', $4, $5, $6, $7, $8)`,
    [p.id, d.gate_no, seqCount, seqCount * 350000, order.code, order.id, `${d.purpose} (${seqCount} ống Oligo)`, actor.userId]
  );

  return { oligo_order_code: order.code, sequence_count: seqCount };
}

const prototypeBomSchema = z.object({
  project_id: z.string().uuid(),
  target_product_item_id: z.string().uuid().optional().nullable(),
  lines: z
    .array(
      z.object({
        component_item_id: z.string().uuid(),
        component_role: z.string().trim().min(1).max(50).default("REAGENT"),
        qty_per_base: z.coerce.number().positive(),
        uom: z.string().trim().min(1).max(30),
        scrap_pct: z.coerce.number().min(0).max(100).default(0),
        notes: z.string().trim().max(500).optional().nullable(),
      })
    )
    .min(1, "Cần ít nhất 1 dòng thành phần trong công thức Prototype BOM"),
});

export async function savePrototypeBom(tx: Tx, actor: AuthzActor, input: unknown) {
  await ensureRdProjectOpsSchema(tx);
  const d = parseInput(prototypeBomSchema, input);
  const p = (await tx.query("SELECT id, owner_org_unit_id FROM rd.project WHERE id = $1", [d.project_id])).rows[0];
  if (!p) throw notFound("dự án R&D");
  await authorize(tx, actor, "rd.project.manage", p.owner_org_unit_id);

  if (d.target_product_item_id !== undefined) {
    await tx.query("UPDATE rd.project SET target_product_item_id = $2, updated_at = now() WHERE id = $1", [
      d.project_id,
      d.target_product_item_id || null,
    ]);
  }

  await tx.query("DELETE FROM rd.project_prototype_bom WHERE project_id = $1", [d.project_id]);
  for (let i = 0; i < d.lines.length; i++) {
    const l = d.lines[i];
    await tx.query(
      `INSERT INTO rd.project_prototype_bom
         (project_id, line_no, component_item_id, component_role, qty_per_base, uom, scrap_pct, notes, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)`,
      [
        d.project_id,
        i + 1,
        l.component_item_id,
        l.component_role,
        l.qty_per_base,
        l.uom,
        l.scrap_pct,
        l.notes ?? null,
        actor.userId,
      ]
    );
  }

  return { saved_lines: d.lines.length };
}

const oneClickTransferSchema = z.object({
  project_id: z.string().uuid(),
  title: z.string().trim().min(3).max(250).optional(),
  pilot_lot_ref: z.string().trim().max(100).optional().nullable(),
  stability_summary: z.string().trim().max(2000).optional().nullable(),
  validation_summary: z.string().trim().max(2000).optional().nullable(),
});

/**
 * 1-Click Tech Transfer Package Builder from R&D Project:
 * Automatically packages the Project's Prototype BOM + Passed TPP Parameters + SOP steps
 * into `rd.tech_transfer_package` AND creates/updates a DRAFT `kit.bom` (if target_domain === 'KIT' and target_product_item_id is set).
 */
export async function createTransferFromProjectBom(tx: Tx, actor: AuthzActor, input: unknown) {
  await ensureRdProjectOpsSchema(tx);
  const d = parseInput(oneClickTransferSchema, input);
  const p = (
    await tx.query("SELECT * FROM rd.project WHERE id = $1", [d.project_id])
  ).rows[0];
  if (!p) throw notFound("dự án R&D");
  await authorize(tx, actor, "rd.project.manage", p.owner_org_unit_id);

  const bomLines = (
    await tx.query(
      `SELECT pb.*, i.code AS item_code, i.name AS item_name
         FROM rd.project_prototype_bom pb
         JOIN master.item i ON i.id = pb.component_item_id
        WHERE pb.project_id = $1
        ORDER BY pb.line_no ASC`,
      [p.id]
    )
  ).rows;
  if (!bomLines.length) {
    throw invalid("Dự án chưa khai báo Công thức / Định mức Thử nghiệm (Prototype BOM). Vui lòng thêm ít nhất 1 thành phần trước khi chuyển giao.");
  }

  const targetDomain = ["KIT", "OLIGO", "DEVICE", "SOFTWARE"].includes(p.target_domain) ? p.target_domain : "KIT";
  const targetDept = (
    await tx.query("SELECT id FROM core.org_unit WHERE module_key = $1 AND status = 'ACTIVE' LIMIT 1", [
      targetDomain === "SOFTWARE" ? "DEVICE" : targetDomain,
    ])
  ).rows[0];
  if (!targetDept) throw invalid(`Không tìm thấy phòng ban nhận chuyển giao cho mảng ${targetDomain}.`);

  const specs = (
    await tx.query("SELECT * FROM rd.spec_evaluation WHERE project_id = $1 ORDER BY category, parameter", [p.id])
  ).rows;

  const pkgCode = await nextNumber(tx, "RD_TRANSFER");
  const bomSpecJson = bomLines.map((l) => ({
    line_no: l.line_no,
    item_id: l.component_item_id,
    item_code: l.item_code,
    item_name: l.item_name,
    role: l.component_role,
    qty_per_base: Number(l.qty_per_base),
    uom: l.uom,
    scrap_pct: Number(l.scrap_pct),
    notes: l.notes,
  }));

  const routingJson = [
    { seq: 1, step_code: "STEP-PREP", step_name: "Chuẩn bị & Kiểm tra bán thành phẩm theo hồ sơ R&D", instructions: "Kiểm tra điều kiện nhiệt độ và rã đông hóa chất trên block lạnh." },
    { seq: 2, step_code: "STEP-MIX-FILL", step_name: "Pha chế theo định mức Prototype BOM & Chiết rót", instructions: "Pha trộn theo tỷ lệ BOM đã chốt và lấy mẫu QC bán thành phẩm." },
    { seq: 3, step_code: "STEP-QC-RELEASE", step_name: "Kiểm định FQC theo bảng chỉ tiêu TPP & Đóng gói", instructions: "Đối chiếu kết quả QC với ma trận TPP của dự án." },
  ];

  const autoValSummary =
    d.validation_summary ||
    (specs.length
      ? `Đã đánh giá ${specs.length} chỉ tiêu thiết kế TPP (${specs.filter((s) => s.result === "PASS").length} chỉ tiêu PASS): ` +
        specs.map((s) => `${s.parameter}: mục tiêu ${s.target_value} / thực tế ${s.actual_value || s.target_value}`).join("; ")
      : "Hoàn thành thẩm định hiệu năng tại phòng R&D theo hồ sơ DHF.");

  const pkg = (
    await tx.query(
      `INSERT INTO rd.tech_transfer_package
         (code, project_id, target_domain, target_org_unit_id, title, product_item_id,
          bom_specification, routing_steps, stability_summary, validation_summary,
          pilot_lot_ref, status, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11, 'DRAFT', $12, $12)
       RETURNING *`,
      [
        pkgCode,
        p.id,
        targetDomain,
        targetDept.id,
        d.title || `Gói chuyển giao công nghệ dự án [${p.code}] ${p.name}`,
        p.target_product_item_id ?? null,
        JSON.stringify(bomSpecJson),
        JSON.stringify(routingJson),
        d.stability_summary || "Đạt độ ổn định cấp tốc và thời gian thực theo đề cương R&D.",
        autoValSummary,
        d.pilot_lot_ref || `PILOT-${p.code}-01`,
        actor.userId,
      ]
    )
  ).rows[0];

  // If targetDomain === 'KIT' and target_product_item_id is set, also auto-create a DRAFT kit.bom if none exists in DRAFT
  let createdKitBomCode: string | null = null;
  if (targetDomain === "KIT" && p.target_product_item_id) {
    const maxVer = Number(
      (
        await tx.query("SELECT coalesce(max(bom_version), 0) AS v FROM kit.bom WHERE product_item_id = $1", [
          p.target_product_item_id,
        ])
      ).rows[0]?.v ?? 0
    );
    const bomCode = `BOM-${p.code}-V${maxVer + 1}`;
    const kitBom = (
      await tx.query(
        `INSERT INTO kit.bom
           (code, org_unit_id, product_item_id, bom_version, name, base_qty, base_uom, tests_per_kit, shelf_life_days, status, notes, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, 1, 'KIT', 50, 365, 'DRAFT', $6, $7, $7)
         ON CONFLICT (code) DO NOTHING
         RETURNING id, code`,
        [
          bomCode,
          targetDept.id,
          p.target_product_item_id,
          maxVer + 1,
          `BOM chuyển giao từ R&D [${p.code}] ${p.name}`,
          `Tự động đẩy từ Công thức Prototype BOM của dự án ${p.code} (Gói ${pkgCode})`,
          actor.userId,
        ]
      )
    ).rows[0];

    if (kitBom) {
      createdKitBomCode = kitBom.code;
      for (const l of bomLines) {
        const validRole = [
          "MASTER_MIX",
          "PRIMER_PROBE",
          "ENZYME",
          "INTERNAL_CONTROL",
          "POSITIVE_CONTROL",
          "NEGATIVE_CONTROL",
          "EXTRACTION_BUFFER",
          "PCR_TUBE_STRIP",
          "PACKAGING",
          "SEMI_FINISHED",
          "REAGENT",
        ].includes(l.component_role)
          ? l.component_role
          : "REAGENT";
        await tx.query(
          `INSERT INTO kit.bom_line
             (bom_id, line_no, component_item_id, component_role, qty_per_base, uom, scrap_pct, is_mix_component, include_in_qc_retention, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, $9)`,
          [
            kitBom.id,
            l.line_no,
            l.component_item_id,
            validRole,
            l.qty_per_base,
            l.uom,
            l.scrap_pct,
            ["MASTER_MIX", "PRIMER_PROBE", "ENZYME"].includes(validRole),
            l.notes,
          ]
        );
      }
    }
  }

  return {
    transfer_id: pkg.id,
    transfer_code: pkg.code,
    created_kit_bom_code: createdKitBomCode,
  };
}
