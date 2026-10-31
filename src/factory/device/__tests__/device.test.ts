import { afterAll, describe, expect, it } from "vitest";
import { createUser, grant } from "../../__tests__/helpers";
import type { AuthzActor } from "../../core/authz";
import { closeFactoryPool, getFactoryPool, withTransaction } from "../../core/db";
import { preAuthenticate, runTransition, type MachineDef, type TransitionRequest } from "../../core/stateMachine";
import { makeItem, makeSite, stockedLot, type Site } from "../../inv/__tests__/fixtures";
import { createPartner } from "../../master/service";
import {
  addModelBomLine,
  createDeviceModel,
  createEcoRequest,
  createModelRevision,
  ecoMachine,
  modelRevisionMachine,
  updateEcoImpact,
} from "../models";
import {
  createDeviceOrder,
  deviceOrderMachine,
  deviceUnitMachine,
  getDeviceOrderDetail,
  getDeviceUnitDetail,
  installUnitComponent,
  recordBurnInRun,
  recordUnitFqcResult,
} from "../assembly";
import {
  createSubcontractOrder,
  createSubcontractPart,
  createVendorEvaluation,
  receiveSubcontractLine,
  subcontractOrderMachine,
} from "../subcontract";
import {
  createServiceTicket,
  evaluateComplaintCapa,
  replaceTicketComponent,
  serviceTicketMachine,
} from "../serviceTickets";
import {
  advanceDeviceRdGate,
  convertPoToWorkOrder,
  createDevicePoOrder,
  createDeviceRdProject,
  createSubcontractFromPo,
  issueWorkOrderBomKitting,
  listDevicePoOrdersWithMrp,
  progressWorkOrderStage,
  proposePrFromPoShortage,
  transferDeviceRdToProduction,
} from "../workflow";
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

async function setupDeviceTeam(site: Site) {
  const engineer = await createUser("Kỹ sư KT-CN", PIN);
  await grant(
    engineer,
    [
      "device.view",
      "device.model.manage",
      "device.eco.propose",
      "device.order.manage",
      "device.assembly.execute",
      "device.subcontract.manage",
      "device.service.manage",
      "work.plan.submit",
      "inv.stock.view",
      "master.data.view",
    ],
    site.dept
  );

  const lead = await createUser("Trưởng phòng KT-CN", PIN);
  await grant(
    lead,
    [
      "device.view",
      "device.model.manage",
      "device.eco.propose",
      "device.eco.approve",
      "device.order.manage",
      "device.assembly.execute",
      "device.subcontract.manage",
      "device.service.manage",
      "work.plan.submit",
      "work.plan.approve",
      "inv.stock.view",
      "master.data.view",
    ],
    site.dept
  );

  const qaReleaser = await createUser("QA Giải phóng Thiết bị", PIN);
  await grant(qaReleaser, ["device.view", "device.unit.release", "device.eco.approve", "qms.qc.view"], site.dept);

  return { engineer, lead, qaReleaser };
}

describe("Phase 4c — Module Phòng Kỹ thuật – Công nghệ / Thiết bị (device schema)", () => {
  it("1. DMR Model Revision & Engineering Change Order (ECO) with 5-dimension impact guard and atomic revision switch", async () => {
    const site = await makeSite();
    const { engineer, lead } = await setupDeviceTeam(site);

    const housingItem = await makeItem(site, { name: "Khối nhôm tản nhiệt CNC 48 giếng", item_type: "COMPONENT", base_uom: "pcs" });
    const pcbItem = await makeItem(site, { name: "Bo mạch điều khiển Peltier", item_type: "COMPONENT", base_uom: "pcs" });

    const model = await withTransaction((tx) =>
      createDeviceModel(tx, engineer, {
        org_unit_id: site.dept,
        name: "Máy Real-time PCR 48 giếng ABT-Cycler",
        category: "THERMAL_CYCLER",
        warranty_months: 12,
        required_burn_in_hours: 48,
      })
    );
    expect(model.status).toBe("DEVELOPMENT");

    const revA = await withTransaction((tx) =>
      createModelRevision(tx, engineer, {
        model_id: model.id,
        revision: "A",
        firmware_version: "v1.0.0",
        dmr_summary: "Hồ sơ thiết kế gốc DMR phiên bản thương mại đầu tiên Rev A",
      })
    );
    expect(revA.status).toBe("DRAFT");

    await withTransaction(async (tx) => {
      await addModelBomLine(tx, engineer, {
        revision_id: revA.id,
        station_code: "STATION_1_MECH",
        component_item_id: housingItem.id,
        qty_per_unit: 1,
        uom: "pcs",
        is_critical: true,
        requires_serial: false,
      });
      await addModelBomLine(tx, engineer, {
        revision_id: revA.id,
        station_code: "STATION_2_PCB",
        component_item_id: pcbItem.id,
        qty_per_unit: 1,
        uom: "pcs",
        is_critical: true,
        requires_serial: true,
      });
    });

    // Release Rev A (signed by department lead) -> model becomes COMMERCIAL and current_revision_id = revA.id
    const revAReleased = await act(modelRevisionMachine, lead, revA.id, "release", {
      ...signed,
      reason: "Ban hành DMR Rev A đưa vào sản xuất",
    });
    expect(revAReleased.status).toBe("RELEASED");

    const modelAfterA = (
      await getFactoryPool().query("SELECT status, current_revision_id FROM device.device_model WHERE id = $1", [model.id])
    ).rows[0];
    expect(modelAfterA.status).toBe("COMMERCIAL");
    expect(modelAfterA.current_revision_id).toBe(revA.id);

    // Propose ECO for Rev B
    const eco = await withTransaction((tx) =>
      createEcoRequest(tx, engineer, {
        model_id: model.id,
        target_revision: "B",
        title: "Nâng cấp thuật toán PID điều khiển nhiệt Firmware v1.1.0",
        reason: "Giảm độ vọt lố nhiệt độ tại 95°C xuống dưới 0.15°C",
        change_summary: "Cập nhật hằng số Kp/Ki/Kd trong Firmware v1.1.0",
      })
    );
    expect(eco.status).toBe("DRAFT");

    const ecoImpact = await act(ecoMachine, engineer, eco.id, "start_impact");
    expect(ecoImpact.status).toBe("IMPACT_ASSESSMENT");

    // Submitting approval before filling all 5 impact assessment fields must fail with IMPACT_INCOMPLETE
    await expect(act(ecoMachine, engineer, eco.id, "submit_approval")).rejects.toMatchObject({
      code: "GUARD_FAILED",
      details: expect.arrayContaining([expect.objectContaining({ code: "IMPACT_INCOMPLETE" })]),
    });

    await withTransaction((tx) =>
      updateEcoImpact(tx, engineer, eco.id, {
        impact_documents: "Cập nhật DMR Rev B và SOP nạp Firmware Trạm 3",
        impact_training: "Đào tạo kỹ thuật viên Trạm 3 về quy trình nạp v1.1.0",
        impact_stock: "Không hủy tồn kho bo mạch hiện tại, chỉ nạp lại Firmware",
        impact_open_orders: "Áp dụng cho các lệnh lắp ráp mới từ ngày ban hành",
        impact_regulatory: "Thay đổi phần mềm mức cải tiến hiệu năng, lưu hồ sơ DHF/DMR",
      })
    );

    const ecoPending = await act(ecoMachine, engineer, eco.id, "submit_approval");
    expect(ecoPending.status).toBe("PENDING_APPROVAL");

    // Proposer cannot self-approve ECO (even if granted approve permission)
    await grant(engineer, ["device.eco.approve"], site.dept);
    await expect(act(ecoMachine, engineer, eco.id, "approve", signed)).rejects.toMatchObject({
      code: "GUARD_FAILED",
      details: expect.arrayContaining([expect.objectContaining({ code: "SELF_APPROVAL" })]),
    });

    // Department lead signs approval on ECO
    const ecoApproved = await act(ecoMachine, lead, eco.id, "approve", signed);
    expect(ecoApproved.status).toBe("APPROVED");

    // Create draft Rev B cloned from Rev A
    const revB = await withTransaction((tx) =>
      createModelRevision(tx, engineer, {
        model_id: model.id,
        revision: "B",
        firmware_version: "v1.1.0",
        dmr_summary: "Phiên bản DMR Rev B theo ECO nâng cấp Firmware v1.1.0",
        eco_request_id: eco.id,
        clone_from_revision_id: revA.id,
      })
    );
    expect(revB.status).toBe("DRAFT");

    // Implement ECO -> atomically releases Rev B, obsoletes Rev A, and updates current_revision_id
    const ecoImpl = await act(ecoMachine, lead, eco.id, "implement");
    expect(ecoImpl.status).toBe("IMPLEMENTED");

    const revAStatus = (await getFactoryPool().query("SELECT status FROM device.model_revision WHERE id = $1", [revA.id])).rows[0].status;
    const revBStatus = (await getFactoryPool().query("SELECT status FROM device.model_revision WHERE id = $1", [revB.id])).rows[0].status;
    const modelAfterB = (
      await getFactoryPool().query("SELECT current_revision_id FROM device.device_model WHERE id = $1", [model.id])
    ).rows[0];
    expect(revAStatus).toBe("OBSOLETE");
    expect(revBStatus).toBe("RELEASED");
    expect(modelAfterB.current_revision_id).toBe(revB.id);

    // Close ECO with verification note
    const ecoClosed = await act(ecoMachine, lead, eco.id, "close", {
      payload: { verification_note: "Đã kiểm tra 2 máy đầu tiên chạy Rev B đạt chuẩn ổn định nhiệt" },
    });
    expect(ecoClosed.status).toBe("CLOSED");
  });

  it("2. Device Order, Serial Assignment, 4-Station DHR Component Installation, 48h Burn-in, FQC NCR & QA Release", async () => {
    const site = await makeSite();
    const { engineer, lead, qaReleaser } = await setupDeviceTeam(site);

    const housingItem = await makeItem(site, { name: "Khung vỏ nhôm CNC", item_type: "COMPONENT", base_uom: "pcs" });
    const pcbItem = await makeItem(site, { name: "Bo mạch điều khiển chính", item_type: "COMPONENT", base_uom: "pcs" });
    await stockedLot(site, housingItem.id, 20, "2028-12-31", { uom: "pcs" });
    await stockedLot(site, pcbItem.id, 20, "2028-12-31", { uom: "pcs" });

    const model = await withTransaction((tx) =>
      createDeviceModel(tx, engineer, {
        org_unit_id: site.dept,
        code: "CYCLER96",
        name: "Máy PCR 96 giếng",
        category: "THERMAL_CYCLER",
        warranty_months: 12,
        required_burn_in_hours: 48,
      })
    );

    const revA = await withTransaction((tx) =>
      createModelRevision(tx, engineer, {
        model_id: model.id,
        revision: "A",
        firmware_version: "v2.0.0",
        dmr_summary: "DMR Rev A cho máy PCR 96 giếng",
      })
    );

    const { lineMech, linePcb } = await withTransaction(async (tx) => {
      const l1 = await addModelBomLine(tx, engineer, {
        revision_id: revA.id,
        station_code: "STATION_1_MECH",
        component_item_id: housingItem.id,
        qty_per_unit: 1,
        uom: "pcs",
        is_critical: true,
        requires_serial: false,
      });
      const l2 = await addModelBomLine(tx, engineer, {
        revision_id: revA.id,
        station_code: "STATION_2_PCB",
        component_item_id: pcbItem.id,
        qty_per_unit: 1,
        uom: "pcs",
        is_critical: true,
        requires_serial: true,
      });
      return { lineMech: l1, linePcb: l2 };
    });

    await act(modelRevisionMachine, lead, revA.id, "release", signed);

    // Create Device Order for 2 machines
    const order = await withTransaction((tx) =>
      createDeviceOrder(tx, engineer, {
        org_unit_id: site.dept,
        model_id: model.id,
        warehouse_id: site.warehouse,
        qty: 2,
      })
    );
    expect(order.status).toBe("RECEIVED");

    await act(deviceOrderMachine, lead, order.id, "approve", signed);
    const prodOrder = await act(deviceOrderMachine, engineer, order.id, "assign_serials");
    expect(prodOrder.status).toBe("IN_PRODUCTION");

    const orderDetail = await withTransaction((tx) => getDeviceOrderDetail(tx, engineer, order.id));
    expect(orderDetail.units).toHaveLength(2);
    const u1 = orderDetail.units[0];
    expect(u1.serial_no).toMatch(/^CYCLER96-\d{6}$/);
    expect(u1.status).toBe("IN_ASSEMBLY");

    // Station 1: Install mechanical housing
    await withTransaction((tx) =>
      installUnitComponent(tx, engineer, u1.id, {
        bom_line_id: lineMech.id,
      })
    );

    // Station 2: Installing PCB without serial must fail because requires_serial = true
    await expect(
      withTransaction((tx) =>
        installUnitComponent(tx, engineer, u1.id, {
          bom_line_id: linePcb.id,
        })
      )
    ).rejects.toMatchObject({
      code: "COMPONENT_SERIAL_REQUIRED",
    });

    // Install PCB with component_serial
    await withTransaction((tx) =>
      installUnitComponent(tx, engineer, u1.id, {
        bom_line_id: linePcb.id,
        component_serial: "PCB-SN-2026-001",
      })
    );

    // Verify warehouse stock was deducted (20 -> 19)
    const pcbBalance = (
      await getFactoryPool().query("SELECT SUM(qty_on_hand)::numeric AS qty FROM inv.stock_balance WHERE item_id = $1", [
        pcbItem.id,
      ])
    ).rows[0];
    expect(Number(pcbBalance.qty)).toBe(19);

    // Advance unit 1 to BURN_IN
    const u1Burn = await act(deviceUnitMachine, engineer, u1.id, "start_burn_in", {
      payload: { firmware_version: "v2.0.0" },
    });
    expect(u1Burn.status).toBe("BURN_IN");

    // Record a 24h burn-in run -> advancing to FQC must fail because 48h is required
    await withTransaction((tx) =>
      recordBurnInRun(tx, engineer, u1.id, {
        hours: 24,
        max_temp_c: 95,
        result: "PASS",
        notes: "Chạy thử 24h chưa đủ thời gian lão hóa",
      })
    );

    await expect(act(deviceUnitMachine, engineer, u1.id, "to_fqc")).rejects.toMatchObject({
      code: "GUARD_FAILED",
      details: expect.arrayContaining([expect.objectContaining({ code: "BURN_IN_NOT_PASSED" })]),
    });

    // Record full 48h PASS burn-in run -> advance to FQC
    await withTransaction((tx) =>
      recordBurnInRun(tx, engineer, u1.id, {
        hours: 48,
        max_temp_c: 95.2,
        cycles_completed: 96,
        result: "PASS",
        notes: "Đạt 48h lão hóa liên tục",
      })
    );

    const u1Fqc = await act(deviceUnitMachine, engineer, u1.id, "to_fqc");
    expect(u1Fqc.status).toBe("FQC");

    // Record FQC FAIL -> automatically returns unit to IN_ASSEMBLY and opens QMS Deviation + NCR
    const u1Failed = await withTransaction((tx) =>
      recordUnitFqcResult(tx, engineer, u1.id, {
        passed: false,
        summary: "Lệch kênh quang FAM tại giếng A1",
      })
    );
    expect(u1Failed.status).toBe("IN_ASSEMBLY");

    const ncrCheck = await getFactoryPool().query("SELECT * FROM qms.ncr WHERE entity_type = 'DEVICE_UNIT' AND entity_id = $1", [
      u1.id,
    ]);
    expect(ncrCheck.rowCount).toBe(1);

    // Re-advance through BURN_IN -> FQC and record FQC PASS
    await act(deviceUnitMachine, engineer, u1.id, "start_burn_in");
    await act(deviceUnitMachine, engineer, u1.id, "to_fqc");
    const u1PassedFqc = await withTransaction((tx) =>
      recordUnitFqcResult(tx, engineer, u1.id, {
        passed: true,
        summary: "Đã hiệu chuẩn lại kênh quang FAM đạt chuẩn xuất xưởng",
      })
    );
    expect(u1PassedFqc.fqc_passed).toBe(true);

    // Installer (engineer) cannot QA-release their own unit even if granted device.unit.release (SELF_RELEASE guard)
    await grant(engineer, ["device.unit.release"], site.dept);
    await expect(act(deviceUnitMachine, engineer, u1.id, "qa_pass", signed)).rejects.toMatchObject({
      code: "GUARD_FAILED",
      details: expect.arrayContaining([expect.objectContaining({ code: "SELF_RELEASE" })]),
    });

    // Independent QA signs qa_pass
    const u1QaPassed = await act(deviceUnitMachine, qaReleaser, u1.id, "qa_pass", signed);
    expect(u1QaPassed.status).toBe("QA_PASSED");

    // Deliver unit 1 to customer -> sets warranty_start/warranty_end and creates 6-month preventive maintenance schedule
    const u1Delivered = await act(deviceUnitMachine, engineer, u1.id, "deliver", {
      payload: { customer_name: "Viện Pasteur TP.HCM" },
    });
    expect(u1Delivered.status).toBe("DELIVERED");
    expect(u1Delivered.warranty_start).toBeTruthy();

    const unitDetail = await withTransaction((tx) => getDeviceUnitDetail(tx, engineer, u1.id));
    expect(unitDetail.warranty_end).toBeTruthy();
    expect(unitDetail.components).toHaveLength(2);

    const sched = (await getFactoryPool().query("SELECT * FROM device.service_schedule WHERE unit_id = $1", [u1.id])).rows;
    expect(sched).toHaveLength(1);
    expect(sched[0].interval_months).toBe(6);
  });

  it("3. Subcontract Order, Dimensional IQC (zero stock on rework, receipt on accepted, NCR on rejected) & Vendor Evaluation Tiering", async () => {
    const site = await makeSite();
    const { engineer, lead } = await setupDeviceTeam(site);

    const blockItem = await makeItem(site, { name: "Khối nhôm CNC Anodize", item_type: "COMPONENT", base_uom: "pcs" });
    const vendor = await withTransaction((tx) =>
      createPartner(tx, site.admin, {
        name: "Công ty Cơ khí Chính xác Á Châu",
        tax_code: `010${Math.floor(1000000 + Math.random() * 8999999)}`,
        is_supplier: true,
        is_subcontractor: true,
      })
    );

    const part = await withTransaction((tx) =>
      createSubcontractPart(tx, engineer, {
        org_unit_id: site.dept,
        name: "Khối nhiệt nhôm 6061-T6 48 giếng",
        item_id: blockItem.id,
        vendor_id: vendor.id,
        material: "Nhôm 6061-T6",
        process_type: "CNC",
        tolerance_standard: "ISO 2768-mK (±0.02mm)",
      })
    );

    const subOrder = await withTransaction((tx) =>
      createSubcontractOrder(tx, engineer, {
        org_unit_id: site.dept,
        vendor_id: vendor.id,
        warehouse_id: site.warehouse,
        issue_now: true,
        lines: [{ part_id: part.id, qty_ordered: 10, unit_price: 550000 }],
      })
    );
    expect(subOrder.status).toBe("ISSUED");

    const lineId = (await getFactoryPool().query("SELECT id FROM device.subcontract_line WHERE order_id = $1", [subOrder.id])).rows[0]
      .id;

    // Batch 1: qty_accepted = 0, qty_rework = 4 -> must NOT post any stock to warehouse
    const afterRework = await withTransaction((tx) =>
      receiveSubcontractLine(tx, engineer, subOrder.id, {
        line_id: lineId,
        qty_accepted: 0,
        qty_rework: 4,
        qty_rejected: 0,
        iqc_dimension_note: "4 phôi lệch dung sai lỗ ốc 0.08mm, trả NCC phay lại",
      })
    );
    expect(afterRework.lines[0].stock_document_id).toBeNull();
    expect(afterRework.lines[0].ncr_id).toBeNull();

    const stockAfterRework = (
      await getFactoryPool().query(
        "SELECT COALESCE(SUM(qty_on_hand), 0)::numeric AS qty FROM inv.stock_balance WHERE item_id = $1",
        [blockItem.id]
      )
    ).rows[0];
    expect(Number(stockAfterRework.qty)).toBe(0);

    // Batch 2: qty_accepted = 8, qty_rejected = 2 -> posts RECEIPT for 8 units and auto-creates NCR for 2 rejected units
    const afterAccept = await withTransaction((tx) =>
      receiveSubcontractLine(tx, engineer, subOrder.id, {
        line_id: lineId,
        qty_accepted: 8,
        qty_rework: 0,
        qty_rejected: 2,
        iqc_dimension_note: "8 chi tiết đạt chuẩn bản vẽ, 2 chi tiết xước bề mặt anodize loại bỏ",
      })
    );
    expect(afterAccept.status).toBe("RECEIVED");
    expect(afterAccept.lines[0].stock_document_id).toBeTruthy();
    expect(afterAccept.lines[0].ncr_id).toBeTruthy();

    const stockAfterAccept = (
      await getFactoryPool().query(
        "SELECT COALESCE(SUM(qty_on_hand), 0)::numeric AS qty FROM inv.stock_balance WHERE item_id = $1",
        [blockItem.id]
      )
    ).rows[0];
    expect(Number(stockAfterAccept.qty)).toBe(8);

    const closedOrder = await act(subcontractOrderMachine, lead, subOrder.id, "close");
    expect(closedOrder.status).toBe("CLOSED");

    // Vendor Evaluation: Tier A (>= 4.5) and Tier D (< 2.5)
    const evalA = await withTransaction((tx) =>
      createVendorEvaluation(tx, lead, {
        org_unit_id: site.dept,
        vendor_id: vendor.id,
        linked_order_id: subOrder.id,
        quality_score: 4.8,
        delivery_score: 4.6,
        cost_score: 4.4,
        service_score: 4.5,
      })
    );
    expect(evalA.tier).toBe("A");
    expect(Number(evalA.weighted_score)).toBeCloseTo(4.63, 2);

    const evalD = await withTransaction((tx) =>
      createVendorEvaluation(tx, lead, {
        org_unit_id: site.dept,
        vendor_id: vendor.id,
        quality_score: 2.0,
        delivery_score: 2.2,
        cost_score: 2.5,
        service_score: 2.0,
      })
    );
    expect(evalD.tier).toBe("D");
  });

  it("4. Field Service Tickets, Warranty Auto-Detection, DHR Spare Part Replacement & Complaint CAPA Guard", async () => {
    const site = await makeSite();
    const { engineer, lead, qaReleaser } = await setupDeviceTeam(site);

    const pcbItem = await makeItem(site, { name: "Bo mạch công suất Peltier", item_type: "COMPONENT", base_uom: "pcs" });
    await stockedLot(site, pcbItem.id, 10, "2028-12-31", { uom: "pcs" });

    // Prepare a delivered unit with active warranty
    const model = await withTransaction((tx) =>
      createDeviceModel(tx, engineer, {
        org_unit_id: site.dept,
        name: "Máy Tách chiết DNA/RNA tự động 32 mẫu",
        category: "EXTRACTOR",
        warranty_months: 12,
        required_burn_in_hours: 1,
      })
    );
    const rev = await withTransaction(async (tx) => {
      const r = await createModelRevision(tx, engineer, {
        model_id: model.id,
        revision: "A",
        firmware_version: "v1.0.0",
        dmr_summary: "DMR Rev A Máy tách chiết 32 mẫu",
      });
      await addModelBomLine(tx, engineer, {
        revision_id: r.id,
        station_code: "STATION_2_PCB",
        component_item_id: pcbItem.id,
        qty_per_unit: 1,
        uom: "pcs",
        is_critical: true,
        requires_serial: false,
      });
      return r;
    });
    await act(modelRevisionMachine, lead, rev.id, "release", signed);

    const order = await withTransaction((tx) =>
      createDeviceOrder(tx, engineer, {
        org_unit_id: site.dept,
        model_id: model.id,
        warehouse_id: site.warehouse,
        qty: 1,
      })
    );
    await act(deviceOrderMachine, lead, order.id, "approve", signed);
    await act(deviceOrderMachine, engineer, order.id, "assign_serials");

    const od = await withTransaction((tx) => getDeviceOrderDetail(tx, engineer, order.id));
    const unit = od.units[0];
    await withTransaction((tx) =>
      installUnitComponent(tx, engineer, unit.id, {
        bom_line_id: od.bom_lines[0].id,
      })
    );
    await act(deviceUnitMachine, engineer, unit.id, "start_burn_in");
    await withTransaction((tx) =>
      recordBurnInRun(tx, engineer, unit.id, {
        hours: 2,
        result: "PASS",
      })
    );
    await act(deviceUnitMachine, engineer, unit.id, "to_fqc");
    await withTransaction((tx) =>
      recordUnitFqcResult(tx, engineer, unit.id, {
        passed: true,
        summary: "FQC đạt",
      })
    );
    await act(deviceUnitMachine, qaReleaser, unit.id, "qa_pass", signed);
    await act(deviceUnitMachine, engineer, unit.id, "deliver", {
      payload: { customer_name: "Bệnh viện Chợ Rẫy" },
    });

    // 4.1 Warranty ticket auto-detects active warranty and forces service_cost = 0
    const warrTicket = await withTransaction((tx) =>
      createServiceTicket(tx, engineer, {
        org_unit_id: site.dept,
        unit_id: unit.id,
        ticket_type: "WARRANTY",
        symptom: "Cần hiệu chuẩn lại cảm biến nhiệt trong thời gian bảo hành",
        service_cost: 3000000,
      })
    );
    expect(warrTicket.is_warranty).toBe(true);
    expect(Number(warrTicket.service_cost)).toBe(0);

    // 4.2 Complaint ticket workflow + DHR spare part replacement + CAPA guard
    const compTicket = await withTransaction((tx) =>
      createServiceTicket(tx, engineer, {
        org_unit_id: site.dept,
        unit_id: unit.id,
        ticket_type: "COMPLAINT",
        symptom: "Máy báo lỗi E04 bo mạch điều khiển Peltier sau 200 chu kỳ",
      })
    );
    expect(compTicket.status).toBe("OPEN");

    const diagnosing = await act(serviceTicketMachine, engineer, compTicket.id, "diagnose");
    expect(diagnosing.status).toBe("DIAGNOSING");

    const unitUnderService = (await getFactoryPool().query("SELECT status FROM device.device_unit WHERE id = $1", [unit.id])).rows[0];
    expect(unitUnderService.status).toBe("UNDER_SERVICE");

    const inRepair = await act(serviceTicketMachine, engineer, compTicket.id, "start_repair", {
      payload: { diagnosis: "Chập MOSFET kênh Peltier số 2" },
    });
    expect(inRepair.status).toBe("IN_REPAIR");

    // Issue replacement PCB from warehouse -> appends row with is_replacement = true into unit's DHR
    const replaced = await withTransaction((tx) =>
      replaceTicketComponent(tx, engineer, compTicket.id, {
        warehouse_id: site.warehouse,
        item_id: pcbItem.id,
        qty: 1,
        uom: "pcs",
        component_serial: "PCB-REP-2026-99",
      })
    );
    expect(replaced).toHaveLength(1);
    expect(replaced[0].is_replacement).toBe(true);
    expect(replaced[0].component_serial).toBe("PCB-REP-2026-99");

    const resolved = await act(serviceTicketMachine, engineer, compTicket.id, "resolve", {
      payload: { resolution: "Đã thay bo mạch công suất mới PCB-REP-2026-99 và chạy thử 10 chu kỳ đạt" },
    });
    expect(resolved.status).toBe("RESOLVED");

    // Attempting to close a COMPLAINT ticket before CAPA evaluation must fail with CAPA_EVAL_REQUIRED
    await expect(act(serviceTicketMachine, lead, compTicket.id, "close", signed)).rejects.toMatchObject({
      code: "GUARD_FAILED",
      details: expect.arrayContaining([expect.objectContaining({ code: "CAPA_EVAL_REQUIRED" })]),
    });

    // Evaluate CAPA -> auto-creates QMS deviation when capa_required = true
    const capaEval = await withTransaction((tx) =>
      evaluateComplaintCapa(tx, lead, compTicket.id, {
        capa_required: true,
        root_cause: "Lô MOSFET từ nhà cung cấp chịu dòng xung thấp",
        corrective_action: "Mở CAPA kiểm tra 100% lô bo mạch cùng đợt",
        notes: "Bắt buộc mở CAPA theo ISO 13485 §8.2.2",
      })
    );
    expect(capaEval.capa_evaluated).toBe(true);
    expect(capaEval.deviation_id).toBeTruthy();

    // Now closing the COMPLAINT ticket succeeds and transitions the unit back to IN_SERVICE_FIELD
    const closed = await act(serviceTicketMachine, lead, compTicket.id, "close", signed);
    expect(closed.status).toBe("CLOSED");

    const unitBackInField = (await getFactoryPool().query("SELECT status FROM device.device_unit WHERE id = $1", [unit.id])).rows[0];
    expect(unitBackInField.status).toBe("IN_SERVICE_FIELD");
  });

  it("5. End-to-End Device Lifecycle: R&D 5-Gate -> Production Transfer -> PO & MRP Shortage -> PR + Subcontract + WO -> BOM Kitting -> Delivery", async () => {
    const site = await makeSite();
    const { engineer, lead, qaReleaser } = await setupDeviceTeam(site);

    const buyPart = await makeItem(site, { name: "Bộ nguồn 24VDC MeanWell", item_type: "COMPONENT", base_uom: "pcs" });
    const subPart = await makeItem(site, { name: "Vỏ máy chấn tôn sơn tĩnh điện CNC", item_type: "COMPONENT", base_uom: "pcs" });
    // Stock only 2 units of each so a 4-unit PO triggers shortage = 2
    await stockedLot(site, buyPart.id, 2, "2028-12-31", { uom: "pcs" });
    await stockedLot(site, subPart.id, 2, "2028-12-31", { uom: "pcs" });

    // 5.1 Create New Device R&D Project with 4-station BOM lines
    const rdRes = await withTransaction((tx) =>
      createDeviceRdProject(tx, engineer, {
        org_unit_id: site.dept,
        project_mode: "NEW_PRODUCT",
        model_code: "SPIN16",
        model_name: "Máy ly tâm mini 16 ống ABT Spin-16",
        category: "CENTRIFUGE",
        revision_code: "A",
        firmware_version: "v1.0.0-SPIN16",
        required_burn_in_hours: 24,
        warranty_months: 12,
        title: "Nghiên cứu & Chế tạo Máy ly tâm mini 16 ống ABT Spin-16",
        objective: "Chế tạo máy ly tâm mini 16 ống phục vụ bộ Kit tách chiết",
        bom_lines: [
          {
            station_code: "STATION_1_MECH",
            component_item_id: subPart.id,
            qty_per_unit: 1,
            uom: "pcs",
            source_type: "SUBCONTRACT",
            tracking_type: "LOT",
            drawing_code: "DWG-SPIN16-01",
            is_critical: true,
            requires_serial: false,
          },
          {
            station_code: "STATION_2_PCB",
            component_item_id: buyPart.id,
            qty_per_unit: 1,
            uom: "pcs",
            source_type: "BUY",
            tracking_type: "LOT",
            drawing_code: "SPEC-PSU-24V",
            is_critical: true,
            requires_serial: false,
          },
        ],
      })
    );
    expect(rdRes.project_id).toBeTruthy();

    // Advance Gates 1, 2, 3, 4 and Transfer to Production at Gate 5
    for (const gateNo of [1, 2, 3, 4]) {
      await withTransaction((tx) => advanceDeviceRdGate(tx, lead, rdRes.project_id, gateNo, `Pass G${gateNo}`));
    }
    const transferRes = await withTransaction((tx) =>
      transferDeviceRdToProduction(tx, lead, rdRes.project_id, "Nghiệm thu G5 ban hành sản xuất thương mại")
    );
    expect(transferRes.status).toBe("TRANSFERRED");

    // 5.2 Create Device PO for 4 units of SPIN16 -> Check MRP Shortage
    const poRes = await withTransaction((tx) =>
      createDevicePoOrder(tx, engineer, {
        org_unit_id: site.dept,
        po_code: "PO-TEST-SPIN16-01",
        customer_name: "Bệnh viện Đại học Y Dược",
        model_id: rdRes.model_id,
        qty: 4,
      })
    );
    expect(poRes.code).toBe("PO-TEST-SPIN16-01");

    const poList = await withTransaction((tx) => listDevicePoOrdersWithMrp(tx, engineer));
    const ourPo = poList.find((p) => p.id === poRes.po_id);
    expect(ourPo).toBeTruthy();
    expect(ourPo!.lines[0].mrp_lines).toHaveLength(2);
    expect(ourPo!.lines[0].mrp_lines.every((m: any) => m.shortage === 2)).toBe(true);

    // 5.3 Propose PR for missing components from PO
    const prRes = await withTransaction((tx) => proposePrFromPoShortage(tx, engineer, poRes.po_id));
    expect(prRes.pr_code).toMatch(/^PR/);
    expect(prRes.line_count).toBeGreaterThanOrEqual(1);

    // 5.4 Create Subcontract Order from PO for SUBCONTRACT parts
    const subRes = await withTransaction((tx) => createSubcontractFromPo(tx, engineer, poRes.po_id));
    expect(subRes.subcontract_order_code).toMatch(/^(SCO|SUB|OPO)/);

    // 5.5 Convert PO -> Work Order (for 2 units that we have stock for)
    const woRes = await withTransaction((tx) =>
      convertPoToWorkOrder(tx, engineer, poRes.po_id, {
        qty: 2,
      })
    );
    expect(woRes.work_order_code).toMatch(/^(DO|DVO|WO)/);
    expect(woRes.unit_count).toBe(2);

    // 5.6 Issue BOM Kitting FEFO/FIFO on the Work Order
    const kittingRes = await withTransaction((tx) => issueWorkOrderBomKitting(tx, engineer, woRes.work_order_id));
    expect(kittingRes.installed_count).toBe(4); // 2 units * 2 BOM lines

    // 5.7 Progress Work Order through Burn-in -> FQC -> QA Release -> Delivery
    await withTransaction((tx) => progressWorkOrderStage(tx, engineer, woRes.work_order_id, "complete_burn_in_to_fqc"));
    await withTransaction((tx) => progressWorkOrderStage(tx, qaReleaser, woRes.work_order_id, "fqc_pass_and_qa_release"));
    const delivRes = await withTransaction((tx) =>
      progressWorkOrderStage(tx, engineer, woRes.work_order_id, "deliver_order", "Bệnh viện Đại học Y Dược")
    );
    expect(delivRes.stage_action).toBe("deliver_order");

    const finalOrder = await withTransaction((tx) => getDeviceOrderDetail(tx, engineer, woRes.work_order_id));
    expect(finalOrder.status).toBe("DELIVERED");
    expect(finalOrder.units.every((u: any) => u.status === "DELIVERED")).toBe(true);
  });
});
