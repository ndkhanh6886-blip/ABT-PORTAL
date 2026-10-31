import { afterAll, describe, expect, it } from "vitest";
import { createUser, grant } from "../../__tests__/helpers";
import type { AuthzActor } from "../../core/authz";
import { closeFactoryPool, getFactoryPool, withTransaction } from "../../core/db";
import { preAuthenticate, runTransition, type MachineDef, type TransitionRequest } from "../../core/stateMachine";
import { createAsset } from "../../asset/service";
import { makeItem, makeSite, stockedLot, type Site } from "../../inv/__tests__/fixtures";
import {
  addBomLine,
  addKitPackaging,
  addRoutingStep,
  bomMachine,
  createBom,
  createRouting,
  getBomDetail,
  getRoutingDetail,
  routingMachine,
} from "../bomRouting";
import {
  createProductionOrder,
  getProductionOrderDetail,
  issueOrderMaterials,
  printOrderLabel,
  productionOrderMachine,
  productionStepMachine,
  updateMaterialActuals,
  updateOrderDates,
} from "../ordersEbr";
import {
  createRetainSample,
  createReworkOrder,
  createStabilityStudy,
  recordStabilityTimepoint,
  retainSampleMachine,
  reworkOrderMachine,
  stabilityStudyMachine,
  traceKitLotGenealogy,
} from "../qualityTrace";
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

async function setupKitTeam(site: Site) {
  const operator = await createUser("KTV Sản xuất Kit", PIN);
  await grant(
    operator,
    [
      "kit.view",
      "kit.bom.manage",
      "kit.order.manage",
      "kit.ebr.execute",
      "kit.rework.manage",
      "kit.quality.manage",
      "inv.stock.view",
      "master.data.view",
    ],
    site.dept
  );

  const checker = await createUser("Tổ trưởng Kiểm tra chéo Kit", PIN);
  await grant(
    checker,
    [
      "kit.view",
      "kit.bom.manage",
      "kit.bom.approve",
      "kit.order.manage",
      "kit.ebr.execute",
      "kit.ebr.check",
      "kit.rework.manage",
      "kit.quality.manage",
      "qms.qc.analyze",
      "qms.qc.review",
    ],
    site.dept
  );
  await grant(checker, ["qms.qc.analyze", "qms.qc.review"], null);

  const qa = await createUser("QA Giải phóng Lô Kit", PIN);
  await grant(
    qa,
    ["kit.view", "kit.bom.approve", "kit.order.release", "qms.qc.view", "qms.qc.review", "qms.ncr.approve"],
    null
  );

  return { operator, checker, qa };
}

describe("Phase 4b — Module Phòng Sản xuất Kit (kit schema)", () => {
  it("1. Quản lý phiên bản BOM nhiều tầng, quy cách Bộ → Hộp → Ống và Routing (chặn tự duyệt & tự động thay thế bản cũ)", async () => {
    const site = await makeSite();
    const { operator, checker } = await setupKitTeam(site);

    const kitItem = await makeItem(site, {
      code: `KIT-HBV-${Date.now().toString(36).slice(-4).toUpperCase()}`,
      item_type: "FINISHED_KIT",
      base_uom: "pcs",
      shelf_life_days: 365,
    });
    const mmItem = await makeItem(site, {
      code: `SEMI-MM-${Date.now().toString(36).slice(-4).toUpperCase()}`,
      item_type: "SEMI_FINISHED",
      base_uom: "µL",
    });
    const primerItem = await makeItem(site, {
      code: `OLG-PRM-${Date.now().toString(36).slice(-4).toUpperCase()}`,
      item_type: "SEMI_FINISHED",
      base_uom: "µL",
    });

    const bom1 = await withTransaction((tx) =>
      createBom(tx, operator, {
        org_unit_id: site.dept,
        product_item_id: kitItem.id,
        name: "BOM Kit Real-time PCR HBV v1",
        tests_per_kit: 50,
        shelf_life_days: 365,
      })
    );

    // Submitting an empty BOM must fail EMPTY_BOM guard
    await expect(act(bomMachine, operator, bom1.id, "submit_review")).rejects.toMatchObject({
      code: "GUARD_FAILED",
      details: [{ code: "EMPTY_BOM" }],
    });

    await withTransaction(async (tx) => {
      await addBomLine(tx, operator, {
        bom_id: bom1.id,
        component_item_id: mmItem.id,
        qty_per_base: 1.5,
        uom: "µL",
        scrap_pct: 0,
        box_no: 1,
        component_role: "MASTER_MIX",
      });
      await addBomLine(tx, operator, {
        bom_id: bom1.id,
        component_item_id: primerItem.id,
        qty_per_base: 200,
        uom: "µL",
        scrap_pct: 0,
        box_no: 2,
        component_role: "PRIMER_PROBE",
      });
      await addKitPackaging(tx, operator, {
        bom_id: bom1.id,
        box_no: 1,
        box_name: "Hộp 1: Hóa chất khuếch đại",
        component_name: "Ống Master Mix 2X",
        container_type: "TUBE_1_5ML",
        fill_qty: 750,
        fill_uom: "µL",
        units_per_kit: 2,
        storage_temp: "-20°C",
      });
    });

    await act(bomMachine, operator, bom1.id, "submit_review");

    // Self-approval by author must fail SELF_APPROVAL guard
    await grant(operator, ["kit.bom.approve"], site.dept);
    await expect(act(bomMachine, operator, bom1.id, "approve", signed)).rejects.toMatchObject({
      code: "GUARD_FAILED",
      details: [{ code: "SELF_APPROVAL" }],
    });

    // Independent approver activates BOM v1 -> EFFECTIVE
    const eff1 = await act(bomMachine, checker, bom1.id, "approve", signed);
    expect(eff1.status).toBe("EFFECTIVE");

    // Clone BOM v2 and activate -> v1 automatically becomes OBSOLETE
    const bom2 = await withTransaction((tx) =>
      createBom(tx, operator, {
        org_unit_id: site.dept,
        product_item_id: kitItem.id,
        name: "BOM Kit Real-time PCR HBV v2",
        tests_per_kit: 50,
        shelf_life_days: 365,
        clone_from_bom_id: bom1.id,
      })
    );
    expect(bom2.bom_version).toBe(2);
    await act(bomMachine, operator, bom2.id, "submit_review");
    const eff2 = await act(bomMachine, checker, bom2.id, "approve", signed);
    expect(eff2.status).toBe("EFFECTIVE");

    const oldBomDetail = await withTransaction((tx) => getBomDetail(tx, checker, bom1.id));
    expect(oldBomDetail.bom.status).toBe("OBSOLETE");

    // Create Routing v1 and activate
    const rt = await withTransaction((tx) =>
      createRouting(tx, operator, {
        org_unit_id: site.dept,
        product_item_id: kitItem.id,
        name: "Quy trình pha chế & đóng gói Kit HBV",
      })
    );
    await withTransaction((tx) =>
      addRoutingStep(tx, operator, {
        routing_id: rt.id,
        seq: 10,
        step_code: "STEP-10",
        step_name: "Pha chế Master Mix",
        category: "FORMULATION",
        instructions: "Phối trộn trên đá lạnh.",
        requires_check_signature: true,
        param_schema: [{ key: "temp_c", label: "Nhiệt độ", type: "number", unit: "°C", min: 2, max: 8, required: true }],
      })
    );
    await act(routingMachine, operator, rt.id, "submit_review");
    const rtEff = await act(routingMachine, checker, rt.id, "approve", signed);
    expect(rtEff.status).toBe("EFFECTIVE");
    const rtDetail = await withTransaction((tx) => getRoutingDetail(tx, checker, rt.id));
    expect(rtDetail.steps.length).toBe(1);
  });

  it("2. Lệnh sản xuất Kit: giữ chỗ FEFO, khóa HSD khi in nhãn, tuần tự EBR, kiểm tra hiệu chuẩn thiết bị, tự sinh Deviation & chữ ký kép", async () => {
    const site = await makeSite();
    const { operator, checker } = await setupKitTeam(site);

    const kitItem = await makeItem(site, {
      code: `KIT-DEN-${Date.now().toString(36).slice(-4).toUpperCase()}`,
      item_type: "FINISHED_KIT",
      base_uom: "pcs",
      shelf_life_days: 365,
    });
    const mmItem = await makeItem(site, {
      code: `MM-DEN-${Date.now().toString(36).slice(-4).toUpperCase()}`,
      item_type: "SEMI_FINISHED",
      base_uom: "µL",
    });

    // Stock two lots with different expiry dates to verify FEFO selection
    const laterLot = await stockedLot(site, mmItem.id, 100, "2027-12-31");
    const soonerLot = await stockedLot(site, mmItem.id, 100, "2027-03-15");

    // Create a calibrated asset and an overdue asset
    await grant(site.admin, ["asset.manage", "asset.view"], site.dept);
    const overdueAsset = await withTransaction((tx) =>
      createAsset(tx, site.admin, {
        name: "Tủ an toàn sinh học quá hạn",
        asset_type: "OTHER",
        owner_org_unit_id: site.dept,
        next_calibration_due: "2020-01-01",
      })
    );
    const goodAsset = await withTransaction((tx) =>
      createAsset(tx, site.admin, {
        name: "Máy PCR định lượng chuẩn",
        asset_type: "PCR",
        owner_org_unit_id: site.dept,
        next_calibration_due: "2028-12-31",
      })
    );

    const bom = await withTransaction(async (tx) => {
      const b = await createBom(tx, operator, {
        org_unit_id: site.dept,
        product_item_id: kitItem.id,
        name: "BOM Kit Dengue",
        tests_per_kit: 50,
        shelf_life_days: 180,
      });
      await addBomLine(tx, operator, {
        bom_id: b.id,
        component_item_id: mmItem.id,
        qty_per_base: 2,
        uom: "µL",
        box_no: 1,
        component_role: "MASTER_MIX",
      });
      return b;
    });
    await act(bomMachine, operator, bom.id, "submit_review");
    await act(bomMachine, checker, bom.id, "approve", signed);

    const rt = await withTransaction(async (tx) => {
      const r = await createRouting(tx, operator, {
        org_unit_id: site.dept,
        product_item_id: kitItem.id,
        name: "Routing Kit Dengue",
      });
      await addRoutingStep(tx, operator, {
        routing_id: r.id,
        seq: 10,
        step_code: "S10",
        step_name: "Pha chế & Chiết rót",
        category: "FILLING",
        instructions: "Chiết rót 2 mL vào ống.",
        required_asset_id: goodAsset.id,
        requires_check_signature: true,
        param_schema: [
          { key: "fill_vol", label: "Thể tích nạp", type: "number", unit: "mL", min: 1.95, max: 2.05, required: true },
        ],
      });
      await addRoutingStep(tx, operator, {
        routing_id: r.id,
        seq: 20,
        step_code: "S20",
        step_name: "Kiểm tra QC bán thành phẩm",
        category: "QC",
        instructions: "Đo Ct chứng dương.",
        is_qc: true,
        requires_check_signature: false,
        param_schema: [
          { key: "ct_val", label: "Giá trị Ct", type: "number", unit: "cycle", min: 20, max: 28, required: true },
        ],
      });
      return r;
    });
    await act(routingMachine, operator, rt.id, "submit_review");
    await act(routingMachine, checker, rt.id, "approve", signed);

    const order = await withTransaction((tx) =>
      createProductionOrder(tx, operator, {
        org_unit_id: site.dept,
        product_item_id: kitItem.id,
        warehouse_id: site.warehouse,
        planned_qty: 10,
        mfg_date: "2026-10-01",
      })
    );

    const confirmed = await act(productionOrderMachine, operator, order.id, "confirm");
    expect(confirmed.status).toBe("CONFIRMED");

    const detail1 = await withTransaction((tx) => getProductionOrderDetail(tx, operator, order.id));
    expect(detail1.order.lot_id).toBeTruthy();
    expect(String(detail1.order.lot_code)).toMatch(/^K\d{4}\d{3}$/);
    // Verify FEFO picked soonerLot (2027-03-15) instead of laterLot (2027-12-31)
    expect(detail1.consumptions.length).toBe(1);
    expect(detail1.consumptions[0].lot_id).toBe(soonerLot.id);
    expect(laterLot.id).not.toBe(soonerLot.id);

    // Print label -> locks mfg_date and expiry_date
    await withTransaction((tx) => printOrderLabel(tx, operator, order.id));
    await expect(
      withTransaction((tx) => updateOrderDates(tx, operator, order.id, { mfg_date: "2026-10-15" }))
    ).rejects.toMatchObject({ code: "LABEL_ALREADY_PRINTED" });

    const [step1, step2] = detail1.steps;

    // Starting step 1 before issuing materials must fail MATERIALS_NOT_ISSUED
    await expect(act(productionStepMachine, operator, step1.id, "start")).rejects.toMatchObject({
      code: "GUARD_FAILED",
      details: [{ code: "MATERIALS_NOT_ISSUED" }],
    });

    await withTransaction((tx) => issueOrderMaterials(tx, operator, order.id));

    // Starting step 2 before step 1 is DONE must fail PREV_STEP_INCOMPLETE
    await expect(act(productionStepMachine, operator, step2.id, "start")).rejects.toMatchObject({
      code: "GUARD_FAILED",
      details: [{ code: "PREV_STEP_INCOMPLETE" }],
    });

    // Starting step 1 with an overdue calibration asset must fail ASSET_CALIBRATION_DUE
    await expect(
      act(productionStepMachine, operator, step1.id, "start", { payload: { asset_id: overdueAsset.id } })
    ).rejects.toMatchObject({ code: "ASSET_CALIBRATION_DUE" });

    // Start step 1 with valid asset
    await act(productionStepMachine, operator, step1.id, "start");

    // Complete step 1 with out-of-range value (2.20 > 2.05) -> auto-creates a QMS Deviation
    const s1Wait = await act(productionStepMachine, operator, step1.id, "complete_for_check", {
      ...signed,
      payload: { param_values: { fill_vol: 2.2 } },
    });
    expect(s1Wait.status).toBe("AWAITING_CHECK");

    // Self-check by performer must fail SELF_CHECK
    await grant(operator, ["kit.ebr.check"], site.dept);
    await expect(act(productionStepMachine, operator, step1.id, "check", signed)).rejects.toMatchObject({
      code: "GUARD_FAILED",
      details: [{ code: "SELF_CHECK" }],
    });

    // Independent checker signs CHECKED
    const s1Done = await act(productionStepMachine, checker, step1.id, "check", signed);
    expect(s1Done.status).toBe("DONE");

    // Step 2 is a QC step (`is_qc = true`): operator without QC permission cannot complete it
    await act(productionStepMachine, operator, step2.id, "start");
    await expect(
      act(productionStepMachine, operator, step2.id, "complete", {
        ...signed,
        payload: { param_values: { ct_val: 24.5 } },
      })
    ).rejects.toMatchObject({ code: "GUARD_FAILED", details: [{ code: "QC_ROLE_REQUIRED" }] });

    // Checker (who has qms.qc.analyze) completes step 2 -> order automatically advances to PENDING_QC
    await act(productionStepMachine, checker, step2.id, "complete", {
      ...signed,
      payload: { param_values: { ct_val: 24.5 } },
    });

    const detailAfterEbr = await withTransaction((tx) => getProductionOrderDetail(tx, operator, order.id));
    expect(detailAfterEbr.order.status).toBe("PENDING_QC");
    expect(detailAfterEbr.steps[0].deviation_id).toBeTruthy();
  });

  it("3. Quyết toán tiêu hao vật tư (> 5% bắt buộc giải trình), tách nhiệm vụ QA Release, nhập kho TP, cấp COA bất biến & truy xuất phả hệ 2 chiều", async () => {
    const site = await makeSite();
    const { operator, checker, qa } = await setupKitTeam(site);

    const kitItem = await makeItem(site, {
      code: `KIT-COV-${Date.now().toString(36).slice(-4).toUpperCase()}`,
      item_type: "FINISHED_KIT",
      base_uom: "pcs",
      shelf_life_days: 365,
    });
    const enzymeItem = await makeItem(site, {
      code: `ENZ-RT-${Date.now().toString(36).slice(-4).toUpperCase()}`,
      item_type: "REAGENT",
      base_uom: "µL",
    });
    const enzymeLot = await stockedLot(site, enzymeItem.id, 5000, "2027-09-30");

    const bom = await withTransaction(async (tx) => {
      const b = await createBom(tx, operator, {
        org_unit_id: site.dept,
        product_item_id: kitItem.id,
        name: "BOM Kit SARS-CoV-2",
      });
      await addBomLine(tx, operator, {
        bom_id: b.id,
        component_item_id: enzymeItem.id,
        qty_per_base: 100,
        uom: "µL",
        box_no: 1,
        component_role: "ENZYME",
      });
      return b;
    });
    await act(bomMachine, operator, bom.id, "submit_review");
    await act(bomMachine, checker, bom.id, "approve", signed);

    const rt = await withTransaction(async (tx) => {
      const r = await createRouting(tx, operator, {
        org_unit_id: site.dept,
        product_item_id: kitItem.id,
        name: "Routing Kit SARS-CoV-2",
      });
      await addRoutingStep(tx, operator, {
        routing_id: r.id,
        seq: 10,
        step_code: "S10",
        step_name: "Đóng gói Kit",
        category: "PACKAGING",
        instructions: "Đóng hộp & dán tem.",
        requires_check_signature: false,
      });
      return r;
    });
    await act(routingMachine, operator, rt.id, "submit_review");
    await act(routingMachine, checker, rt.id, "approve", signed);

    const order = await withTransaction((tx) =>
      createProductionOrder(tx, operator, {
        org_unit_id: site.dept,
        product_item_id: kitItem.id,
        warehouse_id: site.warehouse,
        planned_qty: 10,
      })
    );
    await act(productionOrderMachine, operator, order.id, "confirm");
    await withTransaction((tx) => issueOrderMaterials(tx, operator, order.id));

    const detail0 = await withTransaction((tx) => getProductionOrderDetail(tx, operator, order.id));
    await act(productionStepMachine, operator, detail0.steps[0].id, "start");
    await act(productionStepMachine, operator, detail0.steps[0].id, "complete", signed);

    await act(productionOrderMachine, operator, order.id, "pass_qc", {
      payload: { good_qty: 10, scrap_qty: 0, qc_summary: "Đạt 100% chỉ tiêu QC" },
    });

    // Record 12% variance (planned 1000 UL, actual 1120 UL) WITHOUT reason -> must block release
    await withTransaction((tx) =>
      updateMaterialActuals(tx, operator, order.id, {
        consumption_id: detail0.consumptions[0].id,
        actual_qty: 1120,
        returned_qty: 0,
        variance_reason: "",
      })
    );

    await expect(act(productionOrderMachine, qa, order.id, "release", signed)).rejects.toMatchObject({
      code: "GUARD_FAILED",
      details: [{ code: "RECONCILIATION_VARIANCE" }],
    });

    // Provide variance reason
    await withTransaction((tx) =>
      updateMaterialActuals(tx, operator, order.id, {
        consumption_id: detail0.consumptions[0].id,
        actual_qty: 1120,
        returned_qty: 0,
        variance_reason: "Hao hụt đầu côn pipette tự động đã hiệu chuẩn",
      })
    );

    // Self-release by operator who performed step 1 must fail SELF_RELEASE
    await grant(operator, ["kit.order.release"], site.dept);
    await expect(act(productionOrderMachine, operator, order.id, "release", signed)).rejects.toMatchObject({
      code: "GUARD_FAILED",
      details: [{ code: "SELF_RELEASE" }],
    });

    // Independent QA releases the order
    const released = await act(productionOrderMachine, qa, order.id, "release", signed);
    expect(released.status).toBe("COMPLETED");

    const finalDetail = await withTransaction((tx) => getProductionOrderDetail(tx, qa, order.id));
    expect(finalDetail.order.lot_status).toBe("RELEASED");
    expect(finalDetail.coa).toBeTruthy();

    // COA is append-only (attempting UPDATE must fail trigger)
    await expect(
      getFactoryPool().query("UPDATE kit.coa_certificate SET good_qty = 999 WHERE id = $1", [finalDetail.coa.id])
    ).rejects.toThrow();

    // Verify finished Kit stock balance increased by 10 KIT
    const bal = (
      await getFactoryPool().query("SELECT qty_on_hand FROM inv.stock_balance WHERE lot_id = $1", [
        finalDetail.order.lot_id,
      ])
    ).rows[0];
    expect(Number(bal.qty_on_hand)).toBe(10);

    // Verify 2-way lot genealogy traceability
    const traceFromKit = await withTransaction((tx) => traceKitLotGenealogy(tx, qa, finalDetail.order.lot_id!));
    expect(traceFromKit.upstream_parents.length).toBe(1);
    expect(traceFromKit.upstream_parents[0].parent_lot_id).toBe(enzymeLot.id);

    const traceFromRaw = await withTransaction((tx) => traceKitLotGenealogy(tx, qa, enzymeLot.id));
    expect(traceFromRaw.downstream_children.length).toBe(1);
    expect(traceFromRaw.downstream_children[0].child_lot_id).toBe(finalDetail.order.lot_id);
  });

  it("4. Không đạt QC → Treo lô & Mở NCR, Làm lại một phần (Partial Rework Hộp 2) cấp bù lô mới vào phả hệ, Mẫu lưu & Độ ổn định", async () => {
    const site = await makeSite();
    const { operator, checker, qa } = await setupKitTeam(site);

    const kitItem = await makeItem(site, {
      code: `KIT-MTB-${Date.now().toString(36).slice(-4).toUpperCase()}`,
      item_type: "FINISHED_KIT",
      base_uom: "pcs",
    });
    const box1Item = await makeItem(site, {
      code: `MM-MTB-${Date.now().toString(36).slice(-4).toUpperCase()}`,
      item_type: "SEMI_FINISHED",
      base_uom: "µL",
    });
    const box2CtrlItem = await makeItem(site, {
      code: `CTRL-MTB-${Date.now().toString(36).slice(-4).toUpperCase()}`,
      item_type: "SEMI_FINISHED",
      base_uom: "µL",
    });

    await stockedLot(site, box1Item.id, 500, "2027-06-30");
    await stockedLot(site, box2CtrlItem.id, 500, "2027-05-01");

    const bom = await withTransaction(async (tx) => {
      const b = await createBom(tx, operator, {
        org_unit_id: site.dept,
        product_item_id: kitItem.id,
        name: "BOM Kit MTB 2 Hộp",
      });
      await addBomLine(tx, operator, {
        bom_id: b.id,
        component_item_id: box1Item.id,
        qty_per_base: 1,
        uom: "µL",
        box_no: 1,
        component_role: "MASTER_MIX",
      });
      await addBomLine(tx, operator, {
        bom_id: b.id,
        component_item_id: box2CtrlItem.id,
        qty_per_base: 50,
        uom: "µL",
        box_no: 2,
        component_role: "POSITIVE_CONTROL",
      });
      return b;
    });
    await act(bomMachine, operator, bom.id, "submit_review");
    await act(bomMachine, checker, bom.id, "approve", signed);

    const rt = await withTransaction(async (tx) => {
      const r = await createRouting(tx, operator, {
        org_unit_id: site.dept,
        product_item_id: kitItem.id,
        name: "Routing Kit MTB",
      });
      await addRoutingStep(tx, operator, {
        routing_id: r.id,
        seq: 10,
        step_code: "S10",
        step_name: "Đóng gói Hộp 1 & Hộp 2",
        category: "PACKAGING",
        instructions: "Đóng gói 2 hộp thành phần.",
      });
      return r;
    });
    await act(routingMachine, operator, rt.id, "submit_review");
    await act(routingMachine, checker, rt.id, "approve", signed);

    const order = await withTransaction((tx) =>
      createProductionOrder(tx, operator, {
        org_unit_id: site.dept,
        product_item_id: kitItem.id,
        warehouse_id: site.warehouse,
        planned_qty: 5,
      })
    );
    await act(productionOrderMachine, operator, order.id, "confirm");
    await withTransaction((tx) => issueOrderMaterials(tx, operator, order.id));

    const d0 = await withTransaction((tx) => getProductionOrderDetail(tx, operator, order.id));
    await act(productionStepMachine, operator, d0.steps[0].id, "start");
    await act(productionStepMachine, operator, d0.steps[0].id, "complete", signed);

    // Fail QC -> Order transitions to ON_HOLD and auto-creates NCR
    const held = await act(productionOrderMachine, operator, order.id, "fail_qc", {
      reason: "Chứng dương trong Hộp 2 tín hiệu yếu",
    });
    expect(held.status).toBe("ON_HOLD");

    // Stock a fresh replacement lot for Box 2 Positive Control and execute Partial Rework on Box 2
    const replacementCtrlLot = await stockedLot(site, box2CtrlItem.id, 500, "2027-04-01");

    const rw = await withTransaction((tx) =>
      createReworkOrder(tx, operator, {
        org_unit_id: site.dept,
        production_order_id: order.id,
        scope: "PARTIAL",
        box_no: 2,
        component_item_id: box2CtrlItem.id,
        qty_to_rework: 250,
        uom: "µL",
        warehouse_id: site.warehouse,
        instructions: "Thay thế ống Chứng dương mới trong Hộp 2 cho 5 bộ Kit",
      })
    );
    await act(reworkOrderMachine, checker, rw.id, "approve", signed);
    await act(reworkOrderMachine, operator, rw.id, "start");
    const rwDone = await act(reworkOrderMachine, operator, rw.id, "complete", signed);
    expect(rwDone.status).toBe("COMPLETED");

    // Parent order automatically returned to PENDING_QC; now pass QC and release
    const dAfterRw = await withTransaction((tx) => getProductionOrderDetail(tx, operator, order.id));
    expect(dAfterRw.order.status).toBe("PENDING_QC");

    await act(productionOrderMachine, operator, order.id, "pass_qc", {
      payload: { good_qty: 5, scrap_qty: 0, qc_summary: "Đạt QC sau khi thay thế Hộp 2" },
    });
    await act(productionOrderMachine, qa, order.id, "release", signed);

    // Genealogy of the Kit lot includes BOTH initial lots AND the replacement lot from the Partial Rework
    const trace = await withTransaction((tx) => traceKitLotGenealogy(tx, qa, dAfterRw.order.lot_id!));
    const parentLotIds = trace.upstream_parents.map((p: any) => p.parent_lot_id);
    expect(parentLotIds).toContain(replacementCtrlLot.id);

    // Retain Sample & Stability Study
    const retain = await withTransaction((tx) =>
      createRetainSample(tx, operator, {
        org_unit_id: site.dept,
        lot_id: dAfterRw.order.lot_id,
        production_order_id: order.id,
        qty: 2,
        uom: "pcs",
        storage_condition: "-20°C",
      })
    );
    const inspected = await act(retainSampleMachine, operator, retain.id, "inspect", {
      payload: { inspection_note: "Bao bì nguyên vẹn sau 3 tháng" },
    });
    expect(inspected.status).toBe("INSPECTED");

    const study = await withTransaction((tx) =>
      createStabilityStudy(tx, operator, {
        org_unit_id: site.dept,
        lot_id: dAfterRw.order.lot_id,
        study_type: "REAL_TIME",
        protocol_ref: "STB-MTB-001",
      })
    );
    const tps = (
      await getFactoryPool().query("SELECT * FROM kit.stability_timepoint WHERE study_id = $1 ORDER BY month_mark", [
        study.id,
      ])
    ).rows;
    expect(tps.length).toBe(5);

    const tp0 = await withTransaction((tx) =>
      recordStabilityTimepoint(tx, operator, study.id, {
        timepoint_id: tps[0].id,
        result: "PASS",
        summary: "Ct = 25.1, đạt chuẩn T0",
      })
    );
    expect(tp0.result).toBe("PASS");

    const stDone = await act(stabilityStudyMachine, checker, study.id, "complete", signed);
    expect(stDone.status).toBe("COMPLETED");
  });
});
