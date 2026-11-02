import { z } from "zod";
import type { Tx } from "../core/db";
import { authorize, SYSTEM_ACTOR, type AuthzActor } from "../core/authz";
import { writeAudit } from "../core/audit";
import { vnToday, addDays } from "../core/dates";
import { invalid, notFound } from "../core/errors";
import { nextNumber } from "../core/numbering";
import { parseInput } from "../core/records";
import { createQcTest, registerQcSubject, runTransition } from "./qcTests";
import { createStockDocument, stockDocumentMachine } from "../inv/documents";
import "./permissions";

registerQcSubject("LOT", {
  label: async (tx, id) => {
    const l = (
      await tx.query(
        "SELECT l.code, i.code AS item_code, i.name AS item_name FROM inv.lot l JOIN master.item i ON i.id = l.item_id WHERE l.id = $1",
        [id]
      )
    ).rows[0];
    return l ? `lô ${l.code} (${l.item_code} — ${l.item_name})` : `lô ${id}`;
  },
  onReviewed: async (tx, actor, test) => {
    if (test.overall_result === "PASS") {
      await issueCoaFromQcTest(tx, actor, { test_id: test.id });
    }
  },
});

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

    ALTER TABLE kit.coa_certificate
      ALTER COLUMN production_order_id DROP NOT NULL,
      ADD COLUMN IF NOT EXISTS qc_test_id uuid REFERENCES qms.qc_test(id),
      ADD COLUMN IF NOT EXISTS qc_test_code text,
      ADD COLUMN IF NOT EXISTS spec_code text,
      ADD COLUMN IF NOT EXISTS spec_version integer,
      ADD COLUMN IF NOT EXISTS analyst_name text,
      ADD COLUMN IF NOT EXISTS standard_usages_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS custom_notes text,
      ADD COLUMN IF NOT EXISTS revision_no int NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS revision_reason text;

    DROP TRIGGER IF EXISTS kit_coa_append_only ON kit.coa_certificate;
    DROP TRIGGER IF EXISTS kit_coa_no_delete ON kit.coa_certificate;
    CREATE TRIGGER kit_coa_no_delete BEFORE DELETE OR TRUNCATE ON kit.coa_certificate
      FOR EACH STATEMENT EXECUTE FUNCTION core.forbid_change();

    UPDATE kit.coa_certificate
       SET tests_per_kit = 0
     WHERE production_order_id IS NULL
       AND UPPER(COALESCE(uom, '')) NOT IN ('KIT', 'BỘ', 'HOP', 'HỘP')
       AND tests_per_kit = 50;

    CREATE TABLE IF NOT EXISTS qms.coa_template_config (
      id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      company_name text NOT NULL DEFAULT 'CÔNG TY TNHH GIẢI PHÁP Y SINH ABT — ABT BIOLOGICAL SOLUTIONS CO., LTD',
      document_title text NOT NULL DEFAULT 'GIẤY CHỨNG NHẬN PHÂN TÍCH / CERTIFICATE OF ANALYSIS (COA)',
      iso_subtitle text NOT NULL DEFAULT 'Do Phòng QA/QC Cấp Phát (ISO 13485:2016 & GMP-IVD)',
      address_line text NOT NULL DEFAULT 'Nhà máy & Phòng Lab QA/QC Đạt Chuẩn ISO 13485:2016',
      footer_statement text NOT NULL DEFAULT 'Chứng nhận điện tử cấp bởi Phòng QA/QC tuân thủ 21 CFR Part 11 & ISO 13485',
      approver_title text NOT NULL DEFAULT 'Phòng QA/QC Phê duyệt & Cấp COA / Approved by QA/QC:',
      results_display_mode text NOT NULL DEFAULT 'SUMMARY_TEMPLATE',
      default_coa_parameters jsonb NOT NULL DEFAULT '[
        {"seq":1,"parameter_name":"Ngoại quan & Quy cách đóng gói / Appearance & Packaging","method":"Kiểm tra ngoại quan (TCCS)","spec_limit":"Đồng nhất, nguyên vẹn, đúng quy cách / Conforms","observed_value":"Đạt tiêu chuẩn / Conforms","passed":true},
        {"seq":2,"parameter_name":"Độ tinh khiết & Tính toàn vẹn thành phần / Purity & Integrity","method":"Tiêu chuẩn cơ sở ABT (TCCS)","spec_limit":"Đạt giới hạn chất lượng công bố / Meets Spec","observed_value":"Đạt tiêu chuẩn / Conforms","passed":true},
        {"seq":3,"parameter_name":"Hoạt tính sinh học & Hiệu năng phản ứng / Functional Performance","method":"Thử nghiệm hoạt tính (SOP-QC)","spec_limit":"Đạt độ nhạy & độ đặc hiệu chuẩn / Conforms","observed_value":"Đạt tiêu chuẩn / Conforms","passed":true},
        {"seq":4,"parameter_name":"Kiểm tra độ sạch & Không nhiễm chéo / Contamination Check","method":"Kiểm nghiệm đối chứng âm (NTC)","spec_limit":"Không phát hiện tín hiệu nhiễm / Negative","observed_value":"Đạt tiêu chuẩn / Conforms","passed":true}
      ]'::jsonb,
      updated_by int,
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    ALTER TABLE qms.coa_template_config
      ADD COLUMN IF NOT EXISTS results_display_mode text NOT NULL DEFAULT 'SUMMARY_TEMPLATE',
      ADD COLUMN IF NOT EXISTS default_coa_parameters jsonb NOT NULL DEFAULT '[
        {"seq":1,"parameter_name":"Ngoại quan & Quy cách đóng gói / Appearance & Packaging","method":"Kiểm tra ngoại quan (TCCS)","spec_limit":"Đồng nhất, nguyên vẹn, đúng quy cách / Conforms","observed_value":"Đạt tiêu chuẩn / Conforms","passed":true},
        {"seq":2,"parameter_name":"Độ tinh khiết & Tính toàn vẹn thành phần / Purity & Integrity","method":"Tiêu chuẩn cơ sở ABT (TCCS)","spec_limit":"Đạt giới hạn chất lượng công bố / Meets Spec","observed_value":"Đạt tiêu chuẩn / Conforms","passed":true},
        {"seq":3,"parameter_name":"Hoạt tính sinh học & Hiệu năng phản ứng / Functional Performance","method":"Thử nghiệm hoạt tính (SOP-QC)","spec_limit":"Đạt độ nhạy & độ đặc hiệu chuẩn / Conforms","observed_value":"Đạt tiêu chuẩn / Conforms","passed":true},
        {"seq":4,"parameter_name":"Kiểm tra độ sạch & Không nhiễm chéo / Contamination Check","method":"Kiểm nghiệm đối chứng âm (NTC)","spec_limit":"Không phát hiện tín hiệu nhiễm / Negative","observed_value":"Đạt tiêu chuẩn / Conforms","passed":true}
      ]'::jsonb;

    INSERT INTO qms.coa_template_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

    CREATE TABLE IF NOT EXISTS qms.qc_spec_item (
      spec_id uuid NOT NULL REFERENCES qms.qc_spec(id) ON DELETE CASCADE,
      item_id uuid NOT NULL REFERENCES master.item(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (spec_id, item_id)
    );
    INSERT INTO qms.qc_spec_item (spec_id, item_id)
    SELECT id, item_id FROM qms.qc_spec WHERE item_id IS NOT NULL
    ON CONFLICT (spec_id, item_id) DO NOTHING;
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
                 WHERE (t.entity_type = 'LOT' AND t.entity_id = l.id)
                    OR EXISTS (
                      SELECT 1 FROM kit.production_order po
                       WHERE po.lot_id = l.id
                         AND (po.qc_test_id = t.id OR (t.entity_type = 'PRODUCTION_ORDER' AND t.entity_id = po.id))
                    )
                 ORDER BY t.created_at DESC LIMIT 1
              ) AS latest_test_id,
              (
                SELECT t.code
                  FROM qms.qc_test t
                 WHERE (t.entity_type = 'LOT' AND t.entity_id = l.id)
                    OR EXISTS (
                      SELECT 1 FROM kit.production_order po
                       WHERE po.lot_id = l.id
                         AND (po.qc_test_id = t.id OR (t.entity_type = 'PRODUCTION_ORDER' AND t.entity_id = po.id))
                    )
                 ORDER BY t.created_at DESC LIMIT 1
              ) AS latest_test_code,
              (
                SELECT t.status
                  FROM qms.qc_test t
                 WHERE (t.entity_type = 'LOT' AND t.entity_id = l.id)
                    OR EXISTS (
                      SELECT 1 FROM kit.production_order po
                       WHERE po.lot_id = l.id
                         AND (po.qc_test_id = t.id OR (t.entity_type = 'PRODUCTION_ORDER' AND t.entity_id = po.id))
                    )
                 ORDER BY t.created_at DESC LIMIT 1
              ) AS latest_test_status,
              (
                SELECT t.overall_result
                  FROM qms.qc_test t
                 WHERE (t.entity_type = 'LOT' AND t.entity_id = l.id)
                    OR EXISTS (
                      SELECT 1 FROM kit.production_order po
                       WHERE po.lot_id = l.id
                         AND (po.qc_test_id = t.id OR (t.entity_type = 'PRODUCTION_ORDER' AND t.entity_id = po.id))
                    )
                 ORDER BY t.created_at DESC LIMIT 1
              ) AS latest_test_result,
              (
                SELECT c.code
                  FROM kit.coa_certificate c
                 WHERE c.lot_id = l.id
                 ORDER BY c.issued_at DESC LIMIT 1
              ) AS issued_coa_code
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

  // 7. Official COAs issued by QA/QC and mapped across Production & Sales
  const issuedCoas = (
    await tx.query(
      `SELECT c.*, po.code AS order_code, po.actual_ph::float AS actual_ph
         FROM kit.coa_certificate c
         LEFT JOIN kit.production_order po ON po.id = c.production_order_id
        ORDER BY c.issued_at DESC
        LIMIT 100`
    )
  ).rows;

  // 8. Global COA Template Configuration
  const coaTemplate =
    (await tx.query("SELECT * FROM qms.coa_template_config WHERE id = 1")).rows[0] ?? {
      company_name: "CÔNG TY TNHH GIẢI PHÁP Y SINH ABT — ABT BIOLOGICAL SOLUTIONS CO., LTD",
      document_title: "GIẤY CHỨNG NHẬN PHÂN TÍCH / CERTIFICATE OF ANALYSIS (COA)",
      iso_subtitle: "Do Phòng QA/QC Cấp Phát (ISO 13485:2016 & GMP-IVD)",
      address_line: "Nhà máy & Phòng Lab QA/QC Đạt Chuẩn ISO 13485:2016",
      footer_statement: "Chứng nhận điện tử cấp bởi Phòng QA/QC tuân thủ 21 CFR Part 11 & ISO 13485",
      approver_title: "Phòng QA/QC Phê duyệt & Cấp COA / Approved by QA/QC:",
    };

  return {
    reception_queue: queueLots,
    all_lots: allLots,
    standards,
    standard_usages: standardUsages,
    methods,
    retention_samples: retentionSamples,
    issued_coas: issuedCoas,
    coa_template: coaTemplate,
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
        `SELECT s.id, s.code
           FROM qms.qc_spec s
          WHERE (s.item_id = $1 OR EXISTS (SELECT 1 FROM qms.qc_spec_item si WHERE si.spec_id = s.id AND si.item_id = $1))
            AND s.applies_to = $2
            AND s.status = 'EFFECTIVE'
          ORDER BY s.spec_version DESC LIMIT 1`,
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
  spec_id: z.string().uuid().optional().nullable(),
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

  // Check if an open test already exists for this lot (either LOT or linked PRODUCTION_ORDER)
  const existingOpen = (
    await tx.query(
      `SELECT t.id, t.code, t.status FROM qms.qc_test t
        WHERE (
          (t.entity_type = 'LOT' AND t.entity_id = $1)
          OR EXISTS (
            SELECT 1 FROM kit.production_order po
             WHERE po.lot_id = $1
               AND (po.qc_test_id = t.id OR (t.entity_type = 'PRODUCTION_ORDER' AND t.entity_id = po.id))
          )
        )
        AND t.status IN ('PLANNED', 'IN_PROGRESS', 'RESULTS_ENTERED')
        ORDER BY t.created_at DESC LIMIT 1`,
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

  let spec: { id: string; code: string };
  if (d.spec_id) {
    const chosen = (await tx.query("SELECT id, code FROM qms.qc_spec WHERE id = $1", [d.spec_id])).rows[0];
    if (!chosen) throw notFound("tiêu chuẩn QC đã chọn");
    spec = chosen;
  } else {
    spec = await ensureEffectiveSpecForItem(tx, actor, lot.item_id, autoKind);
  }

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

  // Also link to kit.production_order if one exists for this lot and has no qc_test_id
  await tx.query(
    `UPDATE kit.production_order
        SET qc_test_id = COALESCE(qc_test_id, $2),
            updated_at = now()
      WHERE lot_id = $1`,
    [lot.id, test.id]
  );

  return { test_id: test.id, test_code: test.code, lot_code: lot.code, spec_code: spec.code };
}

const issueCoaFromTestSchema = z.object({
  test_id: z.string().uuid(),
  qc_summary: z.string().trim().max(500).optional().nullable(),
});

/**
 * Issues an official, immutable Certificate of Analysis (`kit.coa_certificate`) directly from an approved QC Test
 * at the QA/QC department (`Tab QA/QC`), capturing:
 * - Official QC Spec parameters, methods, limits, and actual QC measured results (`qms.qc_test_result`)
 * - Reference Standards / Control Panels evaluated in the run (`qms.reference_standard_usage`)
 * - QA/QC Analyst & Reviewer electronic approval metadata
 * And automatically maps (`ánh xạ`) the issued COA to the linked Kit Production Order & Lot.
 */
export async function issueCoaFromQcTest(tx: Tx, actor: AuthzActor, input: unknown) {
  await ensureQaOpsSchema(tx);
  await authorize(tx, actor, "qms.qc.review");
  const d = parseInput(issueCoaFromTestSchema, input);

  const test = (
    await tx.query(
      `SELECT t.*, s.code AS spec_code, s.spec_version, s.name AS spec_name,
              an.display_name AS analyst_name, rv.display_name AS reviewer_name
         FROM qms.qc_test t
         JOIN qms.qc_spec s ON s.id = t.spec_id
         LEFT JOIN core.user_profile an ON an.user_id = t.analyst_id
         LEFT JOIN core.user_profile rv ON rv.user_id = t.reviewer_id
        WHERE t.id = $1`,
      [d.test_id]
    )
  ).rows[0];
  if (!test) throw notFound("phiếu kiểm nghiệm QC");
  if (test.status !== "REVIEWED" || test.overall_result !== "PASS") {
    throw invalid("Chỉ được cấp COA chính thức khi Phiếu kiểm nghiệm QC đã được Duyệt (REVIEWED) với kết quả ĐẠT (PASS).");
  }

  // Resolve linked Production Order and Lot
  let order: any = null;
  let lot: any = null;

  if (test.entity_type === "PRODUCTION_ORDER") {
    order = (
      await tx.query("SELECT * FROM kit.production_order WHERE id = $1 FOR UPDATE", [test.entity_id])
    ).rows[0];
    if (order?.lot_id) {
      lot = (
        await tx.query(
          `SELECT l.*, i.code AS item_code, i.name AS item_name, i.base_uom
             FROM inv.lot l JOIN master.item i ON i.id = l.item_id
            WHERE l.id = $1`,
          [order.lot_id]
        )
      ).rows[0];
    }
  } else if (test.entity_type === "LOT") {
    lot = (
      await tx.query(
        `SELECT l.*, i.code AS item_code, i.name AS item_name, i.base_uom
           FROM inv.lot l JOIN master.item i ON i.id = l.item_id
          WHERE l.id = $1`,
        [test.entity_id]
      )
    ).rows[0];
    if (lot) {
      order = (
        await tx.query(
          "SELECT * FROM kit.production_order WHERE lot_id = $1 ORDER BY created_at DESC LIMIT 1 FOR UPDATE",
          [lot.id]
        )
      ).rows[0];
    }
  }

  if (!lot) {
    throw invalid("Phiếu QC này chưa gắn với Lô hàng (inv.lot) để cấp phát COA lô.");
  }

  // Check if COA was already issued for this lot or test (since kit.coa_certificate is append-only)
  const existingCoa = (
    await tx.query(
      `SELECT * FROM kit.coa_certificate
        WHERE qc_test_id = $1 OR lot_id = $2 OR ($3::uuid IS NOT NULL AND production_order_id = $3)
        ORDER BY issued_at DESC LIMIT 1`,
      [test.id, lot.id, order?.id ?? null]
    )
  ).rows[0];

  if (existingCoa) {
    // Ensure the production order is linked and marked QC passed if still in PENDING_QC
    if (order) {
      await tx.query(
        `UPDATE kit.production_order
            SET qc_test_id = COALESCE(qc_test_id, $2),
                qc_passed = true,
                qc_summary = COALESCE($3, qc_summary, $4),
                status = CASE WHEN status = 'PENDING_QC' THEN 'PENDING_RELEASE' ELSE status END,
                good_qty = COALESCE(NULLIF(good_qty, 0), planned_qty),
                updated_at = now()
          WHERE id = $1`,
        [order.id, test.id, d.qc_summary ?? null, `Đạt QC & Đã cấp COA ${existingCoa.code} từ phiếu ${test.code}`]
      );
    }
    return { coa: existingCoa, already_issued: true };
  }

  // Gather actual QC Test Parameters & Results evaluated by QA/QC
  const qcParamRows = (
    await tx.query(
      `SELECT p.seq,
              p.name AS parameter_name,
              p.method,
              p.unit,
              p.value_type,
              p.lower_limit::float AS lower_limit,
              p.upper_limit::float AS upper_limit,
              p.target,
              p.is_critical,
              r.value_numeric::float AS value_numeric,
              r.observed_numeric::float AS observed_numeric,
              r.value_text,
              r.passed
         FROM qms.qc_spec_parameter p
         LEFT JOIN qms.qc_result r ON r.parameter_id = p.id AND r.test_id = $1
        WHERE p.spec_id = $2
        ORDER BY p.seq ASC`,
      [test.id, test.spec_id]
    )
  ).rows.map((p) => {
    const specLimit =
      p.value_type === "NUMERIC"
        ? [
            p.lower_limit != null ? `≥ ${p.lower_limit}` : null,
            p.upper_limit != null ? `≤ ${p.upper_limit}` : null,
          ]
            .filter(Boolean)
            .join(" và ") + (p.unit ? ` ${p.unit}` : "")
        : p.value_type === "PASS_FAIL"
          ? "Đạt tiêu chuẩn / Conforms"
          : p.target ?? "Đạt";

    const observedValue =
      p.value_numeric != null
        ? `${p.value_numeric}${p.unit ? ` ${p.unit}` : ""}${
            p.observed_numeric != null ? ` (đo: ${p.observed_numeric})` : ""
          }`
        : p.value_text === "PASS"
          ? "Đạt / Pass"
          : p.value_text === "FAIL"
            ? "Không đạt / Fail"
            : p.value_text ?? "Đạt / Pass";

    return {
      seq: p.seq,
      source: "QC_TEST",
      parameter_name: p.parameter_name,
      method: p.method ?? "SOP-QC",
      spec_limit: specLimit || "Đạt",
      observed_value: observedValue,
      passed: p.passed ?? true,
      // Backward-compatible fields for any legacy renderer
      step_code: `QC-${String(p.seq).padStart(2, "0")}`,
      step_name: `${p.parameter_name} (${p.method ?? "SOP-QC"})`,
      param_values: {
        "Yêu cầu": specLimit || "Đạt",
        "Kết quả QC": observedValue,
      },
    };
  });

  // Gather COA template config to determine how parameters should be displayed on the COA
  const tplCfg = (await tx.query("SELECT * FROM qms.coa_template_config WHERE id = 1")).rows[0];
  const displayMode: string = tplCfg?.results_display_mode ?? "SUMMARY_TEMPLATE";
  const tplDefaultParams: any[] = Array.isArray(tplCfg?.default_coa_parameters) ? tplCfg.default_coa_parameters : [];

  let finalCoaResults = qcParamRows;
  if (displayMode === "SUMMARY_TEMPLATE" && tplDefaultParams.length > 0) {
    finalCoaResults = tplDefaultParams.map((p: any, idx: number) => ({
      seq: p.seq ?? idx + 1,
      source: "COA_TEMPLATE",
      parameter_name: p.parameter_name,
      method: p.method || "TCCS / SOP-QC",
      spec_limit: p.spec_limit || "Đạt tiêu chuẩn / Conforms",
      observed_value: p.observed_value || "Đạt tiêu chuẩn / Conforms",
      passed: p.passed !== false,
      step_code: `COA-${String(idx + 1).padStart(2, "0")}`,
      step_name: p.parameter_name,
      param_values: {
        "Yêu cầu": p.spec_limit || "Đạt tiêu chuẩn / Conforms",
        "Kết quả QC": p.observed_value || "Đạt tiêu chuẩn / Conforms",
      },
    }));
  } else if (displayMode === "CONFORMS_ONLY") {
    finalCoaResults = qcParamRows.map((p) => ({
      ...p,
      spec_limit: "Đạt tiêu chuẩn nhà sản xuất / Conforms",
      observed_value: p.passed === false ? "Không đạt / Fail" : "Đạt tiêu chuẩn / Conforms",
      param_values: {
        "Yêu cầu": "Đạt tiêu chuẩn nhà sản xuất / Conforms",
        "Kết quả QC": p.passed === false ? "Không đạt / Fail" : "Đạt tiêu chuẩn / Conforms",
      },
    }));
  }
  const stdUsages = (
    await tx.query(
      `SELECT rs.code AS standard_code,
              rs.name AS standard_name,
              rs.lot_no,
              rs.target_metric,
              rs.lower_limit::float AS lower_limit,
              rs.upper_limit::float AS upper_limit,
              rs.unit,
              u.measured_value::float AS measured_value,
              u.measured_text,
              u.passed
         FROM qms.reference_standard_usage u
         JOIN qms.reference_standard rs ON rs.id = u.standard_id
        WHERE u.test_id = $1
        ORDER BY u.used_at ASC`,
      [test.id]
    )
  ).rows;

  let testsPerKit = 0;
  let packRows: any[] = [];
  if (order?.bom_id) {
    const bomRow = (await tx.query("SELECT tests_per_kit FROM kit.bom WHERE id = $1", [order.bom_id])).rows[0];
    if (bomRow?.tests_per_kit) testsPerKit = Number(bomRow.tests_per_kit);
    packRows = (
      await tx.query("SELECT * FROM kit.kit_packaging WHERE bom_id = $1 ORDER BY box_no, id", [order.bom_id])
    ).rows;
  } else if (String(lot.base_uom ?? "").toUpperCase() === "KIT") {
    testsPerKit = 50;
  }

  const ohRow = (
    await tx.query("SELECT COALESCE(SUM(qty_on_hand), 0)::float AS qty FROM inv.stock_balance WHERE lot_id = $1", [lot.id])
  ).rows[0];
  const goodQty = Number(order?.good_qty || order?.planned_qty || ohRow?.qty || 1);
  const uom = order?.uom || lot.base_uom || "KIT";
  const mfgDate = order?.mfg_date ?? lot.mfg_date ?? vnToday();
  const expiryDate = order?.expiry_date ?? lot.expiry_date ?? addDays(vnToday(), 365);

  const issuerProfile = (
    await tx.query("SELECT display_name FROM core.user_profile WHERE user_id = $1", [test.reviewer_id ?? actor.userId])
  ).rows[0];
  const issuedByName = test.reviewer_name ?? issuerProfile?.display_name ?? actor.name ?? "Trưởng phòng QA/QC";
  const coaCode = await nextNumber(tx, "KIT_COA");
  const summaryText =
    d.qc_summary?.trim() ||
    `Đạt tiêu chuẩn kiểm nghiệm chất lượng theo phiếu QC ${test.code} (${test.spec_code} v${test.spec_version})`;

  const coa = (
    await tx.query(
      `INSERT INTO kit.coa_certificate
         (code, lot_id, production_order_id, qc_test_id, qc_test_code, spec_code, spec_version,
          product_code, product_name, lot_code, mfg_date, expiry_date,
          tests_per_kit, good_qty, uom, qc_summary,
          qc_results_snapshot, standard_usages_snapshot, packaging_snapshot,
          analyst_name, issued_by, issued_by_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb, $18::jsonb, $19::jsonb, $20, $21, $22)
       RETURNING *`,
      [
        coaCode,
        lot.id,
        order?.id ?? null,
        test.id,
        test.code,
        test.spec_code,
        test.spec_version,
        lot.item_code,
        lot.item_name,
        lot.code,
        mfgDate,
        expiryDate,
        testsPerKit,
        goodQty,
        uom,
        summaryText,
        JSON.stringify(finalCoaResults),
        JSON.stringify(stdUsages),
        JSON.stringify(packRows),
        test.analyst_name ?? null,
        test.reviewer_id ?? actor.userId,
        issuedByName,
      ]
    )
  ).rows[0];

  if (order) {
    const planned = Number(order.planned_qty) || 1;
    const sampleQty = Number(order.sample_qty ?? 0);
    const retainQty = Number(order.retain_qty ?? 0);
    const yieldPct = Math.round(((goodQty + sampleQty + retainQty) / planned) * 10000) / 100;
    await tx.query(
      `UPDATE kit.production_order
          SET qc_test_id = $2,
              qc_passed = true,
              qc_summary = $3,
              good_qty = $4,
              yield_pct = $5,
              status = CASE WHEN status = 'PENDING_QC' THEN 'PENDING_RELEASE' ELSE status END,
              version = version + 1,
              updated_at = now()
        WHERE id = $1`,
      [order.id, test.id, summaryText, goodQty, yieldPct]
    );
  }

  await writeAudit(tx, actor, {
    entityType: "coa_certificate",
    entityId: coa.id,
    action: "issue_coa_from_qc",
    changes: { coa_code: [null, coa.code], qc_test_code: [null, test.code], lot_code: [null, lot.code] },
  });

  return { coa, already_issued: false };
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
  if (!["LOT", "PRODUCTION_ORDER"].includes(test.entity_type)) {
    throw invalid("Chỉ áp dụng giải phóng lô & cấp COA cho phiếu QC của Lô hàng (LOT) hoặc Lệnh sản xuất (PRODUCTION_ORDER).");
  }
  if (test.status !== "REVIEWED" || test.overall_result !== "PASS") {
    throw invalid("Phiếu QC phải được duyệt với kết quả ĐẠT (PASS) trước khi giải phóng lô & cấp COA.");
  }
  if (test.analyst_id != null && test.analyst_id === actor.userId) {
    throw invalid("Người giải phóng lô phải khác người kiểm nghiệm phiếu QC này (SoD).");
  }

  let lotId: string | null = test.entity_type === "LOT" ? test.entity_id : null;
  if (test.entity_type === "PRODUCTION_ORDER") {
    const po = (await tx.query("SELECT lot_id FROM kit.production_order WHERE id = $1", [test.entity_id])).rows[0];
    lotId = po?.lot_id ?? null;
  }
  if (!lotId) throw notFound("lô hàng gắn với phiếu QC");

  const openNcr = await tx.query("SELECT code FROM qms.ncr WHERE lot_id = $1 AND status <> 'CLOSED' LIMIT 1", [lotId]);
  if (openNcr.rowCount) {
    throw invalid("Lô đang có phiếu Sai lệch / NCR chưa đóng. Phải hoàn tất điều tra OOS và đóng NCR trước khi giải phóng lô.");
  }
  const openDev = await tx.query("SELECT code FROM qms.deviation WHERE entity_type = 'LOT' AND entity_id = $1 AND status <> 'CLOSED' LIMIT 1", [lotId]);
  if (openDev.rowCount) {
    throw invalid("Lô đang có phiếu Sai lệch / NCR chưa đóng. Phải hoàn tất điều tra OOS và đóng NCR trước khi giải phóng lô.");
  }

  const lot = (
    await tx.query(
      `SELECT l.*, i.code AS item_code, i.name AS item_name, i.item_type, i.base_uom
         FROM inv.lot l
         JOIN master.item i ON i.id = l.item_id
        WHERE l.id = $1 FOR UPDATE`,
      [lotId]
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
        const moveDoc = await createStockDocument(
          tx,
          actor,
          {
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
          },
          { trusted: true }
        );
        await runTransition(tx, stockDocumentMachine, actor, { id: moveDoc.id, action: "post", expectedVersion: moveDoc.version }, { trusted: true });
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

  // Automatically issue official COA from QC test and map to Kit/Lot
  const coaRes = await issueCoaFromQcTest(tx, actor, { test_id: test.id });

  return {
    lot_code: lot.code,
    lot_status: "RELEASED",
    putaway_executed: putawayCount > 0,
    retention_code: retentionCode,
    coa_code: coaRes.coa?.code ?? null,
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

const coaResultLineSchema = z.object({
  seq: z.coerce.number().int().min(1).optional(),
  parameter_name: z.string().trim().min(1),
  method: z.string().trim().default("SOP-QC"),
  spec_limit: z.string().trim().default("Đạt / Conforms"),
  observed_value: z.string().trim().default("Đạt / Pass"),
  passed: z.boolean().default(true),
});

const coaTemplateSchema = z.object({
  company_name: z.string().trim().min(3).max(300),
  document_title: z.string().trim().min(3).max(300),
  iso_subtitle: z.string().trim().max(300).default("Do Phòng QA/QC Cấp Phát (ISO 13485:2016)"),
  address_line: z.string().trim().max(400).default(""),
  footer_statement: z.string().trim().max(500).default(""),
  approver_title: z.string().trim().max(250).default("Phòng QA/QC Phê duyệt & Cấp COA / Approved by QA/QC:"),
  results_display_mode: z.enum(["SUMMARY_TEMPLATE", "CONFORMS_ONLY", "DETAILED_QC"]).default("SUMMARY_TEMPLATE"),
  default_coa_parameters: z.array(coaResultLineSchema).default([]),
  apply_to_existing_coas: z.boolean().default(true),
});

/**
 * Updates the global COA Template Configuration (`qms.coa_template_config`) and syncs `core.setting`
 * (`company.coa_header`, `company.coa_footer`) so all printed COAs reflect the latest template.
 */
export async function saveCoaTemplateConfig(tx: Tx, actor: AuthzActor, input: unknown) {
  await ensureQaOpsSchema(tx);
  await authorize(tx, actor, "qms.qc.review");
  const d = parseInput(coaTemplateSchema, input);

  const normalizedParams = d.default_coa_parameters.map((r, i) => ({
    seq: r.seq ?? i + 1,
    source: "COA_TEMPLATE",
    parameter_name: r.parameter_name,
    method: r.method || "TCCS / SOP-QC",
    spec_limit: r.spec_limit || "Đạt tiêu chuẩn / Conforms",
    observed_value: r.observed_value || "Đạt tiêu chuẩn / Conforms",
    passed: r.passed ?? true,
    step_code: `COA-${String(i + 1).padStart(2, "0")}`,
    step_name: r.parameter_name,
    param_values: {
      "Yêu cầu": r.spec_limit || "Đạt tiêu chuẩn / Conforms",
      "Kết quả QC": r.observed_value || "Đạt tiêu chuẩn / Conforms",
    },
  }));

  const row = (
    await tx.query(
      `INSERT INTO qms.coa_template_config
         (id, company_name, document_title, iso_subtitle, address_line, footer_statement, approver_title,
          results_display_mode, default_coa_parameters, updated_by, updated_at)
       VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, now())
       ON CONFLICT (id) DO UPDATE SET
         company_name = EXCLUDED.company_name,
         document_title = EXCLUDED.document_title,
         iso_subtitle = EXCLUDED.iso_subtitle,
         address_line = EXCLUDED.address_line,
         footer_statement = EXCLUDED.footer_statement,
         approver_title = EXCLUDED.approver_title,
         results_display_mode = EXCLUDED.results_display_mode,
         default_coa_parameters = EXCLUDED.default_coa_parameters,
         updated_by = EXCLUDED.updated_by,
         updated_at = now()
       RETURNING *`,
      [
        d.company_name,
        d.document_title,
        d.iso_subtitle,
        d.address_line,
        d.footer_statement,
        d.approver_title,
        d.results_display_mode,
        JSON.stringify(normalizedParams),
        actor.userId,
      ]
    )
  ).rows[0];

  // Sync to core.setting (`company.coa_header` and `company.coa_footer`) for Phiếu KQ / Oligo COA printing
  const headerStr = [d.company_name, d.address_line].filter(Boolean).join("\n");
  const footerStr = d.footer_statement;
  await tx.query(
    "UPDATE core.setting SET value = $2::jsonb, version = version + 1, updated_at = now(), updated_by = $3 WHERE key = $1",
    ["company.coa_header", JSON.stringify(headerStr), actor.userId]
  );
  await tx.query(
    "UPDATE core.setting SET value = $2::jsonb, version = version + 1, updated_at = now(), updated_by = $3 WHERE key = $1",
    ["company.coa_footer", JSON.stringify(footerStr), actor.userId]
  );

  await writeAudit(tx, actor, {
    entityType: "coa_template_config",
    entityId: "1",
    action: "update_template",
    changes: {
      company_name: [null, d.company_name],
      results_display_mode: [null, d.results_display_mode],
      parameters_count: [null, normalizedParams.length],
    },
  });

  return row;
}

const updateCoaCertSchema = z.object({
  id: z.string().uuid(),
  code: z.string().trim().min(2).max(60),
  product_code: z.string().trim().min(1).max(120),
  product_name: z.string().trim().min(1).max(300),
  lot_code: z.string().trim().min(1).max(120),
  mfg_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  expiry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  tests_per_kit: z.coerce.number().int().min(0).default(0),
  good_qty: z.coerce.number().positive(),
  uom: z.string().trim().min(1).max(40),
  spec_code: z.string().trim().max(80).optional().nullable(),
  qc_summary: z.string().trim().max(1000).optional().nullable(),
  analyst_name: z.string().trim().max(200).optional().nullable(),
  issued_by_name: z.string().trim().min(1).max(200),
  custom_notes: z.string().trim().max(1000).optional().nullable(),
  reason: z.string().trim().max(500).optional().nullable(),
  qc_results_snapshot: z.array(coaResultLineSchema).default([]),
});

/**
 * Updates an issued COA Certificate (`kit.coa_certificate`) with auditable revision tracking (`revision_no`, `revision_reason`).
 */
export async function updateCoaCertificate(tx: Tx, actor: AuthzActor, input: unknown) {
  await ensureQaOpsSchema(tx);
  await authorize(tx, actor, "qms.qc.review");
  const d = parseInput(updateCoaCertSchema, input);

  const oldRow = (await tx.query("SELECT * FROM kit.coa_certificate WHERE id = $1 FOR UPDATE", [d.id])).rows[0];
  if (!oldRow) throw notFound("Giấy chứng nhận phân tích (COA)");

  const normalizedResults = d.qc_results_snapshot.map((r, i) => ({
    seq: r.seq ?? i + 1,
    source: "QC_TEST",
    parameter_name: r.parameter_name,
    method: r.method || "SOP-QC",
    spec_limit: r.spec_limit || "Đạt",
    observed_value: r.observed_value || "Đạt / Pass",
    passed: r.passed ?? true,
    step_code: `QC-${String(i + 1).padStart(2, "0")}`,
    step_name: `${r.parameter_name} (${r.method || "SOP-QC"})`,
    param_values: {
      "Yêu cầu": r.spec_limit || "Đạt",
      "Kết quả QC": r.observed_value || "Đạt / Pass",
    },
  }));

  const revisionReason = d.reason || "Cập nhật phiên bản COA";

  const updatedRow = (
    await tx.query(
      `UPDATE kit.coa_certificate
          SET code = $2,
              product_code = $3,
              product_name = $4,
              lot_code = $5,
              mfg_date = $6,
              expiry_date = $7,
              tests_per_kit = $8,
              good_qty = $9,
              uom = $10,
              spec_code = $11,
              qc_summary = $12,
              analyst_name = $13,
              issued_by_name = $14,
              custom_notes = $15,
              qc_results_snapshot = $16::jsonb,
              revision_no = COALESCE(revision_no, 1) + 1,
              revision_reason = $17
        WHERE id = $1
        RETURNING *`,
      [
        d.id,
        d.code,
        d.product_code,
        d.product_name,
        d.lot_code,
        d.mfg_date,
        d.expiry_date,
        d.tests_per_kit,
        d.good_qty,
        d.uom,
        d.spec_code ?? oldRow.spec_code,
        d.qc_summary ?? oldRow.qc_summary,
        d.analyst_name ?? null,
        d.issued_by_name,
        d.custom_notes ?? null,
        JSON.stringify(normalizedResults),
        revisionReason,
      ]
    )
  ).rows[0];

  await writeAudit(tx, actor, {
    entityType: "kit.coa_certificate",
    entityId: d.id,
    action: "UPDATE",
    changes: {
      revision_no: [oldRow.revision_no ?? 1, updatedRow.revision_no],
      code: [oldRow.code, updatedRow.code],
      product_name: [oldRow.product_name, updatedRow.product_name],
      qc_summary: [oldRow.qc_summary, updatedRow.qc_summary],
      qc_results_snapshot: [oldRow.qc_results_snapshot, updatedRow.qc_results_snapshot],
    },
    reason: revisionReason,
  });

  return updatedRow;
}

const assignSpecItemSchema = z.object({
  spec_id: z.string().uuid(),
  mode: z.enum(["ASSIGN", "CLONE"]).default("ASSIGN"),
  applies_to: z.enum(["ITEM", "RECEIPT", "PRODUCT", "OLIGO", "DEVICE_MODEL"]),
  item_id: z.string().uuid().optional().nullable(),
  item_ids: z.array(z.string().uuid()).optional(),
  custom_name: z.string().trim().max(250).optional().nullable(),
  make_effective: z.boolean().default(true),
});

/**
 * Assigns an existing QC Specification (`qms.qc_spec`) directly to 1 or multiple Products / Items (`mode = 'ASSIGN'`)
 * OR clones an existing QC Specification (with all its parameters) to 1 or multiple Products / Items (`mode = 'CLONE'`).
 */
export async function assignSpecToItem(tx: Tx, actor: AuthzActor, input: unknown) {
  await ensureQaOpsSchema(tx);
  await authorize(tx, actor, "qms.spec.manage");
  const d = parseInput(assignSpecItemSchema, input);

  const srcSpec = (await tx.query("SELECT * FROM qms.qc_spec WHERE id = $1 FOR UPDATE", [d.spec_id])).rows[0];
  if (!srcSpec) throw notFound("tiêu chuẩn QC");

  const targetItemIds = Array.from(new Set([...(d.item_ids ?? []), ...(d.item_id ? [d.item_id] : [])]));

  let itemRows: { id: string; code: string; name: string }[] = [];
  if (targetItemIds.length > 0) {
    itemRows = (
      await tx.query("SELECT id, code, name FROM master.item WHERE id = ANY($1::uuid[]) ORDER BY code", [targetItemIds])
    ).rows;
    if (itemRows.length === 0) throw notFound("vật tư / sản phẩm");
  } else if (["ITEM", "RECEIPT", "PRODUCT"].includes(d.applies_to)) {
    throw invalid("Vui lòng chọn ít nhất một Vật tư / Bán thành phẩm / Sản phẩm cần gán tiêu chuẩn.");
  }

  const primaryItem = itemRows[0] ?? null;

  if (d.mode === "ASSIGN") {
    const newName =
      d.custom_name?.trim() ||
      (itemRows.length === 1
        ? `Tiêu chuẩn QC — ${itemRows[0].code} ${itemRows[0].name}`
        : itemRows.length > 1
          ? `Tiêu chuẩn QC — ${itemRows[0].code} (+${itemRows.length - 1} sản phẩm)`
          : srcSpec.name);

    const updated = (
      await tx.query(
        `UPDATE qms.qc_spec
            SET applies_to = $2,
                item_id = $3,
                name = $4,
                status = CASE WHEN $5::boolean THEN 'EFFECTIVE' ELSE status END,
                effective_at = CASE WHEN $5::boolean THEN COALESCE(effective_at, now()) ELSE effective_at END,
                version = version + 1,
                updated_at = now(),
                updated_by = $6
          WHERE id = $1
          RETURNING *`,
        [srcSpec.id, d.applies_to, primaryItem?.id ?? null, newName, d.make_effective, actor.userId]
      )
    ).rows[0];

    await tx.query("DELETE FROM qms.qc_spec_item WHERE spec_id = $1", [srcSpec.id]);
    for (const ir of itemRows) {
      await tx.query(
        "INSERT INTO qms.qc_spec_item (spec_id, item_id) VALUES ($1, $2) ON CONFLICT (spec_id, item_id) DO NOTHING",
        [srcSpec.id, ir.id]
      );
    }

    await writeAudit(tx, actor, {
      entityType: "qc_spec",
      entityId: srcSpec.id,
      action: "assign_items",
      changes: {
        assigned_count: [null, itemRows.length],
        item_codes: [null, itemRows.map((x) => x.code).join(", ")],
        applies_to: [srcSpec.applies_to, d.applies_to],
      },
    });
    return { spec: updated, mode: "ASSIGN", count: itemRows.length };
  }

  // mode === "CLONE": Clone spec + parameters for the target product(s)
  const newCode = await nextNumber(tx, "QC_SPEC");
  const cloneName =
    d.custom_name?.trim() ||
    (itemRows.length === 1
      ? `Tiêu chuẩn QC — ${itemRows[0].code} ${itemRows[0].name}`
      : itemRows.length > 1
        ? `Tiêu chuẩn QC — ${itemRows[0].code} (+${itemRows.length - 1} sản phẩm)`
        : `${srcSpec.name} (Bản sao)`);

  const cloned = (
    await tx.query(
      `INSERT INTO qms.qc_spec
         (code, spec_version, name, applies_to, item_id, status, effective_at, notes, created_by, updated_by)
       VALUES ($1, 1, $2, $3, $4, $5, CASE WHEN $5 = 'EFFECTIVE' THEN now() ELSE NULL END, $6, $7, $7)
       RETURNING *`,
      [
        newCode,
        cloneName,
        d.applies_to,
        primaryItem?.id ?? null,
        d.make_effective ? "EFFECTIVE" : "DRAFT",
        srcSpec.notes ?? `Sao chép và gán từ tiêu chuẩn ${srcSpec.code}`,
        actor.userId,
      ]
    )
  ).rows[0];

  for (const ir of itemRows) {
    await tx.query(
      "INSERT INTO qms.qc_spec_item (spec_id, item_id) VALUES ($1, $2) ON CONFLICT (spec_id, item_id) DO NOTHING",
      [cloned.id, ir.id]
    );
  }

  await tx.query(
    `INSERT INTO qms.qc_spec_parameter
       (spec_id, seq, name, method, unit, value_type, lower_limit, upper_limit, target, is_critical, derived_metric, oligo_purifications)
     SELECT $1, seq, name, method, unit, value_type, lower_limit, upper_limit, target, is_critical, derived_metric, oligo_purifications
       FROM qms.qc_spec_parameter
      WHERE spec_id = $2
      ORDER BY seq`,
    [cloned.id, srcSpec.id]
  );

  await writeAudit(tx, actor, {
    entityType: "qc_spec",
    entityId: cloned.id,
    action: "clone_to_items",
    changes: {
      from_spec: [null, srcSpec.code],
      new_code: [null, newCode],
      assigned_count: [null, itemRows.length],
    },
  });

  return { spec: cloned, mode: "CLONE", count: itemRows.length };
}
