export interface WorkspaceBlockMeta {
  label: string;
  shortLabel: string;
  defaultDept: string;
  depts: Set<string>;
}

export const WORKSPACE_BLOCKS: Record<"BLOCK_COMMERCIAL" | "BLOCK_TECHNICAL" | "BLOCK_EXECUTIVE", WorkspaceBlockMeta> = {
  BLOCK_COMMERCIAL: {
    label: "Khối Kinh Doanh & Văn Phòng",
    shortLabel: "Khối KD & Văn Phòng",
    defaultDept: "Kinh Doanh",
    depts: new Set([
      "Kinh Doanh",
      "Sales Admin",
      "Application",
      "Kho & Vận Hành",
      "Cung Ứng",
      "PM",
      "Marketing",
      "Kế Toán",
      "Pháp Chế",
      "Hành Chính Nhân Sự",
    ]),
  },
  BLOCK_TECHNICAL: {
    label: "Khối Kỹ Thuật – Nhà Máy",
    shortLabel: "Khối Kỹ Thuật – Nhà Máy",
    defaultDept: "Nghiên Cứu R&D",
    depts: new Set([
      "Đơn Nội Bộ",
      "Nghiên Cứu R&D",
      "Sản Xuất Kit",
      "Tổng Hợp Oligo",
      "Kỹ Thuật – Thiết Bị",
      "QA/QC",
      "Kho Nhà Máy",
      "Cung Ứng Kỹ Thuật",
    ]),
  },
  BLOCK_EXECUTIVE: {
    label: "Khối Ban Lãnh Đạo (BOD)",
    shortLabel: "Ban Giám Đốc",
    defaultDept: "Ban Giám Đốc",
    depts: new Set(["Ban Giám Đốc"]),
  },
};

export type WorkspaceBlockKey = keyof typeof WORKSPACE_BLOCKS;

export function isWorkspaceBlockKey(val: any): val is WorkspaceBlockKey {
  return typeof val === "string" && Object.prototype.hasOwnProperty.call(WORKSPACE_BLOCKS, val);
}

export function normalizeWorkspaceDept(raw: any): string {
  const s = String(raw || "").trim();
  if (!s) return "";
  if (s === "all") return "all";
  if (isWorkspaceBlockKey(s)) return s;
  const l = s.toLowerCase();
  // 1. Phân biệt rõ Kho Nhà Máy và Cung Ứng Kỹ Thuật (xét trước Kho & Cung ứng chung)
  if (
    l.includes("kho nhà máy") ||
    l.includes("kho kỹ thuật") ||
    l.includes("kho tổng nhà máy") ||
    l.includes("kho vật tư") ||
    l.includes("kho hóa chất") ||
    l === "p-wh" ||
    l === "factory_warehouse"
  ) {
    return "Kho Nhà Máy";
  }
  if (
    l.includes("cung ứng kỹ thuật") ||
    l.includes("cung ứng nhà máy") ||
    l.includes("cung ứng nvl") ||
    l.includes("mua hàng nhà máy") ||
    l.includes("mua hàng kỹ thuật") ||
    l.includes("mua sắm nvl") ||
    l === "p-pur" ||
    l === "factory_procurement"
  ) {
    return "Cung Ứng Kỹ Thuật";
  }
  // 2. Các phòng ban thuộc Khối Kỹ Thuật – Nhà Máy
  if (l.includes("đơn nội bộ") || l.includes("điều phối sản xuất") || l.includes("điều phối đơn")) return "Đơn Nội Bộ";
  if (l.includes("r&d") || l.includes("nghiên cứu") || l === "p-rd") return "Nghiên Cứu R&D";
  if (l.includes("sản xuất kit") || l.includes("sx kit") || l === "p-kit") return "Sản Xuất Kit";
  if (l.includes("oligo") || l === "p-oligo") return "Tổng Hợp Oligo";
  if (l.includes("thiết bị") || l.includes("cơ điện") || l === "p-tb") return "Kỹ Thuật – Thiết Bị";
  if (l.includes("qa") || l.includes("qc") || l.includes("chất lượng") || l === "p-qaqc") return "QA/QC";
  // 3. Các phòng ban thuộc Khối Kinh Doanh & Văn Phòng
  if (l.includes("sales admin")) return "Sales Admin";
  if (l === "pm" || l.includes("product manager") || l.includes("quản lý sản phẩm")) return "PM";
  if (l.includes("marketing") || l.includes("tiếp thị")) return "Marketing";
  if (l.includes("nhân sự") || l.includes("hành chính") || l === "hr") return "Hành Chính Nhân Sự";
  if (l.includes("ứng dụng") || l.includes("application") || l === "app") return "Application";
  if (l.includes("kho") || l.includes("vận hành") || l.includes("warehouse") || l.includes("giao nhận")) return "Kho & Vận Hành";
  if (l.includes("cung ứng") || l.includes("mua hàng") || l.includes("procurement")) return "Cung Ứng";
  if (l.includes("kinh doanh") || l.includes("sales")) return "Kinh Doanh";
  if (l.includes("pháp chế") || l.includes("legal") || l.includes("tuân thủ")) return "Pháp Chế";
  if (l.includes("kế toán") || l.includes("tài chính") || l.includes("accounting")) return "Kế Toán";
  if (l.includes("giám đốc") || l.includes("bod")) return "Ban Giám Đốc";
  return s;
}

export function isSameWorkspaceDept(a: any, b: any): boolean {
  const splitDepts = (raw: any): string[] =>
    String(raw || "")
      .split(/[,;\n]+/)
      .map((d) => normalizeWorkspaceDept(d.trim()))
      .filter(Boolean);
  const listA = splitDepts(a);
  const listB = splitDepts(b);
  if (listA.length === 0 || listB.length === 0) return false;
  if (listA.includes("all") || listB.includes("all")) return true;
  return listA.some((da) =>
    listB.some((db) => {
      if (da.toLowerCase() === db.toLowerCase()) return true;
      if (isWorkspaceBlockKey(da)) {
        return isWorkspaceBlockKey(db) ? da === db : WORKSPACE_BLOCKS[da].depts.has(db);
      }
      if (isWorkspaceBlockKey(db)) {
        return WORKSPACE_BLOCKS[db].depts.has(da);
      }
      return false;
    })
  );
}

export function formatWorkspaceScopeLabel(scope: string, withDeptPrefix = false): string {
  if (!scope || scope === "all") return "Toàn Công Ty";
  if (isWorkspaceBlockKey(scope)) return WORKSPACE_BLOCKS[scope].label;
  return withDeptPrefix ? `Phòng ${scope}` : scope;
}

export function defaultConcreteDeptForScope(scope: string, userDept?: string): string {
  if (!scope || scope === "all") return userDept || "Kinh Doanh";
  if (isWorkspaceBlockKey(scope)) {
    const normUserDept = userDept ? normalizeWorkspaceDept(userDept) : "";
    if (normUserDept && WORKSPACE_BLOCKS[scope].depts.has(normUserDept)) {
      return normUserDept;
    }
    return WORKSPACE_BLOCKS[scope].defaultDept;
  }
  return scope;
}
