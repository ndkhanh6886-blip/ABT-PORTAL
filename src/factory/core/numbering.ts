import { FactoryError, notFound } from "./errors";
import type { Tx } from "./db";

/**
 * Document / lot / serial numbers. Pattern tokens:
 *   {YYYY} {YY} {MM} {DD}  business date in Asia/Ho_Chi_Minh
 *   {N…}                    the counter, zero-padded to the number of N (grows past it, never wraps)
 *   {ANY_NAME}              a parameter, e.g. {MODEL} for device serials (letters, digits, '-' only)
 * The counter is kept per "scope" = the code rendered without its counter, so a pattern with {YY}{MM}
 * restarts every month and {MODEL}-{YY}{NNNN} counts per model and year, with no reset job.
 */

const TOKEN = /\{([A-Z_]+)\}/g;
const COUNTER = /^N+$/;
const PARAM_VALUE = /^[A-Z0-9-]{1,20}$/;

export interface CompiledPattern {
  scopeKey: string;
  format: (n: number) => string;
}

function vnDateParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return { YYYY: get("year"), YY: get("year").slice(2), MM: get("month"), DD: get("day") };
}

export function validatePattern(pattern: string): void {
  const tokens = [...pattern.matchAll(TOKEN)].map((m) => m[1]);
  const counters = tokens.filter((t) => COUNTER.test(t));
  if (counters.length !== 1) {
    throw new FactoryError(422, "BAD_PATTERN", `Mẫu mã số "${pattern}" phải có đúng một bộ đếm dạng {NNN}.`);
  }
  if (pattern.replace(TOKEN, "").includes("{") || pattern.replace(TOKEN, "").includes("}")) {
    throw new FactoryError(422, "BAD_PATTERN", `Mẫu mã số "${pattern}" có dấu ngoặc không hợp lệ.`);
  }
  if (pattern.length > 60) throw new FactoryError(422, "BAD_PATTERN", "Mẫu mã số dài tối đa 60 ký tự.");
}

export function compilePattern(pattern: string, date: Date, params: Record<string, string> = {}): CompiledPattern {
  validatePattern(pattern);
  const dateParts = vnDateParts(date);
  let width = 0;
  const resolved = pattern.replace(TOKEN, (_all, name: string) => {
    if (COUNTER.test(name)) {
      width = name.length;
      return "\u0000";
    }
    if (name in dateParts) return dateParts[name as keyof typeof dateParts];
    const value = params[name];
    if (value == null || value === "") {
      throw new FactoryError(422, "PATTERN_PARAM_MISSING", `Thiếu giá trị ${name} để cấp mã theo mẫu "${pattern}".`);
    }
    const upper = String(value).trim().toUpperCase();
    if (!PARAM_VALUE.test(upper)) {
      throw new FactoryError(422, "PATTERN_PARAM_INVALID", `Giá trị ${name} "${value}" chỉ được gồm chữ không dấu, số và dấu gạch ngang (tối đa 20 ký tự).`);
    }
    return upper;
  });
  return {
    scopeKey: resolved.replace("\u0000", "#"),
    format: (n: number) => resolved.replace("\u0000", String(n).padStart(width, "0")),
  };
}

/**
 * Issues the next number inside the caller's transaction. The upsert takes a row lock on the
 * counter, so concurrent callers queue and each gets a distinct value; a rolled-back transaction
 * never consumed its number, a committed one is never handed out again.
 */
export async function nextNumber(
  tx: Tx,
  sequenceKey: string,
  opts: { date?: Date; params?: Record<string, string> } = {}
): Promise<string> {
  const def = await tx.query("SELECT pattern FROM core.sequence_definition WHERE sequence_key = $1", [sequenceKey]);
  if (!def.rowCount) throw notFound(`cấu hình mã số "${sequenceKey}"`);
  const compiled = compilePattern(def.rows[0].pattern, opts.date ?? new Date(), opts.params);
  const res = await tx.query(
    `INSERT INTO core.number_counter (sequence_key, scope_key, last_value) VALUES ($1, $2, 1)
     ON CONFLICT (sequence_key, scope_key)
     DO UPDATE SET last_value = core.number_counter.last_value + 1, updated_at = now()
     RETURNING last_value`,
    [sequenceKey, compiled.scopeKey]
  );
  return compiled.format(Number(res.rows[0].last_value));
}
