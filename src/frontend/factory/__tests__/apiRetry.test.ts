import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "../api";

describe("factory api transient 502/503/504 retry", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("transparently recovers when fetch returns 502 twice and 200 on the 3rd attempt", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("<html>502 Bad Gateway</html>", { status: 502 }))
      .mockResolvedValueOnce(new Response("<html>502 Bad Gateway</html>", { status: 502 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, items: [1, 2] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );
    globalThis.fetch = fetchMock;

    const promise = api<{ ok: boolean; items: number[] }>("/api/factory/qms/ops");
    await vi.runAllTimersAsync();
    const res = await promise;

    expect(res).toEqual({ ok: true, items: [1, 2] });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not retry 401, 403, or 422 responses", async () => {
    for (const status of [401, 403, 422]) {
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
        new Response(JSON.stringify({ error: `Lỗi client ${status}` }), {
          status,
          headers: { "Content-Type": "application/json" },
        })
      );
      globalThis.fetch = fetchMock;

      await expect(api("/api/factory/qms/ops")).rejects.toMatchObject({
        status,
        message: `Lỗi client ${status}`,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });

  it("throws a clear Vietnamese gateway-restart ApiError after exhausting 502 retries", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => new Response("<html>502 Bad Gateway</html>", { status: 502 }));
    globalThis.fetch = fetchMock;

    const promise = api("/api/factory/qms/ops").catch((err: unknown) => err);
    await vi.runAllTimersAsync();
    const err = await promise;

    expect(err).toBeInstanceOf(ApiError);
    const apiErr = err as ApiError;
    expect(apiErr.status).toBe(502);
    expect(apiErr.message).toContain("502");
    expect(apiErr.message).toContain("khởi động lại");
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
