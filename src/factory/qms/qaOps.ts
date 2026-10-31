import { z } from "zod";
import type { Tx } from "../core/db";
import { authorize, SYSTEM_ACTOR, type AuthzActor } from "../core/authz";
import { writeAudit } from "../core/audit";
import { vnToday, addDays } from "../core/dates";
import { invalid, notFound } from "../core/errors";
import { nextNumber } from "../core/numbering";
import { parseInput } from "../core/records";
import { createQcTest } from "./qcTests";
import { createStockDocument, postStockDocument } from "../inv/documents";
import "./permissions";

let qaOpsSchemaEnsured = false;

export async function ensureQaOpsSchema(tx: Tx): Promise<void> {
  if (qaOpsSchemaEnsured) return;
  await tx.query(`
    CREATE TABLE IF NOT EXISTS qms.reference_standard (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      code varchar(40) NOT NULL UNIQUE,
      name varchar(250) NOT NULL,
      standard_type varchar(40) NOT NULL
        CHECK (standard_type IN (
          'POSITIVE_CONTROL',
          'NEGATIVE_CONTROL',
          'LOD_PANEL',
          'SPECIFICITY_PANEL',
          'INTERNAL_CONTROL',
          'CALIBRATOR',
          'CHEMICAL_STD'
        )),
      target_domain varchar(30) NOT NULL DEFAULT 'KIT'
        CHECK (target_domain IN ('KIT', 'OLIGO', 'DEVICE', 'RAW_MATERIAL', 'ALL')),
      lot_no varchar(80) NOT NULL,
      source_strain varchar(250),
      concentration varchar(120),
      target_metric varchar(80) NOT NULL DEFAULT 'Ct Value',
      target_value numeric(18,4),
      lower_limit numeric(18,4),
      upper_limit numeric(18,4),
      unit varchar(40) DEFAULT 'Ct',
      storage_condition varchar(80) DEFAULT '-20°C đến -80°C',
      storage_location varchar(120) DEFAULT 'Tủ âm sâu KHO-QA · Kệ A1',
      aliquots_total int NOT NULL DEFAULT 50 CHECK (aliquots_total >= 0),
      aliquots_remaining int NOT NULL DEFAULT 50 CHECK (aliquots_remaining >= 0),
      max_freeze_thaw int NOT NULL DEFAULT 3 CHECK (max_freeze_thaw >= 1),
      current_freeze_thaw int NOT NULL DEFAULT 0 CHECK (current_freeze_thaw >= 0),
      mfg_date date,
      expiry_date date,
      status varchar(30) NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'DEPLETED', 'EXPIRED', 'QUARANTINE')),
      notes text,
      created_by int,
      updated_by int,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS qms.reference_standard_usage (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      standard_id uuid NOT NULL REFERENCES qms.reference_standard(id) ON DELETE CASCADE,
      test_id uuid REFERENCES qms.qc_test(id) ON DELETE SET NULL,
      measured_value numeric(18,4),
      measured_text varchar(200),
      passed boolean NOT NULL DEFAULT true,
      aliquots_used int NOT NULL DEFAULT 1,
      freeze_thaw_increment int NOT NULL DEFAULT 1,
      notes text,
      used_by int,
      used_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS qms.qc_method (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      code varchar(40) NOT NULL UNIQUE,
      version_no int NOT NULL DEFAULT 1,
      name varchar(250) NOT NULL,
      category varchar(50) NOT NULL DEFAULT 'QPCR_ASSAY'
        CHECK (category IN (
          'QPCR_ASSAY',
          'HPLC_CHROMATOGRAPHY',
          'PAGE_ELECTROPHORESIS',
          'UV_VIS_OD',
          'ELECTRICAL_SAFETY',
          'MECHANICAL_DIMENSIONAL',
          'PHYSICOCHEMICAL'
        )),
      instrument_type varchar(150),
      required_standard_type varchar(50),
      principle text,
      sop_steps jsonb NOT NULL DEFAULT '[]'::jsonb,
      suitability_criteria text,
      validation_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
      status varchar(30) NOT NULL DEFAULT 'EFFECTIVE'
        CHECK (status IN ('DRAFT', 'VALIDATED', 'EFFECTIVE', 'OBSOLETE')),
      approved_by int,
      approved_at timestamptz,
      created_by int,
      updated_by int,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS qms.retention_sample (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      code varchar(40) NOT NULL UNIQUE,
      lot_id uuid REFERENCES inv.lot(id) ON DELETE SET NULL,
      item_id uuid NOT NULL REFERENCES master.item(id),
      sample_category varchar(40) NOT NULL DEFAULT 'FINISHED_KIT'
        CHECK (sample_category IN ('RAW_MATERIAL', 'SEMI_FINISHED', 'FINISHED_KIT', 'OLIGO')),
      qty_retained numeric(18,4) NOT NULL DEFAULT 2,
      uom varchar(30) NOT NULL DEFAULT 'kit',
      storage_temp varchar(60) NOT NULL DEFAULT '-20°C',
      storage_location varchar(120) NOT NULL DEFAULT 'KHO-QA · Tủ Mẫu Lưu R1',
      retained_date date NOT NULL DEFAULT CURRENT_DATE,
      retain_until_date date,
      stability_months int[] NOT NULL DEFAULT ARRAY[0,3,6,9,12,24],
      last_checked_at timestamptz,
      status varchar(30) NOT NULL DEFAULT 'STORED'
        CHECK (status IN ('STORED', 'IN_STABILITY_TEST', 'CONSUMED', 'DISPOSED')),
      notes text,
      created_by int,
      updated_by int,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  qaOpsSchemaEnsured = true;
}

/**
 * Returns the Unified QC Reception Queue & Overview:
 * - Lots awaiting QC sampling or testing (`QUARANTINE` / `PENDING_QC`), classified into:
 *   - `IQC` (Raw Materials, Reagents, Components, Consumables)
 *   - `IPQC` (Semi-finished Mixes, Buffers, Preparations)
 *   - `FQC` (Finished Kits, Oligo, Devices)
 * - Reference Standards & Control Panels summary
 * - QC Analytical Methods & Validation library
 * - QC Retention Samples & Stability schedule
 */
export async function getQaOpsDashboard(tx: Tx, actor: AuthzActor) {
  await ensureQaOpsSchema(tx);
  await authorize(tx, actor, "qms.qc.view");

  // 1. Unified QC Reception Queue (all lots in QUARANTINE or PENDING_QC, plus recently released lots)
  const queueLots = (
    await tx.query(
      `SELECT l.id AS lot_id,
              l.code AS lot_code,
              l.status AS lot_status,
              l.origin,
              l.mfr_lot_no,
              l.received_date::text AS received_date,
              l.expiry_date::text AS expiry_date,
              l.version AS lot_version,
              i.id AS item_id,
              i.code AS item_code,
              i.name AS item_name,
              i.item_type,
              i.base_uom,
              COALESCE((
                SELECT SUM(sb.qty_on_hand)
                  FROM inv.stock_balance sb
                 WHERE sb.lot_id = l.id
              ), 0)::float AS qty_on_hand,
              (
                SELECT string_agg(DISTINCT w.code || '·' || loc.code, ', ')
                  FROM inv.stock_balance sb
                  JOIN master.location loc ON loc.id = sb.location_id
                  JOIN master.warehouse w ON w.id = loc.warehouse_id
                 WHERE sb.lot_id = l.id AND sb.qty_on_hand > 0
              ) AS warehouse_locations,
              (
                SELECT s.code
                  FROM qms.qc_spec s
                 WHERE s.item_id = i.id AND s.status = 'EFFECTIVE'
                 ORDER BY s.spec_version DESC LIMIT 1
              ) AS effective_spec_code,
              (
                SELECT t.id
                  FROM qms.qc_test t
                 WHERE t.entity_type = 'LOT' AND t.entity_id = l.id
                 ORDER BY t.created_at DESC LIMIT 1
              ) AS latest_test_id,
              (
                SELECT t.code
                  FROM qms.qc_test t
                 WHERE t.entity_type = 'LOT' AND t.entity_id = l.id
                 ORDER BY t.created_at DESC LIMIT 1
              ) AS latest_test_code,
              (
                SELECT t.status
                  FROM qms.qc_test t
                 WHERE t.entity_type = 'LOT' AND t.entity_id = l.id
                 ORDER BY t.created_at DESC LIMIT 1
              ) AS latest_test_status,
              (
                SELECT t.overall_result
                  FROM qms.qc_test t
                 WHERE t.entity_type = 'LOT' AND t.entity_id = l.id
                 ORDER BY t.created_at DESC LIMIT 1
              ) AS latest_test_result
         FROM inv.lot l
         JOIN master.item i ON i.id = l.item_id
        WHERE l.status IN ('QUARANTINE', 'PENDING_QC')
        ORDER BY CASE WHEN l.status = 'QUARANTINE' THEN 0 ELSE 1 END, l.created_at DESC
        LIMIT 120`
    )
  ).rows.map((r) => {
    let qc_category: "IQC" | "IPQC" | "FQC" = "IQC";
    if (r.item_type === "SEMI_FINISHED" || r.origin === "PREPARATION") {
      qc_category = "IPQC";
    } else if (["FINISHED_KIT", "DEVICE"].includes(r.item_type) || ["PRODUCTION", "SYNTHESIS"].includes(r.origin)) {
      qc_category = "FQC";
    }
    return { ...r, qc_category };
  });

  // 2. Reference Standards
  const standards = (
    await tx.query(
      `SELECT rs.*,
              (SELECT count(*)::int FROM qms.reference_standard_usage u WHERE u.standard_id = rs.id) AS usage_count
         FROM qms.reference_standard rs
        ORDER BY rs.status ASC, rs.code ASC`
    )
  ).rows;

  // 3. Recent Reference Standard Usages
  const standardUsages = (
    await tx.query(
      `SELECT u.*,
              rs.code AS standard_code,
              rs.name AS standard_name,
              rs.standard_type,
              rs.target_metric,
              rs.lower_limit,
              rs.upper_limit,
              rs.unit,
              t.code AS test_code,
              up.display_name AS user_name
         FROM qms.reference_standard_usage u
         JOIN qms.reference_standard rs ON rs.id = u.standard_id
         LEFT JOIN qms.qc_test t ON t.id = u.test_id
         LEFT JOIN core.user_profile up ON up.user_id = u.used_by
        ORDER BY u.used_at DESC
        LIMIT 100`
    )
  ).rows;

  // 4. QC Analytical Methods
  const methods = (
    await tx.query(
      `SELECT m.*, up.display_name AS approved_by_name
         FROM qms.qc_method m
         LEFT JOIN core.user_profile up ON up.user_id = m.approved_by
        ORDER BY m.code ASC, m.version_no DESC`
    )
  ).rows;

  // 5. Retention Samples & Stability
  const retentionSamples = (
    await tx.query(
      `SELECT r.*,
              l.code AS lot_code,
              l.expiry_date::text AS lot_expiry_date,
              i.code AS item_code,
              i.name AS item_name
         FROM qms.retention_sample r
         JOIN master.item i ON i.id = r.item_id
         LEFT JOIN inv.lot l ON l.id = r.lot_id
        ORDER BY r.retained_date DESC, r.code DESC`
    )
  ).rows;

  // 6. All active lots (including RELEASED) for proactive QC test creation (IQC / IPQC / FQC / STABILITY)
  const allLots = (
    await tx.query(
      `SELECT l.id AS lot_id,
              l.code AS lot_code,
              l.status AS lot_status,
              l.origin,
              i.code AS item_code,
              i.name AS item_name,
              i.item_type,
              i.base_uom
         FROM inv.lot l
         JOIN master.item i ON i.id = l.item_id
        WHERE l.status IN ('QUARANTINE', 'PENDING_QC', 'RELEASED')
        ORDER BY CASE WHEN l.status IN ('QUARANTINE', 'PENDING_QC') THEN 0 ELSE 1 END, l.created_at DESC
        LIMIT 150`
    )
  ).rows;

  return {
    reception_queue: queueLots,
    all_lots: allLots,
    standards,
    standard_usages: standardUsages,
    methods,
    retention_samples: retentionSamples,
  };
}

/**
 * Ensures an EFFECTIVE `qms.qc_spec` exists for `item_id` so QC reception never fails with "No effective spec".
 */
async function ensureEffectiveSpecForItem(
  tx: Tx,
  actor: AuthzActor,
  itemId: string,
  testKind: "IQC" | "IPQC" | "FQC" | "RELEASE" | "STABILITY"
): Promise<{ id: string; code: string }> {
  const appliesOrder = testKind === "IQC" ? ["RECEIPT", "ITEM", "PRODUCT"] : ["PRODUCT", "ITEM", "RECEIPT"];
  for (const ap of appliesOrder) {
    const found = (
      await tx.query(
        "SELECT id, code FROM qms.qc_spec WHERE item_id = $1 AND applies_to = $2 AND status = 'EFFECTIVE' ORDER BY spec_version DESC LIMIT 1",
        [itemId, ap]
      )
    ).rows[0];
    if (found) return found;
  }

  const item = (await tx.query("SELECT id, code, name, item_type FROM master.item WHERE id = $1", [itemId])).rows[0];
  if (!item) throw notFound("vật tư / sản phẩm");

  const appliesTo = testKind === "IQC" ? "RECEIPT" : item.item_type === "FINISHED_KIT" ? "PRODUCT" : "ITEM";
  const specCode = await nextNumber(tx, "QC_SPEC");
  const spec = (
    await tx.query(
      `INSERT INTO qms.qc_spec
         (code, spec_version, name, applies_to, item_id, status, effective_at, notes, created_by, updated_by)
       VALUES ($1, 1, $2, $3, $4, 'EFFECTIVE', now(), $5, $6, $6)
       RETURNING id, code`,
      [
        specCode,
        `Tiêu chuẩn ${testKind} — ${item.code} ${item.name}`,
        appliesTo,
        item.id,
        `Tiêu chuẩn kiểm định tự động kích hoạt khi tiếp nhận mẫu ${testKind}`,
        actor.userId,
      ]
    )
  ).rows[0];

  const defaultParams =
    item.item_type === "FINISHED_KIT"
      ? [
          { seq: 1, name: "Ngoại quan, Quy cách đóng gói & Tem nhãn hộp Kit", method: "MTH-VIS-001 (Kiểm tra ngoại quan)", unit: null, value_type: "PASS_FAIL", min: null, max: null, target: "Đạt" },
          { seq: 2, name: "Tín hiệu Chứng dương chuẩn (Positive Control Ct)", method: "MTH-PCR-001 (Real-time qPCR)", unit: "Ct", value_type: "NUMERIC", min: 24, max: 30, target: null },
          { seq: 3, name: "Chứng âm (Negative Control / NTC) không lên tín hiệu", method: "MTH-PCR-001 (Real-time qPCR)", unit: null, value_type: "PASS_FAIL", min: null, max: null, target: "Đạt" },
          { seq: 4, name: "Giới hạn phát hiện (LoD 95% trên Panel chuẩn)", method: "MTH-PCR-001 (Real-time qPCR)", unit: "copies/rxn", value_type: "NUMERIC", min: 1, max: 20, target: null },
        ]
      : item.item_type === "SEMI_FINISHED"
        ? [
            { seq: 1, name: "Độ trong suốt & Đồng nhất dung dịch bán thành phẩm", method: "Kiểm tra cảm quan", unit: null, value_type: "PASS_FAIL", min: null, max: null, target: "Đạt" },
            { seq: 2, name: "Giá trị pH dung dịch ở 25°C", method: "MTH-PHY-001 (Đo pH chuẩn)", unit: "pH", value_type: "NUMERIC", min: 8.0, max: 8.6, target: null },
            { seq: 3, name: "Hoạt tính khuếch đại thử nghiệm trên mẫu chuẩn", method: "MTH-PCR-001 (Real-time qPCR)", unit: "Ct", value_type: "NUMERIC", min: 24, max: 30, target: null },
          ]
        : [
            { seq: 1, name: "Ngoại quan bao bì, niêm phong & Điều kiện nhiệt độ vận chuyển", method: "SOP-IQC-01 (Kiểm tra đầu vào)", unit: null, value_type: "PASS_FAIL", min: null, max: null, target: "Đạt" },
            { seq: 2, name: "Đối chiếu Giấy chứng nhận phân tích (COA) của Nhà sản xuất & Hạn dùng", method: "SOP-IQC-01 (Đối chiếu hồ sơ)", unit: null, value_type: "PASS_FAIL", min: null, max: null, target: "Đạt" },
            { seq: 3, name: "Kiểm tra chức năng / Độ tinh khiết đầu vào", method: "SOP-IQC-02 (Thử nghiệm đầu vào)", unit: null, value_type: "PASS_FAIL", min: null, max: null, target: "Đạt" },
          ];

  for (const p of defaultParams) {
    await tx.query(
      `INSERT INTO qms.qc_spec_parameter
         (spec_id, seq, name, method, unit, value_type, lower_limit, upper_limit, target, is_critical)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true)`,
      [spec.id, p.seq, p.name, p.method, p.unit, p.value_type, p.min, p.max, p.target]
    );
  }

  return spec;
}

const receiveLotQcSchema = z.object({
  lot_id: z.string().uuid(),
  test_kind: z.enum(["IQC", "IPQC", "FQC", "RELEASE", "STABILITY"]).optional(),
});

/**
 * 1-Click QC Reception from `QA/QC` tab:
 * - Ensures an effective QC Specification exists for the lot's item
 * - Transitions the lot from `QUARANTINE` to `PENDING_QC` if needed
 * - Creates and returns the `qms.qc_test`
 */
export async function receiveAndCreateQcTest(tx: Tx, actor: AuthzActor, input: unknown) {
  await ensureQaOpsSchema(tx);
  await authorize(tx, actor, "qms.qc.analyze");
  const d = parseInput(receiveLotQcSchema, input);

  const lot = (
    await tx.query(
      `SELECT l.*, i.code AS item_code, i.name AS item_name, i.item_type
         FROM inv.lot l
         JOIN master.item i ON i.id = l.item_id
        WHERE l.id = $1 FOR UPDATE`,
      [d.lot_id]
    )
  ).rows[0];
  if (!lot) throw notFound("lô hàng");

  // Check if an open test already exists for this lot
  const existingOpen = (
    await tx.query(
      `SELECT id, code, status FROM qms.qc_test
        WHERE entity_type = 'LOT' AND entity_id = $1 AND status IN ('PLANNED', 'IN_PROGRESS', 'RESULTS_ENTERED')
        ORDER BY created_at DESC LIMIT 1`,
      [lot.id]
    )
  ).rows[0];
  if (existingOpen) {
    if (lot.status === "QUARANTINE") {
      await tx.query("UPDATE inv.lot SET status = 'PENDING_QC', version = version + 1, updated_at = now() WHERE id = $1", [lot.id]);
    }
    return { test_id: existingOpen.id, test_code: existingOpen.code, lot_code: lot.code, already_open: true };
  }

  const autoKind: "IQC" | "IPQC" | "FQC" | "RELEASE" | "STABILITY" =
    d.test_kind ??
    (lot.item_type === "SEMI_FINISHED" || lot.origin === "PREPARATION"
      ? "IPQC"
      : ["FINISHED_KIT", "DEVICE"].includes(lot.item_type) || lot.origin === "PRODUCTION"
        ? "FQC"
        : "IQC");

  const spec = await ensureEffectiveSpecForItem(tx, actor, lot.item_id, autoKind);

  if (lot.status === "QUARANTINE") {
    await tx.query(
      "UPDATE inv.lot SET status = 'PENDING_QC', version = version + 1, updated_at = now(), updated_by = $2 WHERE id = $1",
      [lot.id, actor.userId]
    );
  }

  const test = await createQcTest(tx, actor, {
    entity_type: "LOT",
    entity_id: lot.id,
    spec_id: spec.id,
    test_kind: autoKind,
  });

  return { test_id: test.id, test_code: test.code, lot_code: lot.code, spec_code: spec.code };
}

const releaseFromTestSchema = z.object({
  test_id: z.string().uuid(),
  auto_putaway: z.boolean().default(true),
  retain_sample_qty: z.coerce.number().min(0).default(0),
});

/**
 * Releases the linked Lot (`PENDING_QC` -> `RELEASED`) directly from the QC Test screen once the test passed,
 * optionally transfers stock from Quarantine (`BT`) to Active Shelf (`A1`), and logs a Retention Sample if requested.
 */
export async function releaseLotFromQcTest(tx: Tx, actor: AuthzActor, input: unknown) {
  await ensureQaOpsSchema(tx);
  await authorize(tx, actor, "qms.qc.review");
  const d = parseInput(releaseFromTestSchema, input);

  const test = (
    await tx.query("SELECT * FROM qms.qc_test WHERE id = $1", [d.test_id])
  ).rows[0];
  if (!test) throw notFound("phiếu QC");
  if (test.entity_type !== "LOT") throw invalid("Chỉ áp dụng giải phóng lô cho phiếu QC của Lô hàng (LOT).");
  if (test.status !== "REVIEWED" || test.overall_result !== "PASS") {
    throw invalid("Phiếu QC phải được duyệt với kết quả ĐẠT (PASS) trước khi giải phóng lô.");
  }

  const lot = (
    await tx.query(
      `SELECT l.*, i.code AS item_code, i.name AS item_name, i.item_type, i.base_uom
         FROM inv.lot l
         JOIN master.item i ON i.id = l.item_id
        WHERE l.id = $1 FOR UPDATE`,
      [test.entity_id]
    )
  ).rows[0];
  if (!lot) throw notFound("lô hàng");

  if (lot.status !== "RELEASED") {
    await tx.query(
      "UPDATE inv.lot SET status = 'RELEASED', version = version + 1, updated_at = now(), updated_by = $2 WHERE id = $1",
      [lot.id, actor.userId]
    );
    await writeAudit(tx, actor, {
      entityType: "lot",
      entityId: lot.id,
      action: "release_from_qc",
      changes: { status: [lot.status, "RELEASED"], test_code: [null, test.code] },
    });
  }

  // Optional automatic Put-Away from Quarantine location (BT) to Active location (A1) in the same warehouse
  let putawayCount = 0;
  if (d.auto_putaway) {
    const qBalances = (
      await tx.query(
        `SELECT loc.warehouse_id, sb.location_id AS from_loc_id, sb.qty_on_hand::float AS qty
           FROM inv.stock_balance sb
           JOIN master.location loc ON loc.id = sb.location_id
          WHERE sb.lot_id = $1 AND loc.is_quarantine = true AND sb.qty_on_hand > 0`,
        [lot.id]
      )
    ).rows;

    for (const b of qBalances) {
      const shelfLoc = (
        await tx.query(
          "SELECT id FROM master.location WHERE warehouse_id = $1 AND is_quarantine = false AND status = 'ACTIVE' ORDER BY code LIMIT 1",
          [b.warehouse_id]
        )
      ).rows[0];
      if (shelfLoc && b.qty > 0) {
        const rootAct: AuthzActor = { ...actor, isRootAdmin: true };
        const moveDoc = await createStockDocument(tx, rootAct, {
          doc_type: "TRANSFER",
          reason_code: "PUTAWAY",
          warehouse_id: b.warehouse_id,
          source_entity_type: "QC_TEST",
          source_entity_id: test.id,
          notes: `Tự động chuyển kệ chính sau khi duyệt đạt QC (${test.code})`,
          lines: [
            {
              item_id: lot.item_id,
              lot_id: lot.id,
              from_location_id: b.from_loc_id,
              to_location_id: shelfLoc.id,
              qty: b.qty,
              uom: lot.base_uom,
            },
          ],
        }, { trusted: true });
        await postStockDocument(tx, rootAct, moveDoc.id, moveDoc.version);
        putawayCount++;
      }
    }
  }

  // Optional Retention Sample creation
  let retentionCode: string | null = null;
  if (d.retain_sample_qty > 0) {
    retentionCode = `RET-${lot.code}`;
    const cat =
      lot.item_type === "FINISHED_KIT"
        ? "FINISHED_KIT"
        : lot.item_type === "SEMI_FINISHED"
          ? "SEMI_FINISHED"
          : "RAW_MATERIAL";
    const retainUntil = lot.expiry_date ? addDays(String(lot.expiry_date).slice(0, 10), 365) : addDays(vnToday(), 730);
    await tx.query(
      `INSERT INTO qms.retention_sample
         (code, lot_id, item_id, sample_category, qty_retained, uom, storage_temp, storage_location, retained_date, retain_until_date, notes, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, '-20°C', 'KHO-QA · Tủ Mẫu Lưu R1', CURRENT_DATE, $7, $8, $9, $9)
       ON CONFLICT (code) DO UPDATE SET qty_retained = EXCLUDED.qty_retained`,
      [
        retentionCode,
        lot.id,
        lot.item_id,
        cat,
        d.retain_sample_qty,
        lot.base_uom,
        retainUntil,
        `Trích mẫu lưu khi giải phóng lô từ phiếu QC ${test.code}`,
        actor.userId,
      ]
    );
  }

  return {
    lot_code: lot.code,
    lot_status: "RELEASED",
    putaway_executed: putawayCount > 0,
    retention_code: retentionCode,
  };
}

const referenceStandardSchema = z.object({
  id: z.string().uuid().optional().nullable(),
  code: z.string().trim().min(2).max(40).optional(),
  name: z.string().trim().min(3, "Nhập tên Bộ mẫu chuẩn / Chủng đối chiếu").max(250),
  standard_type: z
    .enum([
      "POSITIVE_CONTROL",
      "NEGATIVE_CONTROL",
      "LOD_PANEL",
      "SPECIFICITY_PANEL",
      "INTERNAL_CONTROL",
      "CALIBRATOR",
      "CHEMICAL_STD",
    ])
    .default("POSITIVE_CONTROL"),
  target_domain: z.enum(["KIT", "OLIGO", "DEVICE", "RAW_MATERIAL", "ALL"]).default("KIT"),
  lot_no: z.string().trim().min(2, "Nhập số lô mẫu chuẩn").max(80),
  source_strain: z.string().trim().max(250).optional().nullable(),
  concentration: z.string().trim().max(120).optional().nullable(),
  target_metric: z.string().trim().min(1).max(80).default("Ct Value"),
  target_value: z.coerce.number().optional().nullable(),
  lower_limit: z.coerce.number().optional().nullable(),
  upper_limit: z.coerce.number().optional().nullable(),
  unit: z.string().trim().max(40).default("Ct"),
  storage_condition: z.string().trim().max(80).default("-20°C đến -80°C"),
  storage_location: z.string().trim().max(120).default("KHO-QA · Tủ âm sâu -80°C"),
  aliquots_total: z.coerce.number().int().min(1).default(50),
  aliquots_remaining: z.coerce.number().int().min(0).optional(),
  max_freeze_thaw: z.coerce.number().int().min(1).default(3),
  expiry_date: z.string().optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
});

export async function saveReferenceStandard(tx: Tx, actor: AuthzActor, input: unknown) {
  await ensureQaOpsSchema(tx);
  await authorize(tx, actor, "qms.qc.analyze");
  const d = parseInput(referenceStandardSchema, input);

  if (!d.id) {
    const cnt = Number((await tx.query("SELECT count(*)::int AS c FROM qms.reference_standard")).rows[0]?.c ?? 0);
    const code = d.code?.toUpperCase() || `STD-QC-${String(cnt + 1).padStart(3, "0")}`;
    const rem = d.aliquots_remaining ?? d.aliquots_total;
    const row = (
      await tx.query(
        `INSERT INTO qms.reference_standard
           (code, name, standard_type, target_domain, lot_no, source_strain, concentration,
            target_metric, target_value, lower_limit, upper_limit, unit,
            storage_condition, storage_location, aliquots_total, aliquots_remaining, max_freeze_thaw,
            mfg_date, expiry_date, status, notes, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, CURRENT_DATE, $18, 'ACTIVE', $19, $20, $20)
         RETURNING *`,
        [
          code,
          d.name,
          d.standard_type,
          d.target_domain,
          d.lot_no,
          d.source_strain ?? null,
          d.concentration ?? null,
          d.target_metric,
          d.target_value ?? null,
          d.lower_limit ?? null,
          d.upper_limit ?? null,
          d.unit,
          d.storage_condition,
          d.storage_location,
          d.aliquots_total,
          rem,
          d.max_freeze_thaw,
          d.expiry_date || addDays(vnToday(), 365),
          d.notes ?? null,
          actor.userId,
        ]
      )
    ).rows[0];
    return row;
  }

  const upd = (
    await tx.query(
      `UPDATE qms.reference_standard
          SET name = $2, standard_type = $3, target_domain = $4, lot_no = $5, source_strain = $6,
              concentration = $7, target_metric = $8, target_value = $9, lower_limit = $10, upper_limit = $11,
              unit = $12, storage_condition = $13, storage_location = $14,
              aliquots_remaining = COALESCE($15, aliquots_remaining), max_freeze_thaw = $16,
              expiry_date = $17, notes = $18, updated_at = now(), updated_by = $19
        WHERE id = $1 RETURNING *`,
      [
        d.id,
        d.name,
        d.standard_type,
        d.target_domain,
        d.lot_no,
        d.source_strain ?? null,
        d.concentration ?? null,
        d.target_metric,
        d.target_value ?? null,
        d.lower_limit ?? null,
        d.upper_limit ?? null,
        d.unit,
        d.storage_condition,
        d.storage_location,
        d.aliquots_remaining ?? null,
        d.max_freeze_thaw,
        d.expiry_date || null,
        d.notes ?? null,
        actor.userId,
      ]
    )
  ).rows[0];
  return upd;
}

const standardUsageSchema = z.object({
  standard_id: z.string().uuid(),
  test_id: z.string().uuid().optional().nullable(),
  measured_value: z.coerce.number().optional().nullable(),
  measured_text: z.string().trim().max(200).optional().nullable(),
  aliquots_used: z.coerce.number().int().min(0).default(1),
  freeze_thaw_increment: z.coerce.number().int().min(0).default(1),
  notes: z.string().trim().max(500).optional().nullable(),
});

/**
 * Records the use of a Reference Standard / Control Panel during a QC Test:
 * - Automatically evaluates System Suitability (`passed`) against `[lower_limit, upper_limit]`
 * - Deducts `aliquots_remaining` and increments `current_freeze_thaw`
 */
export async function recordStandardUsage(tx: Tx, actor: AuthzActor, input: unknown) {
  await ensureQaOpsSchema(tx);
  await authorize(tx, actor, "qms.qc.analyze");
  const d = parseInput(standardUsageSchema, input);

  const std = (
    await tx.query("SELECT * FROM qms.reference_standard WHERE id = $1 FOR UPDATE", [d.standard_id])
  ).rows[0];
  if (!std) throw notFound("bộ mẫu chuẩn");
  if (std.status !== "ACTIVE") throw invalid(`Bộ mẫu chuẩn ${std.code} hiện không ở trạng thái ACTIVE (${std.status}).`);

  let passed = true;
  if (d.measured_value != null) {
    if (std.lower_limit != null && d.measured_value < Number(std.lower_limit)) passed = false;
    if (std.upper_limit != null && d.measured_value > Number(std.upper_limit)) passed = false;
  }

  const newAliquots = Math.max(0, Number(std.aliquots_remaining) - d.aliquots_used);
  const newFt = Number(std.current_freeze_thaw) + d.freeze_thaw_increment;
  const newStatus = newAliquots === 0 ? "DEPLETED" : std.status;

  await tx.query(
    `UPDATE qms.reference_standard
        SET aliquots_remaining = $2,
            current_freeze_thaw = $3,
            status = $4,
            updated_at = now(),
            updated_by = $5
      WHERE id = $1`,
    [std.id, newAliquots, newFt, newStatus, actor.userId]
  );

  const usage = (
    await tx.query(
      `INSERT INTO qms.reference_standard_usage
         (standard_id, test_id, measured_value, measured_text, passed, aliquots_used, freeze_thaw_increment, notes, used_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        std.id,
        d.test_id ?? null,
        d.measured_value ?? null,
        d.measured_text ?? null,
        passed,
        d.aliquots_used,
        d.freeze_thaw_increment,
        d.notes ?? null,
        actor.userId,
      ]
    )
  ).rows[0];

  return {
    usage,
    standard_code: std.code,
    passed,
    freeze_thaw_warning: newFt > Number(std.max_freeze_thaw),
  };
}

const qcMethodSchema = z.object({
  id: z.string().uuid().optional().nullable(),
  code: z.string().trim().min(2).max(40).optional(),
  name: z.string().trim().min(3, "Nhập tên phương pháp kiểm nghiệm").max(250),
  category: z
    .enum([
      "QPCR_ASSAY",
      "HPLC_CHROMATOGRAPHY",
      "PAGE_ELECTROPHORESIS",
      "UV_VIS_OD",
      "ELECTRICAL_SAFETY",
      "MECHANICAL_DIMENSIONAL",
      "PHYSICOCHEMICAL",
    ])
    .default("QPCR_ASSAY"),
  instrument_type: z.string().trim().max(150).optional().nullable(),
  required_standard_type: z.string().trim().max(50).optional().nullable(),
  principle: z.string().trim().max(2000).optional().nullable(),
  sop_steps: z
    .array(
      z.object({
        step_no: z.coerce.number().int(),
        title: z.string().trim(),
        detail: z.string().trim(),
      })
    )
    .default([]),
  suitability_criteria: z.string().trim().max(1000).optional().nullable(),
  validation_summary: z
    .object({
      repeatability_cv_pct: z.string().optional(),
      reproducibility_cv_pct: z.string().optional(),
      lod_value: z.string().optional(),
      specificity_pct: z.string().optional(),
      linearity_r2: z.string().optional(),
      validated_date: z.string().optional(),
    })
    .default({}),
  status: z.enum(["DRAFT", "VALIDATED", "EFFECTIVE", "OBSOLETE"]).default("EFFECTIVE"),
});

export async function saveQcMethod(tx: Tx, actor: AuthzActor, input: unknown) {
  await ensureQaOpsSchema(tx);
  await authorize(tx, actor, "qms.qc.analyze");
  const d = parseInput(qcMethodSchema, input);

  if (!d.id) {
    const cnt = Number((await tx.query("SELECT count(*)::int AS c FROM qms.qc_method")).rows[0]?.c ?? 0);
    const code = d.code?.toUpperCase() || `MTH-QC-${String(cnt + 1).padStart(3, "0")}`;
    const row = (
      await tx.query(
        `INSERT INTO qms.qc_method
           (code, version_no, name, category, instrument_type, required_standard_type,
            principle, sop_steps, suitability_criteria, validation_summary,
            status, approved_by, approved_at, created_by, updated_by)
         VALUES ($1, 1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::jsonb, $10, $11, now(), $11, $11)
         RETURNING *`,
        [
          code,
          d.name,
          d.category,
          d.instrument_type ?? null,
          d.required_standard_type ?? null,
          d.principle ?? null,
          JSON.stringify(d.sop_steps),
          d.suitability_criteria ?? null,
          JSON.stringify(d.validation_summary),
          d.status,
          actor.userId,
        ]
      )
    ).rows[0];
    return row;
  }

  const upd = (
    await tx.query(
      `UPDATE qms.qc_method
          SET name = $2, category = $3, instrument_type = $4, required_standard_type = $5,
              principle = $6, sop_steps = $7::jsonb, suitability_criteria = $8,
              validation_summary = $9::jsonb, status = $10,
              updated_at = now(), updated_by = $11
        WHERE id = $1 RETURNING *`,
      [
        d.id,
        d.name,
        d.category,
        d.instrument_type ?? null,
        d.required_standard_type ?? null,
        d.principle ?? null,
        JSON.stringify(d.sop_steps),
        d.suitability_criteria ?? null,
        JSON.stringify(d.validation_summary),
        d.status,
        actor.userId,
      ]
    )
  ).rows[0];
  return upd;
}

const retentionSchema = z.object({
  lot_id: z.string().uuid().optional().nullable(),
  item_id: z.string().uuid(),
  sample_category: z.enum(["RAW_MATERIAL", "SEMI_FINISHED", "FINISHED_KIT", "OLIGO"]).default("FINISHED_KIT"),
  qty_retained: z.coerce.number().positive().default(2),
  uom: z.string().trim().min(1).max(30).default("kit"),
  storage_temp: z.string().trim().max(60).default("-20°C"),
  storage_location: z.string().trim().max(120).default("KHO-QA · Tủ Mẫu Lưu R1"),
  retain_until_date: z.string().optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
});

export async function saveRetentionSample(tx: Tx, actor: AuthzActor, input: unknown) {
  await ensureQaOpsSchema(tx);
  await authorize(tx, actor, "qms.qc.analyze");
  const d = parseInput(retentionSchema, input);

  const cnt = Number((await tx.query("SELECT count(*)::int AS c FROM qms.retention_sample")).rows[0]?.c ?? 0);
  const code = `RET-QC-${String(cnt + 1).padStart(4, "0")}`;
  const row = (
    await tx.query(
      `INSERT INTO qms.retention_sample
         (code, lot_id, item_id, sample_category, qty_retained, uom, storage_temp, storage_location, retain_until_date, notes, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
       RETURNING *`,
      [
        code,
        d.lot_id ?? null,
        d.item_id,
        d.sample_category,
        d.qty_retained,
        d.uom,
        d.storage_temp,
        d.storage_location,
        d.retain_until_date || addDays(vnToday(), 730),
        d.notes ?? null,
        actor.userId,
      ]
    )
  ).rows[0];
  return row;
}

const triggerStabilitySchema = z.object({
  retention_id: z.string().uuid(),
  timepoint_month: z.coerce.number().int().min(0).default(3),
});

/**
 * 1-Click Stability QC Test trigger from a stored Retention Sample.
 */
export async function triggerStabilityQcTest(tx: Tx, actor: AuthzActor, input: unknown) {
  await ensureQaOpsSchema(tx);
  await authorize(tx, actor, "qms.qc.analyze");
  const d = parseInput(triggerStabilitySchema, input);

  const ret = (
    await tx.query("SELECT * FROM qms.retention_sample WHERE id = $1 FOR UPDATE", [d.retention_id])
  ).rows[0];
  if (!ret) throw notFound("mẫu lưu QC");

  let lotId = ret.lot_id;
  if (!lotId) {
    const anyLot = (
      await tx.query("SELECT id FROM inv.lot WHERE item_id = $1 ORDER BY created_at DESC LIMIT 1", [ret.item_id])
    ).rows[0];
    if (!anyLot) throw invalid("Mẫu lưu này chưa gắn số lô trong kho để khởi tạo phiếu QC.");
    lotId = anyLot.id;
  }

  const spec = await ensureEffectiveSpecForItem(tx, actor, ret.item_id, "STABILITY");
  const test = await createQcTest(tx, actor, {
    entity_type: "LOT",
    entity_id: lotId,
    spec_id: spec.id,
    test_kind: "STABILITY",
    retest_reason: `Kiểm tra độ ổn định mốc ${d.timepoint_month} tháng từ mẫu lưu ${ret.code}`,
  });

  await tx.query(
    "UPDATE qms.retention_sample SET status = 'IN_STABILITY_TEST', last_checked_at = now(), updated_at = now() WHERE id = $1",
    [ret.id]
  );

  return { test_id: test.id, test_code: test.code, retention_code: ret.code };
}
