import { describe, expect, it } from "vitest";
import {
  canonicalDepartment,
  DEPARTMENT_MODULES,
  inferSystemRoleFromPosition,
  isDepartmentLeaderPosition,
} from "../permissions";
import { inferFactoryModuleFromDept, inferFactoryRoleCode } from "@/factory/orgSync";
import {
  ABT_ORG_SCHEMA_VERSION,
  DEPARTMENT_POSITIONS,
  DEPT_KEYS_BY_BLOCK,
  matchDepartment,
  mergeStoredDepartmentPositions,
  PRIMARY_DEPT_KEYS,
} from "@/frontend/components/departmentPositions";

describe("company departments (personnel list 11/2026)", () => {
  it("maps real and old department names to the 11 departments", () => {
    expect(canonicalDepartment("KTCN")).toBe("KTCN");
    expect(canonicalDepartment("Kỹ Thuật – Thiết Bị")).toBe("KTCN");
    expect(canonicalDepartment("Sản xuất")).toBe("Sản xuất");
    expect(canonicalDepartment("Sản Xuất Kit")).toBe("Sản xuất");
    expect(canonicalDepartment("QC/QA")).toBe("QC/QA");
    expect(canonicalDepartment("QA / QC")).toBe("QC/QA");
    expect(canonicalDepartment("APP")).toBe("APP");
    expect(canonicalDepartment("Kỹ Thuật & Ứng Dụng")).toBe("APP");
    // business-block warehouse / purchasing belong to Kinh Doanh; the factory one is Cung ứng Kho
    expect(canonicalDepartment("Kho Vận")).toBe("Kinh Doanh");
    expect(canonicalDepartment("Mua Hàng & Cung Ứng")).toBe("Kinh Doanh");
    expect(canonicalDepartment("Cung ứng Kho")).toBe("Cung ứng Kho");
    expect(canonicalDepartment("Kho Nhà Máy")).toBe("Cung ứng Kho");
    expect(canonicalDepartment("Kế Toán")).toBe("Hành chính");
    expect(canonicalDepartment("Tổng hợp Oligo")).toBe("Tổng hợp Oligo");
    expect(canonicalDepartment("Phòng không có")).toBeNull();
  });

  it("team leaders are not department heads; heads and deputies are", () => {
    expect(isDepartmentLeaderPosition("Trưởng nhóm Sản xuất mix")).toBe(false);
    expect(isDepartmentLeaderPosition("Phó Trưởng phòng QC-QA")).toBe(true);
    expect(isDepartmentLeaderPosition("Phó Trường phòng kinh doanh")).toBe(true); // typo in the list
    expect(isDepartmentLeaderPosition("Quản lý sản phẩm")).toBe(false);
  });

  it("infers the role of each kind of position (no factory staff falls back to sales)", () => {
    expect(inferSystemRoleFromPosition("Sản xuất", "Nhân viên sản xuất")).toBe("kit_staff");
    expect(inferSystemRoleFromPosition("Sản xuất", "Phó Trưởng phòng Sản xuất")).toBe("kit_head");
    expect(inferSystemRoleFromPosition("KTCN", "Trưởng nhóm Sản xuất thiết bị")).toBe("device_staff");
    expect(inferSystemRoleFromPosition("KTCN", "Nhân viên IT")).toBe("staff");
    expect(inferSystemRoleFromPosition("QC/QA", "Nhân viên ISO")).toBe("qa_qc");
    expect(inferSystemRoleFromPosition("Kinh Doanh", "Nhân viên giao nhận")).toBe("warehouse");
    // Sales Admin runs the business warehouse and purchasing; the factory Cung ứng Kho works in the factory modules
    expect(inferSystemRoleFromPosition("Kinh Doanh", "Nhân viên Sales Admin")).toBe("sales_admin");
    expect(inferSystemRoleFromPosition("Kinh Doanh", "Trưởng nhóm Sales Admin")).toBe("sales_admin");
    expect(inferSystemRoleFromPosition("Cung ứng Kho", "Nhân viên Cung ứng Kho")).toBe("staff");
    expect(inferSystemRoleFromPosition("Cung ứng Kho", "Nhân viên Kho")).toBe("staff");
    expect(inferSystemRoleFromPosition("Hành chính", "Nhân viên Kế toán")).toBe("accountant");
    expect(inferSystemRoleFromPosition("Marketing", "Nhân viên Marketing")).toBe("marketing");
    // Cố vấn cấp cao: quyền quản trị như Ban Giám Đốc, kể cả khi xếp ở phòng khác
    expect(inferSystemRoleFromPosition("Ban Giám Đốc", "Cố vấn cấp cao")).toBe("admin");
    expect(inferSystemRoleFromPosition("R&D", "Cố vấn cấp cao")).toBe("admin");
    // a role written in the file is kept
    expect(inferSystemRoleFromPosition("R&D", "Nhân viên R&D", "rd_staff")).toBe("rd_staff");
  });

  it("puts factory departments on their factory unit, and APP on none", () => {
    expect(inferFactoryModuleFromDept("KTCN", "device_staff")).toBe("DEVICE");
    expect(inferFactoryModuleFromDept("Sản xuất", "kit_staff")).toBe("KIT");
    expect(inferFactoryModuleFromDept("Cung ứng Kho", "warehouse")).toBe("WH");
    expect(inferFactoryModuleFromDept("APP", "app_head")).toBeNull();
    expect(inferFactoryModuleFromDept("Kinh Doanh", "sales_admin")).toBeNull();
    expect(inferFactoryRoleCode("WH", "staff", "Trưởng bộ phận Cung ứng Kho")).toBe("WH_HEAD");
    expect(inferFactoryRoleCode("KIT", "kit_staff", "Trưởng nhóm Sản xuất mix")).toBe("KIT_STAFF");
    expect(inferFactoryRoleCode("KIT", "kit_head", "Phó Trưởng phòng Sản xuất")).toBe("KIT_HEAD");
  });
});

describe("Sales Admin role", () => {
  it("covers the business warehouse and purchasing, without approvals", async () => {
    const { ROLE_PRESETS } = await import("../permissions");
    const p = ROLE_PRESETS.sales_admin;
    expect(p["sales.view"]).toBe(true);
    expect(p["warehouse.inbound"]).toBe(true);
    expect(p["procurement.view"]).toBe(true);
    expect(p["procurement.create_pr"]).toBe(true);
    expect(p["procurement.approve_po"]).toBe(false);
    expect(p["sales.approve_discount"]).toBe(false);
  });
});

describe("org structure, commercial vs factory separation & migration", () => {
  it("groups all 11 canonical ABT departments across 4 blocks including Khối Kỹ Thuật – Nhà Máy", () => {
    expect(PRIMARY_DEPT_KEYS).toHaveLength(11);
    expect(DEPT_KEYS_BY_BLOCK.map((b) => b.block)).toEqual([
      "Điều Hành",
      "Khối Văn Phòng",
      "Khối Kinh Doanh",
      "Khối Kỹ Thuật – Nhà Máy",
    ]);
    const technicalBlock = DEPT_KEYS_BY_BLOCK.find((b) => b.block === "Khối Kỹ Thuật – Nhà Máy");
    expect(technicalBlock?.keys).toEqual([
      "R&D",
      "Sản xuất",
      "Tổng hợp Oligo",
      "KTCN",
      "QC/QA",
      "Cung ứng Kho",
    ]);
  });

  it("explicitly separates Commercial Warehouse/Procurement from Factory P-KHO", () => {
    expect(matchDepartment("Kho Vận", "Kinh Doanh")).toBe(true);
    expect(matchDepartment("Kho Nhà Máy", "Cung ứng Kho")).toBe(true);
    expect(matchDepartment("Kho Vận", "Cung ứng Kho")).toBe(false);
    expect(matchDepartment("Mua Hàng & Cung Ứng", "Cung ứng Kho")).toBe(false);

    const whMod = DEPARTMENT_MODULES.find((m) => m.key === "warehouse.view");
    const procMod = DEPARTMENT_MODULES.find((m) => m.key === "procurement.view");
    expect(whMod?.shortName).toContain("Kho Kinh Doanh");
    expect(procMod?.shortName).toContain("Cung Ứng Kinh Doanh");
    expect(DEPARTMENT_POSITIONS["Cung ứng Kho"].name).toContain("Kho Nhà Máy");
    expect(DEPARTMENT_POSITIONS["Cung ứng Kho"].code).toBe("P-KHO");
  });

  it("upgrades stale unversioned TBRs storage payloads while preserving custom positions and respecting v2 schema", () => {
    const staleTbrs = {
      "Ban Giám Đốc": {
        name: "Ban Giám Đốc",
        code: "BOD",
        desc: "Old TBRs",
        badgeColor: "",
        borderTheme: "",
        positions: [
          { title: "Tổng Giám Đốc / Giám Đốc Điều Hành (CEO)", defaultRole: "admin", level: "Director", desc: "TBRs" },
        ],
      },
      "Kinh Doanh": {
        name: "Phòng Kinh Doanh & Tiếp Thị (Sales & Marketing)",
        code: "SALES",
        desc: "Old TBRs Sales",
        badgeColor: "",
        borderTheme: "",
        positions: [
          { title: "Trưởng Phòng Kinh Doanh (Head of Sales)", defaultRole: "sales_head", level: "Manager", desc: "TBRs" },
          { title: "Chuyên viên Hỗ trợ Thầu KD", defaultRole: "sales_rep", level: "Specialist", desc: "Custom position" },
        ],
      },
      "Kho Vận": {
        name: "Bộ Phận Kho Vận & Chuỗi Lạnh (Warehouse & Logistics)",
        code: "WH",
        desc: "Old TBRs Warehouse",
        badgeColor: "",
        borderTheme: "",
        positions: [
          { title: "Trưởng Bộ Phận Kho Vận", defaultRole: "warehouse_lead", level: "Manager", desc: "TBRs" },
        ],
      },
    };

    const upgraded = mergeStoredDepartmentPositions(DEPARTMENT_POSITIONS, staleTbrs);

    expect(PRIMARY_DEPT_KEYS.every((k) => Boolean(upgraded[k]))).toBe(true);
    expect(upgraded["Ban Giám Đốc"].positions.some((p) => p.title === "Cố vấn cấp cao")).toBe(true);
    expect(upgraded["Ban Giám Đốc"].positions.some((p) => p.title.includes("(CEO)"))).toBe(false);
    expect(upgraded["Kinh Doanh"].positions.some((p) => p.title.includes("(Head of Sales)"))).toBe(false);
    expect(upgraded["Kinh Doanh"].positions.some((p) => p.title === "Chuyên viên Hỗ trợ Thầu KD")).toBe(true);
    expect(upgraded["KTCN"].positions.some((p) => p.title === "Nhân viên IT")).toBe(true);
    expect(upgraded["Cung ứng Kho"].code).toBe("P-KHO");
    expect(upgraded["Kho Vận"].code).toBe("SALES");

    const v2Stored = {
      _abtSchemaVersion: ABT_ORG_SCHEMA_VERSION,
      ...DEPARTMENT_POSITIONS,
      "R&D": {
        ...DEPARTMENT_POSITIONS["R&D"],
        positions: [
          { title: "R&D Custom Lead", defaultRole: "rd_head", level: "Manager", desc: "Edited in v2" },
        ],
      },
    };
    const v2Merged = mergeStoredDepartmentPositions(DEPARTMENT_POSITIONS, v2Stored);
    expect("_abtSchemaVersion" in v2Merged).toBe(false);
    expect(v2Merged["R&D"].positions).toHaveLength(1);
    expect(v2Merged["R&D"].positions[0].title).toBe("R&D Custom Lead");
  });
});
