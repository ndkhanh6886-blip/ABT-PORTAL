import { describe, expect, it, vi } from "vitest";
import { apiErrorResponse } from "@/backend/services/apiErrors";

describe("apiErrorResponse (no internal detail in responses)", () => {
  it("hides database errors behind a reference code", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const err = Object.assign(new Error('relation "secret_table" does not exist'), { code: "42P01", severity: "ERROR" });
    const res = apiErrorResponse(err);
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body.code).toBe("INTERNAL");
    expect(JSON.stringify(body)).not.toContain("secret_table");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("hides network / system errors (ECONNREFUSED)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const err = Object.assign(new Error("connect ECONNREFUSED 10.0.0.5:5432"), { code: "ECONNREFUSED", syscall: "connect" });
    const body = await apiErrorResponse(err).json();
    expect(JSON.stringify(body)).not.toContain("10.0.0.5");
    spy.mockRestore();
  });

  it("keeps short business messages for the user", async () => {
    const body = await apiErrorResponse(new Error("Số lượng tồn không đủ")).json();
    expect(body.error).toBe("Số lượng tồn không đủ");
  });
});
