import { z } from "zod";
import type { Tx } from "../core/db";
import { authorize, hasFactoryPermission, registerPermissions, type AuthzActor } from "../core/authz";
import { vnToday } from "../core/dates";
import { invalid, notFound } from "../core/errors";
import { nextNumber } from "../core/numbering";
import { insertRecord, parseInput } from "../core/records";

registerPermissions([
  { code: "asset.view", description: "Xem thiết bị phòng lab" },
  { code: "asset.manage", description: "Khai báo thiết bị phòng lab, hạn hiệu chuẩn, cấu hình máy tổng hợp" },
]);

const assetSchema = z.object({
  name: z.string().trim().min(1, "bắt buộc").max(200),
  asset_type: z.enum(["SYNTHESIZER", "HPLC", "PCR", "CENTRIFUGE", "FREEZER", "BALANCE", "SPECTROPHOTOMETER", "MASS_SPEC", "OTHER"]),
  owner_org_unit_id: z.string().uuid("chọn phòng quản lý"),
  manufacturer: z.string().trim().max(100).optional().nullable(),
  model: z.string().trim().max(100).optional().nullable(),
  serial_no: z.string().trim().max(100).optional().nullable(),
  calibration_interval_days: z.coerce.number().int().positive().optional().nullable(),
  next_calibration_due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  synthesizer: z
    .object({ column_positions: z.coerce.number().int().min(1).max(384), supported_scales: z.array(z.string()).max(30).default([]) })
    .optional()
    .nullable(),
});

export async function createAsset(tx: Tx, actor: AuthzActor, input: unknown) {
  const data = parseInput(assetSchema, input);
  await authorize(tx, actor, "asset.manage", data.owner_org_unit_id);
  if (data.asset_type === "SYNTHESIZER" && !data.synthesizer) throw invalid("Máy tổng hợp cần số vị trí cột.");
  const { synthesizer, ...fields } = data;
  const code = await nextNumber(tx, "ASSET");
  const asset = await insertRecord<{ id: string; code: string }>(tx, actor, "asset.asset", "asset", { ...fields, code });
  if (synthesizer) {
    await tx.query("INSERT INTO oligo.synthesizer (asset_id, column_positions, supported_scales) VALUES ($1, $2, $3)", [asset.id, synthesizer.column_positions, synthesizer.supported_scales]);
  }
  return asset;
}

/** Equipment may be used only while in service and within its calibration date (docs 02 §5). */
export async function assertUsable(tx: Tx, assetId: string): Promise<{ id: string; code: string; owner_org_unit_id: string }> {
  const a = (await tx.query("SELECT id, code, name, status, next_calibration_due, owner_org_unit_id FROM asset.asset WHERE id = $1", [assetId])).rows[0];
  if (!a) throw notFound("thiết bị");
  if (a.status !== "IN_SERVICE") throw invalid(`Thiết bị ${a.code} (${a.name}) đang không sẵn sàng (${a.status}).`, undefined, "ASSET_UNAVAILABLE");
  if (a.next_calibration_due && a.next_calibration_due < vnToday()) {
    throw invalid(`Thiết bị ${a.code} (${a.name}) đã quá hạn hiệu chuẩn (${a.next_calibration_due}). Hiệu chuẩn rồi mới dùng.`, undefined, "ASSET_CALIBRATION_DUE");
  }
  return a;
}

export async function listAssets(tx: Tx, actor: AuthzActor, type?: string) {
  const all = await hasFactoryPermission(tx, actor, "asset.view");
  const rows = (
    await tx.query(
      `SELECT a.*, o.name AS owner_name, s.column_positions, s.supported_scales
         FROM asset.asset a JOIN core.org_unit o ON o.id = a.owner_org_unit_id LEFT JOIN oligo.synthesizer s ON s.asset_id = a.id
        WHERE ($1::text IS NULL OR a.asset_type = $1) AND a.status <> 'RETIRED' ORDER BY a.code`,
      [type ?? null]
    )
  ).rows;
  if (all) return rows;
  const out = [];
  for (const r of rows) if ((await hasFactoryPermission(tx, actor, "asset.view", r.owner_org_unit_id)) || (await hasFactoryPermission(tx, actor, "oligo.view", r.owner_org_unit_id))) out.push(r);
  return out;
}
