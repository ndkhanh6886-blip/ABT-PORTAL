import crypto from "crypto";
import { hashPassword, verifyPassword } from "@/backend/services/passwords";
import { withTransaction, type Tx } from "./db";
import type { Actor } from "./audit";
import { FactoryError, invalid } from "./errors";
import { getNumberSetting } from "./settings";

export type SignatureMeaning = "PERFORMED" | "CHECKED" | "REVIEWED" | "APPROVED" | "RELEASED";

export const MEANING_LABEL: Record<SignatureMeaning, string> = {
  PERFORMED: "Thực hiện",
  CHECKED: "Kiểm tra",
  REVIEWED: "Xem xét",
  APPROVED: "Phê duyệt",
  RELEASED: "Giải phóng",
};

/** Fields that change on every save and say nothing about the signed content. */
const VOLATILE_FIELDS = new Set(["version", "updated_at", "updated_by"]);

/** Deterministic JSON: object keys sorted at every level, so equal content always hashes equally. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    .join(",")}}`;
}

/** SHA-256 of the record content at signing time; a later edit makes the hash differ (signature void). */
export function recordHash(record: Record<string, unknown>): string {
  const content: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record)) if (!VOLATILE_FIELDS.has(k)) content[k] = v;
  return crypto.createHash("sha256").update(canonicalJson(content)).digest("hex");
}

export interface SignatureCredential {
  method: "PIN" | "PASSWORD";
  secret: string;
}

/** Checks the ABT Portal login password of a user. Injected so the factory never reads portal tables itself. */
export type PasswordVerifier = (userId: number, password: string) => Promise<boolean>;

export async function setPin(tx: Tx, userId: number, pin: string): Promise<void> {
  if (!/^\d{6,8}$/.test(pin)) throw invalid("Mã PIN chữ ký phải gồm 6–8 chữ số.");
  if (/^(\d)\1+$/.test(pin) || "0123456789".includes(pin) || "9876543210".includes(pin)) {
    throw invalid("Mã PIN quá dễ đoán (lặp lại hoặc liên tiếp). Vui lòng chọn mã khác.");
  }
  const res = await tx.query(
    `UPDATE core.user_profile SET pin_hash = $2, pin_failed_attempts = 0, pin_locked_until = NULL,
            version = version + 1, updated_at = now() WHERE user_id = $1`,
    [userId, hashPassword(pin)]
  );
  if (!res.rowCount) throw invalid("Tài khoản chưa được kích hoạt trên hệ thống nhà máy.");
}

/**
 * Re-authenticates the signer (PIN or password) with lock-out after repeated failures.
 * Runs in its own transaction, before the business transaction, so a failed attempt is counted
 * even though the business change is then abandoned.
 */
export async function authenticateSigner(
  userId: number,
  credential: SignatureCredential,
  verifyPortalPassword?: PasswordVerifier
): Promise<void> {
  const failure = await withTransaction((tx) => checkCredential(tx, userId, credential, verifyPortalPassword));
  if (failure) throw failure;
}

async function checkCredential(
  tx: Tx,
  userId: number,
  credential: SignatureCredential,
  verifyPortalPassword?: PasswordVerifier
): Promise<FactoryError | null> {
  const res = await tx.query(
    "SELECT pin_hash, pin_failed_attempts, pin_locked_until, status FROM core.user_profile WHERE user_id = $1 FOR UPDATE",
    [userId]
  );
  const profile = res.rows[0];
  if (!profile || profile.status !== "ACTIVE") throw invalid("Tài khoản không được phép ký điện tử.", undefined, "SIGNER_INACTIVE");
  if (profile.pin_locked_until && new Date(profile.pin_locked_until) > new Date()) {
    throw new FactoryError(429, "SIGNATURE_LOCKED", "Chữ ký điện tử đang tạm khóa do nhập sai nhiều lần. Vui lòng thử lại sau.");
  }
  let ok = false;
  if (credential.method === "PIN") {
    if (!profile.pin_hash) throw invalid("Bạn chưa đặt mã PIN chữ ký. Vào Hồ sơ cá nhân để đặt PIN.", undefined, "PIN_NOT_SET");
    ok = verifyPassword(credential.secret, profile.pin_hash);
  } else {
    if (!verifyPortalPassword) throw invalid("Chưa hỗ trợ ký bằng mật khẩu tại thao tác này. Hãy dùng PIN.");
    ok = await verifyPortalPassword(userId, credential.secret);
  }
  if (ok) {
    if (profile.pin_failed_attempts > 0) {
      await tx.query("UPDATE core.user_profile SET pin_failed_attempts = 0 WHERE user_id = $1", [userId]);
    }
    return null;
  }
  const maxAttempts = await getNumberSetting(tx, "security.pin_max_failed_attempts", 5);
  const lockMinutes = await getNumberSetting(tx, "security.pin_lock_minutes", 15);
  await tx.query(
    `UPDATE core.user_profile SET
       pin_failed_attempts = CASE WHEN pin_failed_attempts + 1 >= $2 THEN 0 ELSE pin_failed_attempts + 1 END,
       pin_locked_until = CASE WHEN pin_failed_attempts + 1 >= $2 THEN now() + make_interval(mins => $3) ELSE pin_locked_until END
     WHERE user_id = $1`,
    [userId, maxAttempts, lockMinutes]
  );
  return new FactoryError(401, "SIGNATURE_INVALID", `${credential.method === "PIN" ? "Mã PIN" : "Mật khẩu"} không đúng. Chữ ký chưa được ghi nhận.`);
}

/** Stores an e-signature over the record as it is now. */
export async function insertSignature(
  tx: Tx,
  actor: Actor,
  entry: {
    entityType: string;
    entityId: string;
    entityVersion: number;
    meaning: SignatureMeaning;
    record: Record<string, unknown>;
    method: "PIN" | "PASSWORD";
    reason?: string | null;
  }
): Promise<{ id: string; recordHash: string }> {
  const hash = recordHash(entry.record);
  const res = await tx.query(
    `INSERT INTO core.e_signature (entity_type, entity_id, entity_version, meaning, signer_id, signer_name, reason, auth_method, record_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [entry.entityType, entry.entityId, entry.entityVersion, entry.meaning, actor.userId, actor.name, entry.reason ?? null, entry.method, hash]
  );
  return { id: res.rows[0].id, recordHash: hash };
}

/** A signature stays valid only while the record content still hashes to what was signed. */
export function isSignatureValid(signedHash: string, currentRecord: Record<string, unknown>): boolean {
  return signedHash === recordHash(currentRecord);
}
