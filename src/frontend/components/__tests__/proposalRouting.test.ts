import { describe, expect, it } from "vitest";
import {
  resolveDeptLeaderInfo,
  getSupervisingBodForDept,
  resolveBodMemberForStep,
  formatStepApproverDeptLabel,
  isPersonDeptHeadOrDeputy,
  normalizeProposalStepsForRequester,
  isProposalWaitingForUser,
  resolveDefaultTemplateVisibility,
  getEffectiveProposalVisibility,
  canUserViewProposal,
  canUserSeeFullLeaveDetails,
  type ProposalItem,
  type ProposalStepInstance
} from "../ProposalsApprovalView";
import { filterReadableProposalsForUser } from "@/backend/services/proposalStoreGuard";
import { getTaskAccess, parseTaskFollowers, taskHasFollower } from "@/backend/services/workspaceTasks";

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

  it("does NOT allow PGĐ Kỹ thuật (Nguyễn Duy Khánh) to approve Step 2 (Hành Chính Nhân Sự - Nguyễn Văn Hiếu) after approving Step 1", () => {
    const proposalAtStep2: ProposalItem = {
      id: "PROP-DXNP-002",
      proposalCode: "DXNP-2026-002",
      templateId: "tmpl_leave_request",
      templateName: "Đơn xin Nghỉ phép / Nghỉ việc riêng",
      category: "HR_ADMIN",
      title: "Xin nghỉ phép — Phan Thị Thảo Trinh (23/11/2026)",
      priority: "NORMAL",
      requesterName: "Phan Thị Thảo Trinh",
      requesterDept: "QA/QC",
      createdAt: "2026-11-18 09:34",
      updatedAt: "2026-11-18 11:42",
      neededByDate: "2026-11-23",
      totalAmount: 0,
      currency: "VNĐ",
      summaryReason: "Xin phép nghỉ 1 ngày",
      formValues: { fromDate: "2026-11-23", toDate: "2026-11-23", totalDays: "1" },
      lineItems: [],
      currentStepIndex: 1,
      status: "PENDING",
      followers: ["Đoàn Hồng Sơn"],
      attachments: [],
      comments: [],
      auditLogs: [],
      steps: [
        {
          stepOrder: 1,
          stepName: "PGĐ Kỹ thuật duyệt & sắp xếp nhân sự",
          roleType: "DIRECTOR",
          dept: "Ban Giám Đốc",
          approverName: "Nguyễn Duy Khánh",
          status: "APPROVED",
          decidedAt: "2026-11-18 11:42",
          decidedBy: "Nguyễn Duy Khánh",
          slaHours: 4
        },
        {
          stepOrder: 2,
          stepName: "Hành chính - Nhân sự ghi nhận công phép",
          roleType: "REVIEWER",
          dept: "Hành Chính Nhân Sự",
          approverName: "Nguyễn Văn Hiếu",
          status: "PENDING_NOW",
          slaHours: 4
        }
      ]
    };

    // Nguyễn Duy Khánh (isDirector = true) đã duyệt Bước 1 -> ở Bước 2 KHÔNG được hiện bảng duyệt thay cho Hành chính
    expect(
      isProposalWaitingForUser(proposalAtStep2, "Nguyễn Duy Khánh", "Ban Giám Đốc", true, false)
    ).toBe(false);

    // Người theo dõi (Đoàn Hồng Sơn) chỉ xem, KHÔNG có chức năng duyệt
    expect(
      isProposalWaitingForUser(proposalAtStep2, "Đoàn Hồng Sơn", "Sản Xuất Kit", false, true)
    ).toBe(false);

    // Chỉ Nguyễn Văn Hiếu (Hành Chính Nhân Sự) mới là người duyệt Bước 2
    expect(
      isProposalWaitingForUser(proposalAtStep2, "Nguyễn Văn Hiếu", "Hành Chính Nhân Sự", false, true)
    ).toBe(true);
  });

  it("gives task followers view-only access (no status change or approval authority)", () => {
    const followers = parseTaskFollowers(["Đoàn Hồng Sơn (Phó trưởng phòng)", "Phan Thị Thảo Trinh", "Đoàn Hồng Sơn"]);
    expect(followers).toEqual(["Đoàn Hồng Sơn", "Phan Thị Thảo Trinh"]);
    expect(taskHasFollower(followers, "Đoàn Hồng Sơn")).toBe(true);

    const task = {
      department: "Nghiên Cứu R&D",
      assignee_name: "Nguyễn Quốc Bảo",
      created_by: "ABT002",
      created_by_name: "Nguyễn Duy Khánh",
      followers
    };

    // Người theo dõi (Đoàn Hồng Sơn - Sản Xuất Kit) chỉ có quyền "view" (chỉ xem & bình luận, không đổi trạng thái)
    expect(
      getTaskAccess(
        { username: "ABT012", full_name: "Đoàn Hồng Sơn", role: "kit_head", department: "Sản Xuất Kit", isAdmin: false },
        task
      )
    ).toBe("view");

    // Người phụ trách (Nguyễn Quốc Bảo) có quyền "progress"
    expect(
      getTaskAccess(
        { username: "ABT005", full_name: "Nguyễn Quốc Bảo", role: "rd_head", department: "Nghiên Cứu R&D", isAdmin: false },
        task
      )
    ).toBe("full");
  });

  it("preserves Kế Toán / Kế toán trưởng step (even if roleType was left as DIRECTOR) and sanitizes legacy TBR name Võ Thị Ngọc Giàu", () => {
    const dnttSteps: ProposalStepInstance[] = [
      {
        stepOrder: 1,
        stepName: "Kế toán trưởng duyệt chi",
        roleType: "DIRECTOR", // Bị sót roleType DIRECTOR khi sửa từ mẫu 3 bước xuống 1 bước
        dept: "Kế Toán",
        approverName: "Kế toán trưởng",
        status: "PENDING_NOW",
        slaHours: 9
      }
    ];

    const resDntt = normalizeProposalStepsForRequester(dnttSteps, "Kinh Doanh", "Huỳnh Thị Ngọc Huyền", SAMPLE_PERSONNEL);
    expect(resDntt.steps[0]).toMatchObject({
      stepOrder: 1,
      stepName: "Kế toán trưởng duyệt chi",
      roleType: "REVIEWER",
      dept: "Kế Toán",
      approverName: "Kế toán trưởng"
    });

    const dnxhdSteps: ProposalStepInstance[] = [
      {
        stepOrder: 1,
        stepName: "Kế toán kiểm tra & xuất hóa đơn",
        roleType: "REVIEWER",
        dept: "Kế Toán",
        approverName: "Võ Thị Ngọc Giàu",
        status: "PENDING_NOW",
        slaHours: 8
      }
    ];

    const resDnxhd = normalizeProposalStepsForRequester(dnxhdSteps, "Kinh Doanh", "Yin Minh Châu", SAMPLE_PERSONNEL);
    expect(resDnxhd.steps[0].approverName).toBe("Kế toán trưởng");
    expect(resDnxhd.steps[0].dept).toBe("Kế Toán");
    expect(resDnxhd.steps[0].roleType).toBe("REVIEWER");
  });

  it("displays the specific Kế toán viên approver (Trần Hồng Thi) configured in the template instead of generic 'Kế toán viên'", () => {
    const templateSteps = [
      {
        stepOrder: 1,
        stepName: "Kế toán trưởng duyệt chi",
        roleType: "REVIEWER" as const,
        defaultDept: "Kế Toán",
        defaultApprover: "Kế toán trưởng",
        slaHours: 9
      },
      {
        stepOrder: 2,
        stepName: "Kế toán viên",
        roleType: "REVIEWER" as const,
        defaultDept: "Kế Toán",
        defaultApprover: "Trần Hồng Thi",
        slaHours: 8
      }
    ];

    const stepsFromGeneric: ProposalStepInstance[] = [
      {
        stepOrder: 1,
        stepName: "Kế toán trưởng duyệt chi",
        roleType: "REVIEWER",
        dept: "Kế Toán",
        approverName: "Nguyễn Văn Hiếu",
        status: "APPROVED",
        decidedBy: "Nguyễn Văn Hiếu",
        decidedAt: "2026-11-20 09:44",
        slaHours: 9
      },
      {
        stepOrder: 2,
        stepName: "Kế toán viên",
        roleType: "REVIEWER",
        dept: "Kế Toán",
        approverName: "Kế toán viên",
        status: "PENDING_NOW",
        slaHours: 8
      }
    ];

    const res = normalizeProposalStepsForRequester(
      stepsFromGeneric,
      "Kinh Doanh",
      "Huỳnh Thị Ngọc Huyền",
      SAMPLE_PERSONNEL,
      templateSteps
    );
    expect(res.steps[1]).toMatchObject({
      stepOrder: 2,
      stepName: "Kế toán viên",
      roleType: "REVIEWER",
      dept: "Kế Toán",
      approverName: "Trần Hồng Thi"
    });
  });

  it("enforces 3 visibility modes (PRIVATE, DEPT, PUBLIC) and masks private leave reasons for outside colleagues", () => {
    expect(resolveDefaultTemplateVisibility({ id: "tmpl_payment_request", codePrefix: "DNTT", category: "FINANCE" })).toBe("PRIVATE");
    expect(resolveDefaultTemplateVisibility({ id: "tmpl_leave_request", codePrefix: "DXNP", category: "HR_ADMIN" })).toBe("PUBLIC");
    expect(resolveDefaultTemplateVisibility({ id: "tmpl_capex_procurement", codePrefix: "DXMS-KD", category: "TECHNICAL_OPS" })).toBe("DEPT");

    const paymentProposal: ProposalItem = {
      id: "PROP-DNTT-1",
      proposalCode: "DNTT-2026-001",
      templateId: "tmpl_payment_request",
      templateName: "Đề nghị Thanh toán (Payment Request)",
      category: "FINANCE",
      title: "Thanh toán hóa đơn NCC A",
      priority: "HIGH",
      requesterName: "Yin Minh Châu",
      requesterDept: "Kinh Doanh",
      createdAt: "2026-11-23 10:00",
      updatedAt: "2026-11-23 10:00",
      neededByDate: "2026-11-25",
      totalAmount: 15000000,
      currency: "VNĐ",
      summaryReason: "Thanh toán hợp đồng mua hàng đợt 1",
      formValues: {},
      lineItems: [],
      steps: [
        {
          stepOrder: 1,
          stepName: "Trưởng bộ phận xác nhận",
          roleType: "DEPT_HEAD",
          dept: "Kinh Doanh",
          approverName: "Huỳnh Thị Ngọc Huyền",
          status: "PENDING_NOW",
          slaHours: 4
        },
        {
          stepOrder: 2,
          stepName: "Kế toán kiểm tra chứng từ",
          roleType: "REVIEWER",
          dept: "Kế Toán",
          approverName: "Nguyễn Văn Hiếu",
          status: "WAITING",
          slaHours: 8
        }
      ],
      currentStepIndex: 0,
      status: "PENDING",
      followers: [],
      attachments: [],
      comments: [],
      auditLogs: []
    };

    expect(getEffectiveProposalVisibility(paymentProposal)).toBe("PRIVATE");

    // Nhân viên hoặc Trưởng phòng ngoài phòng (VD: QC/QA hoặc R&D) KHÔNG thấy Đề nghị thanh toán
    expect(
      canUserViewProposal(paymentProposal, "Nguyễn Thị Thu Thảo", "QA/QC", false, false, SAMPLE_PERSONNEL)
    ).toBe(false);
    expect(
      canUserViewProposal(paymentProposal, "Nguyễn Quốc Bảo", "Nghiên Cứu R&D", false, true, SAMPLE_PERSONNEL)
    ).toBe(false);
    // Nhân viên cùng phòng Kinh doanh nhưng không nằm trong luồng duyệt cũng KHÔNG thấy Đề nghị thanh toán PRIVATE
    expect(
      canUserViewProposal(paymentProposal, "Trần Văn Sales Khác", "Kinh Doanh", false, false, SAMPLE_PERSONNEL)
    ).toBe(false);
    // Người tạo, Trưởng phòng duyệt bước 1, Kế toán duyệt bước 2 và Ban Giám Đốc đều thấy
    expect(
      canUserViewProposal(paymentProposal, "Yin Minh Châu", "Kinh Doanh", false, false, SAMPLE_PERSONNEL)
    ).toBe(true);
    expect(
      canUserViewProposal(paymentProposal, "Huỳnh Thị Ngọc Huyền", "Kinh Doanh", false, true, SAMPLE_PERSONNEL)
    ).toBe(true);
    expect(
      canUserViewProposal(paymentProposal, "Nguyễn Văn Hiếu", "Hành Chính Nhân Sự", false, true, SAMPLE_PERSONNEL)
    ).toBe(true);
    expect(
      canUserViewProposal(paymentProposal, "Đỗ Ngọc Diễm Trúc", "Ban Giám Đốc", true, false, SAMPLE_PERSONNEL)
    ).toBe(true);

    // Đơn xin nghỉ phép (DXNP) để PUBLIC: đồng nghiệp phòng khác thấy lịch nghỉ & người nhận bàn giao nhưng KHÔNG thấy lý do cá nhân
    const leaveProposal: ProposalItem = {
      ...paymentProposal,
      id: "PROP-DXNP-1",
      proposalCode: "DXNP-2026-010",
      templateId: "tmpl_leave_request",
      templateName: "Đơn xin Nghỉ phép / Nghỉ việc riêng",
      category: "HR_ADMIN",
      title: "Xin nghỉ phép — Nguyễn Thị Thu Thảo",
      requesterName: "Nguyễn Thị Thu Thảo",
      requesterDept: "QA/QC",
      summaryReason: "Đi khám sức khỏe cá nhân tại bệnh viện",
      formValues: {
        leaveType: "Nghỉ phép năm (Có hưởng lương)",
        fromDate: "2026-11-24",
        toDate: "2026-11-25",
        totalDays: "2",
        handoverStaff: "Phan Thị Thảo Trinh"
      },
      attachments: [{ name: "giay-kham.pdf", url: "/uploads/giay-kham.pdf" }]
    };

    expect(
      canUserViewProposal(leaveProposal, "Yin Minh Châu", "Kinh Doanh", false, false, SAMPLE_PERSONNEL)
    ).toBe(true);
    expect(
      canUserSeeFullLeaveDetails(leaveProposal, "Yin Minh Châu", "Kinh Doanh", false, false, SAMPLE_PERSONNEL)
    ).toBe(false);
    expect(
      canUserSeeFullLeaveDetails(leaveProposal, "Phan Thị Thảo Trinh", "QA/QC", false, true, SAMPLE_PERSONNEL)
    ).toBe(true);
    expect(
      canUserSeeFullLeaveDetails(leaveProposal, "Nguyễn Văn Hiếu", "Hành Chính Nhân Sự", false, true, SAMPLE_PERSONNEL)
    ).toBe(true);

    // Kiểm tra lọc từ phía máy chủ (/api/storage) cho nhân viên Kinh Doanh ngoài luồng của đơn QA/QC
    const serverFiltered = filterReadableProposalsForUser([paymentProposal, leaveProposal], {
      id: 99,
      username: "ABT099",
      full_name: "Nhân viên R&D",
      role: "rd_staff",
      department: "Nghiên Cứu R&D",
      permissions: {}
    } as any);
    expect(serverFiltered).toHaveLength(1);
    expect(serverFiltered[0].proposalCode).toBe("DXNP-2026-010");
    expect(serverFiltered[0].summaryReason).toContain("Lý do xin nghỉ riêng tư");
    expect(serverFiltered[0].attachments).toEqual([]);
  });

  it("distinguishes each BOD member individually so PGĐ Kinh doanh steps do NOT show 'Cần tôi duyệt' for PGĐ Kỹ thuật or Giám đốc", () => {
    // Đề xuất nghỉ phép của nhân sự Marketing (DXNP-2026-008: Hà Thượng Hương, DXNP-2026-013: Nguyễn Nhật Đức)
    // Bước 1 do PGĐ Kinh doanh — Đỗ Ngọc Diễm Trúc duyệt
    const rawMarketingSteps: ProposalStepInstance[] = [
      {
        stepOrder: 1,
        stepName: "Trưởng bộ phận duyệt & sắp xếp nhân sự",
        roleType: "DEPT_HEAD",
        dept: "Marketing",
        approverName: "Trưởng bộ phận",
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

    const normMkt = normalizeProposalStepsForRequester(
      rawMarketingSteps,
      "Marketing",
      "Hà Thượng Hương",
      SAMPLE_PERSONNEL
    );

    expect(normMkt.steps[0]).toMatchObject({
      stepOrder: 1,
      stepName: "PGĐ Kinh doanh duyệt & sắp xếp nhân sự",
      roleType: "DIRECTOR",
      dept: "Ban Giám Đốc",
      approverName: "Đỗ Ngọc Diễm Trúc",
      status: "PENDING_NOW"
    });
    expect(formatStepApproverDeptLabel(normMkt.steps[0])).toBe("PGĐ Kinh doanh • Ban Giám Đốc");

    const dxnp008 = {
      id: "PROP-DXNP-008",
      proposalCode: "DXNP-2026-008",
      requesterName: "Hà Thượng Hương",
      requesterDept: "Marketing",
      status: "PENDING",
      currentStepIndex: 0,
      steps: normMkt.steps
    } as ProposalItem;

    // CHỈ PGĐ Kinh doanh (Đỗ Ngọc Diễm Trúc) mới hiển thị "Cần tôi duyệt" / "Đang chờ bạn duyệt!"
    expect(isProposalWaitingForUser(dxnp008, "Đỗ Ngọc Diễm Trúc", "Ban Giám Đốc", true, false, SAMPLE_PERSONNEL)).toBe(true);

    // PGĐ Kỹ thuật (Nguyễn Duy Khánh) và Giám đốc (Nguyễn Văn Tùng) KHÔNG hiển thị "Cần tôi duyệt" cho bước của PGĐ Kinh doanh
    expect(isProposalWaitingForUser(dxnp008, "Nguyễn Duy Khánh", "Ban Giám Đốc", true, false, SAMPLE_PERSONNEL)).toBe(false);
    expect(isProposalWaitingForUser(dxnp008, "Nguyễn Văn Tùng", "Ban Giám Đốc", true, false, SAMPLE_PERSONNEL)).toBe(false);

    // Tương tự: bước duyệt của PGĐ Kỹ thuật (Nguyễn Duy Khánh) không hiển thị "Cần tôi duyệt" cho PGĐ Kinh doanh hoặc Giám đốc
    const techDirectorProposal = {
      id: "PROP-TECH-1",
      proposalCode: "DXNP-2026-001",
      requesterName: "Phan Thị Thảo Trinh",
      requesterDept: "QA/QC",
      status: "PENDING",
      currentStepIndex: 0,
      steps: [
        {
          stepOrder: 1,
          stepName: "PGĐ Kỹ thuật duyệt & sắp xếp nhân sự",
          roleType: "DIRECTOR",
          dept: "Ban Giám Đốc",
          approverName: "Nguyễn Duy Khánh",
          status: "PENDING_NOW",
          slaHours: 4
        }
      ]
    } as ProposalItem;

    expect(formatStepApproverDeptLabel(techDirectorProposal.steps[0])).toBe("PGĐ Kỹ thuật • Ban Giám Đốc");
    expect(isProposalWaitingForUser(techDirectorProposal, "Nguyễn Duy Khánh", "Ban Giám Đốc", true, false, SAMPLE_PERSONNEL)).toBe(true);
    expect(isProposalWaitingForUser(techDirectorProposal, "Đỗ Ngọc Diễm Trúc", "Ban Giám Đốc", true, false, SAMPLE_PERSONNEL)).toBe(false);
    expect(isProposalWaitingForUser(techDirectorProposal, "Nguyễn Văn Tùng", "Ban Giám Đốc", true, false, SAMPLE_PERSONNEL)).toBe(false);

    // Bước duyệt của Giám đốc (Nguyễn Văn Tùng - phụ trách KTCN) không hiển thị "Cần tôi duyệt" cho 2 PGĐ
    const ceoProposal = {
      id: "PROP-CEO-1",
      proposalCode: "DXNP-2026-015",
      requesterName: "Nguyễn Khánh Linh",
      requesterDept: "Kỹ Thuật – Thiết Bị",
      status: "PENDING",
      currentStepIndex: 0,
      steps: [
        {
          stepOrder: 1,
          stepName: "Giám đốc duyệt & sắp xếp nhân sự",
          roleType: "DIRECTOR",
          dept: "Ban Giám Đốc",
          approverName: "Nguyễn Văn Tùng",
          status: "PENDING_NOW",
          slaHours: 4
        }
      ]
    } as ProposalItem;

    expect(formatStepApproverDeptLabel(ceoProposal.steps[0])).toBe("Giám đốc • Ban Giám Đốc");
    expect(isProposalWaitingForUser(ceoProposal, "Nguyễn Văn Tùng", "Ban Giám Đốc", true, false, SAMPLE_PERSONNEL)).toBe(true);
    expect(isProposalWaitingForUser(ceoProposal, "Nguyễn Duy Khánh", "Ban Giám Đốc", true, false, SAMPLE_PERSONNEL)).toBe(false);
    expect(isProposalWaitingForUser(ceoProposal, "Đỗ Ngọc Diễm Trúc", "Ban Giám Đốc", true, false, SAMPLE_PERSONNEL)).toBe(false);

    // Kiểm tra ánh xạ chức danh BGĐ cụ thể qua resolveBodMemberForStep
    expect(resolveBodMemberForStep({ approverName: "PGĐ Kinh doanh", dept: "Ban Giám Đốc" }, "Kinh Doanh", SAMPLE_PERSONNEL).approverName).toBe("Đỗ Ngọc Diễm Trúc");
    expect(resolveBodMemberForStep({ approverName: "PGĐ Kinh doanh", dept: "Ban Giám Đốc" }, "QA/QC", SAMPLE_PERSONNEL).approverName).toBe("Nguyễn Duy Khánh");
    expect(resolveBodMemberForStep({ approverName: "PGĐ Kỹ thuật", dept: "Ban Giám Đốc" }, "Kinh Doanh", SAMPLE_PERSONNEL).approverName).toBe("Nguyễn Duy Khánh");
    expect(resolveBodMemberForStep({ approverName: "Giám đốc", dept: "Ban Giám Đốc" }, "Kinh Doanh", SAMPLE_PERSONNEL).approverName).toBe("Nguyễn Văn Tùng");
  });

  it("routes DXKNM (Đề xuất Xuất Kho Nhà Máy) for any department without QC-QA step and assigns Step 2 directly to Đoàn Hồng Sơn", () => {
    const dxknmTemplateSteps: ProposalStepInstance[] = [
      {
        stepOrder: 1,
        stepName: "Trưởng bộ phận duyệt nhu cầu",
        roleType: "DEPT_HEAD",
        dept: "Application",
        approverName: "Trưởng bộ phận",
        status: "PENDING_NOW",
        slaHours: 4
      },
      {
        stepOrder: 2,
        stepName: "Kiểm tra tồn kho: Xác nhận giao hàng (nếu có sẵn) hoặc Tạo lệnh sản xuất (nếu chưa có)",
        roleType: "EXECUTOR",
        dept: "Sản Xuất Kit",
        approverName: "Đoàn Hồng Sơn",
        status: "WAITING",
        slaHours: 4
      }
    ];

    // 1. Nhân viên phòng Application lập phiếu -> B1: Trần Tài (Application), B2: Đoàn Hồng Sơn (Sản Xuất Kit), không qua bước QC-QA
    const appStaffRes = normalizeProposalStepsForRequester(
      dxknmTemplateSteps,
      "Application",
      "Lê Minh Quân",
      SAMPLE_PERSONNEL
    );
    expect(appStaffRes.steps).toHaveLength(2);
    expect(appStaffRes.steps[0]).toMatchObject({
      stepOrder: 1,
      roleType: "DEPT_HEAD",
      dept: "Application",
      approverName: "Trần Tài"
    });
    expect(appStaffRes.steps[1]).toMatchObject({
      stepOrder: 2,
      roleType: "EXECUTOR",
      dept: "Sản Xuất Kit",
      approverName: "Đoàn Hồng Sơn"
    });

    // 2. Phó Trưởng phòng Application (Trần Tài) lập phiếu -> B1 nâng lên PGĐ Kinh doanh (Đỗ Ngọc Diễm Trúc), B2 giữ nguyên Đoàn Hồng Sơn
    const appLeadRes = normalizeProposalStepsForRequester(
      dxknmTemplateSteps,
      "Application",
      "Trần Tài",
      SAMPLE_PERSONNEL
    );
    expect(appLeadRes.steps).toHaveLength(2);
    expect(appLeadRes.steps[0]).toMatchObject({
      stepOrder: 1,
      roleType: "DIRECTOR",
      dept: "Ban Giám Đốc",
      approverName: "Đỗ Ngọc Diễm Trúc"
    });
    expect(appLeadRes.steps[1]).toMatchObject({
      stepOrder: 2,
      roleType: "EXECUTOR",
      dept: "Sản Xuất Kit",
      approverName: "Đoàn Hồng Sơn"
    });
  });
});
