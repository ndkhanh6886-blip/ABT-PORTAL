import { describe, expect, it } from "vitest";
import { canonicalDepartment, inferSystemRoleFromPosition, isDepartmentLeaderPosition } from "../permissions";
import { inferFactoryModuleFromDept, inferFactoryRoleCode } from "@/factory/orgSync";

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
