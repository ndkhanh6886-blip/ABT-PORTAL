import { afterAll, describe, expect, it } from "vitest";
import { createOrgUnit, createUser, grant } from "../../__tests__/helpers";
import { closeFactoryPool, getFactoryPool, withTransaction } from "../../core/db";
import type { AuthzActor } from "../../core/authz";
import { preAuthenticate, runTransition, type MachineDef, type TransitionRequest } from "../../core/stateMachine";
import { createAsset } from "../../asset/service";
import { makeItem, makeSite, stockedLot, type Site } from "../../inv/__tests__/fixtures";
import {
  createIdea,
  createStrategicGoal,
  evaluateIdea,
  getIdeaDetail,
  ideaMachine,
} from "../ideas";
import {
  createProject,
  exportRoadmapIcs,
  getProjectDetail,
  projectGateMachine,
  saveMilestone,
  saveSpecEvaluation,
  updateGateDeliverable,
} from "../projects";
import {
  addExperimentEntry,
  consumeExperimentMaterial,
  createExperiment,
  createExperimentRevision,
  experimentMachine,
  getExperimentDetail,
  logExperimentAsset,
} from "../eln";
import { createSample, getSampleDetail, recordSampleEvent } from "../samples";
import {
  createSoftwareRelease,
  createTechTransferPackage,
  swReleaseMachine,
  techTransferMachine,
} from "../transfer";
import {
  addWorkTask,
  createOrGetWorkPlan,
  getWorkPlanDetail,
  updateWorkTaskAction,
  workPlanMachine,
} from "../workPlans";
import "../../modules";

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

async function setupRdTeam(site: Site) {
  const researcher = await createUser("Nghiên cứu viên R&D", PIN);
  await grant(
    researcher,
    [
      "rd.view",
      "rd.idea.propose",
      "rd.project.manage",
      "rd.eln.write",
      "rd.sample.manage",
      "rd.transfer.manage",
      "work.plan.submit",
      "asset.view",
      "asset.operate",
      "inv.stock.view",
      "master.data.view",
    ],
    site.dept
  );

  const rdHead = await createUser("Trưởng phòng R&D", PIN);
  await grant(
    rdHead,
    [
      "rd.view",
      "rd.idea.propose",
      "rd.idea.evaluate",
      "rd.idea.approve",
      "rd.project.manage",
      "rd.gate.review",
      "rd.eln.write",
      "rd.eln.approve",
      "rd.sample.manage",
      "rd.transfer.manage",
      "rd.software.release",
      "work.plan.submit",
      "work.plan.approve",
      "asset.view",
      "asset.manage",
      "asset.operate",
      "inv.stock.view",
      "master.data.view",
    ],
    site.dept
  );

  const bizReviewer = await createUser("Hội đồng Kinh doanh", PIN);
  await grant(bizReviewer, ["rd.view", "rd.idea.evaluate"], site.dept);

  const kitDept = await createOrgUnit("KIT-PROD");
  const kitHead = await createUser("Trưởng phòng Sản xuất Kit", PIN);
  await grant(kitHead, ["rd.view", "rd.transfer.accept", "qms.qc.view"], kitDept);

  return { researcher, rdHead, bizReviewer, kitDept, kitHead };
}

describe("R&D Module (Phase 4d): Idea Funnel, Stage-Gate, ELN, Biobank, Tech Transfer & Weekly Work Plans", () => {
  it("1. Idea Funnel & Weighted Committee Scoring: enforces both TECH and BIZ evaluations, blocks self-approval, signs approval, and converts to Stage-Gate project", async () => {
    const site = await makeSite();
    const { researcher, rdHead, bizReviewer } = await setupRdTeam(site);

    const goal = await withTransaction((tx) =>
      createStrategicGoal(tx, rdHead, {
        name: "Làm chủ Kit Real-time PCR chẩn đoán tác nhân hô hấp 2026",
        period: "2026",
        description: "Mục tiêu chiến lược phát triển IVD Class C",
      })
    );
    expect(goal.code).toMatch(/^SG\d{2}-/);

    const idea = await withTransaction((tx) =>
      createIdea(tx, researcher, {
        org_unit_id: site.dept,
        title: "Kit Multiplex RT-qPCR cúm A/B & RSV một bước",
        description: "Sử dụng TaqMan probe 4 màu huỳnh quang, phản ứng lyophilisate ổn định ở 2-8°C",
        target_domain: "KIT",
        goal_id: goal.id,
        expected_roi: "Hoàn vốn sau 10 tháng thương mại hóa",
        market_summary: "Nhu cầu 150.000 test/năm tại các bệnh viện tuyến tỉnh",
        submit_now: true,
      })
    );
    expect(idea.status).toBe("SUBMITTED");

    // First evaluation (TECH only) moves idea to EVALUATION, not yet EVALUATED
    const afterTech = await withTransaction((tx) =>
      evaluateIdea(tx, rdHead, idea.id, {
        eval_type: "TECH",
        scores: {
          TECH_FEASIBILITY: 5,
          TECH_INNOVATION: 4,
          TECH_RESOURCES: 4,
        },
        analysis: "Hoàn toàn khả thi với năng lực tổng hợp Oligo nội bộ.",
        recommendation: "APPROVE",
      })
    );
    expect(afterTech.status).toBe("EVALUATION");
    expect(afterTech.evaluations).toHaveLength(1);
    expect(afterTech.evaluations[0].weighted_score).toBeGreaterThan(80);

    // Cannot complete evaluation before BIZ evaluation is recorded
    await expect(act(ideaMachine, rdHead, idea.id, "complete_evaluation")).rejects.toMatchObject({
      code: "GUARD_FAILED",
      details: expect.arrayContaining([expect.objectContaining({ code: "TECH_AND_BIZ_REQUIRED" })]),
    });

    // Second evaluation (BIZ) automatically advances idea to EVALUATED
    const afterBiz = await withTransaction((tx) =>
      evaluateIdea(tx, bizReviewer, idea.id, {
        eval_type: "BIZ",
        scores: {
          BIZ_MARKET: 5,
          BIZ_ROI: 4,
          BIZ_STRATEGY: 5,
        },
        analysis: "Biên lợi nhuận tốt, phù hợp kênh phân phối bệnh viện hiện có.",
        recommendation: "APPROVE",
      })
    );
    expect(afterBiz.status).toBe("EVALUATED");
    expect(afterBiz.evaluations).toHaveLength(2);

    // Self-approval guard: proposer cannot approve their own idea even if granted rd.idea.approve
    await grant(researcher, ["rd.idea.approve"], site.dept);
    await expect(act(ideaMachine, researcher, idea.id, "approve", signed)).rejects.toMatchObject({
      code: "GUARD_FAILED",
      details: expect.arrayContaining([expect.objectContaining({ code: "SELF_APPROVAL" })]),
    });

    // Head approves with e-signature
    await expect(act(ideaMachine, rdHead, idea.id, "approve")).rejects.toMatchObject({
      code: "SIGNATURE_REQUIRED",
    });
    const approved = await act(ideaMachine, rdHead, idea.id, "approve", signed);
    expect(approved.status).toBe("APPROVED");

    // Convert approved idea into a Stage-Gate project
    const project = await withTransaction((tx) =>
      createProject(tx, rdHead, {
        name: "Dự án Kit Multiplex RT-qPCR Cúm A/B & RSV",
        owner_org_unit_id: site.dept,
        project_type: "NEW_PRODUCT",
        target_domain: "KIT",
        ivd_class: "CLASS_C",
        idea_id: idea.id,
        leader_id: researcher.userId,
      })
    );
    expect(project.code).toMatch(/^PRJ\d{2}-/);
    expect(project.current_stage).toBe("G0_CONCEPT");
    expect(project.gates.length).toBeGreaterThanOrEqual(4);
    expect(project.gates[0].status).toBe("OPEN");
    expect(project.gates[1].status).toBe("LOCKED");

    const updatedIdea = await withTransaction((tx) => getIdeaDetail(tx, rdHead, idea.id));
    expect(updatedIdea.status).toBe("CONVERTED");
    expect(updatedIdea.project_id).toBe(project.id);
  });

  it("2. Stage-Gate Project & ISO 13485 Design Control: enforces deliverable checklist, blocks gate skipping & self-review, unlocks next gate on signed GO, and exports .ics roadmap", async () => {
    const site = await makeSite();
    const { researcher, rdHead } = await setupRdTeam(site);

    const project = await withTransaction((tx) =>
      createProject(tx, rdHead, {
        name: "Dự án Kit qPCR HBV Định lượng",
        owner_org_unit_id: site.dept,
        target_domain: "KIT",
        ivd_class: "CLASS_C",
        leader_id: researcher.userId,
      })
    );
    const gate0 = project.gates[0];
    const gate1 = project.gates[1];

    // Cannot submit Gate 0 while required deliverables are MISSING
    await expect(act(projectGateMachine, researcher, gate0.id, "submit")).rejects.toMatchObject({
      code: "GUARD_FAILED",
      details: expect.arrayContaining([expect.objectContaining({ code: "MISSING_DELIVERABLES" })]),
    });

    // Researcher submits evidence for all Gate 0 deliverables
    for (const deliv of gate0.deliverables) {
      await withTransaction((tx) =>
        updateGateDeliverable(tx, researcher, deliv.id, {
          status: "SUBMITTED",
          notes: `Hồ sơ minh chứng cho ${deliv.item_name} — bản dự thảo v1.0`,
        })
      );
    }

    // Submit Gate 0 for review
    const submittedGate0 = await act(projectGateMachine, researcher, gate0.id, "submit");
    expect(submittedGate0.status).toBe("PENDING_REVIEW");

    // Cannot decide GO before deliverables are reviewed as ACCEPTED
    await expect(act(projectGateMachine, rdHead, gate0.id, "decide_go", signed)).rejects.toMatchObject({
      code: "GUARD_FAILED",
      details: expect.arrayContaining([expect.objectContaining({ code: "DELIVERABLES_NOT_ACCEPTED" })]),
    });

    // Reviewer accepts all Gate 0 deliverables
    for (const deliv of gate0.deliverables) {
      await withTransaction((tx) =>
        updateGateDeliverable(tx, rdHead, deliv.id, {
          status: "ACCEPTED",
          reviewer_comment: "Đạt yêu cầu hồ sơ Thiết kế đầu vào ISO 13485",
        })
      );
    }

    // Submitter cannot self-review Gate 0
    await grant(researcher, ["rd.gate.review"], site.dept);
    await expect(act(projectGateMachine, researcher, gate0.id, "decide_go", signed)).rejects.toMatchObject({
      code: "GUARD_FAILED",
      details: expect.arrayContaining([expect.objectContaining({ code: "SELF_REVIEW" })]),
    });

    // Head signs GO decision on Gate 0
    const passedGate0 = await act(projectGateMachine, rdHead, gate0.id, "decide_go", {
      ...signed,
      reason: "Thông qua Gate 0, cho phép bước sang giai đoạn Khả thi (Feasibility)",
    });
    expect(passedGate0.status).toBe("PASSED");
    expect(passedGate0.decision).toBe("GO");

    const refreshed = await withTransaction((tx) => getProjectDetail(tx, researcher, project.id));
    expect(refreshed.current_stage).toBe(gate0.stage_after);
    expect(refreshed.gates.find((g: any) => g.id === gate1.id).status).toBe("OPEN");

    // Save TPP Design Input / Output matrix and Roadmap Milestone
    const spec = await withTransaction((tx) =>
      saveSpecEvaluation(tx, researcher, project.id, null, {
        category: "ANALYTICAL",
        parameter: "Giới hạn phát hiện (LoD 95%)",
        unit: "IU/mL",
        baseline_value: "50 IU/mL",
        target_value: "≤ 20 IU/mL",
        actual_value: "15 IU/mL",
        method_ref: "CLSI EP17-A2 (Probit 24 lặp)",
        result: "PASS",
      })
    );
    expect(spec.result).toBe("PASS");

    await withTransaction((tx) =>
      saveMilestone(tx, researcher, project.id, null, {
        title: "Hoàn thành đánh giá độ nhạy phân tích LoD",
        due_date: "2026-11-15",
        status: "PLANNED",
        tags: ["LoD", "Validation"],
      })
    );
    const ics = await withTransaction((tx) => exportRoadmapIcs(tx, researcher, project.id));
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("Hoàn thành đánh giá độ nhạy phân tích LoD");
  });

  it("3. Electronic Lab Notebook (ELN): issues R&D stock via FEFO ledger, blocks out-of-calibration equipment, signs approval, and versions revisions", async () => {
    const site = await makeSite();
    const { researcher, rdHead } = await setupRdTeam(site);

    const project = await withTransaction((tx) =>
      createProject(tx, rdHead, {
        name: "Dự án Tối ưu Enzyme Taq Polymerase",
        owner_org_unit_id: site.dept,
        target_domain: "KIT",
        leader_id: researcher.userId,
      })
    );

    const reagent = await makeItem(site, { name: "HotStart Taq MasterMix 2X", base_uom: "µL" });
    const lotEarly = await stockedLot(site, reagent.id, 500, "2027-03-01");
    await stockedLot(site, reagent.id, 500, "2027-09-01");

    const overduePcr = await withTransaction((tx) =>
      createAsset(tx, rdHead, {
        name: "Máy Real-time PCR Bio-Rad CFX96 #1",
        asset_type: "PCR",
        owner_org_unit_id: site.dept,
        next_calibration_due: "2020-01-01",
      })
    );
    const validPcr = await withTransaction((tx) =>
      createAsset(tx, rdHead, {
        name: "Máy Real-time PCR Bio-Rad CFX96 #2",
        asset_type: "PCR",
        owner_org_unit_id: site.dept,
        next_calibration_due: "2028-12-31",
      })
    );

    const exp = await withTransaction((tx) =>
      createExperiment(tx, researcher, {
        project_id: project.id,
        title: "Khảo sát nhiệt độ gắn mồi (Annealing temperature gradient)",
        objective: "Xác định nhiệt độ tối ưu từ 56°C đến 62°C cho cặp mồi HBV-S",
        hypothesis: "Tại 60°C hiệu suất khuếch đại đạt 98-102% và không có primer-dimer",
        protocol_summary: "45 chu kỳ: 95°C 15s, Gradient 56-62°C 30s",
        start_now: true,
      })
    );
    expect(exp.status).toBe("IN_PROGRESS");

    // Consume 150 µL of reagent from R&D warehouse — FEFO must pick lotEarly (2027-03-01) and post ISSUE stock document
    const consumed = await withTransaction((tx) =>
      consumeExperimentMaterial(tx, researcher, exp.id, {
        warehouse_id: site.warehouse,
        item_id: reagent.id,
        qty: 150,
        uom: "µL",
        role_in_exp: "MasterMix phản ứng qPCR",
      })
    );
    expect(consumed).toHaveLength(1);
    expect(consumed[0].lot_id).toBe(lotEarly.id);

    const bal = (
      await getFactoryPool().query(
        "SELECT qty_on_hand::float AS on_hand FROM inv.stock_balance WHERE lot_id = $1 AND location_id = $2",
        [lotEarly.id, site.shelf]
      )
    ).rows[0];
    expect(bal.on_hand).toBe(350);

    // Out-of-calibration equipment must be blocked
    await expect(
      withTransaction((tx) =>
        logExperimentAsset(tx, researcher, exp.id, {
          asset_id: overduePcr.id,
          run_params: { program: "HBV-GRADIENT-45C" },
        })
      )
    ).rejects.toMatchObject({ code: "ASSET_CALIBRATION_DUE" });

    // Calibrated equipment is accepted
    await withTransaction((tx) =>
      logExperimentAsset(tx, researcher, exp.id, {
        asset_id: validPcr.id,
        run_params: { program: "HBV-GRADIENT-45C", annealing_c: 60 },
      })
    );

    // Add ELN entry
    await withTransaction((tx) =>
      addExperimentEntry(tx, researcher, exp.id, {
        entry_type: "RESULT",
        title: "Bảng Ct theo dải nhiệt độ 56–62°C",
        content: { text: "Tại 60°C: Ct trung bình = 24.12 (CV = 0.8%), đường chuẩn R² = 0.999" },
      })
    );

    // Submit ELN experiment with conclusion
    const submitted = await act(experimentMachine, researcher, exp.id, "submit", {
      payload: { conclusion: "Chọn nhiệt độ gắn mồi chuẩn là 60°C cho quy trình SOP." },
    });
    expect(submitted.status).toBe("SUBMITTED");

    // Self-approval guard: researcher who performed/submitted cannot sign approval
    await grant(researcher, ["rd.eln.approve"], site.dept);
    await expect(act(experimentMachine, researcher, exp.id, "approve", signed)).rejects.toMatchObject({
      code: "GUARD_FAILED",
      details: expect.arrayContaining([expect.objectContaining({ code: "SELF_APPROVAL" })]),
    });

    // R&D Head signs approval
    const approved = await act(experimentMachine, rdHead, exp.id, "approve", signed);
    expect(approved.status).toBe("APPROVED");

    // Locked after approval: cannot append new entries directly to an APPROVED experiment
    await expect(
      withTransaction((tx) =>
        addExperimentEntry(tx, researcher, exp.id, {
          entry_type: "OBSERVATION",
          title: "Ghi chú thêm sau khi khóa",
          content: { text: "Không được phép" },
        })
      )
    ).rejects.toThrow(/APPROVED/);

    // Revising an approved experiment creates Rev 2 in IN_PROGRESS and transitions Rev 1 to SUPERSEDED
    const rev2 = await withTransaction((tx) =>
      createExperimentRevision(tx, researcher, exp.id, {
        reason: "Bổ sung dữ liệu kiểm tra chéo trên 3 lô MasterMix độc lập",
      })
    );
    expect(rev2.revision).toBe(2);
    expect(rev2.status).toBe("IN_PROGRESS");
    expect(rev2.parent_experiment_id).toBe(exp.id);
    expect(rev2.entries).toHaveLength(1);

    const rev1After = await withTransaction((tx) => getExperimentDetail(tx, researcher, exp.id));
    expect(rev1After.status).toBe("SUPERSEDED");
  });

  it("4. Biobank Sample Chain-of-Custody: tracks freeze-thaw cycles and blocks quantitative use once freeze_thaw_count exceeds max_freeze_thaw", async () => {
    const site = await makeSite();
    const { researcher } = await setupRdTeam(site);

    const sample = await withTransaction((tx) =>
      createSample(tx, researcher, {
        org_unit_id: site.dept,
        sample_type: "SERUM_PLASMA",
        name: "Mẫu huyết tương chuẩn quốc tế WHO HBV DNA",
        source: "NIBSC / Bệnh viện Bệnh Nhiệt Đới",
        biosafety_level: "BSL2",
        target_pathogen: "HBV Genotype B",
        reference_ct: 25.4,
        warehouse_id: site.warehouse,
        location_id: site.shelf,
        box_position: "Tủ -80°C / Rack 2 / Box A / Ô B04",
        initial_volume: 200,
        uom: "µL",
        max_freeze_thaw: 2,
      })
    );
    expect(sample.status).toBe("STORED");
    expect(sample.freeze_thaw_count).toBe(0);

    // Cycle 1, 2, 3 of THAW -> REFREEZE
    for (let i = 1; i <= 3; i++) {
      await withTransaction((tx) => recordSampleEvent(tx, researcher, sample.id, { event_type: "THAW", reason: `Rã đông lần ${i}` }));
      if (i < 3) {
        await withTransaction((tx) => recordSampleEvent(tx, researcher, sample.id, { event_type: "REFREEZE", reason: `Cấp đông lại lần ${i}` }));
      }
    }

    const detail = await withTransaction((tx) => getSampleDetail(tx, researcher, sample.id));
    expect(detail.freeze_thaw_count).toBe(3);
    expect(detail.thaw_warning).toBe(true);

    // Quantitative use (e.g., LoD / standard curve) must be blocked when freeze_thaw_count (3) > max_freeze_thaw (2)
    await expect(
      withTransaction((tx) =>
        recordSampleEvent(tx, researcher, sample.id, {
          event_type: "USE",
          volume_used: 50,
          is_quantitative: true,
          reason: "Dựng đường chuẩn định lượng LoD",
        })
      )
    ).rejects.toMatchObject({ code: "FREEZE_THAW_EXCEEDED" });

    // Qualitative screening use is still permitted with reason and deducts volume
    const afterQualUse = await withTransaction((tx) =>
      recordSampleEvent(tx, researcher, sample.id, {
        event_type: "USE",
        volume_used: 50,
        is_quantitative: false,
        reason: "Chạy đối chứng dương định tính sơ bộ",
      })
    );
    expect(afterQualUse.current_volume).toBe(150);

    // Dispose remaining sample requires reason and sets status = DISPOSED, current_volume = 0
    const disposed = await withTransaction((tx) =>
      recordSampleEvent(tx, researcher, sample.id, {
        event_type: "DISPOSE",
        reason: "Hấp tiệt trùng 121°C/30 phút theo biên bản hủy mẫu sinh học BSL-2",
      })
    );
    expect(disposed.status).toBe("DISPOSED");
    expect(disposed.current_volume).toBe(0);
  });

  it("5. Technology Transfer & Software Release: auto-creates DRAFT QC specification in QMS upon signed acceptance and manages software release lifecycle", async () => {
    const site = await makeSite();
    const { researcher, rdHead, kitDept, kitHead } = await setupRdTeam(site);

    const productItem = await makeItem(site, {
      name: "Kit Real-time PCR ABT® HBV Quantitative",
      item_type: "FINISHED_KIT",
      base_uom: "kit",
    });

    const project = await withTransaction((tx) =>
      createProject(tx, rdHead, {
        name: "Dự án Chuyển giao Kit HBV Quantitative",
        owner_org_unit_id: site.dept,
        target_domain: "KIT",
        leader_id: researcher.userId,
      })
    );

    // Record TPP parameters on the project so tech transfer can populate the QMS QC spec
    await withTransaction((tx) =>
      saveSpecEvaluation(tx, researcher, project.id, null, {
        category: "ANALYTICAL",
        parameter: "Độ nhạy phân tích LoD 95%",
        unit: "IU/mL",
        target_value: "≤ 20 IU/mL",
        actual_value: "14.5 IU/mL",
        method_ref: "SOP-QC-HBV-01",
        result: "PASS",
      })
    );

    const pkg = await withTransaction((tx) =>
      createTechTransferPackage(tx, rdHead, {
        project_id: project.id,
        target_domain: "KIT",
        target_org_unit_id: kitDept,
        title: "Hồ sơ DMR & Chuyển giao công nghệ Kit HBV Quantitative v1.0",
        product_item_id: productItem.id,
        bom_specification: [
          { component_code: "MM-HBV-2X", component_name: "MasterMix HBV 2X", qty_per_kit: 1250, uom: "µL", role: "Phản ứng chính" },
          { component_code: "PC-HBV", component_name: "Chứng dương HBV", qty_per_kit: 100, uom: "µL", role: "Đối chứng" },
        ],
        routing_steps: [
          { seq: 1, step_name: "Pha bán thành phẩm MasterMix", params: "Phòng sạch ISO Class 7, 2-8°C", qc_check: "Đo pH & kiểm nhiễm âm" },
          { seq: 2, step_name: "Chiết rót & đóng gói Kit", params: "25 µL/tube × 50 test", qc_check: "QC 3 lô Pilot liên tiếp" },
        ],
        stability_summary: "Độ ổn định tăng tốc 37°C đạt 14 ngày; độ ổn định thực -20°C đạt 12 tháng.",
        validation_summary: "Độ nhạy lâm sàng 99.2%, độ đặc hiệu 100% trên 300 mẫu bệnh phẩm.",
        submit_now: true,
      })
    );
    expect(pkg.status).toBe("SUBMITTED");

    // Receiving Kit Production Head accepts with PIN signature -> auto-creates DRAFT qms.qc_spec and emits TechTransferAccepted
    const accepted = await act(techTransferMachine, kitHead, pkg.id, "accept", signed);
    expect(accepted.status).toBe("ACCEPTED");

    const updatedPkg = (
      await getFactoryPool().query("SELECT created_qc_spec_id FROM rd.tech_transfer_package WHERE id = $1", [pkg.id])
    ).rows[0];
    expect(updatedPkg.created_qc_spec_id).toBeTruthy();

    const qcSpec = (
      await getFactoryPool().query("SELECT code, status, item_id FROM qms.qc_spec WHERE id = $1", [updatedPkg.created_qc_spec_id])
    ).rows[0];
    expect(qcSpec.status).toBe("DRAFT");
    expect(qcSpec.item_id).toBe(productItem.id);

    const outbox = await getFactoryPool().query(
      "SELECT 1 FROM core.outbox_event WHERE event_type = 'TechTransferAccepted' AND payload->>'package_id' = $1",
      [pkg.id]
    );
    expect(outbox.rowCount).toBe(1);

    // Complete transfer after Pilot batches pass QC
    const completed = await act(techTransferMachine, kitHead, pkg.id, "complete", {
      payload: { pilot_lot_ref: "LOT-PILOT-HBV-001, 002, 003 (Đạt QC)" },
    });
    expect(completed.status).toBe("COMPLETED");
    expect(completed.pilot_lot_ref).toContain("LOT-PILOT-HBV-001");

    // Software Release lifecycle (DRAFT -> RELEASED ✍ -> WITHDRAWN 📝): the researcher drafts, the head signs
    const sw = await withTransaction((tx) =>
      createSoftwareRelease(tx, researcher, {
        project_id: project.id,
        version_tag: "v1.2.0",
        target_kind: "ASSAY_CALLER",
        release_notes: "Thuật toán tự động phân tích ngưỡng Ct và kiểm tra nội chuẩn IC cho Kit HBV",
        checksum_sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        validation_summary: "Đã vượt qua bộ 120 vector dữ liệu chuẩn IEC 62304 (100% pass)",
        srs_traceability: [{ req_id: "SRS-001", title: "Ngưỡng Ct tự động", test_case_id: "TC-001", result: "PASS" }],
      })
    );
    expect(sw.status).toBe("DRAFT");

    // drafting does not give the right to release (rd.software.release), and the drafter never signs their own release
    await expect(act(swReleaseMachine, researcher, sw.id, "release", signed)).rejects.toThrow(/quyền/);
    await grant(researcher, ["rd.software.release"], site.dept);
    await expect(act(swReleaseMachine, researcher, sw.id, "release", signed)).rejects.toMatchObject({
      code: "GUARD_FAILED",
      details: expect.arrayContaining([expect.objectContaining({ code: "SELF_RELEASE" })]),
    });

    const releasedSw = await act(swReleaseMachine, rdHead, sw.id, "release", signed);
    expect(releasedSw.status).toBe("RELEASED");

    const withdrawnSw = await act(swReleaseMachine, rdHead, sw.id, "withdraw", {
      reason: "Thu hồi để nâng cấp ngưỡng baseline cho dòng máy ABI 7500",
    });
    expect(withdrawnSw.status).toBe("WITHDRAWN");
  });

  it("6. Weekly Employee Work Plan: blocks execution before approval, flags post-approval tasks as unplanned, requires deferral category/reason, and supports manager rating", async () => {
    const site = await makeSite();
    const { researcher, rdHead } = await setupRdTeam(site);

    const plan = await withTransaction((tx) =>
      createOrGetWorkPlan(tx, researcher, {
        org_unit_id: site.dept,
        week_start: "2026-11-02",
        summary_notes: "Kế hoạch tuần thực nghiệm độ nhạy LoD & độ lặp lại",
      })
    );
    expect(plan.status).toBe("DRAFT");

    const task1 = await withTransaction((tx) =>
      addWorkTask(tx, researcher, plan.id, {
        title: "Chạy thực nghiệm Probit LoD 24 lặp nồng độ 20 IU/mL",
        day_of_week: 2,
        time_slot: "FULL_DAY",
        target_metric: "Đạt ≥ 23/24 giếng dương tính",
      })
    );
    expect(task1.is_unplanned).toBe(false);

    const task2 = await withTransaction((tx) =>
      addWorkTask(tx, researcher, plan.id, {
        title: "Đo độ ổn định tăng tốc ngày thứ 7 tại 37°C",
        day_of_week: 4,
        time_slot: "MORNING",
      })
    );

    // Cannot record task completion before the weekly plan is APPROVED
    await expect(
      withTransaction((tx) =>
        updateWorkTaskAction(tx, researcher, task1.id, {
          action: "complete",
          version: task1.version,
          result_summary: "24/24 dương tính",
        })
      )
    ).rejects.toMatchObject({ code: "PLAN_NOT_APPROVED" });

    // Submit plan and verify self-approval is blocked
    await act(workPlanMachine, researcher, plan.id, "submit");
    await grant(researcher, ["work.plan.approve"], site.dept);
    await expect(act(workPlanMachine, researcher, plan.id, "approve")).rejects.toMatchObject({
      code: "GUARD_FAILED",
      details: expect.arrayContaining([expect.objectContaining({ code: "SELF_APPROVAL" })]),
    });

    // Manager approves the weekly plan
    const approvedPlan = await act(workPlanMachine, rdHead, plan.id, "approve", {
      payload: { review_note: "Đồng ý kế hoạch tuần, ưu tiên hoàn thành LoD trước thứ Tư." },
    });
    expect(approvedPlan.status).toBe("APPROVED");

    // Task added AFTER plan approval is automatically marked is_unplanned = true ("Phát sinh")
    const unplannedTask = await withTransaction((tx) =>
      addWorkTask(tx, researcher, plan.id, {
        title: "Hỗ trợ QC kiểm tra lại lô mồi chứng nội IC",
        day_of_week: 5,
        time_slot: "AFTERNOON",
      })
    );
    expect(unplannedTask.is_unplanned).toBe(true);

    // Complete task1 and unplannedTask
    const done1 = await withTransaction((tx) =>
      updateWorkTaskAction(tx, researcher, task1.id, {
        action: "complete",
        version: task1.version,
        result_summary: "Đạt 24/24 giếng dương tính, Ct trung bình 34.8 (CV 1.4%)",
      })
    );
    expect(done1.status).toBe("DONE");

    await withTransaction((tx) =>
      updateWorkTaskAction(tx, researcher, unplannedTask.id, {
        action: "complete",
        version: unplannedTask.version,
        result_summary: "Đã xác nhận lô mồi IC đạt độ tinh sạch HPLC 96%",
      })
    );

    // Deferring task2 requires defer_category (OBJECTIVE/SUBJECTIVE) and defer_reason
    await expect(
      withTransaction((tx) =>
        updateWorkTaskAction(tx, researcher, task2.id, {
          action: "defer",
          version: task2.version,
        })
      )
    ).rejects.toThrow(/Khách quan \/ Chủ quan/);

    const deferred2 = await withTransaction((tx) =>
      updateWorkTaskAction(tx, researcher, task2.id, {
        action: "defer",
        version: task2.version,
        defer_category: "OBJECTIVE",
        defer_reason: "Tủ ấm 37°C đang bảo trì định kỳ theo lịch phòng Thiết bị",
      })
    );
    expect(deferred2.status).toBe("DEFERRED");
    expect(deferred2.defer_category).toBe("OBJECTIVE");

    // Manager rates task1 efficiency (5 stars)
    const rated1 = await withTransaction((tx) =>
      updateWorkTaskAction(tx, rdHead, done1.id, {
        action: "rate",
        version: done1.version,
        efficiency_rating: 5,
        manager_comment: "Số liệu đầy đủ, độ lặp lại rất tốt.",
      })
    );
    expect(rated1.efficiency_rating).toBe(5);

    // Close the weekly plan once all tasks are DONE / DEFERRED / REPLACED
    const closedPlan = await act(workPlanMachine, rdHead, plan.id, "close");
    expect(closedPlan.status).toBe("CLOSED");

    const finalDetail = await withTransaction((tx) => getWorkPlanDetail(tx, rdHead, plan.id));
    expect(finalDetail.tasks).toHaveLength(3);
  });
});
