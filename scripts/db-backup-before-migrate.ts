// Sao lưu CSDL sản xuất (factory) và CSDL portal trước khi chạy migration lúc deploy.
// Usage: npx tsx scripts/db-backup-before-migrate.ts
// Thoát mã 0 khi sao lưu xong; mã 2 khi máy chủ không có pg_dump (deploy chỉ cảnh báo); mã 1 khi sao lưu lỗi.
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { loadEnv } from "./lib/loadEnv";

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function main(): number {
  loadEnv();
  const which = spawnSync("pg_dump", ["--version"], { encoding: "utf8" });
  if (which.error || which.status !== 0) {
    console.warn("::warning::Máy chủ không có pg_dump — bỏ qua sao lưu trước migration");
    return 2;
  }
  const dir = process.env.DB_BACKUP_DIR || "/var/backups/abt_portal";
  fs.mkdirSync(dir, { recursive: true });
  const databases = [process.env.FACTORY_PGDATABASE || "abt_factory", process.env.PGDATABASE || "abt_portal"];
  const env = {
    ...process.env,
    PGHOST: process.env.PGHOST || "127.0.0.1",
    PGPORT: process.env.PGPORT || "5432",
    PGUSER: process.env.PGUSER || "postgres",
  };
  for (const db of [...new Set(databases)]) {
    const file = path.join(dir, `${db}_before_deploy_${stamp()}.dump`);
    const r = spawnSync("pg_dump", ["-Fc", "-d", db, "-f", file], { env, stdio: "inherit" });
    if (r.status !== 0) {
      console.error(`::error::Sao lưu CSDL ${db} lỗi (mã ${r.status})`);
      return 1;
    }
    console.log(`Đã sao lưu ${db}: ${file} (${(fs.statSync(file).size / 1024 / 1024).toFixed(1)} MB)`);
  }
  // Giữ 10 bản sao lưu trước deploy gần nhất của mỗi CSDL
  for (const db of [...new Set(databases)]) {
    const old = fs.readdirSync(dir).filter(f => f.startsWith(`${db}_before_deploy_`)).sort().reverse().slice(10);
    for (const f of old) fs.unlinkSync(path.join(dir, f));
  }
  return 0;
}

process.exit(main());
