import crypto from "crypto";

/**
 * Password hashing: salted scrypt, stored as `scrypt$<saltHex>$<hashHex>`.
 * Legacy formats (unsalted SHA-256 hex and plaintext) are still accepted at login and are
 * upgraded to scrypt by the login route right after a successful verification.
 */

const KEY_LENGTH = 32;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

function safeEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function verifyPassword(password: string, stored: string | null | undefined): boolean {
  if (!stored || typeof password !== "string" || password.length === 0) return false;
  if (stored.startsWith("scrypt$")) {
    const [, saltHex, hashHex] = stored.split("$");
    if (!saltHex || !hashHex) return false;
    const expected = Buffer.from(hashHex, "hex");
    const actual = crypto.scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
    return safeEqual(actual, expected);
  }
  if (/^[a-f0-9]{64}$/i.test(stored)) {
    const sha = crypto.createHash("sha256").update(password).digest();
    return safeEqual(sha, Buffer.from(stored, "hex"));
  }
  // Legacy plaintext rows (accounts created before hashing was introduced)
  return safeEqual(Buffer.from(password), Buffer.from(stored));
}

const TEMP_PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

/**
 * Random one-time password for a new account (or an account created by a sync / import).
 * Replaces the shared "123456": with it, anyone who knew an employee code could log in first.
 */
export function generateTemporaryPassword(length = 10): string {
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += TEMP_PASSWORD_ALPHABET[bytes[i] % TEMP_PASSWORD_ALPHABET.length];
  return out;
}

export function needsRehash(stored: string | null | undefined): boolean {
  return !stored || !stored.startsWith("scrypt$");
}
