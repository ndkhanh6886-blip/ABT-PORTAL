import type { z } from "zod";
import type { Tx } from "./db";
import { diffChanges, writeAudit, type Actor } from "./audit";
import { conflict, FactoryError, notFound } from "./errors";

/** Parses input with a Zod schema; failures become a 400 listing each field in Vietnamese. */
export function parseInput<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  const fields = result.error.issues.map((i) => ({ field: i.path.join("."), message: i.message }));
  throw new FactoryError(400, "VALIDATION", `Dữ liệu chưa hợp lệ: ${fields.map((f) => `${f.field || "dữ liệu"} — ${f.message}`).join("; ")}`, fields);
}

const IDENT = /^[a-z_]+\.[a-z_]+$/;
const COLUMN = /^[a-z_]+$/;

/**
 * Inserts a business record and audits it as "create" with every given field.
 * `table` and column names come from code, never from user input.
 */
export async function insertRecord<Row extends { id: string }>(
  tx: Tx,
  actor: Actor,
  table: string,
  entityType: string,
  values: Record<string, unknown>
): Promise<Row> {
  if (!IDENT.test(table)) throw new Error(`Tên bảng không hợp lệ: ${table}`);
  const cols = Object.keys(values).filter((c) => values[c] !== undefined);
  for (const c of cols) if (!COLUMN.test(c)) throw new Error(`Tên cột không hợp lệ: ${c}`);
  const all = [...cols, "created_by", "updated_by"];
  const params = [...cols.map((c) => values[c]), actor.userId, actor.userId];
  const res = await tx.query(
    `INSERT INTO ${table} (${all.join(", ")}) VALUES (${all.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING *`,
    params
  );
  const row = res.rows[0] as Row;
  await writeAudit(tx, actor, { entityType, entityId: row.id, action: "create", changes: diffChanges(null, row as any, cols) });
  return row;
}

/**
 * Optimistic-locked update: fails when the record changed since the user loaded it, writes
 * only changed fields and audits old → new values. Never touches `status` (state machines own it).
 */
export async function updateRecord<Row extends { id: string; version: number }>(
  tx: Tx,
  actor: Actor,
  table: string,
  entityType: string,
  id: string,
  expectedVersion: number,
  patch: Record<string, unknown>,
  reason?: string | null
): Promise<Row> {
  if (!IDENT.test(table)) throw new Error(`Tên bảng không hợp lệ: ${table}`);
  if ("status" in patch) throw new Error("Không được sửa status trực tiếp; dùng máy trạng thái.");
  const current = (await tx.query(`SELECT * FROM ${table} WHERE id = $1 FOR UPDATE`, [id])).rows[0] as Row | undefined;
  if (!current) throw notFound("bản ghi");
  if (current.version !== expectedVersion) {
    throw conflict("Bản ghi vừa được người khác thay đổi. Tải lại trang rồi thực hiện lại.", "STALE_VERSION");
  }
  const fields = Object.keys(patch).filter((c) => patch[c] !== undefined);
  for (const c of fields) if (!COLUMN.test(c)) throw new Error(`Tên cột không hợp lệ: ${c}`);
  const changes = diffChanges(current as any, patch, fields);
  const changed = Object.keys(changes);
  if (!changed.length) return current;
  const sets = changed.map((c, i) => `${c} = $${i + 2}`);
  const res = await tx.query(
    `UPDATE ${table} SET ${sets.join(", ")}, version = version + 1, updated_at = now(), updated_by = $${changed.length + 2}
      WHERE id = $1 RETURNING *`,
    [id, ...changed.map((c) => patch[c]), actor.userId]
  );
  await writeAudit(tx, actor, { entityType, entityId: id, action: "update", changes, reason });
  return res.rows[0] as Row;
}
