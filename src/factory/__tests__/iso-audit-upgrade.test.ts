import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUser, grant } from "./helpers";
import { syncPermissions, type AuthzActor } from "../core/authz";
import { closeFactoryPool, getFactoryPool, withTransaction } from "../core/db";
import { preAuthenticate, runTransition, type MachineDef, type TransitionRequest } from "../core/stateMachine";
import { makeItem, makeSite } from "../inv/__tests__/fixtures";
import {
  controlledDocMachine,
  createControlledDocument,
  isUserTrainedForSop,
  recordTraining,
} from "../qms/documents";
import {
  bulkAddBomLines,
  createBom,
  getBomDetail,
  listBoms,
} from "../kit/bomRouting";
import { checkColumnContamination } from "../oligo/batches";
import { createProject, saveRiskItem, saveSpecEvaluation } from "../rd/projects";
import { createSoftwareRelease, swReleaseMachine } from "../rd/transfer";
import "../modules";

beforeAll(() => withTransaction((tx) => syncPermissions(tx)));
afterAll(closeFactoryPool);

const PIN = "482910";
const signed = { credential: { method: "PIN" as const, secret: PIN } };

async function act<S extends string, R extends { id: string; status: S; version: number }>(
  machine: MachineDef<S, R>,
  actor: AuthzActor,
  id: string,
  action: string,
  extra: Partial<TransitionRequest> = {}
): Promise<R> {
  const row = (await getFactoryPool().query(`SELECT status, version FROM ${machine.table} WHERE id = $1`, [id])).rows[0];
  const req: TransitionRequest = { id, action, expectedVersion: row.version, ...extra };
  await preAuthenticate(machine, row.status, req, actor);
  return withTransaction((tx) => runTransition(tx, machine, actor, req, { signerAuthenticated: true }));
}

describe("ISO 13485 / IEC 62304 / ISO 14971 / GMP / High-Scale & Column Oligo Audit Upgrade", () => {
  it("1. Controlled Document (SOP) & Personnel Training Qualification (ISO 13485 §4.2.4 & §6.2)", async () => {
    const author = await createUser("Chuyên viên QA Soạn SOP", PIN);
    const approver = await createUser("Trưởng phòng QA Duyệt SOP", PIN);
    const operator = await createUser("KTV Pha chế", PIN);

    await grant(author, ["qms.doc.manage", "qms.qc.view"]);
    await grant(approver, ["qms.doc.manage", "qms.doc.approve", "qms.qc.view"]);

    const sopCode = `SOP-GMP-${Date.now().toString().slice(-6)}`;
    const doc = await withTransaction((tx) =>
      createControlledDocument(tx, author, {
        code: sopCode,
        title: "Quy trình pha chế Master Mix phòng sạch ISO Class 7",
        doc_type: "SOP",
      })
    );
    expect(doc.status).toBe("DRAFT");
    expect(doc.doc_version).toBe(1);

    await act(controlledDocMachine, author, doc.id, "submit_review");

    // Self-approval blocked
    await expect(act(controlledDocMachine, author, doc.id, "approve", signed)).rejects.toThrow();

    // Independent QA approver signs approval -> EFFECTIVE
    const approved = await act(controlledDocMachine, approver, doc.id, "approve", signed);
    expect(approved.status).toBe("EFFECTIVE");

    // Before training record is logged, operator is NOT qualified for this EFFECTIVE SOP
    const trainedBefore = await withTransaction((tx) => isUserTrainedForSop(tx, operator.userId, sopCode));
    expect(trainedBefore).toBe(false);

    // Record PASS training -> operator becomes qualified
    await withTransaction((tx) =>
      recordTraining(tx, author, {
        document_id: doc.id,
        user_id: operator.userId,
        assessment_score: 95,
        result: "PASS",
      })
    );
    const trainedAfter = await withTransaction((tx) => isUserTrainedForSop(tx, operator.userId, sopCode));
    expect(trainedAfter).toBe(true);
  });

  it("2. High-Scale BOM: Bulk UNNEST Insertion of 120 Raw Material Lines & Server-Side Search/Pagination", async () => {
    const site = await makeSite();
    const manager = await createUser("Trưởng phòng Kit Scale", PIN);
    await grant(manager, ["kit.view", "kit.bom.manage", "master.item.manage"], site.dept);
    await grant(manager, ["master.item.manage"]);

    const kitProduct = await makeItem(site, { code: `KIT-MUX-${Date.now().toString().slice(-5)}`, item_type: "FINISHED_KIT" });
    const rawItems: Array<{ id: string }> = [];
    for (let i = 1; i <= 12; i++) {
      rawItems.push(await makeItem(site, { code: `RM-SCALE-${i}-${Date.now().toString().slice(-4)}`, item_type: "RAW_MATERIAL" }));
    }

    const bom = await withTransaction((tx) =>
      createBom(tx, manager, {
        org_unit_id: site.dept,
        product_item_id: kitProduct.id,
        name: "BOM Kit Multiplex 120 thành phần",
        tests_per_kit: 100,
      })
    );

    const bulkLines = Array.from({ length: 120 }, (_, idx) => ({
      component_item_id: rawItems[idx % rawItems.length].id,
      qty_per_base: 0.25 + (idx % 5) * 0.1,
      uom: "ML",
      scrap_pct: 2,
      box_no: (idx % 4) + 1,
      component_role: "REAGENT" as const,
      is_critical: true,
      is_bundled: false,
      allow_substitute: false,
      notes: `Thành phần #${idx + 1}`,
    }));

    const inserted = await withTransaction((tx) =>
      bulkAddBomLines(tx, manager, {
        bom_id: bom.id,
        lines: bulkLines,
      })
    );
    expect(inserted.length).toBe(120);

    // Filter BOM lines by box_no = 2
    const detailBox2 = await withTransaction((tx) => getBomDetail(tx, manager, bom.id, { box_no: 2, limit: 50 }));
    expect(detailBox2.total_lines).toBe(120);
    expect(detailBox2.lines.length).toBe(30);

    // Server-side search on listBoms
    const bomsFound = await withTransaction((tx) => listBoms(tx, manager, { q: "Multiplex 120" }));
    expect(bomsFound.some((b: any) => b.id === bom.id && b.line_count === 120)).toBe(true);
  });

  it("3. Column-Based Oligo Synthesizer Cross-Contamination Detection (Adjacent Columns vs Non-Adjacent)", async () => {
    const posCtrl = {
      code: "SEQ-PC-HBV",
      name: "HBV Positive Control Template",
      oligo_role: "POSITIVE_CONTROL",
      target_pathogen: "HBV",
      normalized_sequence: "ATCGGATCCGTACGATCGATCGATCGATCGATCGATCGATCGATCG",
    };
    const primerSamePathogen = {
      code: "SEQ-F-HBV",
      name: "HBV Forward Primer",
      oligo_role: "PRIMER",
      target_pathogen: "HBV",
      normalized_sequence: "ATCGGATCCGTACGATCGAT",
    };
    const unrelatedPrimer = {
      code: "SEQ-F-ACTB",
      name: "ACTB Internal Control Primer",
      oligo_role: "PRIMER",
      target_pathogen: "ACTB",
      normalized_sequence: "GCTAGCTAGCTAGCTAGCTA",
    };

    // Case A: Placed on adjacent columns (#1 and #2) -> triggers adjacentCollisions
    const adj = checkColumnContamination([
      { position_no: 1, s: posCtrl },
      { position_no: 2, s: primerSamePathogen },
    ]);
    expect(adj.adjacentCollisions.length).toBe(1);
    expect(adj.warningsByPos.get(1)).toContain("CẢNH BÁO NHIỄM CHÉO CỘT LIỀN KỀ");

    // Case B: Separated by an unrelated column (#1 is PC, #2 is ACTB, #3 is HBV Primer) -> 0 adjacent collisions, records co-synthesis note
    const separated = checkColumnContamination([
      { position_no: 1, s: posCtrl },
      { position_no: 2, s: unrelatedPrimer },
      { position_no: 3, s: primerSamePathogen },
    ]);
    expect(separated.adjacentCollisions.length).toBe(0);
    expect(separated.warningsByPos.get(1)).toContain("Lưu ý đồng tổng hợp cùng mẻ với cột #3");
  });

  it("4. R&D ISO 14971 FMEA Risk Register & IEC 62304 Software Release Safety Class Guards", async () => {
    const site = await makeSite();
    const rdLead = await createUser("Trưởng nhóm R&D ISO", PIN);
    await grant(rdLead, ["rd.view", "rd.project.manage", "rd.transfer.manage"], site.dept);

    const projDetail = await withTransaction((tx) =>
      createProject(tx, rdLead, {
        name: "Phần mềm Phân tích Ct Real-time PCR Tự động",
        owner_org_unit_id: site.dept,
        target_domain: "SOFTWARE",
        ivd_class: "CLASS_C",
      })
    );

    // Save ISO 14971 Risk Item -> RPN auto-computed (4 * 3 * 2 = 24)
    const risk = await withTransaction((tx) =>
      saveRiskItem(tx, rdLead, projDetail.id, null, {
        hazard: "Sai lệch ngưỡng đường nền (Baseline drift)",
        hazardous_situation: "Tín hiệu huỳnh quang nhiễu ở chu kỳ đầu",
        harm: "Dương tính giả dẫn đến điều trị sai",
        severity: 4,
        occurrence: 3,
        detection: 2,
        mitigation_measure: "Thuật toán lọc nhiễu Savitzky-Golay & kiểm tra ngưỡng R² ≥ 0.99",
        status: "MITIGATED",
      })
    );
    expect(risk.rpn).toBe(24);

    // Save ISO 13485 Design Traceability spec linked to risk_item_id
    const spec = await withTransaction((tx) =>
      saveSpecEvaluation(tx, rdLead, projDetail.id, null, {
        category: "SOFTWARE",
        design_stage: "VERIFICATION",
        parameter: "Độ chính xác xác định Ct",
        unit: "Ct",
        target_value: "ΔCt ≤ 0.15",
        actual_value: "ΔCt = 0.08",
        risk_item_id: risk.id,
        result: "PASS",
      })
    );
    expect(spec.design_stage).toBe("VERIFICATION");
    expect(spec.risk_item_id).toBe(risk.id);

    // Create IEC 62304 Class C Software Release with an OPEN CRITICAL anomaly -> release must be blocked
    const swBlocked = await withTransaction((tx) =>
      createSoftwareRelease(tx, rdLead, {
        project_id: projDetail.id,
        version_tag: "v1.0.0-rc1",
        target_kind: "ASSAY_CALLER",
        safety_class: "CLASS_C",
        srs_traceability: [{ req_id: "SRS-01", title: "Tính toán Ct nội suy", test_case_id: "TC-01", result: "PASS" }],
        soup_list: [{ name: "numjs", version: "0.16.1", vendor: "OSS" }],
        known_anomalies: [{ bug_id: "BUG-99", severity: "CRITICAL", description: "Tràn bộ nhớ khi chạy > 384 mẫu", status: "OPEN" }],
        release_notes: "Bản thử nghiệm RC1",
        validation_summary: "Đã chạy 100 bộ dữ liệu giả lập",
      })
    );
    await expect(act(swReleaseMachine, rdLead, swBlocked.id, "release", signed)).rejects.toThrow();

    // Create IEC 62304 Class C Software Release with all SRS PASS and no open HIGH/CRITICAL anomalies -> release succeeds
    const swClean = await withTransaction((tx) =>
      createSoftwareRelease(tx, rdLead, {
        project_id: projDetail.id,
        version_tag: "v1.0.0",
        target_kind: "ASSAY_CALLER",
        safety_class: "CLASS_C",
        srs_traceability: [{ req_id: "SRS-01", title: "Tính toán Ct nội suy", test_case_id: "TC-01", result: "PASS" }],
        soup_list: [{ name: "numjs", version: "0.16.1", vendor: "OSS" }],
        known_anomalies: [{ bug_id: "BUG-99", severity: "CRITICAL", description: "Tràn bộ nhớ khi chạy > 384 mẫu", status: "RESOLVED" }],
        release_notes: "Bản chính thức v1.0.0",
        validation_summary: "Đạt 100% ca kiểm thử SRS-01..SRS-25",
      })
    );
    const released = await act(swReleaseMachine, rdLead, swClean.id, "release", signed);
    expect(released.status).toBe("RELEASED");
  });
});
