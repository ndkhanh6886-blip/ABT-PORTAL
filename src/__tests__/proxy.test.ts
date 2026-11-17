import { beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// the policy depends on NODE_ENV when the module loads: test the production one
let proxy: (r: NextRequest) => Promise<Response & { headers: Headers }>;
beforeAll(async () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.resetModules();
  proxy = (await import("@/proxy")).proxy as any;
});

const req = (url: string, init: RequestInit = {}) => new NextRequest(url, init as any);

describe("proxy: page headers", () => {
  it("sends a nonce CSP without unsafe-inline / unsafe-eval for scripts", async () => {
    const res = await proxy(req("https://abt-portal.com/"));
    const csp = res.headers.get("content-security-policy") || "";
    const scriptSrc = csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("script-src")) || "";
    expect(scriptSrc).toMatch(/'nonce-[A-Za-z0-9+/=]+'/);
    expect(scriptSrc).not.toContain("unsafe-inline");
    expect(scriptSrc).not.toContain("unsafe-eval");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'self'");
  });

  it("uses a different nonce for each request", async () => {
    const a = (await proxy(req("https://abt-portal.com/"))).headers.get("content-security-policy");
    const b = (await proxy(req("https://abt-portal.com/"))).headers.get("content-security-policy");
    expect(a).not.toEqual(b);
  });

  it("sets the hardening headers", async () => {
    const res = await proxy(req("https://abt-portal.com/"));
    expect(res.headers.get("strict-transport-security")).toContain("includeSubDomains");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cross-origin-opener-policy")).toBe("same-origin");
  });
});

describe("proxy: CSRF check on /api writes", () => {
  it("rejects a write whose Origin is another site", async () => {
    const res = await proxy(req("https://abt-portal.com/api/sales", { method: "POST", headers: { origin: "https://evil.example", host: "abt-portal.com" } }));
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("CROSS_SITE");
  });

  it("rejects a write with a null Origin", async () => {
    const res = await proxy(req("https://abt-portal.com/api/sales", { method: "DELETE", headers: { origin: "null", host: "abt-portal.com" } }));
    expect(res.status).toBe(403);
  });

  it("rejects a cross-site fetch without Origin", async () => {
    const res = await proxy(req("https://abt-portal.com/api/sales", { method: "POST", headers: { "sec-fetch-site": "cross-site", host: "abt-portal.com" } }));
    expect(res.status).toBe(403);
  });

  it("lets a same-origin write reach the session check (401 without cookie)", async () => {
    const res = await proxy(req("https://abt-portal.com/api/sales", { method: "POST", headers: { origin: "https://abt-portal.com", host: "abt-portal.com" } }));
    expect(res.status).toBe(401);
  });

  it("gives API responses a script-less CSP", async () => {
    const res = await proxy(req("https://abt-portal.com/api/sales"));
    expect(res.headers.get("content-security-policy")).toContain("script-src 'none'");
  });
});
