import { z } from "zod";
import type { Tx } from "../core/db";
import { writeAudit } from "../core/audit";
import { authorize, authorizeAnywhere, hasFactoryPermission, type AuthzActor } from "../core/authz";
import { invalid, notFound } from "../core/errors";
import { nextNumber } from "../core/numbering";
import { insertRecord, parseInput } from "../core/records";
import "./permissions";

export type SampleStatus = "STORED" | "IN_USE" | "DEPLETED" | "DISPOSED" | "TRANSFERRED";

export interface ClinicalSpecimenItem {
  id: string;
  patientId: string;
  diagnosis: string;
  volume: number;
  unit: string;
  status: string;
  location?: string;
}

export interface SampleGrowthHistoryItem {
  id: string;
  date: string;
  action: string;
  performer: string;
  details: string;
  resultVolume?: string;
}

export interface SampleMetadata {
  category?: string;
  concentration?: string;
  qcStatus?: string;
  growthStatus?: "Stock" | "Activated" | "Culturing" | "Degraded";
  locationText?: string;
  coaName?: string | null;
  parentId?: string | null;
  parentCode?: string | null;
  parentName?: string | null;
  lineageType?: "culture" | "aliquot" | "extraction" | null;
  specimens?: ClinicalSpecimenItem[];
  growthHistory?: SampleGrowthHistoryItem[];
}

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
  metadata?: SampleMetadata;
  version: number;
}

let schemaEnsured = false;

async function ensureSampleSchema(tx: Tx) {
  if (schemaEnsured) return;
  await tx.query(`ALTER TABLE rd.sample ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb`);
  await tx.query(`
    INSERT INTO master.uom (code, name, dimension) VALUES
      ('ml', 'mililít', 'VOLUME'),
      ('ul', 'microlít', 'VOLUME'),
      ('mL', 'mililít', 'VOLUME'),
      ('µL', 'microlít', 'VOLUME'),
      ('vial', 'lọ/vial', 'COUNT'),
      ('tube', 'ống', 'COUNT')
    ON CONFLICT (code) DO NOTHING
  `);
  schemaEnsured = true;
}

function normalizeUom(raw?: string | null): string {
  const u = (raw || "µL").trim();
  if (u === "ml") return "mL";
  if (u === "ul" || u === "uL") return "µL";
  if (u === "ống" || u === "ong") return "tube";
  if (u === "lọ" || u === "lo") return "vial";
  if (["mL", "µL", "L", "g", "mg", "µg", "kg", "vial", "tube", "pcs", "box", "kit", "test", "OD", "nmol", "µmol"].includes(u)) {
    return u;
  }
  return "mL";
}

function mapCategoryToSampleType(
  category?: string | null,
  fallback?: SampleRow["sample_type"]
): SampleRow["sample_type"] {
  if (fallback) return fallback;
  const c = (category || "").trim();
  if (c === "Bệnh phẩm") return "SWAB";
  if (c === "Vi khuẩn chuẩn" || c === "Virus chuẩn") return "STRAIN";
  if (c === "DNA chuẩn") return "DNA";
  if (c === "RNA") return "RNA";
  if (c === "Plasmid chứng dương") return "PLASMID";
  if (c === "Panel ngoại kiểm" || c === "Panel ngoại kiểm / Chuẩn quốc tế") return "CONTROL_PANEL";
  return "OTHER";
}

function mapSampleTypeToCategory(sampleType: string, metaCategory?: string): string {
  if (metaCategory) return metaCategory;
  switch (sampleType) {
    case "BLOOD":
    case "SERUM_PLASMA":
    case "SWAB":
      return "Bệnh phẩm";
    case "STRAIN":
      return "Vi khuẩn chuẩn";
    case "DNA":
      return "DNA chuẩn";
    case "RNA":
      return "RNA";
    case "PLASMID":
      return "Plasmid chứng dương";
    case "CONTROL_PANEL":
      return "Panel ngoại kiểm";
    default:
      return "Bệnh phẩm";
  }
}

function parseReferenceCt(concentration?: string | null, explicitCt?: number | null): number | null {
  if (typeof explicitCt === "number" && !Number.isNaN(explicitCt)) return explicitCt;
  if (!concentration) return null;
  const m = concentration.match(/Ct\s*=\s*(\d+(\.\d+)?)/i);
  if (m) {
    const val = parseFloat(m[1]);
    if (!Number.isNaN(val) && val >= 0 && val <= 50) return val;
  }
  return null;
}

async function resolveDefaultRdOrgUnitId(tx: Tx, providedOrgUnitId?: string | null): Promise<string> {
  if (providedOrgUnitId) return providedOrgUnitId;
  const r = await tx.query(
    `SELECT id FROM core.org_unit WHERE code IN ('P-RD', 'RD', 'KHOI-SX') OR name ILIKE '%R&D%' OR name ILIKE '%Nghiên cứu%' ORDER BY created_at ASC LIMIT 1`
  );
  if (r.rows[0]?.id) return r.rows[0].id;
  const anyUnit = await tx.query(`SELECT id FROM core.org_unit ORDER BY created_at ASC LIMIT 1`);
  if (anyUnit.rows[0]?.id) return anyUnit.rows[0].id;
  throw invalid("Chưa có đơn vị tổ chức R&D trên hệ thống.");
}

const createSampleSchema = z.object({
  action: z.enum(["CREATE", "BULK_IMPORT", "CLEAR_ALL"]).optional(),
  org_unit_id: z.string().uuid("chọn phòng R&D quản lý mẫu").optional().nullable(),
  project_id: z.string().uuid().optional().nullable(),
  custom_code: z.string().trim().max(80).optional().nullable(),
  sample_type: z
    .enum(["BLOOD", "SERUM_PLASMA", "SWAB", "DNA", "RNA", "STRAIN", "PLASMID", "CONTROL_PANEL", "OTHER"])
    .optional(),
  category: z.string().trim().max(100).optional().nullable(),
  name: z.string().trim().min(2, "nhập tên / mã nhận diện mẫu").max(250).optional(),
  source: z.string().trim().min(2, "nhập nguồn mẫu (Bệnh viện / ATCC / Ngoại kiểm...)").max(250).optional(),
  consent_ref: z.string().trim().max(200).optional().nullable(),
  biosafety_level: z.enum(["BSL1", "BSL2", "BSL3"]).default("BSL2"),
  target_pathogen: z.string().trim().max(200).optional().nullable(),
  concentration: z.string().trim().max(200).optional().nullable(),
  reference_ct: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? null : Number(v)),
    z.number().min(0).max(50).nullable().optional()
  ),
  collected_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  warehouse_id: z.preprocess((v) => (v === "" ? null : v), z.string().uuid().optional().nullable()),
  location_id: z.preprocess((v) => (v === "" ? null : v), z.string().uuid().optional().nullable()),
  box_position: z.string().trim().max(250).optional().nullable(),
  initial_volume: z.coerce.number().min(0).optional(),
  uom: z.string().trim().min(1).default("µL"),
  max_freeze_thaw: z.coerce.number().int().min(1).max(20).default(3),
  qc_status: z.string().trim().max(100).optional().nullable(),
  coa_name: z.string().trim().max(250).optional().nullable(),
  specimens: z
    .array(
      z.object({
        id: z.string(),
        patientId: z.string(),
        diagnosis: z.string(),
        volume: z.coerce.number(),
        unit: z.string(),
        status: z.string(),
        location: z.string().optional(),
      })
    )
    .optional(),
  samples: z.array(z.any()).optional(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export async function createSample(
  tx: Tx,
  actor: AuthzActor,
  input: unknown
): Promise<SampleRow & { cleared?: number; imported?: number; items?: SampleRow[] }> {
  await ensureSampleSchema(tx);
  const d = parseInput(createSampleSchema, input);
  const orgUnitId = await resolveDefaultRdOrgUnitId(tx, d.org_unit_id);
  await authorize(tx, actor, "rd.sample.manage", orgUnitId);

  if (d.action === "CLEAR_ALL") {
    const disposed = await tx.query(
      `UPDATE rd.sample
          SET status = 'DISPOSED',
              current_volume = 0,
              version = version + 1,
              updated_at = now(),
              updated_by = $2
        WHERE org_unit_id = $1 AND status <> 'DISPOSED'
        RETURNING id, code, status AS old_status, current_volume`,
      [orgUnitId, actor.userId]
    );
    for (const row of disposed.rows) {
      await tx.query(
        `INSERT INTO rd.sample_event (sample_id, event_type, volume_delta, reason, performed_by)
         VALUES ($1, 'DISPOSE', 0, $2, $3)`,
        [row.id, d.notes || "Thanh lý / Lưu trữ hàng loạt mẫu sinh học (Soft Disposal)", actor.userId]
      );
      await writeAudit(tx, actor, {
        entityType: "rd_sample",
        entityId: row.id,
        action: "dispose_bulk",
        changes: { status: ["STORED", "DISPOSED"] },
        reason: d.notes || "Thanh lý / Lưu trữ hàng loạt mẫu sinh học",
      });
    }
    return { cleared: disposed.rowCount ?? 0 } as any;
  }

  if (d.action === "BULK_IMPORT" && Array.isArray(d.samples)) {
    const imported: SampleRow[] = [];
    for (const item of d.samples) {
      const code = (item.code || item.id || "").trim() || (await nextNumber(tx, "RD_SAMPLE"));
      const rawVol = Math.max(0, Number(item.volume ?? item.initial_volume ?? 1));
      const initVol = rawVol > 0 ? rawVol : 1;
      const uom = normalizeUom(item.unit || item.uom || "mL");
      const category = item.category || "Bệnh phẩm";
      const sampleType = mapCategoryToSampleType(category, item.sample_type);
      const concentration = item.concentration || (item.reference_ct ? `Ct = ${item.reference_ct}` : "Chưa xác định");
      const qcStatus = item.status || item.qcStatus || (rawVol <= 0 ? "Hết mẫu" : "Đạt tiêu chuẩn");
      const growthStatus = item.growthStatus || "Stock";
      const boxPos = item.location || item.box_position || "Chưa phân bổ";
      const collectedAt =
        typeof item.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(item.date)
          ? item.date
          : new Date().toISOString().slice(0, 10);

      const meta: SampleMetadata = {
        category,
        concentration,
        qcStatus,
        growthStatus,
        locationText: boxPos,
        coaName: item.coaName || null,
        specimens: Array.isArray(item.specimens) ? item.specimens : undefined,
        growthHistory: Array.isArray(item.growthHistory)
          ? item.growthHistory
          : [
              {
                id: `GH-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                date: collectedAt,
                action: "Khởi tạo",
                performer: "Hệ thống Import",
                details: "Nhập hàng loạt từ file Excel/CSV",
                resultVolume: `${rawVol} ${item.unit || uom}`,
              },
            ],
      };

      const existing = await tx.query(`SELECT id FROM rd.sample WHERE code = $1`, [code]);
      const finalCode = existing.rows[0] ? `${code}-${Math.floor(100 + Math.random() * 900)}` : code;

      const sample = await insertRecord<SampleRow>(tx, actor, "rd.sample", "rd_sample", {
        code: finalCode,
        org_unit_id: orgUnitId,
        project_id: d.project_id ?? null,
        sample_type: sampleType,
        name: item.name || "Mẫu không tên",
        source: item.source || "Không rõ",
        biosafety_level: "BSL2",
        target_pathogen: item.target || item.target_pathogen || "Chưa xác định",
        reference_ct: parseReferenceCt(concentration, null),
        collected_at: collectedAt,
        box_position: boxPos,
        initial_volume: initVol,
        current_volume: rawVol,
        uom,
        status: rawVol <= 0 ? "DEPLETED" : "STORED",
        metadata: meta as any,
      });
      imported.push(sample);
    }
    return { imported: imported.length, items: imported } as any;
  }

  if (!d.name || d.name.trim().length < 2) throw invalid("Nhập tên / nhãn mẫu sinh học.");
  if (!d.source || d.source.trim().length < 2) throw invalid("Nhập nguồn gốc mẫu (Bệnh viện / Viện / ATCC...).");

  const specimens = Array.isArray(d.specimens) ? d.specimens : [];
  const totalSpecimenVol = specimens.reduce((acc, sp) => acc + (Number(sp.volume) || 0), 0);
  const rawVol = specimens.length > 0 ? Number(totalSpecimenVol.toFixed(4)) : Number(d.initial_volume ?? 0);
  if (!(rawVol > 0)) throw invalid("Thể tích ban đầu phải > 0.");

  const uom = normalizeUom(d.uom);
  const category = d.category || mapSampleTypeToCategory(d.sample_type || "OTHER");
  const sampleType = mapCategoryToSampleType(category, d.sample_type);
  const concentration =
    d.concentration ||
    (specimens.length > 0 ? `Lô ${specimens.length} mẫu bệnh phẩm` : d.reference_ct != null ? `Ct = ${d.reference_ct}` : "Chưa xác định");
  const refCt = parseReferenceCt(concentration, d.reference_ct ?? null);
  const qcStatus = d.qc_status || "Đạt tiêu chuẩn";
  const collectedAt = d.collected_at || new Date().toISOString().slice(0, 10);
  const code = d.custom_code?.trim() || (await nextNumber(tx, "RD_SAMPLE"));

  const performerRes = await tx.query(`SELECT display_name FROM core.user_profile WHERE user_id = $1`, [actor.userId]);
  const performerName = performerRes.rows[0]?.display_name || "Nghiên cứu viên R&D";

  const metadata: SampleMetadata = {
    category,
    concentration,
    qcStatus,
    growthStatus: "Stock",
    locationText: d.box_position || "",
    coaName: d.coa_name || null,
    specimens: specimens.length > 0 ? specimens : undefined,
    growthHistory: [
      {
        id: `GH-${Date.now()}`,
        date: collectedAt,
        action: "Khởi tạo",
        performer: performerName,
        details:
          specimens.length > 0
            ? `Đăng ký lô mẫu mới từ ${d.source} (Kèm danh sách ${specimens.length} ống bệnh phẩm chi tiết)`
            : `Đăng ký mẫu mới từ ${d.source}`,
        resultVolume: `${rawVol} ${d.uom || uom}`,
      },
    ],
  };

  const sample = await insertRecord<SampleRow>(tx, actor, "rd.sample", "rd_sample", {
    code,
    org_unit_id: orgUnitId,
    project_id: d.project_id ?? null,
    sample_type: sampleType,
    name: d.name,
    source: d.source,
    consent_ref: d.consent_ref ?? null,
    biosafety_level: d.biosafety_level,
    target_pathogen: d.target_pathogen ?? null,
    reference_ct: refCt,
    collected_at: collectedAt,
    warehouse_id: d.warehouse_id ?? null,
    location_id: d.location_id ?? null,
    box_position: d.box_position ?? null,
    initial_volume: rawVol,
    current_volume: rawVol,
    uom,
    max_freeze_thaw: d.max_freeze_thaw,
    notes: d.notes ?? null,
    metadata: metadata as any,
  });
  await tx.query(
    `INSERT INTO rd.sample_event (sample_id, event_type, volume_delta, to_location_id, reason, performed_by)
     VALUES ($1, 'RECEIVE', $2, $3, $4, $5)`,
    [sample.id, rawVol, d.location_id ?? null, `Tiếp nhận mẫu từ ${d.source}`, actor.userId]
  );
  return sample;
}

const sampleActionSchema = z.object({
  event_type: z.enum([
    "MOVE",
    "THAW",
    "REFREEZE",
    "USE",
    "DISPOSE",
    "PROLIFERATE",
    "CREATE_CHILDREN",
    "IMPORT_SPECIMENS",
    "AUTO_GENERATE_SPECIMENS",
    "ADD_SINGLE_SPECIMEN",
    "CONSUME_SPECIMEN",
    "DELETE",
  ]),
  volume_used: z.coerce.number().min(0).optional(),
  to_location_id: z.preprocess((v) => (v === "" ? null : v), z.string().uuid().optional().nullable()),
  box_position: z.string().trim().max(250).optional().nullable(),
  experiment_id: z.preprocess((v) => (v === "" ? null : v), z.string().uuid().optional().nullable()),
  is_quantitative: z.boolean().default(false),
  reason: z.string().trim().max(1000).optional().nullable(),
  // Rich R&D lifecycle fields
  performer: z.string().trim().max(200).optional().nullable(),
  project_use: z.string().trim().max(300).optional().nullable(),
  purpose: z.string().trim().max(500).optional().nullable(),
  date: z.string().trim().max(40).optional().nullable(),
  // Proliferation fields
  conditions: z.string().trim().max(500).optional().nullable(),
  new_volume: z.coerce.number().positive().optional(),
  new_concentration: z.string().trim().max(200).optional().nullable(),
  // Child sample creation fields
  is_multiple_tubes: z.boolean().optional(),
  tube_count: z.coerce.number().int().min(1).max(100).optional(),
  lineage_type: z.enum(["culture", "aliquot", "extraction"]).optional(),
  child_name: z.string().trim().max(250).optional(),
  child_code: z.string().trim().max(80).optional(),
  child_unit: z.string().trim().max(20).optional(),
  inoculum_volume: z.coerce.number().positive().optional(),
  child_volume: z.coerce.number().positive().optional(),
  child_concentration: z.string().trim().max(200).optional(),
  child_location: z.string().trim().max(250).optional(),
  // Clinical specimen management fields
  specimens_csv: z.string().optional(),
  specimen: z
    .object({
      id: z.string().trim().min(1),
      patientId: z.string().trim().min(1),
      diagnosis: z.string().trim().min(1),
      volume: z.coerce.number().positive(),
      location: z.string().trim().optional(),
    })
    .optional(),
  specimen_id: z.string().trim().optional(),
});

/**
 * Records a Biobank chain-of-custody event or R&D sample lifecycle operation:
 * - `THAW`, `REFREEZE`, `USE`, `MOVE`, `DISPOSE` (Biobank chain of custody)
 * - `PROLIFERATE` (Hoạt hóa / Tăng sinh chủng vi sinh vật)
 * - `CREATE_CHILDREN` (Tạo 1 hoặc nhiều ống mẫu con: nuôi cấy, aliquot, tách chiết DNA/RNA)
 * - `IMPORT_SPECIMENS`, `AUTO_GENERATE_SPECIMENS`, `ADD_SINGLE_SPECIMEN`, `CONSUME_SPECIMEN` (Quản lý ống bệnh phẩm lâm sàng)
 * - `DELETE` (Xóa mẫu sinh học)
 */
export async function recordSampleEvent(tx: Tx, actor: AuthzActor, sampleId: string, input: unknown) {
  await ensureSampleSchema(tx);
  const d = parseInput(sampleActionSchema, input);
  const s = (await tx.query("SELECT * FROM rd.sample WHERE id = $1 FOR UPDATE", [sampleId])).rows[0] as SampleRow | undefined;
  if (!s) throw notFound("mẫu sinh học");
  await authorize(tx, actor, "rd.sample.manage", s.org_unit_id);

  if (d.event_type === "DELETE") {
    const reasonText = d.reason?.trim() || "Thanh lý / ngừng sử dụng mẫu sinh học (Soft Disposal)";
    await tx.query(
      `UPDATE rd.sample
          SET status = 'DISPOSED',
              current_volume = 0,
              version = version + 1,
              updated_at = now(),
              updated_by = $2
        WHERE id = $1`,
      [sampleId, actor.userId]
    );
    await tx.query(
      `INSERT INTO rd.sample_event (sample_id, event_type, volume_delta, reason, performed_by)
       VALUES ($1, 'DISPOSE', $2, $3, $4)`,
      [sampleId, -Number(s.current_volume || 0), reasonText, actor.userId]
    );
    await writeAudit(tx, actor, {
      entityType: "rd_sample",
      entityId: sampleId,
      action: "dispose",
      changes: {
        status: [s.status, "DISPOSED"],
        current_volume: [Number(s.current_volume || 0), 0],
      },
      reason: reasonText,
    });
    return { deleted: true, disposed: true, id: sampleId, status: "DISPOSED" };
  }

  const performerRes = await tx.query(`SELECT display_name FROM core.user_profile WHERE user_id = $1`, [actor.userId]);
  const performerName = d.performer?.trim() || performerRes.rows[0]?.display_name || "Nghiên cứu viên R&D";
  const actionDate = d.date || new Date().toISOString().slice(0, 10);

  const meta: SampleMetadata = {
    category: mapSampleTypeToCategory(s.sample_type, s.metadata?.category),
    concentration: s.metadata?.concentration || (s.reference_ct != null ? `Ct = ${s.reference_ct}` : "Chưa xác định"),
    qcStatus: s.metadata?.qcStatus || (Number(s.current_volume) <= 0 ? "Hết mẫu" : "Đạt tiêu chuẩn"),
    growthStatus: s.metadata?.growthStatus || "Stock",
    locationText: s.metadata?.locationText || s.box_position || "",
    coaName: s.metadata?.coaName ?? null,
    parentId: s.metadata?.parentId ?? null,
    parentCode: s.metadata?.parentCode ?? null,
    parentName: s.metadata?.parentName ?? null,
    lineageType: s.metadata?.lineageType ?? null,
    specimens: Array.isArray(s.metadata?.specimens) ? [...s.metadata!.specimens!] : undefined,
    growthHistory: Array.isArray(s.metadata?.growthHistory) ? [...s.metadata!.growthHistory!] : [],
  };

  const curVol = Number(s.current_volume);

  // 1. Proliferate / Activate strain
  if (d.event_type === "PROLIFERATE") {
    const newVol = Number(d.new_volume ?? curVol);
    if (!(newVol > 0)) throw invalid("Nhập thể tích thu hoạch sau tăng sinh (> 0).");
    const newConc = d.new_concentration?.trim() || meta.concentration || "";
    const cond = d.conditions?.trim() || "Nuôi cấy hoạt hóa chủng chuẩn";
    meta.concentration = newConc;
    meta.growthStatus = "Activated";
    meta.qcStatus = "Đạt tiêu chuẩn";
    meta.growthHistory!.push({
      id: `GH-${Date.now()}`,
      date: actionDate,
      action: "Tăng sinh",
      performer: performerName,
      details: `${cond}. Đạt nồng độ/mật độ mới: ${newConc}`,
      resultVolume: `${newVol} ${s.uom}`,
    });
    const nextStatus: SampleStatus = s.status === "DEPLETED" ? "STORED" : s.status;
    await tx.query(
      `UPDATE rd.sample
          SET status = $2, current_volume = $3, metadata = $4::jsonb,
              version = version + 1, updated_at = now(), updated_by = $5
        WHERE id = $1`,
      [sampleId, nextStatus, newVol, JSON.stringify(meta), actor.userId]
    );
    await tx.query(
      `INSERT INTO rd.sample_event (sample_id, event_type, volume_delta, reason, performed_by)
       VALUES ($1, 'RECEIVE', $2, $3, $4)`,
      [sampleId, Number((newVol - curVol).toFixed(6)), `Tăng sinh / Hoạt hóa: ${cond} (${newConc})`, actor.userId]
    );
    return getSampleDetail(tx, actor, sampleId);
  }

  // 2. Create 1 or multiple child samples (Culture / Aliquot / Extraction)
  if (d.event_type === "CREATE_CHILDREN") {
    const isMulti = Boolean(d.is_multiple_tubes);
    const tubeCount = isMulti ? Math.max(2, Math.min(100, Number(d.tube_count ?? 2))) : 1;
    const inoculumPerTube = Number(d.inoculum_volume ?? 0);
    const childVol = Number(d.child_volume ?? 0);
    if (!(inoculumPerTube > 0) || !(childVol > 0)) {
      throw invalid("Thể tích trích mẫu mẹ và thể tích ống mẫu con phải > 0.");
    }
    const totalInoculum = Number((inoculumPerTube * tubeCount).toFixed(6));
    if (totalInoculum > curVol + 1e-9) {
      throw invalid(
        `Tổng thể tích trích từ mẫu mẹ (${totalInoculum} ${s.uom} cho ${tubeCount} ống) vượt quá lượng tồn hiện tại (${curVol} ${s.uom}).`,
        undefined,
        "INSUFFICIENT_SAMPLE"
      );
    }

    const lineageType = d.lineage_type || "culture";
    const lineageLabel =
      lineageType === "culture"
        ? "Nuôi cấy tăng sinh mẫu con"
        : lineageType === "aliquot"
          ? "Chia nhỏ mẫu (Aliquot)"
          : "Tách chiết DNA/RNA";

    let childCat = meta.category || "Vi khuẩn chuẩn";
    if (lineageType === "extraction") {
      childCat = (d.child_name || "").toUpperCase().includes("RNA") ? "RNA" : "DNA chuẩn";
    }
    const childSampleType = mapCategoryToSampleType(childCat);
    const childUom = normalizeUom(d.child_unit || s.uom);
    const childConc = d.child_concentration?.trim() || meta.concentration || "Chưa xác định";
    const childLoc = d.child_location?.trim() || s.box_position || "";
    const baseCode = (d.child_code || `${s.code}-F1`).trim();
    const baseName = (d.child_name || `${s.name} (Mẫu con)`).trim();

    const createdChildren: SampleRow[] = [];
    for (let i = 1; i <= tubeCount; i++) {
      const codeCandidate = isMulti ? `${baseCode}-${i}` : baseCode;
      const dupCheck = await tx.query(`SELECT id FROM rd.sample WHERE code = $1`, [codeCandidate]);
      const finalChildCode = dupCheck.rows[0] ? `${codeCandidate}-${Math.floor(100 + Math.random() * 900)}` : codeCandidate;
      const finalChildName = isMulti ? `${baseName} #${i}` : baseName;

      const childMeta: SampleMetadata = {
        category: childCat,
        concentration: childConc,
        qcStatus: "Đạt tiêu chuẩn",
        growthStatus: lineageType === "culture" ? "Activated" : "Stock",
        locationText: childLoc,
        coaName: null,
        parentId: s.id,
        parentCode: s.code,
        parentName: s.name,
        lineageType,
        growthHistory: [
          {
            id: `GH-${Date.now()}-C-${i}`,
            date: actionDate,
            action: "Khởi tạo",
            performer: performerName,
            details: `Được tạo từ mẫu mẹ [${s.code} - ${s.name}] qua hình thức: ${lineageLabel} (Trích ${inoculumPerTube} ${s.uom} mẫu mẹ)`,
            resultVolume: `${childVol} ${childUom}`,
          },
        ],
      };

      const childRow = await insertRecord<SampleRow>(tx, actor, "rd.sample", "rd_sample", {
        code: finalChildCode,
        org_unit_id: s.org_unit_id,
        project_id: s.project_id,
        sample_type: childSampleType,
        name: finalChildName,
        source: `Tạo từ mẫu mẹ ${s.code} (${s.source})`,
        biosafety_level: s.biosafety_level,
        target_pathogen: s.target_pathogen,
        reference_ct: parseReferenceCt(childConc, s.reference_ct ? Number(s.reference_ct) : null),
        collected_at: actionDate,
        warehouse_id: s.warehouse_id,
        location_id: s.location_id,
        box_position: childLoc,
        initial_volume: childVol,
        current_volume: childVol,
        uom: childUom,
        max_freeze_thaw: s.max_freeze_thaw,
        status: "STORED",
        metadata: childMeta as any,
      });
      createdChildren.push(childRow);
    }

    const nextParentVol = Math.max(0, Number((curVol - totalInoculum).toFixed(6)));
    const nextParentStatus: SampleStatus = nextParentVol === 0 ? "DEPLETED" : s.status;
    if (nextParentVol === 0) meta.qcStatus = "Hết mẫu";

    meta.growthHistory!.push({
      id: `GH-${Date.now()}-P`,
      date: actionDate,
      action: "Tạo mẫu con",
      performer: performerName,
      details: isMulti
        ? `[${lineageLabel} - Chia ${tubeCount} ống] Trích tổng ${totalInoculum} ${s.uom} (${inoculumPerTube} ${s.uom}/ống) để tạo lô ${tubeCount} mẫu con: ${baseName} (${baseCode}-1 -> ${baseCode}-${tubeCount})`
        : `[${lineageLabel}] Trích ${inoculumPerTube} ${s.uom} để tạo mẫu con mới: ${baseName} (Mã: ${baseCode})`,
      resultVolume: `${nextParentVol} ${s.uom}`,
    });

    await tx.query(
      `UPDATE rd.sample
          SET status = $2, current_volume = $3, metadata = $4::jsonb,
              version = version + 1, updated_at = now(), updated_by = $5
        WHERE id = $1`,
      [sampleId, nextParentStatus, nextParentVol, JSON.stringify(meta), actor.userId]
    );

    await tx.query(
      `INSERT INTO rd.sample_event (sample_id, event_type, volume_delta, reason, performed_by)
       VALUES ($1, 'ALIQUOT', $2, $3, $4)`,
      [
        sampleId,
        -totalInoculum,
        `${lineageLabel}: tạo ${tubeCount} ống mẫu con (${createdChildren.map((c) => c.code).join(", ")})`,
        actor.userId,
      ]
    );

    const updatedParent = await getSampleDetail(tx, actor, sampleId);
    return { ...updatedParent, created_children: createdChildren };
  }

  // 3. Clinical Specimen Sub-table Operations (for "Bệnh phẩm")
  if (d.event_type === "IMPORT_SPECIMENS") {
    const rawCsv = (d.specimens_csv || "").trim();
    if (!rawCsv) throw invalid("Không có dữ liệu bệnh phẩm để nhập.");
    const lines = rawCsv.split(/\r?\n/).filter((l) => l.trim() !== "");
    const existingSpecs = meta.specimens || [];
    const addedSpecs: ClinicalSpecimenItem[] = [];
    lines.forEach((line, idx) => {
      const parts = line.split(/[,\t]/).map((p) => p.trim());
      if (parts.length >= 2) {
        const vol = parseFloat(parts[3]);
        const specVol = !Number.isNaN(vol) ? vol : 0.5;
        addedSpecs.push({
          id: parts[0] || `CL-IMP-${Date.now().toString().slice(-3)}-${idx + 1}`,
          patientId: parts[1] || "Khuyết danh",
          diagnosis: parts[2] || "Chưa có kết quả",
          volume: specVol,
          unit: s.uom,
          status: specVol <= 0 ? "Hết mẫu" : "Đạt",
          location: parts[4] || s.box_position || "Kệ lưu mẫu lâm sàng",
        });
      }
    });
    if (addedSpecs.length === 0) throw invalid("Định dạng dữ liệu không hợp lệ. Vui lòng nhập theo: Mã_mẫu,Mã_BN,Kết_quả,Thể_tích");
    meta.specimens = [...existingSpecs, ...addedSpecs];
    const totalVol = Number(meta.specimens.reduce((acc, sp) => acc + (Number(sp.volume) || 0), 0).toFixed(4));
    meta.qcStatus = totalVol > 0 ? "Đạt tiêu chuẩn" : "Hết mẫu";
    meta.growthHistory!.push({
      id: `GH-${Date.now()}`,
      date: actionDate,
      action: "Khởi tạo",
      performer: performerName,
      details: `Nhập danh sách ${addedSpecs.length} ống bệnh phẩm từ CSV/Excel`,
      resultVolume: `${totalVol} ${s.uom}`,
    });
    await tx.query(
      `UPDATE rd.sample SET current_volume = $2, status = $3, metadata = $4::jsonb, version = version + 1, updated_at = now() WHERE id = $1`,
      [sampleId, totalVol, totalVol > 0 ? "STORED" : "DEPLETED", JSON.stringify(meta)]
    );
    return getSampleDetail(tx, actor, sampleId);
  }

  if (d.event_type === "AUTO_GENERATE_SPECIMENS") {
    throw invalid(
      "Chức năng sinh tự động mẫu bệnh phẩm giả lập (AUTO_GENERATE_SPECIMENS) đã bị vô hiệu hóa theo quy định toàn vẹn dữ liệu ISO 13485 / GLP. Vui lòng nhập dữ liệu thực tế hoặc tải lên từ file CSV/Excel."
    );
  }

  if (d.event_type === "ADD_SINGLE_SPECIMEN" && d.specimen) {
    const existingSpecs = meta.specimens || [];
    const newSpec: ClinicalSpecimenItem = {
      id: d.specimen.id,
      patientId: d.specimen.patientId,
      diagnosis: d.specimen.diagnosis,
      volume: Number(d.specimen.volume),
      unit: s.uom,
      status: d.specimen.diagnosis.toLowerCase().includes("nghi ngờ") ? "Cần kiểm tra lại" : "Đạt",
      location: d.specimen.location || s.box_position || "Chưa gán vị trí",
    };
    meta.specimens = [...existingSpecs, newSpec];
    const totalVol = Number(meta.specimens.reduce((acc, sp) => acc + (Number(sp.volume) || 0), 0).toFixed(4));
    meta.qcStatus = totalVol > 0 ? "Đạt tiêu chuẩn" : "Hết mẫu";
    meta.growthHistory!.push({
      id: `GH-${Date.now()}`,
      date: actionDate,
      action: "Khởi tạo",
      performer: performerName,
      details: `Thêm ống bệnh phẩm lẻ [${newSpec.id}] (BN: ${newSpec.patientId}) với thể tích ${newSpec.volume} ${s.uom}`,
      resultVolume: `${totalVol} ${s.uom}`,
    });
    await tx.query(
      `UPDATE rd.sample SET current_volume = $2, status = $3, metadata = $4::jsonb, version = version + 1, updated_at = now() WHERE id = $1`,
      [sampleId, totalVol, totalVol > 0 ? "STORED" : "DEPLETED", JSON.stringify(meta)]
    );
    return getSampleDetail(tx, actor, sampleId);
  }

  if (d.event_type === "CONSUME_SPECIMEN") {
    const specId = d.specimen_id;
    const used = Number(d.volume_used ?? 0);
    if (!specId || !(used > 0)) throw invalid("Chọn ống bệnh phẩm và nhập thể tích sử dụng (> 0).");
    const specs = meta.specimens || [];
    const targetSpec = specs.find((sp) => sp.id === specId);
    if (!targetSpec) throw notFound("ống bệnh phẩm");
    if (used > targetSpec.volume + 1e-9) {
      throw invalid(`Thể tích sử dụng (${used} ${s.uom}) vượt quá thể tích còn lại của ống ${specId} (${targetSpec.volume} ${s.uom})!`);
    }
    meta.specimens = specs.map((sp) => {
      if (sp.id !== specId) return sp;
      const rem = Math.max(0, Number((sp.volume - used).toFixed(4)));
      return { ...sp, volume: rem, status: rem === 0 ? "Hết mẫu" : sp.status };
    });
    const totalVol = Number(meta.specimens.reduce((acc, sp) => acc + (Number(sp.volume) || 0), 0).toFixed(4));
    if (totalVol === 0) meta.qcStatus = "Hết mẫu";
    const detailMsg = `[Đề tài: ${d.project_use || "Nghiên cứu R&D"}] Tiêu hao ${used} ${s.uom} từ ống bệnh phẩm [${specId}] (BN: ${targetSpec.patientId}) cho: ${d.purpose || "Thử nghiệm"}`;
    meta.growthHistory!.push({
      id: `GH-${Date.now()}`,
      date: actionDate,
      action: "Sử dụng",
      performer: performerName,
      details: detailMsg,
      resultVolume: `${totalVol} ${s.uom}`,
    });
    await tx.query(
      `UPDATE rd.sample SET current_volume = $2, status = $3, metadata = $4::jsonb, version = version + 1, updated_at = now() WHERE id = $1`,
      [sampleId, totalVol, totalVol > 0 ? s.status : "DEPLETED", JSON.stringify(meta)]
    );
    await tx.query(
      `INSERT INTO rd.sample_event (sample_id, event_type, volume_delta, reason, performed_by)
       VALUES ($1, 'USE', $2, $3, $4)`,
      [sampleId, -used, detailMsg, actor.userId]
    );
    return getSampleDetail(tx, actor, sampleId);
  }

  // 4. Standard Biobank Chain-of-Custody events: THAW, REFREEZE, USE, MOVE, DISPOSE
  if (["DEPLETED", "DISPOSED", "TRANSFERRED"].includes(s.status)) {
    throw invalid(`Mẫu ${s.code} đã ở trạng thái kết thúc (${s.status}), không thể thao tác thêm.`);
  }

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
    meta.growthHistory!.push({
      id: `GH-${Date.now()}`,
      date: actionDate,
      action: "Rã đông",
      performer: performerName,
      details: d.reason || `Rã đông mẫu lần thứ ${nextThaw} (Giới hạn: ${s.max_freeze_thaw} lần)`,
      resultVolume: `${curVol} ${s.uom}`,
    });
  } else if (d.event_type === "REFREEZE") {
    if (s.status !== "IN_USE") throw invalid("Chỉ cấp đông lại mẫu đang lấy ra sử dụng (IN_USE).");
    nextStatus = "STORED";
    if (d.to_location_id) nextLoc = d.to_location_id;
    if (d.box_position !== undefined) nextBox = d.box_position ?? s.box_position;
    meta.growthHistory!.push({
      id: `GH-${Date.now()}`,
      date: actionDate,
      action: "Cấp đông lại",
      performer: performerName,
      details: d.reason || `Đưa mẫu trở lại tủ lưu trữ (${nextBox || "Vị trí cũ"})`,
      resultVolume: `${curVol} ${s.uom}`,
    });
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
    if (nextVol === 0) {
      nextStatus = "DEPLETED";
      meta.qcStatus = "Hết mẫu";
    }
    const useDetails = d.project_use
      ? `[Đề tài: ${d.project_use}] Lấy ${used} ${s.uom} phục vụ: ${d.purpose || d.reason || "Thử nghiệm"}`
      : d.reason || `Lấy ${used} ${s.uom} phục vụ thí nghiệm`;
    meta.growthHistory!.push({
      id: `GH-${Date.now()}`,
      date: actionDate,
      action: "Sử dụng",
      performer: performerName,
      details: useDetails,
      resultVolume: `${nextVol} ${s.uom}`,
    });
  } else if (d.event_type === "MOVE") {
    if (!d.to_location_id && !d.box_position) throw invalid("Chọn vị trí tủ hoặc hộp lưu mới khi di chuyển mẫu.");
    nextLoc = d.to_location_id ?? s.location_id;
    nextBox = d.box_position ?? s.box_position;
    if (nextBox) meta.locationText = nextBox;
  } else if (d.event_type === "DISPOSE") {
    if (!d.reason || d.reason.length < 3) throw invalid("Bắt buộc nhập lý do tiêu hủy mẫu sinh học.");
    volDelta = -curVol;
    nextVol = 0;
    nextStatus = "DISPOSED";
    meta.qcStatus = "Hết mẫu";
    meta.growthHistory!.push({
      id: `GH-${Date.now()}`,
      date: actionDate,
      action: "Tiêu hủy",
      performer: performerName,
      details: `Tiêu hủy mẫu: ${d.reason}`,
      resultVolume: `0 ${s.uom}`,
    });
  }

  await tx.query(
    `UPDATE rd.sample SET status = $2, current_volume = $3, freeze_thaw_count = $4, location_id = $5, box_position = $6,
            metadata = $7::jsonb, version = version + 1, updated_at = now(), updated_by = $8
      WHERE id = $1`,
    [sampleId, nextStatus, nextVol, nextThaw, nextLoc, nextBox, JSON.stringify(meta), actor.userId]
  );

  const eventReason =
    d.reason ||
    (d.project_use ? `[${d.project_use}] ${d.purpose || ""}`.trim() : null);

  await tx.query(
    `INSERT INTO rd.sample_event (sample_id, event_type, volume_delta, from_location_id, to_location_id, experiment_id, is_quantitative, reason, performed_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [sampleId, d.event_type, volDelta, s.location_id, nextLoc, d.experiment_id ?? null, d.is_quantitative, eventReason, actor.userId]
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
    reason: eventReason,
  });

  return getSampleDetail(tx, actor, sampleId);
}

export async function listSamples(tx: Tx, actor: AuthzActor, projectId?: string) {
  await ensureSampleSchema(tx);
  await authorizeAnywhere(tx, actor, "rd.view");
  const rows = (
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
  await ensureSampleSchema(tx);
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
