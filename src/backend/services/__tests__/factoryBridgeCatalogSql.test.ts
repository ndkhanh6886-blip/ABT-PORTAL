import { beforeEach, describe, expect, it, vi } from "vitest";

const recordedSql: string[] = [];

vi.mock("@/backend/db/db", () => {
  const mockQuery = vi.fn(async (sql: string) => {
    recordedSql.push(sql);
    if (sql.includes("FROM procurement_suppliers ORDER BY id ASC")) {
      return {
        rows: [
          {
            id: 101,
            supplier_code: "NCC-NB-OLIGO",
            name: "Nhà cung cấp tổng hợp Oligo",
            short_name: "Oligo",
          },
        ],
      };
    }
    if (sql.includes("SELECT to_regclass('public.catalog_items')")) {
      return { rows: [{ reg: "catalog_items" }] };
    }
    if (sql.includes("RETURNING id, supplier_code, name")) {
      return {
        rows: [
          {
            id: 102,
            supplier_code: "NCC-NB-KIT",
            name: "Mock Supplier",
          },
        ],
      };
    }
    return { rows: [] };
  });

  return {
    query: mockQuery,
    withTransaction: vi.fn(async (cb: (client: { query: typeof mockQuery }) => Promise<unknown>) =>
      cb({ query: mockQuery })
    ),
    logAudit: vi.fn(async () => undefined),
    HttpError: class HttpError extends Error {
      status: number;
      constructor(status: number, message: string) {
        super(message);
        this.status = status;
      }
    },
  };
});

describe("factoryBridge ensureDefaultInternalSuppliers SQL safety", () => {
  beforeEach(() => {
    recordedSql.length = 0;
  });

  it("ensures notes column exists and updates catalog_items JSONB data without referencing nonexistent flat supplier column", async () => {
    const { ensureDefaultInternalSuppliers } = await import("../factoryBridge");
    await ensureDefaultInternalSuppliers(true);

    const allSql = recordedSql.join("\n---\n");
    expect(allSql).toContain("ALTER TABLE procurement_suppliers ADD COLUMN IF NOT EXISTS short_name");
    expect(allSql).toContain("ALTER TABLE procurement_suppliers ADD COLUMN IF NOT EXISTS notes");

    expect(recordedSql.some((s) => /UPDATE\s+catalog_items\s+SET\s+supplier\s*=/i.test(s))).toBe(false);

    expect(recordedSql.some((s) => s.includes("to_regclass('public.catalog_items')"))).toBe(true);
    expect(
      recordedSql.some((s) => s.includes("UPDATE catalog_items") && s.includes("jsonb_set"))
    ).toBe(true);
  });
});
