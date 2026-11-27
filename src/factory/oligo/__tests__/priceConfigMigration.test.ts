import fs from "fs";
import path from "path";
import type { PoolClient } from "pg";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import "../../__tests__/helpers";
import { closeFactoryPool, getFactoryPool } from "../../core/db";
import { MIGRATIONS_DIR } from "../../db/migrate";

/** Migration 0052: đổi ngưỡng Desalt 35 → 34 nt trong cấu hình bảng giá Oligo đã lưu, chỉ khi còn y nguyên bản gốc. */
const SQL = fs.readFileSync(path.join(MIGRATIONS_DIR, "0052_oligo_desalt_threshold_34nt.sql"), "utf8");

const ORIGINAL = [
  { max_len: 35, method: "Desalt" },
  { max_len: 60, method: "OPC" },
  { max_len: 120, method: "HPLC" },
];
const UPDATED = [
  { max_len: 34, method: "Desalt" },
  { max_len: 60, method: "OPC" },
  { max_len: 120, method: "HPLC" },
];

let client: PoolClient;
beforeEach(async () => {
  client = await getFactoryPool().connect();
  await client.query("BEGIN"); // mọi thay đổi được hoàn tác sau mỗi test
});
afterEach(async () => {
  await client.query("ROLLBACK");
  client.release();
});
afterAll(closeFactoryPool);

async function seed(rules: unknown) {
  const config = { company_info: { name: "x" }, purification_pricing: { OPC: { "100nmol": 70000 } }, purification_default_by_length: rules };
  await client.query(
    `INSERT INTO oligo.price_config (id, config, version) VALUES (1, $1::jsonb, 3)
     ON CONFLICT (id) DO UPDATE SET config = EXCLUDED.config, version = EXCLUDED.version`,
    [JSON.stringify(config)]
  );
}
async function saved() {
  return (await client.query("SELECT config, version FROM oligo.price_config WHERE id = 1")).rows[0];
}

describe("migration 0052 — ngưỡng Desalt 34 nt", () => {
  it("cấu hình gốc (35 Desalt / 60 OPC / 120 HPLC) → đổi thành 34, giữ nguyên các mục khác", async () => {
    await seed(ORIGINAL);
    await client.query(SQL);
    const row = await saved();
    expect(row.config.purification_default_by_length).toEqual(UPDATED);
    expect(row.config.purification_pricing).toEqual({ OPC: { "100nmol": 70000 } });
    expect(row.version).toBe(4);
  });

  it("cấu hình đã chỉnh tay → giữ nguyên", async () => {
    const manual = [
      { max_len: 30, method: "Desalt" },
      { max_len: 60, method: "OPC" },
      { max_len: 120, method: "HPLC" },
    ];
    await seed(manual);
    await client.query(SQL);
    const row = await saved();
    expect(row.config.purification_default_by_length).toEqual(manual);
    expect(row.version).toBe(3);
  });

  it("chạy lại lần hai → không đổi gì", async () => {
    await seed(ORIGINAL);
    await client.query(SQL);
    const first = await saved();
    await client.query(SQL);
    const second = await saved();
    expect(second.config).toEqual(first.config);
    expect(second.version).toBe(first.version);
  });

  it("chưa có cấu hình đã lưu → không tạo dòng mới", async () => {
    await client.query("DELETE FROM oligo.price_config");
    await client.query(SQL);
    expect((await client.query("SELECT count(*)::int AS n FROM oligo.price_config")).rows[0].n).toBe(0);
  });
});
