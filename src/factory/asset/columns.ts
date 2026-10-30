import { z } from "zod";
import type { Tx } from "../core/db";
import { writeAudit } from "../core/audit";
import { authorizeAnywhere, type AuthzActor } from "../core/authz";
import { conflict, invalid, notFound } from "../core/errors";
import { parseInput } from "../core/records";

const columnSchema = z.object({
  code: z.string().trim().min(1, "nhập mã / serial cột").max(60),
  name: z.string().trim().min(1).max(200),
  asset_id: z.string().uuid().optional().nullable(),
  price_vnd: z.coerce.number().min(0),
  design_runs: z.coerce.number().int().positive("số lượt chạy thiết kế phải lớn hơn 0"),
});

/** A purification column (as OligoFlow's "Khấu hao cột HPLC"): price spread over its design number of runs. */
export async function createColumn(tx: Tx, actor: AuthzActor, input: unknown) {
  await authorizeAnywhere(tx, actor, "asset.manage");
  const d = parseInput(columnSchema, input);
  if ((await tx.query("SELECT 1 FROM asset.lc_column WHERE upper(code) = upper($1)", [d.code])).rowCount) throw conflict(`Đã có cột ${d.code}.`, "DUPLICATE");
  if (d.asset_id && !(await tx.query("SELECT 1 FROM asset.asset WHERE id = $1", [d.asset_id])).rowCount) throw notFound("thiết bị");
  const c = (
    await tx.query("INSERT INTO asset.lc_column (code, name, asset_id, price_vnd, design_runs, created_by, updated_by) VALUES ($1, $2, $3, $4, $5, $6, $6) RETURNING *", [
      d.code, d.name, d.asset_id ?? null, d.price_vnd, d.design_runs, actor.userId,
    ])
  ).rows[0];
  await writeAudit(tx, actor, { entityType: "lc_column", entityId: c.id, action: "create", changes: { code: [null, d.code], price_vnd: [null, d.price_vnd], design_runs: [null, d.design_runs] } });
  return c;
}

export async function retireColumn(tx: Tx, actor: AuthzActor, id: string, reasonInput: unknown) {
  await authorizeAnywhere(tx, actor, "asset.manage");
  const reason = parseInput(z.string().trim().min(3, "nhập lý do"), reasonInput);
  const c = (await tx.query("SELECT * FROM asset.lc_column WHERE id = $1 FOR UPDATE", [id])).rows[0];
  if (!c) throw notFound("cột");
  if (c.status === "RETIRED") throw invalid("Cột đã thanh lý.");
  await tx.query("UPDATE asset.lc_column SET status = 'RETIRED', retired_reason = $2, version = version + 1, updated_at = now(), updated_by = $3 WHERE id = $1", [id, reason, actor.userId]);
  await writeAudit(tx, actor, { entityType: "lc_column", entityId: id, action: "retire", changes: { status: ["ACTIVE", "RETIRED"] }, reason });
}

/** Columns with runs used against design, cost per run and accumulated depreciation. */
export async function listColumns(tx: Tx, actor: AuthzActor) {
  await authorizeAnywhere(tx, actor, "asset.view").catch(() => authorizeAnywhere(tx, actor, "oligo.view"));
  return (
    await tx.query(
      `SELECT c.id, c.code, c.name, c.status, c.retired_reason, c.price_vnd::float AS price_vnd, c.design_runs, a.code AS asset_code, a.name AS asset_name,
              round(c.price_vnd / c.design_runs, 2)::float AS cost_per_run,
              (SELECT count(*)::int FROM asset.lc_column_run r WHERE r.column_id = c.id) AS runs_used,
              (SELECT coalesce(sum(r.cost_vnd), 0)::float FROM asset.lc_column_run r WHERE r.column_id = c.id) AS depreciated_vnd,
              (SELECT max(r.run_at) FROM asset.lc_column_run r WHERE r.column_id = c.id) AS last_run_at
         FROM asset.lc_column c LEFT JOIN asset.asset a ON a.id = c.asset_id
        ORDER BY c.status, c.code`
    )
  ).rows;
}

export async function columnRuns(tx: Tx, actor: AuthzActor, id: string) {
  await authorizeAnywhere(tx, actor, "asset.view").catch(() => authorizeAnywhere(tx, actor, "oligo.view"));
  return (
    await tx.query(
      `SELECT r.sequence_code, r.step_name, r.cost_vnd::float AS cost_vnd, r.run_at, u.display_name AS run_by_name
         FROM asset.lc_column_run r LEFT JOIN core.user_profile u ON u.user_id = r.run_by WHERE r.column_id = $1 ORDER BY r.run_at DESC LIMIT 500`,
      [id]
    )
  ).rows;
}

/** A sequence run on a column in an SOP step: one run, costed at price / design runs. */
export async function recordColumnRun(tx: Tx, actor: AuthzActor, columnId: string, ref: { post_process_id: string; sequence_code: string; step_name: string }) {
  const c = (await tx.query("SELECT * FROM asset.lc_column WHERE id = $1 FOR UPDATE", [columnId])).rows[0];
  if (!c || c.status !== "ACTIVE") throw invalid("Cột sắc ký không có hoặc đã thanh lý.", undefined, "COLUMN_RETIRED");
  await tx.query("INSERT INTO asset.lc_column_run (column_id, post_process_id, sequence_code, step_name, cost_vnd, run_by) VALUES ($1, $2, $3, $4, $5, $6)", [
    columnId, ref.post_process_id, ref.sequence_code, ref.step_name, Math.round((Number(c.price_vnd) / c.design_runs) * 100) / 100, actor.userId,
  ]);
}
