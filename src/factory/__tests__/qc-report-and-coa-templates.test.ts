import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeFactoryPool, getFactoryPool, withTransaction } from "../core/db";
import { syncPermissions, type AuthzActor } from "../core/authz";
import { preAuthenticate, runTransition, type MachineDef, type TransitionRequest } from "../core/stateMachine";
import { createUser, grant } from "./helpers";
import { makeItem, makeSite, stockedLot } from "../inv/__tests__/fixtures";
import { createSpecDraft, specMachine } from "../qms/specs";
import { createQcTest, qcTestMachine, saveResults } from "../qms/qcTests";
import { coaForTest } from "../qms/coa";
import { issueCoaFromQcTest, loadQcFormsConfig, saveCoaTemplateConfig } from "../qms/qaOps";
import { listQualityRecords } from "../kit/qualityTrace";
import {
  DEFAULT_QC_FORMS_CONFIG,
  DEFAULT_QC_STAFF_SIGNATURES,
  normalizeQcFormsConfig,
  resolveQcSignature,
} from "../../frontend/factory/qcSignatures";
import {
  buildCoaCertificateHtml,
  buildQcTestReportHtml,
  prepareCoaCertificateModel,
} from "../../frontend/factory/coa";
import "../modules";

const PIN = "482910";
const signed = { credential: { method: "PIN" as const, secret: PIN } };
const uniq = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

async function act<S extends string, R extends { id: string; status: S; version: number }>(
  machine: MachineDef<S, R>,
  actor: AuthzActor,
  id: string,
  action: string,
  extra: Partial<TransitionRequest> = {}
): Promise<R> {
  const row = (await getFactoryPool().query(`SELECT status, version FROM ${machine.table} WHERE id = $1`, [id])).rows[0];
  const req: TransitionRequest = { id, action, expectedVersion: row.version, ...extra };
  if (extra.credential) await preAuthenticate(machine, row.status, req, actor);
  return withTransaction((tx) =>
    runTransition(tx, machine, actor, req, extra.credential ? { signerAuthenticated: true } : {})
  );
}

beforeAll(() => withTransaction((tx) => syncPermissions(tx)));
afterAll(closeFactoryPool);

describe("QC Test Report (BM-QC-TR-01), COA (BM-QC-COA-01), Multilingual Export & Staff Signatures", () => {
  it("1. Ships all 7 valid handwritten QC employee signature PNG files in public/signatures/qc/", () => {
    const sigDir = path.resolve(process.cwd(), "public", "signatures", "qc");
    expect(DEFAULT_QC_STAFF_SIGNATURES).toHaveLength(7);

    const expectedFiles = [
      "chukythaotrinh.png",
      "chukythithong.png",
      "chukyngocmai.png",
      "chukyyennhi1.png",
      "chukyyenngoc.png",
      "chukykimanh.png",
      "chukykieumi.png",
    ];

    for (const file of expectedFiles) {
      const fullPath = path.join(sigDir, file);
      expect(fs.existsSync(fullPath)).toBe(true);
      const buf = fs.readFileSync(fullPath);
      expect(buf.length).toBeGreaterThan(1000);
      // Verify PNG magic signature: 89 50 4E 47
      expect(buf.subarray(0, 4).toString("hex")).toBe("89504e47");
    }
  });

  it("2. Resolves all 7 QC staff signatures by full name, emp_code, and accent-stripped alias with Phan Thị Thảo Trinh manager fallback", () => {
    const cfg = normalizeQcFormsConfig(null, null);

    expect(resolveQcSignature("Phan Thị Thảo Trinh", "MANAGER", cfg).signatureUrl).toBe("/signatures/qc/chukythaotrinh.png");
    expect(resolveQcSignature("Nguyễn Thị Thông", "ANALYST", cfg).signatureUrl).toBe("/signatures/qc/chukythithong.png");
    expect(resolveQcSignature("Bạch Ngọc Mai", "ANALYST", cfg).signatureUrl).toBe("/signatures/qc/chukyngocmai.png");
    expect(resolveQcSignature("Nguyễn Ngọc Yến Nhi", "ANALYST", cfg).signatureUrl).toBe("/signatures/qc/chukyyennhi1.png");
    expect(resolveQcSignature("Phan Yến Ngọc", "ANALYST", cfg).signatureUrl).toBe("/signatures/qc/chukyyenngoc.png");
    expect(resolveQcSignature("Huỳnh Thị Kim Anh", "ANALYST", cfg).signatureUrl).toBe("/signatures/qc/chukykimanh.png");
    expect(resolveQcSignature("Lâm Kiều Mi", "ANALYST", cfg).signatureUrl).toBe("/signatures/qc/chukykieumi.png");

    // Lookup by emp_code and accent-stripped name
    expect(resolveQcSignature("NV.QC09", "ANALYST", cfg).displayName).toBe("Lâm Kiều Mi");
    expect(resolveQcSignature("nguyen thi thong", "ANALYST", cfg).signatureUrl).toBe("/signatures/qc/chukythithong.png");
    expect(resolveQcSignature("Thao Trinh", "MANAGER", cfg).signatureUrl).toBe("/signatures/qc/chukythaotrinh.png");

    // Generic manager label or empty name falls back to default QC/QA Manager (Phan Thị Thảo Trinh),
    // while an unrecognized custom person name never forges another employee's handwritten signature.
    const genericMgr = resolveQcSignature("Trưởng Phòng QA/QC", "MANAGER", cfg);
    expect(genericMgr.signatureUrl).toBe("/signatures/qc/chukythaotrinh.png");
    expect(genericMgr.displayName).toBe("Phan Thị Thảo Trinh");

    const customNoSigMgr = resolveQcSignature("Unknown Manager Name", "MANAGER", cfg);
    expect(customNoSigMgr.signatureUrl).toBeNull();
    expect(customNoSigMgr.displayName).toBe("Unknown Manager Name");

    const emptyMgr = resolveQcSignature("", "MANAGER", cfg);
    expect(emptyMgr.displayName).toBe("Phan Thị Thảo Trinh");
    expect(emptyMgr.signatureUrl).toBe("/signatures/qc/chukythaotrinh.png");
  });

  it("3. Renders detailed QC Test Report HTML (BM-QC-TR-01) with Method, Equipment, Measured Values & Signatures", () => {
    const html = buildQcTestReportHtml({
      test: {
        id: "t-1",
        code: "QC-26-1276",
        test_kind: "FQC",
        status: "REVIEWED",
        overall_result: "PASS",
        spec_code: "TCCS 222:2024/ABTLH",
        spec_version: 1,
        analyst_name: "Nguyễn Thị Thông",
        reviewer_name: "Phan Thị Thảo Trinh",
        parameters: [
          {
            id: "p1",
            seq: 1,
            name: "Đo pH dung dịch đệm",
            method: "Đo bằng máy đo pH (SOP-QC-05)",
            equipment_name: "Máy đo pH Mettler Toledo FP20",
            value_type: "NUMERIC",
            lower_limit: 7.0,
            upper_limit: 7.5,
            unit: "pH",
          },
          {
            id: "p2",
            seq: 2,
            name: "Độ nhạy phản ứng qPCR (Ct)",
            method: "Chạy Real-time PCR chuẩn nội",
            equipment_name: "Máy CFX96 Bio-Rad",
            value_type: "NUMERIC",
            upper_limit: 28,
            unit: "Ct",
          },
        ],
        results: [
          { parameter_id: "p1", value_numeric: 7.21, passed: true },
          { parameter_id: "p2", value_numeric: 24.35, passed: true },
        ],
      },
      lot: {
        code: "B2611146",
        item_code: "DD-103",
        item_name: "ABT® Cervical Cytology Kit",
        kd_po_code: "PO-26-0937",
        mfg_date: "2026-11-14",
        expiry_date: "2027-11-14",
        lot_qty: 7,
        uom: "Bộ",
        tests_per_kit: 25,
        bom_storage_condition: "RT",
        tccs_code: "TCCS 222:2024/ABTLH",
      },
      signature: {
        signer_name: "Phan Thị Thảo Trinh",
        signed_at: "2026-11-14T10:00:00Z",
      },
    });

    expect(html).toContain("QUALITY TEST REPORT");
    expect(html).toContain("PHIẾU TRẢ KẾT QUẢ KIỂM TRA CHẤT LƯỢNG THÀNH PHẨM");
    expect(html).toContain("BM-QC-TR-01");
    expect(html).toContain("TR-B2611146");
    expect(html).toContain("QC-26-1276");
    expect(html).toContain("Phương pháp:");
    expect(html).toContain("Thiết bị:");
    expect(html).toContain("Máy đo pH Mettler Toledo FP20");
    expect(html).toContain("Máy CFX96 Bio-Rad");
    expect(html).toContain("7,21");
    expect(html).toContain("24,35");
    expect(html).toContain("/signatures/qc/chukythithong.png");
    expect(html).toContain("/signatures/qc/chukythaotrinh.png");
  });

  it("4. Renders COA (BM-QC-COA-01) in TCCS_CONFORMANCE mode across BI, VI, and EN without leaking internal numeric values", () => {
    const sampleCoa = {
      id: "coa-1",
      code: "COA-B2611150",
      qc_test_code: "QC-26-1282",
      product_code: "DD-103",
      product_name: "ABT® Cervical Cytology Kit",
      lot_code: "B2611150",
      kd_po_code: "PO-26-0937",
      mfg_date: "2026-11-14",
      expiry_date: "2027-11-14",
      good_qty: 7,
      uom: "Bộ",
      tests_per_kit: 25,
      bom_storage_condition: "15-25 °C",
      tccs_code: "TCCS 222:2024/ABTLH",
      analyst_name: "Lâm Kiều Mi",
      issued_by_name: "Phan Thị Thảo Trinh",
      issued_at: "2026-11-14T11:00:00Z",
      qc_results_snapshot: [
        {
          seq: 1,
          parameter_name: "Đo pH nội bộ",
          method: "SOP-QC-05",
          spec_limit: "7.0 - 7.5",
          observed_value: "7.218",
          passed: true,
        },
        {
          seq: 2,
          parameter_name: "Ct nội bộ",
          method: "qPCR",
          spec_limit: "<= 28 Ct",
          observed_value: "24.391",
          passed: true,
        },
      ],
    };

    const htmlBi = buildCoaCertificateHtml(sampleCoa, null, "BI");
    expect(htmlBi).toContain("CERTIFICATE OF ANALYSIS (COA)");
    expect(htmlBi).toContain("PHIẾU PHÂN TÍCH KẾT QUẢ KIỂM NGHIỆM THÀNH PHẨM");
    expect(htmlBi).toContain("BM-QC-COA-01");
    expect(htmlBi).toContain("COA-B2611150");
    expect(htmlBi).toContain("QC-26-1282");
    expect(htmlBi).toContain("PO-26-0937");
    expect(htmlBi).toContain("Cảm quan và kỹ thuật");
    expect(htmlBi).toContain("Kiểm tra theo SOP");
    expect(htmlBi).toContain("Đạt yêu cầu về cảm quan và kỹ thuật theo TCCS 222:2024/ABTLH");
    expect(htmlBi).toContain("ĐẠT (PASS)");
    expect(htmlBi).toContain("/signatures/qc/chukykieumi.png");
    expect(htmlBi).toContain("/signatures/qc/chukythaotrinh.png");
    // Internal lab numbers must NOT leak on COA in default TCCS_CONFORMANCE mode
    expect(htmlBi).not.toContain("7.218");
    expect(htmlBi).not.toContain("24.391");

    // Pure Vietnamese export
    const htmlVi = buildCoaCertificateHtml(sampleCoa, null, "VI");
    expect(htmlVi).toContain("PHIẾU PHÂN TÍCH KẾT QUẢ KIỂM NGHIỆM THÀNH PHẨM");
    expect(htmlVi).not.toContain("Product Name:");
    expect(htmlVi).toContain("Cảm quan và kỹ thuật");
    expect(htmlVi).toContain("7 Bộ");
    expect(htmlVi).toContain("12 tháng");

    // Pure English export
    const modelEn = prepareCoaCertificateModel(sampleCoa, null, "EN");
    expect(modelEn.batchSize).toBe("7 Kits");
    const htmlEn = buildCoaCertificateHtml(sampleCoa, null, "EN");
    expect(htmlEn).toContain("CERTIFICATE OF ANALYSIS (COA)");
    expect(htmlEn).toContain("Appearance and Technical Specifications");
    expect(htmlEn).toContain("Tested according to SOP");
    expect(htmlEn).toContain("Conforms to appearance and technical specifications per TCCS 222:2024/ABTLH");
    expect(htmlEn).toContain("12 months");
    expect(htmlEn).toContain("7 Kits");
    expect(htmlEn).not.toContain("Cảm quan và kỹ thuật");
  });

  it("5. Persists dual template config + staff signatures in DB, enriches coaForTest & issues TCCS_CONFORMANCE COA without mutating append-only history", async () => {
    const site = await makeSite();
    const product = await makeItem(site, { storage_temp: "RT" });
    const lot = await stockedLot(site, product.id, 12, "2027-12-31");

    const analyst = await createUser("Lâm Kiều Mi", PIN);
    const reviewer = await createUser("Phan Thị Thảo Trinh", PIN);
    await grant(analyst, ["qms.qc.view", "qms.qc.analyze", "qms.spec.manage", "qms.spec.approve"]);
    await grant(reviewer, ["qms.qc.view", "qms.qc.review", "qms.spec.approve", "kit.view"]);

    // 5a. Save template config with custom signature data URI and ensure javascript: URLs are stripped
    const customConfig = structuredClone(DEFAULT_QC_FORMS_CONFIG);
    customConfig.coa.default_lang = "EN";
    customConfig.staff_signatures.push(
      {
        id: "nv-custom-png",
        emp_code: "NV.QC99",
        full_name: "Test Custom PNG",
        title_vi: "NHÂN VIÊN QC",
        title_en: "QC Analyst",
        role: "ANALYST",
        signature_url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        aliases: [],
      },
      {
        id: "nv-xss",
        emp_code: "NV.XSS",
        full_name: "Evil Script",
        title_vi: "XSS",
        title_en: "XSS",
        role: "ANALYST",
        signature_url: "javascript:alert(1)",
        aliases: [],
      }
    );

    await withTransaction((tx) =>
      saveCoaTemplateConfig(tx, reviewer, {
        results_display_mode: "TCCS_CONFORMANCE",
        qc_forms_config: customConfig,
      })
    );

    const loadedCfg = await withTransaction((tx) => loadQcFormsConfig(tx));
    expect(loadedCfg.qcFormsConfig.coa.results_mode).toBe("TCCS_CONFORMANCE");
    expect(loadedCfg.qcFormsConfig.coa.default_lang).toBe("EN");
    expect(loadedCfg.qcFormsConfig.staff_signatures.some((s) => s.emp_code === "NV.QC99")).toBe(true);
    expect(loadedCfg.qcFormsConfig.staff_signatures.some((s) => s.emp_code === "NV.XSS")).toBe(false);

    // 5b. Create BOM with tccs_code & Production Order linked to lot, plus Effective QC Spec & Reviewed Test
    const uid = uniq();
    await withTransaction(async (tx) => {
      const bom = (
        await tx.query(
          `INSERT INTO kit.bom (code, org_unit_id, product_item_id, name, base_uom, status, tccs_code, specification, storage_condition, shelf_life_months)
           VALUES ($1, $2, $3, $4, $5, 'EFFECTIVE', 'TCCS 222:2024/ABTLH', '25 tests', '15-25 °C', 12)
           RETURNING id`,
          [`BOM-QCTPL-${uid}`, site.dept, product.id, `BOM ${uid}`, product.base_uom]
        )
      ).rows[0];
      const routing = (
        await tx.query(
          `INSERT INTO kit.routing (code, org_unit_id, product_item_id, name, status)
           VALUES ($1, $2, $3, $4, 'EFFECTIVE') RETURNING id`,
          [`RT-QCTPL-${uid}`, site.dept, product.id, `Routing ${uid}`]
        )
      ).rows[0];
      await tx.query(
        `INSERT INTO kit.production_order
           (code, org_unit_id, product_item_id, bom_id, routing_id, warehouse_id, planned_qty, good_qty, uom, lot_id, mfg_date, expiry_date, status)
         VALUES ($1, $2, $3, $4, $5, $6, 12, 12, $7, $8, '2026-11-14', '2027-11-14', 'COMPLETED')`,
        [`PO-26-0937-${uid}`, site.dept, product.id, bom.id, routing.id, site.warehouse, product.base_uom, lot.id]
      );
    });

    const spec = await withTransaction((tx) =>
      createSpecDraft(tx, analyst, {
        name: `Spec TCCS ${uid}`,
        applies_to: "ITEM",
        item_id: product.id,
        parameters: [
          { name: "pH chuẩn", method: "Đo pH (SOP-QC)", value_type: "NUMERIC", lower_limit: 7.0, upper_limit: 7.5, unit: "pH" },
        ],
      })
    );
    await act(specMachine, reviewer, spec.id, "approve", signed);

    const test = await withTransaction((tx) =>
      createQcTest(tx, analyst, { entity_type: "LOT", entity_id: lot.id, spec_id: spec.id, test_kind: "FQC" })
    );
    await act(qcTestMachine, analyst, test.id, "start");
    const params = (
      await getFactoryPool().query("SELECT id FROM qms.qc_spec_parameter WHERE spec_id = $1 ORDER BY seq", [spec.id])
    ).rows;
    await withTransaction((tx) =>
      saveResults(tx, analyst, test.id, { results: [{ parameter_id: params[0].id, value_numeric: 7.25 }] })
    );
    await act(qcTestMachine, analyst, test.id, "submit_results");
    await act(qcTestMachine, reviewer, test.id, "review", signed);

    // 5c. Issue COA and inspect coaForTest & listQualityRecords
    const coaReq = { test_id: test.id, ...signed };
    const issued = await withTransaction((tx) =>
      issueCoaFromQcTest(tx, reviewer, coaReq, { signerAuthenticated: true })
    );
    expect(issued.coa.qc_results_snapshot).toHaveLength(1);
    expect(issued.coa.qc_results_snapshot[0].parameter_name).toBe("Cảm quan và kỹ thuật");
    expect(issued.coa.qc_results_snapshot[0].spec_limit).toContain("TCCS 222:2024/ABTLH");

    await expect(
      getFactoryPool().query("UPDATE kit.coa_certificate SET qc_summary = 'tampered' WHERE id = $1", [issued.coa.id])
    ).rejects.toThrow();

    const reportPayload = await withTransaction((tx) => coaForTest(tx, reviewer, test.id));
    expect(reportPayload.lot?.tccs_code).toBe("TCCS 222:2024/ABTLH");
    expect(reportPayload.lot?.order_code).toBe(`PO-26-0937-${uid}`);
    expect(reportPayload.qc_forms_config?.coa?.default_lang).toBe("EN");

    const quality = await withTransaction((tx) => listQualityRecords(tx, reviewer));
    expect(quality.qc_forms_config?.coa?.results_mode).toBe("TCCS_CONFORMANCE");

    // 5d. Restore clean default config in test DB
    await withTransaction((tx) =>
      saveCoaTemplateConfig(tx, reviewer, {
        results_display_mode: "TCCS_CONFORMANCE",
        qc_forms_config: DEFAULT_QC_FORMS_CONFIG,
      })
    );
  });
});
