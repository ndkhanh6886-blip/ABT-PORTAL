import crypto from "crypto";
import type { Tx } from "./db";
import { conflict, invalid } from "./errors";
import { canonicalJson } from "./signature";

export function requestHash(body: unknown): string {
  return crypto.createHash("sha256").update(canonicalJson(body)).digest("hex");
}

/**
 * Makes a document-creating command safe to submit twice (double click, retry after timeout).
 * The key row is inserted in the caller's transaction: a concurrent duplicate waits on the
 * primary key until the first commits, then receives the stored response instead of a second document.
 */
export async function withIdempotency<T>(
  tx: Tx,
  scope: { userId: number; endpoint: string; key: string | null | undefined; body: unknown },
  run: () => Promise<T>
): Promise<{ result: T; replayed: boolean }> {
  const key = scope.key?.trim();
  if (!key) throw invalid("Thiếu khóa chống gửi trùng (Idempotency-Key). Tải lại trang rồi thực hiện lại.", undefined, "IDEMPOTENCY_KEY_REQUIRED");
  const hash = requestHash(scope.body);
  const inserted = await tx.query(
    `INSERT INTO core.idempotency_key (user_id, endpoint, key, request_hash) VALUES ($1, $2, $3, $4)
     ON CONFLICT DO NOTHING RETURNING key`,
    [scope.userId, scope.endpoint, key, hash]
  );
  if (!inserted.rowCount) {
    const prev = (
      await tx.query("SELECT request_hash, response FROM core.idempotency_key WHERE user_id = $1 AND endpoint = $2 AND key = $3", [
        scope.userId,
        scope.endpoint,
        key,
      ])
    ).rows[0];
    if (prev.request_hash !== hash) {
      throw invalid("Khóa chống gửi trùng đã dùng cho một yêu cầu khác. Tải lại trang rồi thực hiện lại.", undefined, "IDEMPOTENCY_KEY_REUSED");
    }
    if (prev.response == null) throw conflict("Yêu cầu này đang được xử lý. Vui lòng đợi giây lát.", "IDEMPOTENCY_IN_PROGRESS");
    return { result: prev.response.value as T, replayed: true };
  }
  const result = await run();
  await tx.query("UPDATE core.idempotency_key SET response = $4 WHERE user_id = $1 AND endpoint = $2 AND key = $3", [
    scope.userId,
    scope.endpoint,
    key,
    JSON.stringify({ value: result ?? null }),
  ]);
  return { result, replayed: false };
}
