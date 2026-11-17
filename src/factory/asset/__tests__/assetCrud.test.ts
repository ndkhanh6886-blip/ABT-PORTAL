import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthzActor } from "../../core/authz";
import { closeFactoryPool, getFactoryPool, withTransaction } from "../../core/db";
import { migrate } from "../../db/migrate";
import { createOrgUnit, createUser, grant } from "../../__tests__/helpers";
import "../../modules";
import { createAsset, deleteAsset, updateAsset } from "../service";
import { createProject, listProjects } from "../../rd/projects";

const PIN = "482910";

describe("Asset Full Edit / Safe Delete & Independent Software vs R&D Gates", () => {
  let rdDept: string;
  let kitDept: string;
  let deviceDept: string;
  let manager: AuthzActor;

  beforeAll(async () => {
    await migrate(getFactoryPool());

    rdDept = await createOrgUnit("RD-AST");
    kitDept = await createOrgUnit("KIT-AST");
    deviceDept = await createOrgUnit("DEV-AST");

    manager = await createUser("Quản lý Thiết bị & Dự án", PIN);
    await grant(
      manager,
      ["asset.view", "asset.manage", "rd.view", "rd.project.manage"],
      null
    );
  });

  afterAll(closeFactoryPool);

  it("1. Updates asset code, type, location, calibration due date and safely deletes unused asset", async () => {
    const created = await withTransaction((tx) =>
      createAsset(tx, manager, {
        name: "Máy PCR Ban đầu",
        asset_type: "PCR",
        owner_org_unit_id: rdDept,
        model: "CFX-96",
        serial_no: "SN-TEST-001",
        next_calibration_due: "2027-06-30",
      })
    );

    const newCode = `EQ-CUSTOM-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    await withTransaction((tx) =>
      updateAsset(tx, manager, created.id, {
        code: newCode,
        name: "Máy Real-time PCR Đã Cập Nhật",
        asset_type: "SPECTROPHOTOMETER",
        owner_org_unit_id: kitDept,
        location: "Phòng Pha chế MasterMix (ISO 7)",
        equipment_category: "Quang phổ",
        model: "CFX-96 Touch v2",
        next_calibration_due: "2027-12-31",
        reason: "Điều chỉnh mã máy, vị trí phòng và gia hạn hiệu chuẩn",
      })
    );

    const pool = getFactoryPool();
    const row = (await pool.query("SELECT * FROM asset.asset WHERE id = $1", [created.id])).rows[0];
    expect(row.code).toBe(newCode);
    expect(row.name).toBe("Máy Real-time PCR Đã Cập Nhật");
    expect(row.asset_type).toBe("SPECTROPHOTOMETER");
    expect(row.owner_org_unit_id).toBe(kitDept);
    expect(row.location).toBe("Phòng Pha chế MasterMix (ISO 7)");

    // Add a PLANNED maintenance event (no immutable history yet) -> deleteAsset cascades cleanly
    await pool.query(
      `INSERT INTO asset.event (code, asset_id, kind, status, planned_date, description)
       VALUES ($1, $2, 'MAINTENANCE', 'PLANNED', current_date + 7, 'Kế hoạch bảo trì nháp')`,
      [`AE-PLAN-${Math.random().toString(36).slice(2, 8).toUpperCase()}`, created.id]
    );

    const res = await withTransaction((tx) =>
      deleteAsset(tx, manager, created.id, { reason: "Khai báo nhầm khi kiểm thử danh mục" })
    );
    expect(res.deleted).toBe(true);

    const after = await pool.query("SELECT 1 FROM asset.asset WHERE id = $1", [created.id]);
    expect(after.rowCount).toBe(0);
  });

  it("2. Blocks permanent deletion with CONFLICT when asset has immutable calibration/production history", async () => {
    const asset = await withTransaction((tx) =>
      createAsset(tx, manager, {
        name: "Tủ âm sâu Kiểm nghiệm Chuẩn",
        asset_type: "FREEZER",
        owner_org_unit_id: rdDept,
        serial_no: "SN-HIST-002",
      })
    );

    await getFactoryPool().query(
      `INSERT INTO asset.event (code, asset_id, kind, status, planned_date, done_date, performed_by, result, passed)
       VALUES ($1, $2, 'CALIBRATION', 'DONE', current_date, current_date, 'Kỹ sư Thiết bị KTCN', 'Đạt chuẩn hiệu chuẩn ISO 13485', true)`,
      [`AE-DONE-${Math.random().toString(36).slice(2, 8).toUpperCase()}`, asset.id]
    );

    await expect(
      withTransaction((tx) =>
        deleteAsset(tx, manager, asset.id, { reason: "Thử xóa thiết bị đã hiệu chuẩn" })
      )
    ).rejects.toThrow(/ISO 13485/i);
  });

  it("3. Isolates Software projects (IEC 62304) from R&D Stage-Gate project queries", async () => {
    const kitProj = await withTransaction((tx) =>
      createProject(tx, manager, {
        name: "Đề tài Kit Chuẩn Tổng Quát Độc Lập R&D",
        owner_org_unit_id: rdDept,
        project_type: "NEW_PRODUCT",
        target_domain: "KIT",
      })
    );

    const swProj = await withTransaction((tx) =>
      createProject(tx, manager, {
        name: "Phần mềm Phân tích Tín hiệu Quang học KTCN",
        owner_org_unit_id: deviceDept,
        project_type: "NEW_PRODUCT",
        target_domain: "SOFTWARE",
      })
    );

    const rdList = await withTransaction((tx) => listProjects(tx, manager, { excludeDomain: "SOFTWARE" }));
    expect(rdList.some((p: any) => p.id === kitProj.id)).toBe(true);
    expect(rdList.some((p: any) => p.id === swProj.id)).toBe(false);

    const swList = await withTransaction((tx) => listProjects(tx, manager, { domain: "SOFTWARE" }));
    expect(swList.some((p: any) => p.id === swProj.id)).toBe(true);
    expect(swList.some((p: any) => p.id === kitProj.id)).toBe(false);
  });
});
