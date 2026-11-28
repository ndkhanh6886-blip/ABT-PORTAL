import { itemIdentity } from "@/backend/services/storagePatch";
import type { AuthorizedUser } from "@/backend/services/authz";
import { isAdminUser } from "@/backend/services/authz";
import { canonicalDepartment, hasPermission, isDepartmentLeaderPosition } from "@/backend/services/permissions";
import { isSameWorkspaceDept, normalizeWorkspaceDept, sameStaffName } from "@/backend/services/workspaceTasks";

/**
 * Bảo vệ danh sách Đề xuất & Phê duyệt (app_storage "workspace_proposals").
 *
 * 11/2026: một trình duyệt có danh sách sai (chưa tải xong / bị thay bằng đơn dựng lại) đã gửi lệnh lưu làm XÓA toàn bộ
 * đơn thật trên máy chủ, và mã đơn sinh theo "số đơn trên trình duyệt + 1" cho ra 3 đơn cùng mã DXNP-2026-007.
 *  - Một lần lưu chỉ được xóa tối đa MAX_DELETES_PER_SAVE đơn (người dùng xóa từng đơn một); xóa nhiều hơn bị bỏ qua.
 *  - Ghi đè cả danh sách không được làm mất đơn đang có trên máy chủ.
 *  - Mã đơn trùng (cùng mã, khác đơn): đơn có sẵn trên máy chủ / lập trước giữ mã, đơn sau được cấp số kế tiếp.
 */
export const PROTECTED_PROPOSAL_KEY = "workspace_proposals";
export const MAX_DELETES_PER_SAVE = 1;

const CODE_RE = /^([A-Z]+)-(\d{4})-(\d+)$/;

/** Bỏ các lệnh xóa vượt giới hạn; trả về số lệnh xóa bị bỏ. */
export function limitProposalDeletes(patch: { deletes?: string[] }): number {
  const dels = Array.isArray(patch.deletes) ? patch.deletes : [];
  if (dels.length <= MAX_DELETES_PER_SAVE) return 0;
  patch.deletes = [];
  return dels.length;
}

/** Ghi đè cả danh sách: giữ lại các đơn đang có trên máy chủ mà danh sách gửi lên không có. */
export function keepMissingProposals(current: any, incoming: any[]): { list: any[]; kept: number } {
  if (!Array.isArray(current) || current.length === 0) return { list: incoming, kept: 0 };
  const ids = new Set(incoming.map((p) => itemIdentity(p)).filter(Boolean) as string[]);
  const missing = current.filter((p: any) => {
    const id = itemIdentity(p);
    return id && !ids.has(id);
  });
  return { list: missing.length ? [...incoming, ...missing] : incoming, kept: missing.length };
}

const createdKey = (p: any) => String(p?.createdAt || "") + "|" + String(p?.id || "");

/**
 * Cấp lại mã cho đơn trùng mã. `existingIds`: các đơn đã có trên máy chủ trước lần lưu này (được ưu tiên giữ mã).
 * Trả về danh sách [mã cũ, mã mới, id] đã đổi.
 */
export function dedupeProposalCodes(list: any[], existingIds: Set<string> = new Set(), current: any = null): Array<[string, string, string]> {
  if (!Array.isArray(list)) return [];
  const maxSeq = new Map<string, number>();
  const byCode = new Map<string, any[]>();
  for (const p of list) {
    const code = String(p?.proposalCode || "").trim().toUpperCase();
    const m = CODE_RE.exec(code);
    if (!m) continue;
    const series = `${m[1]}-${m[2]}`;
    maxSeq.set(series, Math.max(maxSeq.get(series) || 0, Number(m[3])));
    const arr = byCode.get(code) || [];
    arr.push(p);
    byCode.set(code, arr);
  }
  // Mã máy chủ đang lưu cho từng đơn: trình duyệt chưa tải lại có thể gửi lại mã cũ (trùng) của đơn đã được cấp mã mới
  const serverCodeById = new Map<string, string>();
  for (const p of Array.isArray(current) ? current : []) {
    const id = itemIdentity(p);
    if (id) serverCodeById.set(String(id), String(p?.proposalCode || "").trim().toUpperCase());
  }
  const used = new Set(Array.from(byCode.keys()));
  const changes: Array<[string, string, string]> = [];
  for (const [code, items] of byCode) {
    if (items.length < 2) continue;
    const m = CODE_RE.exec(code)!;
    const series = `${m[1]}-${m[2]}`;
    const width = Math.max(3, m[3].length);
    // Giữ mã: đơn đã có trên máy chủ trước, rồi đơn lập sớm nhất
    const sorted = [...items].sort((a, b) => {
      const ea = existingIds.has(String(itemIdentity(a))) ? 0 : 1;
      const eb = existingIds.has(String(itemIdentity(b))) ? 0 : 1;
      return ea - eb || createdKey(a).localeCompare(createdKey(b));
    });
    for (const p of sorted.slice(1)) {
      const prevCode = serverCodeById.get(String(itemIdentity(p)));
      let newCode: string;
      if (prevCode && prevCode !== code && !used.has(prevCode)) {
        newCode = prevCode; // giữ mã máy chủ đã cấp cho đơn này
      } else {
        const next = (maxSeq.get(series) || 0) + 1;
        maxSeq.set(series, next);
        newCode = `${series}-${String(next).padStart(width, "0")}`;
      }
      used.add(newCode);
      const note = `Hệ thống cấp lại mã ${newCode} (mã ${code} bị trùng với đơn khác)`;
      p.proposalCode = newCode;
      p.auditLogs = [
        ...(Array.isArray(p.auditLogs) ? p.auditLogs : []),
        { time: new Date().toISOString(), actor: "Hệ thống", action: "Cấp lại mã đơn", detail: note },
      ];
      changes.push([code, newCode, String(p?.id || "")]);
    }
  }
  return changes;
}

const KNOWN_LEADERS_AND_DEPUTIES = [
  "Nguyễn Quốc Bảo",
  "Nguyễn Thanh Tùng",
  "Nguyễn Văn Hiếu",
  "Tô Khánh Nhựt",
  "Phan Thị Thảo Trinh",
  "Đoàn Hồng Sơn",
  "Huỳnh Thị Ngọc Huyền",
  "Trần Tài",
];

function isDirectorOrAdminActor(me: AuthorizedUser): boolean {
  if (isAdminUser(me)) return true;
  const r = String(me.role || "").toLowerCase();
  const d = String(me.department || "").toLowerCase();
  return r.includes("director") || r.includes("giám đốc") || d.includes("giám đốc") || d.includes("bod");
}

function isDeptLeaderActor(me: AuthorizedUser): boolean {
  if (isDirectorOrAdminActor(me)) return true;
  if (hasPermission(me, "workspace.approve_dept")) return true;
  const r = String(me.role || "").toLowerCase();
  if (
    isDepartmentLeaderPosition(r) ||
    r.includes("head") ||
    r.includes("lead") ||
    r.includes("manager") ||
    r.includes("trưởng phòng") ||
    r.includes("phó trưởng phòng") ||
    r.includes("phó phòng") ||
    r.includes("quản đốc")
  ) {
    return true;
  }
  const fullName = String(me.full_name || "").trim();
  return Boolean(fullName && KNOWN_LEADERS_AND_DEPUTIES.some((n) => sameStaffName(n, fullName)));
}

function isGenericRoleApprover(label: any): boolean {
  const s = String(label || "").toLowerCase().normalize("NFC").trim();
  if (!s) return true;
  return (
    s === "trưởng bộ phận" ||
    s === "ban giám đốc" ||
    s === "kế toán trưởng" ||
    s === "kế toán viên" ||
    s === "nhân viên kế toán" ||
    s === "chuyên viên kế toán" ||
    s === "thủ quỹ" ||
    s === "hành chính nhân sự" ||
    s === "kế toán" ||
    s === "pháp chế" ||
    s.startsWith("trưởng phòng") ||
    s.startsWith("phó trưởng phòng") ||
    s.startsWith("trưởng bộ phận") ||
    s.startsWith("trưởng kho") ||
    s.startsWith("thủ kho") ||
    s.startsWith("trưởng cung ứng") ||
    s.startsWith("phụ trách")
  );
}

function isLeaveProposalItem(p: any): boolean {
  if (!p || typeof p !== "object") return false;
  const tid = String(p.templateId || "").toLowerCase();
  const code = String(p.proposalCode || "").toUpperCase();
  const tname = String(p.templateName || "").toLowerCase();
  return tid === "tmpl_leave_request" || code.startsWith("DXNP") || tname.includes("nghỉ phép");
}

export function resolveEffectiveProposalVisibility(p: any): "PRIVATE" | "DEPT" | "PUBLIC" {
  const vis = String(p?.visibility || "").toUpperCase();
  if (vis === "PRIVATE" || vis === "DEPT" || vis === "PUBLIC") return vis;
  const tid = String(p?.templateId || "").toLowerCase();
  const prefix = String(p?.proposalCode || "").split("-")[0].toUpperCase();
  const cat = String(p?.category || "").toUpperCase();

  if (tid === "tmpl_leave_request" || prefix === "DXNP") return "PUBLIC";
  if (cat === "EXECUTIVE" || tid === "tmpl_executive_memo" || prefix === "TTR") return "PUBLIC";
  if (tid === "tmpl_business_trip" || prefix === "DXCT") return "DEPT";
  if (cat === "TECHNICAL_OPS") return "DEPT";
  return "PRIVATE";
}

export function isActorDirectlyInProposalFlow(p: any, me: AuthorizedUser): boolean {
  if (!p || typeof p !== "object") return false;
  if (isDirectorOrAdminActor(me)) return true;
  const myName = String(me.full_name || me.username || "").trim();
  const myDept = String(me.department || "").trim();
  if (!myName) return false;

  if (sameStaffName(p.requesterName, myName)) return true;
  if (p.executorName && sameStaffName(p.executorName, myName)) return true;
  if (Array.isArray(p.followers) && p.followers.some((f: any) => sameStaffName(f, myName))) return true;

  const handover = String(p.formValues?.handoverStaff || p.formValues?.handover_person || "").trim();
  if (handover && sameStaffName(handover, myName)) return true;

  const companions = String(p.formValues?.companions || "").trim();
  if (
    companions &&
    companions
      .split(/[,;\n]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .some((c) => sameStaffName(c, myName))
  ) {
    return true;
  }

  const isLeader = isDeptLeaderActor(me);
  if (
    isLeader &&
    myDept &&
    (isSameWorkspaceDept(p.requesterDept, myDept) ||
      (Boolean(canonicalDepartment(p.requesterDept)) &&
        canonicalDepartment(p.requesterDept) === canonicalDepartment(myDept)))
  ) {
    return true;
  }

  const steps = Array.isArray(p.steps) ? p.steps : [];
  for (const st of steps) {
    if (!st) continue;
    if (st.approverName && sameStaffName(st.approverName, myName)) return true;
    if (st.decidedBy && sameStaffName(st.decidedBy, myName)) return true;
    if (myDept && sameStaffName(st.approverName, myDept)) return true;
    if (isLeader && myDept && isGenericRoleApprover(st.approverName)) {
      const sameStepDept =
        isSameWorkspaceDept(st.dept, myDept) ||
        (Boolean(canonicalDepartment(st.dept)) && canonicalDepartment(st.dept) === canonicalDepartment(myDept));
      if (sameStepDept) return true;
    }
  }

  return false;
}

export function canActorSeeFullLeaveDetails(p: any, me: AuthorizedUser): boolean {
  if (isActorDirectlyInProposalFlow(p, me)) return true;
  const myDept = String(me.department || "").trim();
  const canonDept = canonicalDepartment(myDept);
  const normDept = normalizeWorkspaceDept(myDept);
  if (canonDept === "Hành chính" || normDept === "Hành Chính Nhân Sự" || normDept === "Kế Toán") {
    return true;
  }
  return false;
}

export function canActorViewProposal(p: any, me: AuthorizedUser): boolean {
  if (!p || typeof p !== "object") return false;
  if (isDirectorOrAdminActor(me)) return true;
  const myName = String(me.full_name || me.username || "").trim();
  if (String(p.status || "").toUpperCase() === "DRAFT") {
    return Boolean(myName && sameStaffName(p.requesterName, myName));
  }
  if (isActorDirectlyInProposalFlow(p, me)) return true;
  const vis = resolveEffectiveProposalVisibility(p);
  if (vis === "PUBLIC") return true;
  if (vis === "DEPT") {
    const myDept = String(me.department || "").trim();
    if (!myDept) return false;
    return (
      isSameWorkspaceDept(p.requesterDept, myDept) ||
      (Boolean(canonicalDepartment(p.requesterDept)) &&
        canonicalDepartment(p.requesterDept) === canonicalDepartment(myDept))
    );
  }
  return false;
}

/**
 * Lọc danh sách `workspace_proposals` trước khi trả về từ `/api/storage`:
 * - Ẩn hoàn toàn các đề xuất `PRIVATE` / `DEPT` mà người đang đăng nhập không có quyền xem.
 * - Với Đơn xin nghỉ phép (`DXNP`) công khai lịch (`PUBLIC`), nếu người xem không nằm trong luồng duyệt / HCNS / Kế toán / BGĐ
 *   thì tự động ẩn lý do cá nhân (`summaryReason`) và tệp đính kèm riêng tư (`attachments`), vẫn giữ nguyên lịch ngày nghỉ & người bàn giao.
 */
export function filterReadableProposalsForUser(rawList: any, me: AuthorizedUser): any {
  if (!Array.isArray(rawList)) return rawList;
  if (isDirectorOrAdminActor(me)) return rawList;
  const out: any[] = [];
  for (const p of rawList) {
    if (!canActorViewProposal(p, me)) continue;
    if (isLeaveProposalItem(p) && !canActorSeeFullLeaveDetails(p, me)) {
      out.push({
        ...p,
        summaryReason: "🔒 Lý do xin nghỉ riêng tư (Đã ẩn bảo mật — chỉ hiển thị lịch ngày nghỉ & người nhận bàn giao)",
        attachments: [],
      });
    } else {
      out.push(p);
    }
  }
  return out;
}

/**
 * Khi một tài khoản nhận về đơn nghỉ phép đã bị che `summaryReason` / `attachments` và vô tình gửi patch lên,
 * giữ nguyên `summaryReason` và `attachments` gốc đang lưu trên máy chủ.
 */
export function preserveRedactedProposalFields(current: any, upserts: any[], me: AuthorizedUser): any[] {
  if (!Array.isArray(current) || !Array.isArray(upserts) || isDirectorOrAdminActor(me)) return upserts;
  const byId = new Map<string, any>();
  for (const item of current) {
    const id = itemIdentity(item);
    if (id !== null) byId.set(id, item);
  }
  return upserts.map((item) => {
    const prev = byId.get(itemIdentity(item) || "");
    if (!prev || !isLeaveProposalItem(prev) || canActorSeeFullLeaveDetails(prev, me)) return item;
    return {
      ...item,
      summaryReason: prev.summaryReason,
      attachments: prev.attachments,
    };
  });
}

/**
 * Kiểm tra người dùng `me` có thẩm quyền phê duyệt / từ chối / trả lại ở một bước (`step`) của đề xuất `proposal` hay không.
 */
export function canActorDecideProposalStep(proposal: any, step: any, me: AuthorizedUser): boolean {
  if (!proposal || !step || !me) return false;
  if (isDirectorOrAdminActor(me)) return true;

  const myName = String(me.full_name || me.username || "").trim();
  const myDept = String(me.department || "").trim();
  if (!myName) return false;

  // Người tạo đề xuất không được tự duyệt bước Trưởng bộ phận (DEPT_HEAD) cho chính đơn của mình
  if (String(step.roleType || "").toUpperCase() === "DEPT_HEAD" && sameStaffName(proposal.requesterName, myName)) {
    return false;
  }

  // 1. Khớp trực tiếp tên người duyệt được chỉ định trên bước
  if (step.approverName && !isGenericRoleApprover(step.approverName) && sameStaffName(step.approverName, myName)) {
    return true;
  }

  // 2. Bước dành cho Ban Giám Đốc (DIRECTOR) -> chỉ Ban Giám Đốc / Admin được duyệt (đã xử lý ở isDirectorOrAdminActor phía trên)
  if (String(step.roleType || "").toUpperCase() === "DIRECTOR" || isSameWorkspaceDept(step.dept, "Ban Giám Đốc")) {
    return isDirectorOrAdminActor(me);
  }

  // 3. Bước mang nhãn chức danh chung (VD: "Trưởng bộ phận", "Kế toán trưởng", "Hành Chính Nhân Sự") hoặc cùng phòng chuyên môn
  const stepTargetDept =
    !step.dept || String(step.dept).trim() === "Theo phòng người tạo"
      ? String(proposal.requesterDept || "")
      : String(step.dept);

  const sameDept =
    Boolean(myDept) &&
    (isSameWorkspaceDept(stepTargetDept, myDept) ||
      (Boolean(canonicalDepartment(stepTargetDept)) &&
        canonicalDepartment(stepTargetDept) === canonicalDepartment(myDept)));

  if (!sameDept) return false;

  if (String(step.roleType || "").toUpperCase() === "DEPT_HEAD") {
    return isDeptLeaderActor(me);
  }

  // Các bước REVIEWER / EXECUTOR (VD: Kế toán kiểm tra chứng từ, HCNS ghi nhận công phép, Kho xuất thực thi)
  if (isDeptLeaderActor(me)) return true;
  if (isGenericRoleApprover(step.approverName)) return true;

  return false;
}

/**
 * Kiểm soát toàn vẹn & phân quyền trên máy chủ đối với từng đề xuất / đơn nghỉ phép được gửi lên qua `/api/storage` (`workspace_proposals`):
 * 1. TẠO MỚI ĐỀ XUẤT (chưa có trên máy chủ):
 *    - Bắt buộc `requesterName` phải là tên của chính người đang đăng nhập (trừ Ban Giám Đốc / Admin).
 *    - Không cho phép nhân viên thường tự tạo đề xuất / đơn nghỉ phép với trạng thái `"APPROVED"` hoặc `"EXECUTED"` mà chưa qua quản lý duyệt:
 *      mọi bước duyệt mà người tạo không có thẩm quyền duyệt đều bị đưa về `"PENDING_NOW"` / `"WAITING"` và trạng thái tổng của đơn đưa về `"PENDING"` (hoặc `"DRAFT"`).
 * 2. CẬP NHẬT ĐỀ XUẤT ĐÃ CÓ TRÊN MÁY CHỦ:
 *    - Không cho phép sửa `requesterName` (chủ đơn) hay `createdAt`.
 *    - Nếu người gửi KHÔNG nằm trong luồng đề xuất (không phải chủ đơn, người duyệt, người thực thi, người theo dõi, quản lý phòng):
 *      từ chối mọi thay đổi, giữ nguyên bản ghi gốc trên máy chủ (`prev`).
 *    - Nếu sửa nội dung gốc của đơn (`title`, `totalAmount`, `summaryReason`, `formValues`, `lineItems`):
 *      chỉ chính chủ đơn (khi đơn đang ở `DRAFT` / `PENDING` / `RETURNED` / `WITHDRAWN`) hoặc Ban Giám Đốc / Admin mới được sửa.
 *      Người khác (kể cả người chỉ xem hoặc bình luận) hoặc đơn đã `APPROVED` / `EXECUTED` bị khóa nguyên nội dung gốc từ bản máy chủ (`prev`).
 *    - Nếu chuyển trạng thái bước duyệt sang `APPROVED` / `REJECTED` / `RETURNED` hoặc chuyển trạng thái tổng sang `APPROVED` / `REJECTED`:
 *      kiểm tra người đang đăng nhập có đúng thẩm quyền duyệt bước đó (`canActorDecideProposalStep`) hay không. Nếu không có quyền,
 *      khôi phục lại trạng thái bước duyệt và trạng thái tổng (`prev.status`, `prev.steps`, `prev.currentStepIndex`) từ bản máy chủ.
 * 3. XÓA ĐỀ XUẤT:
 *    - Chỉ chủ đơn (khi đơn chưa `APPROVED` / `EXECUTED`) hoặc Ban Giám Đốc / Admin mới được xóa đơn.
 */
export function enforceProposalWriteGuards(current: any, incomingUpserts: any[], me: AuthorizedUser): any[] {
  if (!Array.isArray(incomingUpserts)) return incomingUpserts;
  const isBodOrAdmin = isDirectorOrAdminActor(me);
  const myName = String(me.full_name || me.username || "").trim();
  const myDept = String(me.department || "").trim();

  const currentById = new Map<string, any>();
  if (Array.isArray(current)) {
    for (const item of current) {
      const id = itemIdentity(item);
      if (id !== null) currentById.set(id, item);
    }
  }

  const sanitizedUpserts: any[] = [];

  for (const rawItem of incomingUpserts) {
    if (!rawItem || typeof rawItem !== "object") continue;
    const id = itemIdentity(rawItem);
    const prev = id !== null ? currentById.get(id) : undefined;

    // TRƯỜNG HỢP 1: TẠO ĐỀ XUẤT MỚI
    if (!prev) {
      const item = { ...rawItem };
      // Chống mạo danh người khác tạo đề xuất
      if (!isBodOrAdmin && myName && !sameStaffName(item.requesterName, myName)) {
        item.requesterName = myName;
        if (myDept) item.requesterDept = myDept;
      }

      const rawSteps = Array.isArray(item.steps) ? item.steps : [];
      const wantedStatus = String(item.status || "PENDING").toUpperCase();

      // Nếu không phải Ban Giám Đốc / Admin thì không được tự tạo đơn ở trạng thái đã duyệt ("APPROVED" / "EXECUTED")
      if (!isBodOrAdmin && (wantedStatus === "APPROVED" || wantedStatus === "EXECUTED")) {
        const canSelfApproveAll =
          rawSteps.length > 0 && rawSteps.every((st: any) => canActorDecideProposalStep(item, st, me));
        if (!canSelfApproveAll) {
          console.warn(
            `[proposalGuard] Chặn ${me.username} (${myName}) tự tạo đề xuất mới ${item.proposalCode || item.id} ở trạng thái ${wantedStatus}; chuyển về PENDING.`
          );
          let firstPendingAssigned = false;
          item.steps = rawSteps.map((st: any) => {
            if (st?.status === "SKIPPED") return st;
            if (!firstPendingAssigned) {
              firstPendingAssigned = true;
              return { ...st, status: "PENDING_NOW", decidedAt: undefined, decidedBy: undefined };
            }
            return { ...st, status: "WAITING", decidedAt: undefined, decidedBy: undefined };
          });
          item.currentStepIndex = 0;
          item.status = "PENDING";
        }
      }
      sanitizedUpserts.push(item);
      continue;
    }

    // TRƯỜNG HỢP 2: CẬP NHẬT ĐỀ XUẤT ĐÃ CÓ TRÊN MÁY CHỦ
    const isOwner = Boolean(myName && sameStaffName(prev.requesterName, myName));
    const inFlow = isActorDirectlyInProposalFlow(prev, me);

    // Nếu chỉ là lần đồng bộ danh sách tự động từ trình duyệt của người khác (không phải chủ đơn, không duyệt mới, không bình luận mới)
    // hoặc người gửi không nằm trong luồng đề xuất -> giữ nguyên bản trên máy chủ để chống ghi đè chéo giữa các máy
    const prevCommentsLen = Array.isArray(prev.comments) ? prev.comments.length : 0;
    const nextCommentsLen = Array.isArray(rawItem.comments) ? rawItem.comments.length : 0;
    const hasNewComment = nextCommentsLen > prevCommentsLen;

    if (!isBodOrAdmin && !inFlow && !hasNewComment) {
      sanitizedUpserts.push(prev);
      continue;
    }

    let nextItem = {
      ...rawItem,
      // Khóa cứng thông tin người tạo và thời điểm tạo gốc
      requesterName: prev.requesterName,
      requesterDept: isOwner || isBodOrAdmin ? (rawItem.requesterDept || prev.requesterDept) : prev.requesterDept,
      createdAt: prev.createdAt || rawItem.createdAt,
    };

    const prevStatus = String(prev.status || "PENDING").toUpperCase();
    const nextStatus = String(nextItem.status || prevStatus).toUpperCase();
    const isAlreadyFinal = prevStatus === "APPROVED" || prevStatus === "EXECUTED";

    // Kiểm tra quyền sửa nội dung gốc của đề xuất (title, summaryReason, formValues, lineItems, totalAmount, neededByDate)
    const canEditCoreContent =
      isBodOrAdmin || (isOwner && !isAlreadyFinal && ["DRAFT", "PENDING", "RETURNED", "WITHDRAWN"].includes(prevStatus));

    if (!canEditCoreContent) {
      nextItem = {
        ...nextItem,
        title: prev.title,
        templateId: prev.templateId,
        templateName: prev.templateName,
        category: prev.category,
        priority: prev.priority,
        neededByDate: prev.neededByDate,
        totalAmount: prev.totalAmount,
        currency: prev.currency,
        summaryReason: prev.summaryReason,
        formValues: prev.formValues,
        lineItems: prev.lineItems,
        attachments: prev.attachments,
        customerName: prev.customerName,
        supplierName: prev.supplierName,
        linkedRefCode: prev.linkedRefCode,
        visibility: prev.visibility,
      };
    }

    // Kiểm tra tính hợp lệ của việc chuyển trạng thái bước duyệt (steps) và trạng thái tổng (status)
    if (!isBodOrAdmin) {
      const prevSteps: any[] = Array.isArray(prev.steps) ? prev.steps : [];
      const nextSteps: any[] = Array.isArray(nextItem.steps) ? nextItem.steps : [];

      let unauthorizedDecision = false;
      for (let i = 0; i < nextSteps.length; i++) {
        const ns = nextSteps[i];
        const ps = prevSteps[i];
        if (!ns) continue;
        const psStatus = String(ps?.status || "WAITING").toUpperCase();
        const nsStatus = String(ns?.status || "WAITING").toUpperCase();
        if (psStatus !== nsStatus && ["APPROVED", "REJECTED", "RETURNED"].includes(nsStatus)) {
          if (!canActorDecideProposalStep(prev, ps || ns, me)) {
            unauthorizedDecision = true;
            break;
          }
        }
      }

      // Kiểm tra chuyển trạng thái tổng của đơn
      if (!unauthorizedDecision && prevStatus !== nextStatus) {
        if (nextStatus === "WITHDRAWN") {
          if (!isOwner || isAlreadyFinal) unauthorizedDecision = true;
        } else if (nextStatus === "APPROVED" || nextStatus === "REJECTED" || nextStatus === "RETURNED") {
          const canDecideAnyActive = prevSteps.some(
            (ps: any) =>
              (ps?.status === "PENDING_NOW" || ps?.status === "WAITING") && canActorDecideProposalStep(prev, ps, me)
          );
          if (!canDecideAnyActive) unauthorizedDecision = true;
        } else if (nextStatus === "EXECUTED") {
          const isExecutor =
            (prev.executorName && sameStaffName(prev.executorName, myName)) ||
            prevSteps.some((ps: any) => ps?.roleType === "EXECUTOR" && canActorDecideProposalStep(prev, ps, me)) ||
            isDeptLeaderActor(me);
          if (!isExecutor) unauthorizedDecision = true;
        } else if (nextStatus === "PENDING" && prevStatus === "RETURNED") {
          if (!isOwner) unauthorizedDecision = true;
        }
      }

      if (unauthorizedDecision) {
        console.warn(
          `[proposalGuard] Chặn ${me.username} (${myName}) thay đổi trạng thái duyệt trái phép trên đề xuất ${prev.proposalCode || prev.id} (${prevStatus} -> ${nextStatus}).`
        );
        nextItem = {
          ...nextItem,
          status: prev.status,
          steps: prev.steps,
          currentStepIndex: prev.currentStepIndex,
          executedAt: prev.executedAt,
          executionNote: prev.executionNote,
          executionAttachments: prev.executionAttachments,
        };
      }
    }

    sanitizedUpserts.push(nextItem);
  }

  return sanitizedUpserts;
}

/**
 * Chỉ cho phép chủ đơn (khi đơn chưa APPROVED / EXECUTED) hoặc Ban Giám Đốc / Admin xóa đề xuất.
 */
export function filterAuthorizedProposalDeletes(current: any, deleteIds: string[], me: AuthorizedUser): string[] {
  if (!Array.isArray(deleteIds) || deleteIds.length === 0) return [];
  if (isDirectorOrAdminActor(me)) return deleteIds;
  if (!Array.isArray(current)) return [];
  const myName = String(me.full_name || me.username || "").trim();
  if (!myName) return [];

  const currentById = new Map<string, any>();
  for (const item of current) {
    const id = itemIdentity(item);
    if (id !== null) currentById.set(id, item);
  }

  return deleteIds.filter((delId) => {
    const target = currentById.get(delId);
    if (!target) return false;
    const st = String(target.status || "").toUpperCase();
    if (st === "APPROVED" || st === "EXECUTED") return false;
    return sameStaffName(target.requesterName, myName);
  });
}
