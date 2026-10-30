import type { Tx } from "./db";
import { conflict, invalid, notFound } from "./errors";
import { writeAudit, type Actor } from "./audit";

/** Reads a configurable value (`core.setting`). JSON null is returned as null. */
export async function getSetting<T>(tx: Tx, key: string): Promise<T | null> {
  const res = await tx.query("SELECT value FROM core.setting WHERE key = $1", [key]);
  if (!res.rowCount) throw notFound(`tham số cấu hình "${key}"`);
  return (res.rows[0].value ?? null) as T | null;
}

export async function getNumberSetting(tx: Tx, key: string, fallback: number): Promise<number> {
  const value = await getSetting<number>(tx, key);
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** All settings with their descriptions, for the settings screen. */
export async function listSettings(tx: Tx) {
  return (await tx.query("SELECT key, value, description, version, updated_at FROM core.setting ORDER BY key")).rows;
}

/** Changes one setting (JSON value) with optimistic locking; audited old → new with the reason. */
export async function updateSetting(tx: Tx, actor: Actor, key: string, input: { value: unknown; version: number; reason: string }) {
  if (typeof input.reason !== "string" || input.reason.trim().length < 3) throw invalid("Nhập lý do thay đổi tham số.");
  const cur = (await tx.query("SELECT value, version FROM core.setting WHERE key = $1 FOR UPDATE", [key])).rows[0];
  if (!cur) throw notFound(`tham số cấu hình "${key}"`);
  if (cur.version !== Number(input.version)) throw conflict("Tham số vừa được người khác sửa. Tải lại.", "STALE_VERSION");
  const value = input.value === "" || input.value === undefined ? null : input.value;
  await tx.query("UPDATE core.setting SET value = $2, version = version + 1, updated_at = now(), updated_by = $3 WHERE key = $1", [key, JSON.stringify(value), actor.userId]);
  await writeAudit(tx, actor, { entityType: "setting", entityId: key, action: "update", changes: { value: [cur.value, value] }, reason: input.reason.trim() });
}
