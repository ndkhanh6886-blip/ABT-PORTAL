import { itemIdentity } from "@/backend/services/storagePatch";

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
