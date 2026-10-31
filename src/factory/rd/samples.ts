import { z } from "zod";
import type { Tx } from "../core/db";
import { writeAudit } from "../core/audit";
import { authorize, authorizeAnywhere, hasFactoryPermission, type AuthzActor } from "../core/authz";
import { invalid, notFound } from "../core/errors";
import { nextNumber } from "../core/numbering";
import { insertRecord, parseInput } from "../core/records";
import "./permissions";

export type SampleStatus = "STORED" | "IN_USE" | "DEPLETED" | "DISPOSED" | "TRANSFERRED";

export interface SampleRow {
  id: string;
  code: string;
  org_unit_id: string;
  project_id: string | null;
  sample_type: "BLOOD" | "SERUM_PLASMA" | "SWAB" | "DNA" | "RNA" | "STRAIN" | "PLASMID" | "CONTROL_PANEL" | "OTHER";
  name: string;
  source: string;
  consent_ref: string | null;
  biosafety_level: "BSL1" | "BSL2" | "BSL3";
  target_pathogen: string | null;
  reference_ct: number | null;
  collected_at: string | null;
  warehouse_id: string | null;
  location_id: string | null;
  box_position: string | null;
  initial_volume: string;
  current_volume: string;
  uom: string;
  freeze_thaw_count: number;
  max_freeze_thaw: number;
  status: SampleStatus;
  notes: string | null;
  version: number;
}

const createSampleSchema = z.object({
  org_unit_id: z.string().uuid("chọn phòng R&D quản lý mẫu"),
  project_id: z.string().uuid().optional().nullable(),
  sample_type: z.enum(["BLOOD", "SERUM_PLASMA", "SWAB", "DNA", "RNA", "STRAIN", "PLASMID", "CONTROL_PANEL", "OTHER"]),
  name: z.string().trim().min(2, "nhập tên / mã nhận diện mẫu").max(250),
  source: z.string().trim().min(2, "nhập nguồn mẫu (Bệnh viện / ATCC / Ngoại kiểm...)").max(250),
  consent_ref: z.string().trim().max(200).optional().nullable(),
  biosafety_level: z.enum(["BSL1", "BSL2", "BSL3"]).default("BSL2"),
  target_pathogen: z.string().trim().max(200).optional().nullable(),
  reference_ct: z.coerce.number().min(0).max(50).optional().nullable(),
  collected_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  warehouse_id: z.string().uuid().optional().nullable(),
  location_id: z.string().uuid().optional().nullable(),
  box_position: z.string().trim().max(100).optional().nullable(),
  initial_volume: z.coerce.number().positive("thể tích ban đầu phải > 0"),
  uom: z.string().trim().min(1).default("µL"),
  max_freeze_thaw: z.coerce.number().int().min(1).max(20).default(3),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export async function createSample(tx: Tx, actor: AuthzActor, input: unknown) {
  const d = parseInput(createSampleSchema, input);
  await authorize(tx, actor, "rd.sample.manage", d.org_unit_id);
  const code = await nextNumber(tx, "RD_SAMPLE");
  const sample = await insertRecord<SampleRow>(tx, actor, "rd.sample", "rd_sample", {
    code,
    org_unit_id: d.org_unit_id,
    project_id: d.project_id ?? null,
    sample_type: d.sample_type,
    name: d.name,
    source: d.source,
    consent_ref: d.consent_ref ?? null,
    biosafety_level: d.biosafety_level,
    target_pathogen: d.target_pathogen ?? null,
    reference_ct: d.reference_ct ?? null,
    collected_at: d.collected_at ?? null,
    warehouse_id: d.warehouse_id ?? null,
    location_id: d.location_id ?? null,
    box_position: d.box_position ?? null,
    initial_volume: d.initial_volume,
    current_volume: d.initial_volume,
    uom: d.uom,
    max_freeze_thaw: d.max_freeze_thaw,
    notes: d.notes ?? null,
  });
  await tx.query(
    `INSERT INTO rd.sample_event (sample_id, event_type, volume_delta, to_location_id, reason, performed_by)
     VALUES ($1, 'RECEIVE', $2, $3, $4, $5)`,
    [sample.id, d.initial_volume, d.location_id ?? null, `Tiếp nhận mẫu từ ${d.source}`, actor.userId]
  );
  return sample;
}

const sampleActionSchema = z.object({
  event_type: z.enum(["MOVE", "THAW", "REFREEZE", "USE", "DISPOSE"]),
  volume_used: z.coerce.number().min(0).optional(),
  to_location_id: z.string().uuid().optional().nullable(),
  box_position: z.string().trim().max(100).optional().nullable(),
  experiment_id: z.string().uuid().optional().nullable(),
  is_quantitative: z.boolean().default(false),
  reason: z.string().trim().max(1000).optional().nullable(),
});

/**
 * Records a Biobank chain-of-custody event (docs/nha-may/02 §7.5):
 * - `THAW`: moves `STORED → IN_USE` and increments `freeze_thaw_count`.
 * - `REFREEZE`: returns `IN_USE → STORED`.
 * - `USE`: deducts `volume_used` from `current_volume` (automatically marks `DEPLETED` when 0);
 *   if `is_quantitative = true` and `freeze_thaw_count > max_freeze_thaw`, blocks use with a clear Vietnamese error.
 * - `MOVE`: updates `location_id` / `box_position`.
 * - `DISPOSE`: requires a mandatory reason and marks `DISPOSED`.
 */
export async function recordSampleEvent(tx: Tx, actor: AuthzActor, sampleId: string, input: unknown) {
  const d = parseInput(sampleActionSchema, input);
  const s = (await tx.query("SELECT * FROM rd.sample WHERE id = $1 FOR UPDATE", [sampleId])).rows[0] as SampleRow | undefined;
  if (!s) throw notFound("mẫu sinh học");
  await authorize(tx, actor, "rd.sample.manage", s.org_unit_id);
  if (["DEPLETED", "DISPOSED", "TRANSFERRED"].includes(s.status)) {
    throw invalid(`Mẫu ${s.code} đã ở trạng thái kết thúc (${s.status}), không thể thao tác thêm.`);
  }

  const curVol = Number(s.current_volume);
  let nextStatus: SampleStatus = s.status;
  let nextVol = curVol;
  let nextThaw = s.freeze_thaw_count;
  let volDelta = 0;
  let nextLoc = s.location_id;
  let nextBox = s.box_position;

  if (d.event_type === "THAW") {
    if (s.status !== "STORED") throw invalid("Mẫu đang ở ngoài tủ lưu (IN_USE), không cần rã đông lại.");
    nextStatus = "IN_USE";
    nextThaw = s.freeze_thaw_count + 1;
  } else if (d.event_type === "REFREEZE") {
    if (s.status !== "IN_USE") throw invalid("Chỉ cấp đông lại mẫu đang lấy ra sử dụng (IN_USE).");
    nextStatus = "STORED";
    if (d.to_location_id) nextLoc = d.to_location_id;
    if (d.box_position !== undefined) nextBox = d.box_position ?? s.box_position;
  } else if (d.event_type === "USE") {
    const used = Number(d.volume_used ?? 0);
    if (!(used > 0)) throw invalid("Nhập thể tích mẫu sử dụng (> 0).");
    if (used > curVol + 1e-9) {
      throw invalid(`Thể tích lấy dùng (${used} ${s.uom}) vượt quá lượng còn lại của mẫu (${curVol} ${s.uom}).`, undefined, "INSUFFICIENT_SAMPLE");
    }
    if (d.is_quantitative && s.freeze_thaw_count > s.max_freeze_thaw) {
      throw invalid(
        `Mẫu ${s.code} đã rã đông ${s.freeze_thaw_count} lần (vượt ngưỡng cho phép ${s.max_freeze_thaw} lần): bị chặn dùng cho thí nghiệm định lượng (LoD / chuẩn độ).`,
        undefined,
        "FREEZE_THAW_EXCEEDED"
      );
    }
    nextVol = Math.max(0, Math.round((curVol - used) * 1e6) / 1e6);
    volDelta = -used;
    if (nextVol === 0) nextStatus = "DEPLETED";
  } else if (d.event_type === "MOVE") {
    if (!d.to_location_id && !d.box_position) throw invalid("Chọn vị trí tủ hoặc hộp lưu mới khi di chuyển mẫu.");
    nextLoc = d.to_location_id ?? s.location_id;
    nextBox = d.box_position ?? s.box_position;
  } else if (d.event_type === "DISPOSE") {
    if (!d.reason || d.reason.length < 3) throw invalid("Bắt buộc nhập lý do tiêu hủy mẫu sinh học.");
    volDelta = -curVol;
    nextVol = 0;
    nextStatus = "DISPOSED";
  }

  await tx.query(
    `UPDATE rd.sample SET status = $2, current_volume = $3, freeze_thaw_count = $4, location_id = $5, box_position = $6,
            version = version + 1, updated_at = now(), updated_by = $7
      WHERE id = $1`,
    [sampleId, nextStatus, nextVol, nextThaw, nextLoc, nextBox, actor.userId]
  );

  await tx.query(
    `INSERT INTO rd.sample_event (sample_id, event_type, volume_delta, from_location_id, to_location_id, experiment_id, is_quantitative, reason, performed_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [sampleId, d.event_type, volDelta, s.location_id, nextLoc, d.experiment_id ?? null, d.is_quantitative, d.reason ?? null, actor.userId]
  );

  await writeAudit(tx, actor, {
    entityType: "rd_sample",
    entityId: sampleId,
    action: d.event_type.toLowerCase(),
    changes: {
      status: [s.status, nextStatus],
      current_volume: [curVol, nextVol],
      freeze_thaw_count: [s.freeze_thaw_count, nextThaw],
    },
    reason: d.reason ?? null,
  });

  return getSampleDetail(tx, actor, sampleId);
}

export async function listSamples(tx: Tx, actor: AuthzActor, projectId?: string) {
  await authorizeAnywhere(tx, actor, "rd.view");
  const rows = (
    await tx.query(
      `SELECT s.*, s.initial_volume::float AS initial_volume, s.current_volume::float AS current_volume,
              s.reference_ct::float AS reference_ct, u.name AS org_unit_name, p.code AS project_code,
              w.code AS warehouse_code, loc.code AS location_code, loc.temperature_condition,
              (s.freeze_thaw_count > s.max_freeze_thaw) AS thaw_warning
         FROM rd.sample s
         JOIN core.org_unit u ON u.id = s.org_unit_id
         LEFT JOIN rd.project p ON p.id = s.project_id
         LEFT JOIN master.warehouse w ON w.id = s.warehouse_id
         LEFT JOIN master.location loc ON loc.id = s.location_id
        WHERE ($1::uuid IS NULL OR s.project_id = $1)
        ORDER BY s.created_at DESC LIMIT 300`,
      [projectId ?? null]
    )
  ).rows;
  const visible = [];
  for (const r of rows) {
    if (await hasFactoryPermission(tx, actor, "rd.view", r.org_unit_id)) visible.push(r);
  }
  return visible;
}

export async function getSampleDetail(tx: Tx, actor: AuthzActor, id: string) {
  const s = (
    await tx.query(
      `SELECT s.*, s.initial_volume::float AS initial_volume, s.current_volume::float AS current_volume,
              s.reference_ct::float AS reference_ct, u.name AS org_unit_name, p.code AS project_code, p.name AS project_name,
              w.code AS warehouse_code, loc.code AS location_code, loc.temperature_condition,
              (s.freeze_thaw_count > s.max_freeze_thaw) AS thaw_warning
         FROM rd.sample s
         JOIN core.org_unit u ON u.id = s.org_unit_id
         LEFT JOIN rd.project p ON p.id = s.project_id
         LEFT JOIN master.warehouse w ON w.id = s.warehouse_id
         LEFT JOIN master.location loc ON loc.id = s.location_id
        WHERE s.id = $1`,
      [id]
    )
  ).rows[0];
  if (!s) throw notFound("mẫu sinh học");
  await authorize(tx, actor, "rd.view", s.org_unit_id);
  const events = (
    await tx.query(
      `SELECT e.*, e.volume_delta::float AS volume_delta, up.display_name AS performed_by_name,
              fl.code AS from_location_code, tl.code AS to_location_code, ex.code AS experiment_code
         FROM rd.sample_event e
         LEFT JOIN core.user_profile up ON up.user_id = e.performed_by
         LEFT JOIN master.location fl ON fl.id = e.from_location_id
         LEFT JOIN master.location tl ON tl.id = e.to_location_id
         LEFT JOIN rd.experiment ex ON ex.id = e.experiment_id
        WHERE e.sample_id = $1 ORDER BY e.performed_at DESC`,
      [id]
    )
  ).rows;
  return { ...s, events };
}
