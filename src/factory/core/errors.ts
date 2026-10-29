/**
 * Business error of the factory modules. `message` is Vietnamese and tells the user what to do;
 * `code` is stable for the UI and tests; `details` carries e.g. the failed guards.
 */
export class FactoryError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "FactoryError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const notFound = (what: string) => new FactoryError(404, "NOT_FOUND", `Không tìm thấy ${what}.`);

export const forbidden = (message = "Bạn không có quyền thực hiện thao tác này. Liên hệ quản trị viên để được cấp quyền.") =>
  new FactoryError(403, "FORBIDDEN", message);

export const conflict = (message: string, code = "CONFLICT") => new FactoryError(409, code, message);

export const invalid = (message: string, details?: unknown, code = "INVALID") => new FactoryError(422, code, message, details);

/** Separation of duties: the person who performed / analysed must not also check / approve / release. */
export function assertDifferentPeople(performerId: number | null | undefined, approverId: number, message: string): void {
  if (performerId != null && performerId === approverId) {
    throw new FactoryError(422, "SAME_PERSON", message);
  }
}
