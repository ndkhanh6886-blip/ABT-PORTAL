import { NextResponse } from "next/server";
import { HttpError, httpErrorStatus } from "@/backend/db/db";

/**
 * Error response of an API route (CWE-209: never send internal error text to the client).
 *
 * Messages written for people are kept: `HttpError` (route validation), `FactoryError` (factory rules and
 * guards: it carries `status` and `code`) and plain `Error`s thrown by application code. Everything that comes
 * from a library or the system is replaced with a reference number and logged on the server instead: database
 * errors (they name tables, columns and constraints), network errors (`ECONNREFUSED 127.0.0.1:5432`),
 * `TypeError` / `ReferenceError` / `RangeError` (stack details) and anything with a driver `code`.
 */

type AnyError = { name?: string; message?: string; code?: unknown; status?: unknown; syscall?: unknown; severity?: unknown; constructor?: { name?: string } };

const INTERNAL_NAMES = new Set(["TypeError", "ReferenceError", "RangeError", "SyntaxError", "EvalError", "URIError", "AggregateError", "DatabaseError"]);

function isUserFacing(e: AnyError): boolean {
  if (e instanceof HttpError) return true;
  // FactoryError: HTTP status in `status` and an application `code` such as GUARD_FAILED / NOT_FOUND
  if (e?.name === "FactoryError") return true;
  if (e?.syscall || e?.severity) return false; // Node system error / pg DatabaseError
  if (typeof e?.code === "string" && /^[0-9A-Z]{5}$/.test(e.code)) return false; // SQLSTATE
  if (typeof e?.code === "string" && /^E[A-Z]+$/.test(e.code)) return false; // ECONNREFUSED, ENOENT, …
  if (INTERNAL_NAMES.has(String(e?.name))) return false;
  return e?.constructor?.name === "Error" && typeof e?.message === "string" && e.message.length > 0 && e.message.length < 400;
}

/** Same text for every unexpected failure, plus a reference the administrator finds in the server log. */
export function internalErrorResponse(error: unknown, status = 500, context?: string) {
  const ref = crypto.randomUUID().slice(0, 8);
  const e = (error ?? {}) as AnyError;
  console.error(JSON.stringify({ level: "error", ref, context, name: e.name, code: e.code, message: String(e.message ?? error).slice(0, 500) }));
  return NextResponse.json({ error: `Lỗi hệ thống (mã tra cứu ${ref}). Vui lòng báo quản trị viên.`, code: "INTERNAL" }, { status });
}

/** `catch (error) { return apiErrorResponse(error); }` — replaces `NextResponse.json({ error: error.message }, …)`. */
export function apiErrorResponse(error: unknown, context?: string) {
  const e = (error ?? {}) as AnyError;
  const status = typeof e.status === "number" && e.status >= 400 && e.status < 600 && isUserFacing(e) ? e.status : httpErrorStatus(error);
  if (isUserFacing(e)) {
    return NextResponse.json({ error: String(e.message || "Yêu cầu không hợp lệ"), ...(typeof e.code === "string" && e.name === "FactoryError" ? { code: e.code } : {}) }, { status });
  }
  // constraint violations are the user's data problem, not a crash: say so without naming the constraint
  if (status === 409) {
    return NextResponse.json({ error: "Dữ liệu bị trùng hoặc đang được sử dụng ở nơi khác, không thể thực hiện thao tác này.", code: "CONFLICT" }, { status: 409 });
  }
  return internalErrorResponse(error, status, context);
}
