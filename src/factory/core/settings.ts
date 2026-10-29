import type { Tx } from "./db";
import { notFound } from "./errors";

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
