import { z } from "zod";
import type { Tx } from "../core/db";
import { writeAudit } from "../core/audit";
import { authorize, hasFactoryPermission, registerPermissions, type AuthzActor } from "../core/authz";
import { vnToday } from "../core/dates";
import { invalid, notFound } from "../core/errors";
import { nextNumber } from "../core/numbering";
import { insertRecord, parseInput } from "../core/records";
import { ensureHplcReagentSlotsAndColumnsSeed } from "./slots";
import { ensureLegacyOligoDataSeeded } from "../oligo/legacySync";

registerPermissions([
  { code: "asset.view", description: "Xem thiết bị phòng lab" },
  { code: "asset.manage", description: "Khai báo thiết bị phòng lab, hạn hiệu chuẩn, cấu hình máy tổng hợp" },
]);

const assetSchema = z.object({
  name: z.string().trim().min(1, "bắt buộc").max(200),
  asset_type: z.enum(["SYNTHESIZER", "HPLC", "PCR", "CENTRIFUGE", "FREEZER", "BALANCE", "SPECTROPHOTOMETER", "MASS_SPEC", "OTHER"]),
  owner_org_unit_id: z.string().uuid("chọn phòng quản lý").optional().nullable(),
  dept_code: z.string().trim().max(40).optional().nullable(),
  location: z.string().trim().max(150).optional().nullable(),
  equipment_category: z.string().trim().max(80).optional().nullable(),
  manufacturer: z.string().trim().max(100).optional().nullable(),
  model: z.string().trim().max(100).optional().nullable(),
  serial_no: z.string().trim().max(100).optional().nullable(),
  calibration_interval_days: z.coerce.number().int().positive().optional().nullable(),
  last_calibration_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  next_calibration_due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
  synthesizer: z
    .object({ column_positions: z.coerce.number().int().min(1).max(384), supported_scales: z.array(z.string()).max(30).default([]) })
    .optional()
    .nullable(),
});

let assetExtraColsEnsured = false;
export async function ensureAssetExtraColumnsSchema(tx: Tx): Promise<void> {
  if (assetExtraColsEnsured) return;
  await tx.query("SELECT pg_advisory_xact_lock(2026111404)");
  if (assetExtraColsEnsured) return;
  await tx.query(`
    ALTER TABLE asset.asset DROP CONSTRAINT IF EXISTS asset_code_check;
    ALTER TABLE asset.asset ADD COLUMN IF NOT EXISTS location text;
    ALTER TABLE asset.asset ADD COLUMN IF NOT EXISTS equipment_category text;
    ALTER TABLE asset.asset ADD COLUMN IF NOT EXISTS last_calibration_date date;
    ALTER TABLE asset.asset ADD COLUMN IF NOT EXISTS notes text;
  `);
  assetExtraColsEnsured = true;
}

const updateAssetSchema = z.object({
  name: z.string().trim().min(1, "bắt buộc").max(200).optional(),
  model: z.string().trim().max(100).optional().nullable(),
  serial_no: z.string().trim().max(100).optional().nullable(),
  status: z.enum(["IN_SERVICE", "UNDER_MAINTENANCE", "OUT_OF_CALIBRATION", "RETIRED"]).optional(),
  next_calibration_due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  synthesizer: z
    .object({ column_positions: z.coerce.number().int().min(1).max(384), supported_scales: z.array(z.string()).max(30).default([]) })
    .optional()
    .nullable(),
  reason: z.string().trim().max(500).optional().nullable(),
});

export async function createAsset(tx: Tx, actor: AuthzActor, input: unknown) {
  await ensureAssetExtraColumnsSchema(tx);
  const data = parseInput(assetSchema, input);
  let ownerOrgUnitId = data.owner_org_unit_id ?? null;
  if (!ownerOrgUnitId && data.dept_code) {
    const u = (await tx.query("SELECT id FROM core.org_unit WHERE code = $1 LIMIT 1", [data.dept_code])).rows[0];
    ownerOrgUnitId = u?.id ?? null;
  }
  if (!ownerOrgUnitId) {
    const u = (await tx.query("SELECT id FROM core.org_unit WHERE status = 'ACTIVE' ORDER BY code LIMIT 1")).rows[0];
    ownerOrgUnitId = u?.id ?? null;
  }
  if (!ownerOrgUnitId) throw invalid("Chưa chọn phòng quản lý thiết bị.");
  await authorize(tx, actor, "asset.manage", ownerOrgUnitId);
  if (data.asset_type === "SYNTHESIZER" && !data.synthesizer) throw invalid("Máy tổng hợp cần số vị trí cột.");
  const { synthesizer, dept_code: _dc, ...fields } = data;
  const code = await nextNumber(tx, "ASSET");
  const asset = await insertRecord<{ id: string; code: string }>(tx, actor, "asset.asset", "asset", {
    ...fields,
    owner_org_unit_id: ownerOrgUnitId,
    code,
  });
  if (synthesizer) {
    await tx.query("INSERT INTO oligo.synthesizer (asset_id, column_positions, supported_scales) VALUES ($1, $2, $3)", [asset.id, synthesizer.column_positions, synthesizer.supported_scales]);
  }
  return asset;
}

export async function updateAsset(tx: Tx, actor: AuthzActor, assetId: string, input: unknown) {
  const data = parseInput(updateAssetSchema, input);
  const cur = (
    await tx.query(
      `SELECT a.*, s.column_positions, s.supported_scales
         FROM asset.asset a LEFT JOIN oligo.synthesizer s ON s.asset_id = a.id
        WHERE a.id = $1 FOR UPDATE OF a`,
      [assetId]
    )
  ).rows[0];
  if (!cur) throw notFound("thiết bị");
  await authorize(tx, actor, "asset.manage", cur.owner_org_unit_id);

  const nextName = data.name ?? cur.name;
  const nextModel = data.model === undefined ? cur.model : data.model;
  const nextSerial = data.serial_no === undefined ? cur.serial_no : data.serial_no;
  const nextStatus = data.status ?? cur.status;
  const nextCal = data.next_calibration_due === undefined ? cur.next_calibration_due : data.next_calibration_due;

  const curCalStr = cur.next_calibration_due ? String(cur.next_calibration_due).slice(0, 10) : null;
  const nextCalStr = nextCal ? String(nextCal).slice(0, 10) : null;
  const statusChanged = data.status !== undefined && data.status !== cur.status;
  const calChanged = data.next_calibration_due !== undefined && nextCalStr !== curCalStr;
  if ((statusChanged || calChanged) && (!data.reason || data.reason.trim().length < 3)) {
    throw invalid("Bắt buộc nhập lý do (tối thiểu 3 ký tự) khi thay đổi trạng thái hoặc hạn hiệu chuẩn thiết bị.", undefined, "REASON_REQUIRED");
  }

  await tx.query(
    `UPDATE asset.asset
        SET name = $2, model = $3, serial_no = $4, status = $5, next_calibration_due = $6,
            version = version + 1, updated_at = now(), updated_by = $7
      WHERE id = $1`,
    [assetId, nextName, nextModel, nextSerial, nextStatus, nextCal, actor.userId]
  );

  if (cur.asset_type === "SYNTHESIZER" && data.synthesizer) {
    await tx.query(
      `INSERT INTO oligo.synthesizer (asset_id, column_positions, supported_scales)
       VALUES ($1, $2, $3)
       ON CONFLICT (asset_id) DO UPDATE SET column_positions = EXCLUDED.column_positions, supported_scales = EXCLUDED.supported_scales`,
      [assetId, data.synthesizer.column_positions, data.synthesizer.supported_scales]
    );
  }

  await writeAudit(tx, actor, {
    entityType: "asset",
    entityId: assetId,
    action: "update",
    changes: {
      name: [cur.name, nextName],
      model: [cur.model, nextModel],
      serial_no: [cur.serial_no, nextSerial],
      status: [cur.status, nextStatus],
      next_calibration_due: [cur.next_calibration_due, nextCal],
      ...(data.synthesizer
        ? {
            column_positions: [cur.column_positions, data.synthesizer.column_positions],
            supported_scales: [cur.supported_scales, data.synthesizer.supported_scales],
          }
        : {}),
    },
    reason: data.reason || "Cập nhật cấu hình máy tổng hợp / thiết bị",
  });

  return { id: assetId };
}

/** Auto-marks any IN_SERVICE / ACTIVE assets with next_calibration_due < CURRENT_DATE as OUT_OF_CALIBRATION. */
export async function syncOverdueCalibrationAssets(tx: Tx): Promise<void> {
  await tx.query(
    `UPDATE asset.asset
        SET status = 'OUT_OF_CALIBRATION', version = version + 1, updated_at = now()
      WHERE status IN ('IN_SERVICE', 'ACTIVE')
        AND next_calibration_due IS NOT NULL
        AND next_calibration_due < CURRENT_DATE`
  );
}

/** Equipment may be used only while in service and within its calibration date (docs 02 §5). */
export async function assertUsable(tx: Tx, assetId: string): Promise<{ id: string; code: string; owner_org_unit_id: string }> {
  const a = (await tx.query("SELECT id, code, name, status, next_calibration_due, owner_org_unit_id FROM asset.asset WHERE id = $1", [assetId])).rows[0];
  if (!a) throw notFound("thiết bị");
  if (a.next_calibration_due && a.next_calibration_due < vnToday()) {
    if (a.status === "IN_SERVICE" || a.status === "ACTIVE") {
      await tx.query(
        "UPDATE asset.asset SET status = 'OUT_OF_CALIBRATION', version = version + 1, updated_at = now() WHERE id = $1",
        [assetId]
      );
    }
    throw invalid(`Thiết bị ${a.code} (${a.name}) đã quá hạn hiệu chuẩn (${a.next_calibration_due}). Hiệu chuẩn rồi mới dùng.`, undefined, "ASSET_CALIBRATION_DUE");
  }
  if (a.status !== "IN_SERVICE") throw invalid(`Thiết bị ${a.code} (${a.name}) đang không sẵn sàng (${a.status}).`, undefined, "ASSET_UNAVAILABLE");
  return a;
}

export async function ensureDepartmentEquipmentSeed(tx: Tx) {
  if (process.env.FACTORY_ALLOW_DEMO_SEED !== "1") return;
  const depts = (
    await tx.query("SELECT id, code, name FROM core.org_unit WHERE code IN ('P-RD', 'P-KIT', 'P-QA', 'P-OLIGO', 'P-DEVICE')")
  ).rows as { id: string; code: string; name: string }[];
  if (!depts.length) return;
  const byCode = new Map(depts.map((d) => [d.code, d.id]));

  const seedAssets = [
    {
      code: "TB-RD-PCR01",
      name: "Máy Real-time PCR Bio-Rad CFX96 Touch (Phòng R&D)",
      asset_type: "PCR",
      dept: "P-RD",
      manufacturer: "Bio-Rad",
      model: "CFX96 Touch",
      serial_no: "BR-CFX96-202501",
      status: "IN_SERVICE",
      calibration_interval_days: 365,
      next_calibration_due: "2026-11-15",
    },
    {
      code: "TB-RD-FRZ80",
      name: "Tủ âm sâu -80°C Lưu mẫu Biobank & Enzyme R&D",
      asset_type: "FREEZER",
      dept: "P-RD",
      manufacturer: "Thermo Scientific",
      model: "TSX40086V",
      serial_no: "TS-80C-8821",
      status: "IN_SERVICE",
      calibration_interval_days: 180,
      next_calibration_due: "2027-02-10",
    },
    {
      code: "TB-RD-CEN01",
      name: "Máy ly tâm lạnh tốc độ cao Eppendorf 5425R",
      asset_type: "CENTRIFUGE",
      dept: "P-RD",
      manufacturer: "Eppendorf",
      model: "5425 R",
      serial_no: "EP-5425R-1092",
      status: "IN_SERVICE",
      calibration_interval_days: 365,
      next_calibration_due: "2027-03-01",
    },
    {
      code: "TB-KIT-DISP01",
      name: "Hệ thống Chia lẻ & Chiết rót Tự động Aliquot Robot (Dây chuyền Kit)",
      asset_type: "OTHER",
      dept: "P-KIT",
      manufacturer: "Hamilton / ABT Tech",
      model: "Microlab STARlet IVD",
      serial_no: "HM-STAR-2601",
      status: "IN_SERVICE",
      calibration_interval_days: 180,
      next_calibration_due: "2026-11-12",
    },
    {
      code: "TB-KIT-BSC01",
      name: "Tủ An toàn Sinh học Cấp II (Phòng Pha chế MasterMix Kit)",
      asset_type: "OTHER",
      dept: "P-KIT",
      manufacturer: "Esco Lifesciences",
      model: "Airstream AC2-4E8",
      serial_no: "ESCO-2024-991",
      status: "IN_SERVICE",
      calibration_interval_days: 365,
      next_calibration_due: "2027-01-20",
    },
    {
      code: "TB-KIT-PH01",
      name: "Máy đo pH chuẩn Mettler Toledo SevenCompact (Pha đệm Kit)",
      asset_type: "BALANCE",
      dept: "P-KIT",
      manufacturer: "Mettler Toledo",
      model: "SevenCompact S220",
      serial_no: "MT-S220-7731",
      status: "IN_SERVICE",
      calibration_interval_days: 90,
      next_calibration_due: "2026-11-08",
    },
    {
      code: "TB-QC-PCR01",
      name: "Hệ thống Real-time PCR Chuẩn Kiểm nghiệm QC (QuantStudio 5)",
      asset_type: "PCR",
      dept: "P-QA",
      manufacturer: "Applied Biosystems",
      model: "QuantStudio 5 IVD",
      serial_no: "ABI-QS5-5501",
      status: "IN_SERVICE",
      calibration_interval_days: 180,
      next_calibration_due: "2026-11-10",
    },
    {
      code: "TB-QC-BAL01",
      name: "Cân phân tích 5 số lẻ Sartorius Cubis II (Phòng QA/QC)",
      asset_type: "BALANCE",
      dept: "P-QA",
      manufacturer: "Sartorius",
      model: "MCA225S-2S00",
      serial_no: "SAR-551902",
      status: "IN_SERVICE",
      calibration_interval_days: 180,
      next_calibration_due: "2027-01-15",
    },
    {
      code: "TB-QC-SPEC01",
      name: "Máy quang phổ NanoDrop OneC Đo nồng độ DNA/RNA (QC)",
      asset_type: "SPECTROPHOTOMETER",
      dept: "P-QA",
      manufacturer: "Thermo Scientific",
      model: "NanoDrop OneC",
      serial_no: "ND-ONEC-3318",
      status: "IN_SERVICE",
      calibration_interval_days: 365,
      next_calibration_due: "2027-04-01",
    },
  ];

  for (const item of seedAssets) {
    const ownerId = byCode.get(item.dept);
    if (!ownerId) continue;
    const exists = await tx.query("SELECT id FROM asset.asset WHERE code = $1 LIMIT 1", [item.code]);
    if (!exists.rowCount) {
      await tx.query(
        `INSERT INTO asset.asset
           (code, name, asset_type, owner_org_unit_id, manufacturer, model, serial_no, status, calibration_interval_days, next_calibration_due)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          item.code,
          item.name,
          item.asset_type,
          ownerId,
          item.manufacturer,
          item.model,
          item.serial_no,
          item.status,
          item.calibration_interval_days,
          item.next_calibration_due,
        ]
      );
    }
  }

  // Ensure sample maintenance/calibration requests exist so Engineering & Technology sees the live queue
  const evCount = Number((await tx.query("SELECT count(*)::int AS c FROM asset.event")).rows[0]?.c ?? 0);
  if (evCount === 0) {
    const kitRobot = (await tx.query("SELECT id FROM asset.asset WHERE code = 'TB-KIT-DISP01' LIMIT 1")).rows[0];
    const rdPcr = (await tx.query("SELECT id FROM asset.asset WHERE code = 'TB-RD-PCR01' LIMIT 1")).rows[0];
    const qcPcr = (await tx.query("SELECT id FROM asset.asset WHERE code = 'TB-QC-PCR01' LIMIT 1")).rows[0];
    if (kitRobot) {
      await tx.query(
        `INSERT INTO asset.event (code, asset_id, kind, status, planned_date, assignee, description, out_of_service)
         VALUES ('AE2610-0001', $1, 'MAINTENANCE', 'PLANNED', current_date + 3, 'Phòng Kỹ thuật – Thiết bị', 'Đề xuất từ Sản xuất Kit: Bảo trì định kỳ & kiểm tra độ chính xác đầu kim chiết rót Aliquot trước chiến dịch PO tháng 11', false)
         ON CONFLICT DO NOTHING`,
        [kitRobot.id]
      );
    }
    if (rdPcr) {
      await tx.query(
        `INSERT INTO asset.event (code, asset_id, kind, status, planned_date, assignee, description, out_of_service)
         VALUES ('AE2610-0002', $1, 'CALIBRATION', 'PLANNED', current_date + 5, 'Phòng Kỹ thuật – Thiết bị', 'Đề xuất từ R&D: Hiệu chuẩn định kỳ 5 kênh màu quang học FAM/HEX/ROX/Cy5 & block nhiệt máy CFX96', false)
         ON CONFLICT DO NOTHING`,
        [rdPcr.id]
      );
    }
    if (qcPcr) {
      await tx.query(
        `INSERT INTO asset.event (code, asset_id, kind, status, planned_date, assignee, description, out_of_service)
         VALUES ('AE2610-0003', $1, 'CALIBRATION', 'PLANNED', current_date + 2, 'Phòng Kỹ thuật – Thiết bị', 'Đề xuất từ QA/QC: Hiệu chuẩn nhiệt độ block 96 giếng máy QuantStudio 5 phục vụ xuất xưởng lô Kit', false)
         ON CONFLICT DO NOTHING`,
        [qcPcr.id]
      );
    }
  }
}

export async function listAssets(tx: Tx, actor: AuthzActor, type?: string, deptCode?: string) {
  await ensureAssetExtraColumnsSchema(tx);
  await ensureDepartmentEquipmentSeed(tx);
  await ensureLegacyOligoDataSeeded(tx);
  await ensureHplcReagentSlotsAndColumnsSeed(tx);
  await syncOverdueCalibrationAssets(tx);
  const rows = (
    await tx.query(
      `SELECT a.*, o.code AS owner_code, o.name AS owner_name, s.column_positions, s.supported_scales,
              (SELECT count(*)::int FROM asset.event e WHERE e.asset_id = a.id AND e.status = 'PLANNED') AS open_event_count
         FROM asset.asset a
         JOIN core.org_unit o ON o.id = a.owner_org_unit_id
         LEFT JOIN oligo.synthesizer s ON s.asset_id = a.id
        WHERE ($1::text IS NULL OR a.asset_type = $1)
          AND ($2::text IS NULL OR o.code = $2)
          AND a.status <> 'RETIRED'
        ORDER BY o.code, a.code`,
      [type ?? null, deptCode ?? null]
    )
  ).rows;
  return rows;
}
