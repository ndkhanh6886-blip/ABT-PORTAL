import { describe, expect, it } from "vitest";
import {
  resolveDeptLeaderInfo,
  getSupervisingBodForDept,
  isPersonDeptHeadOrDeputy,
  normalizeProposalStepsForRequester,
  isProposalWaitingForUser,
  type ProposalItem,
  type ProposalStepInstance
} from "../ProposalsApprovalView";

const SAMPLE_PERSONNEL = [
  { full_name: "Nguyễn Văn Tùng", department: "Ban Giám Đốc", position: "Giám đốc", role: "admin" },
  { full_name: "Đỗ Ngọc Diễm Trúc", department: "Ban Giám Đốc", position: "Phó Giám đốc Kinh doanh", role: "admin" },
  { full_name: "Nguyễn Duy Khánh", department: "Ban Giám Đốc", position: "Phó Giám đốc Kỹ Thuật", role: "admin" },
  { full_name: "Phan Thị Thảo Trinh", department: "QC/QA", position: "Phó Trưởng phòng QC-QA", role: "qa_qc_lead" },
  { full_name: "Nguyễn Thị Thu Thảo", department: "QC/QA", position: "Nhân viên QC", role: "qa_qc" },
  { full_name: "Đoàn Hồng Sơn", department: "Sản xuất", position: "Phó Trưởng phòng Sản xuất", role: "kit_head" },
  { full_name: "Nguyễn Quốc Bảo", department: "R&D", position: "Trưởng phòng R&D", role: "rd_head" },
  { full_name: "Nguyễn Thanh Tùng", department: "Tổng hợp Oligo", position: "Trưởng phòng Tổng hợp Oligo", role: "oligo_head" },
  { full_name: "Nguyễn Khánh Linh", department: "KTCN", position: "Trưởng nhóm Kỹ Thuật Công Nghệ", role: "device_staff" },
  { full_name: "Huỳnh Thị Ngọc Huyền", department: "Kinh Doanh", position: "Phó Trường phòng kinh doanh", role: "sales_head" },
  { full_name: "Trần Tài", department: "APP", position: "Phó Trưởng phòng Ứng dụng", role: "app_head" },
  { full_name: "Nguyễn Văn Hiếu", department: "Hành chính", position: "Trưởng phòng Hành chính", role: "accountant_head" },
  { full_name: "Tô Khánh Nhựt", department: "Hành chính", position: "Phó Trưởng phòng Hành chính", role: "accountant_head" }
];

describe("Proposal approval routing & escalation rules", () => {
  it("resolves Deputy Head (Phó trưởng phòng) as Department Head when department has no Trưởng phòng", () => {
    expect(resolveDeptLeaderInfo("QA/QC", SAMPLE_PERSONNEL)?.name).toBe("Phan Thị Thảo Trinh");
    expect(resolveDeptLeaderInfo("QC/QA", SAMPLE_PERSONNEL)?.name).toBe("Phan Thị Thảo Trinh");
    expect(resolveDeptLeaderInfo("Sản Xuất Kit", SAMPLE_PERSONNEL)?.name).toBe("Đoàn Hồng Sơn");
    expect(resolveDeptLeaderInfo("Kinh Doanh", SAMPLE_PERSONNEL)?.name).toBe("Huỳnh Thị Ngọc Huyền");
    expect(resolveDeptLeaderInfo("Application", SAMPLE_PERSONNEL)?.name).toBe("Trần Tài");
    expect(resolveDeptLeaderInfo("Nghiên Cứu R&D", SAMPLE_PERSONNEL)?.name).toBe("Nguyễn Quốc Bảo");
    expect(resolveDeptLeaderInfo("Tổng Hợp Oligo", SAMPLE_PERSONNEL)?.name).toBe("Nguyễn Thanh Tùng");
    expect(resolveDeptLeaderInfo("Hành Chính Nhân Sự", SAMPLE_PERSONNEL)?.name).toBe("Nguyễn Văn Hiếu");
    expect(resolveDeptLeaderInfo("KTCN", SAMPLE_PERSONNEL)).toBeNull();
  });

  it("maps supervising BOD member correctly: PGĐ Kỹ thuật for Khối Kỹ thuật, GĐ for KTCN, PGĐ Kinh doanh for Khối KD", () => {
    expect(getSupervisingBodForDept("QA/QC", SAMPLE_PERSONNEL)).toEqual({
      approverName: "Nguyễn Duy Khánh",
      roleTitle: "PGĐ Kỹ thuật",
      dept: "Ban Giám Đốc"
    });
    expect(getSupervisingBodForDept("Sản Xuất Kit", SAMPLE_PERSONNEL).approverName).toBe("Nguyễn Duy Khánh");
    expect(getSupervisingBodForDept("Nghiên Cứu R&D", SAMPLE_PERSONNEL).approverName).toBe("Nguyễn Duy Khánh");
    expect(getSupervisingBodForDept("Tổng Hợp Oligo", SAMPLE_PERSONNEL).approverName).toBe("Nguyễn Duy Khánh");

    // Phòng Kỹ thuật Công nghệ (KTCN / Kỹ Thuật – Thiết Bị) do Giám đốc (Nguyễn Văn Tùng) duyệt
    expect(getSupervisingBodForDept("KTCN", SAMPLE_PERSONNEL)).toEqual({
      approverName: "Nguyễn Văn Tùng",
      roleTitle: "Giám đốc",
      dept: "Ban Giám Đốc"
    });
    expect(getSupervisingBodForDept("Kỹ Thuật – Thiết Bị", SAMPLE_PERSONNEL).approverName).toBe("Nguyễn Văn Tùng");

    // Khối Kinh doanh & Hành chính do PGĐ Kinh doanh (Đỗ Ngọc Diễm Trúc) duyệt
    expect(getSupervisingBodForDept("Kinh Doanh", SAMPLE_PERSONNEL).approverName).toBe("Đỗ Ngọc Diễm Trúc");
    expect(getSupervisingBodForDept("Application", SAMPLE_PERSONNEL).approverName).toBe("Đỗ Ngọc Diễm Trúc");
    expect(getSupervisingBodForDept("Hành Chính Nhân Sự", SAMPLE_PERSONNEL).approverName).toBe("Đỗ Ngọc Diễm Trúc");
  });

  it("assigns regular QA/QC staff proposals to Phó Trưởng phòng Phan Thị Thảo Trinh", () => {
    const rawSteps: ProposalStepInstance[] = [
      {
        stepOrder: 1,
        stepName: "Trưởng bộ phận duyệt & sắp xếp nhân sự",
        roleType: "DEPT_HEAD",
        dept: "QA/QC",
        approverName: "Trưởng phòng QA/QC",
        status: "PENDING_NOW",
        slaHours: 4
      },
      {
        stepOrder: 2,
        stepName: "Hành chính - Nhân sự ghi nhận công phép",
        roleType: "REVIEWER",
        dept: "Hành Chính Nhân Sự",
        approverName: "Hành Chính Nhân Sự",
        status: "WAITING",
        slaHours: 4
      }
    ];

    const res = normalizeProposalStepsForRequester(rawSteps, "QA/QC", "Nguyễn Thị Thu Thảo", SAMPLE_PERSONNEL);
    expect(res.steps[0].approverName).toBe("Phan Thị Thảo Trinh");
    expect(res.steps[0].roleType).toBe("DEPT_HEAD");
    expect(res.steps[0].dept).toBe("QA/QC");
    expect(res.steps[1].approverName).toBe("Nguyễn Văn Hiếu");
  });

  it("escalates DXNP-2026-001 by Phan Thị Thảo Trinh (Phó Trưởng phòng QC-QA) to PGĐ Kỹ thuật Nguyễn Duy Khánh", () => {
    const dxnp001Steps: ProposalStepInstance[] = [
      {
        stepOrder: 1,
        stepName: "Trưởng bộ phận duyệt & sắp xếp nhân sự",
        roleType: "DEPT_HEAD",
        dept: "QA/QC",
        approverName: "Trưởng phòng QA/QC",
        status: "PENDING_NOW",
        slaHours: 4
      },
      {
        stepOrder: 2,
        stepName: "Hành chính - Nhân sự ghi nhận công phép",
        roleType: "REVIEWER",
        dept: "Hành Chính Nhân Sự",
        approverName: "Hành Chính Nhân Sự",
        status: "WAITING",
        slaHours: 4
      }
    ];

    expect(isPersonDeptHeadOrDeputy("Phan Thị Thảo Trinh", "QA/QC", SAMPLE_PERSONNEL)).toBe(true);
    const res = normalizeProposalStepsForRequester(dxnp001Steps, "QA/QC", "Phan Thị Thảo Trinh", SAMPLE_PERSONNEL);
    expect(res.changed).toBe(true);
    expect(res.steps[0]).toMatchObject({
      stepOrder: 1,
      stepName: "PGĐ Kỹ thuật duyệt & sắp xếp nhân sự",
      roleType: "DIRECTOR",
      dept: "Ban Giám Đốc",
      approverName: "Nguyễn Duy Khánh",
      status: "PENDING_NOW"
    });
    expect(res.steps[1].approverName).toBe("Nguyễn Văn Hiếu");

    const proposalObj = {
      id: "PROP-1",
      proposalCode: "DXNP-2026-001",
      requesterName: "Phan Thị Thảo Trinh",
      requesterDept: "QA/QC",
      status: "PENDING",
      currentStepIndex: 0,
      steps: res.steps
    } as ProposalItem;

    expect(isProposalWaitingForUser(proposalObj, "Nguyễn Duy Khánh", "Ban Giám Đốc", true, false)).toBe(true);
    expect(isProposalWaitingForUser(proposalObj, "Phan Thị Thảo Trinh", "QA/QC", false, true)).toBe(false);
  });

  it("routes KTCN (Phòng Kỹ thuật Công nghệ) proposals directly to Giám đốc Nguyễn Văn Tùng", () => {
    const ktcnSteps: ProposalStepInstance[] = [
      {
        stepOrder: 1,
        stepName: "Trưởng bộ phận duyệt & sắp xếp nhân sự",
        roleType: "DEPT_HEAD",
        dept: "Kỹ Thuật – Thiết Bị",
        approverName: "Trưởng phòng Kỹ Thuật – Thiết Bị",
        status: "PENDING_NOW",
        slaHours: 4
      }
    ];

    const res = normalizeProposalStepsForRequester(ktcnSteps, "Kỹ Thuật – Thiết Bị", "Nguyễn Khánh Linh", SAMPLE_PERSONNEL);
    expect(res.steps[0]).toMatchObject({
      stepName: "Giám đốc duyệt & sắp xếp nhân sự",
      roleType: "DIRECTOR",
      dept: "Ban Giám Đốc",
      approverName: "Nguyễn Văn Tùng"
    });
  });

  it("escalates Kinh Doanh & APP Deputy Head proposals to PGĐ Kinh doanh Đỗ Ngọc Diễm Trúc", () => {
    const kdSteps: ProposalStepInstance[] = [
      {
        stepOrder: 1,
        stepName: "Trưởng bộ phận xác nhận",
        roleType: "DEPT_HEAD",
        dept: "Kinh Doanh",
        approverName: "Trưởng bộ phận",
        status: "PENDING_NOW",
        slaHours: 4
      }
    ];

    const resKd = normalizeProposalStepsForRequester(kdSteps, "Kinh Doanh", "Huỳnh Thị Ngọc Huyền", SAMPLE_PERSONNEL);
    expect(resKd.steps[0]).toMatchObject({
      stepName: "PGĐ Kinh doanh xác nhận",
      roleType: "DIRECTOR",
      dept: "Ban Giám Đốc",
      approverName: "Đỗ Ngọc Diễm Trúc"
    });

    const resApp = normalizeProposalStepsForRequester(kdSteps, "Application", "Trần Tài", SAMPLE_PERSONNEL);
    expect(resApp.steps[0].approverName).toBe("Đỗ Ngọc Diễm Trúc");
  });
});
