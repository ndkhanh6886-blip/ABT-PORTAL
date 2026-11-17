import { afterAll, describe, expect, it } from "vitest";
import { createUser, grant } from "../../__tests__/helpers";
import type { AuthzActor } from "../../core/authz";
import { closeFactoryPool, getFactoryPool, withTransaction } from "../../core/db";
import { preAuthenticate, runTransition, type MachineDef, type TransitionRequest } from "../../core/stateMachine";
import { makeItem, makeSite, stockedLot, type Site } from "../../inv/__tests__/fixtures";
import { createItem, updateItem } from "../../master/service";
import {
  addBomLine,
  addRoutingStep,
  bomMachine,
  createBom,
  createRouting,
  getBomDetail,
  routingMachine,
  updateBomHeader,
  updateBomLine,
} from "../bomRouting";
import {
  createProductionOrder,
  getProductionOrderDetail,
  productionOrderMachine,
  selectDraftMaterialLot,
} from "../ordersEbr";
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

async function setupKitActors(site: Site) {
  const operator = await createUser("KTV Sản xuất Kit", PIN);
  await grant(
    operator,
    [
      "kit.view",
      "kit.bom.manage",
      "kit.order.manage",
      "kit.ebr.execute",
      "inv.stock.view",
      "master.data.view",
      "master.item.manage",
    ],
    site.dept
  );

  const checker = await createUser("Tổ trưởng Kiểm tra Kit", PIN);
  await grant(
    checker,
    ["kit.view", "kit.bom.manage", "kit.bom.approve", "kit.order.manage"],
    site.dept
  );

  return { operator, checker };
}

describe("Kit BOM — Số lẻ Mẫu lưu QC & Đánh dấu Vật tư Có lưu kho / Lưu kho số nguyên", () => {
  it("1. Cho phép nhập & cập nhật qc_retention_qty dạng số lẻ (0.5) trên BOM nháp và BOM EFFECTIVE đã có Lệnh SX", async () => {
    const site = await makeSite();
    const { operator, checker } = await setupKitActors(site);
    const suffix = Date.now().toString(36).slice(-5).toUpperCase();

    const kitItem = await makeItem(site, {
      code: `KIT-M1-${suffix}`,
      name: "Kit Tách Chiết Tổng Hợp M1",
      item_type: "FINISHED_KIT",
      base_uom: "kit",
    });
    const bufferItem = await makeItem(site, {
      code: `BUF-M1-${suffix}`,
      name: "Dung dịch Đệm Ly Giải B1",
      item_type: "SEMI_FINISHED",
      base_uom: "mL",
    });
    await stockedLot(site, bufferItem.id, 5000, "2028-12-31", { uom: "mL" });

    const bom = await withTransaction(async (tx) => {
      const b = await createBom(tx, operator, {
        org_unit_id: site.dept,
        product_item_id: kitItem.id,
        name: "BOM Kit Tách Chiết Tổng Hợp M1",
        bom_category: "Tách chiết / Khác",
        tests_per_kit: 50,
        qc_retention_qty: 0.5,
      });
      await addBomLine(tx, operator, {
        bom_id: b.id,
        component_item_id: bufferItem.id,
        qty_per_base: 50,
        uom: "mL",
        box_no: 1,
        component_role: "EXTRACTION_BUFFER",
        scrap_pct: 0,
      });
      return b;
    });

    const rt = await withTransaction(async (tx) => {
      const r = await createRouting(tx, operator, {
        org_unit_id: site.dept,
        product_item_id: kitItem.id,
        routing_category: "Tách chiết / Khác",
        name: "Routing Đóng gói Kit M1",
      });
      await addRoutingStep(tx, operator, {
        routing_id: r.id,
        seq: 10,
        step_code: "S10",
        step_name: "Chiết rót & Đóng gói",
        category: "FILLING",
        instructions: "Chiết rót theo định mức BOM.",
      });
      return r;
    });

    await act(bomMachine, operator, bom.id, "submit_review");
    await act(bomMachine, checker, bom.id, "approve", signed);
    await act(routingMachine, operator, rt.id, "submit_review");
    await act(routingMachine, checker, rt.id, "approve", signed);

    const detail0 = await withTransaction((tx) => getBomDetail(tx, operator, bom.id));
    expect(Number(detail0.bom.qc_retention_qty)).toBeCloseTo(0.5, 6);

    // Phát hành & xác nhận một Lệnh SX thực tế dùng BOM EFFECTIVE này
    const order = await withTransaction((tx) =>
      createProductionOrder(tx, operator, {
        org_unit_id: site.dept,
        product_item_id: kitItem.id,
        bom_id: bom.id,
        routing_id: rt.id,
        warehouse_id: site.warehouse,
        planned_qty: 10,
      })
    );
    await act(productionOrderMachine, operator, order.id, "confirm");

    // Vẫn cho phép cập nhật Mẫu lưu QC bổ sung (VD: 0.5 -> 0.25) và thuộc tính lưu kho mà không bị chặn
    const updatedBom = await withTransaction((tx) =>
      updateBomHeader(tx, operator, bom.id, {
        qc_retention_qty: 0.25,
      })
    );
    expect(Number(updatedBom.qc_retention_qty)).toBeCloseTo(0.25, 6);

    const detail1 = await withTransaction((tx) => getBomDetail(tx, operator, bom.id));
    expect(Number(detail1.bom.qc_retention_qty)).toBeCloseTo(0.25, 6);
  });

  it("2. Nổ BOM & Giữ chỗ kho phân biệt rõ: Số lẻ / Lưu kho số nguyên (CEIL) / Không +Mẫu lưu / Không lưu kho", async () => {
    const site = await makeSite();
    const { operator, checker } = await setupKitActors(site);
    const suffix = (Date.now() + 7).toString(36).slice(-5).toUpperCase();

    const kitItem = await makeItem(site, {
      code: `KIT-M2-${suffix}`,
      name: "Kit Tách Chiết Tổng Hợp M2",
      item_type: "FINISHED_KIT",
      base_uom: "kit",
    });

    // 1. Dung dịch lỏng: Có lưu kho, Cho phép số lẻ, +Mẫu lưu QC
    const liquidItem = await makeItem(site, {
      code: `LIQ-${suffix}`,
      name: "Dung dịch Đệm Ly Giải B1",
      item_type: "SEMI_FINISHED",
      base_uom: "mL",
    });
    await stockedLot(site, liquidItem.id, 2000, "2028-12-31", { uom: "mL" });

    // 2. Chai nhựa chứa dung dịch: Có lưu kho, Lưu kho số nguyên, +Mẫu lưu QC
    const bottleItem = await makeItem(site, {
      code: `BTL-${suffix}`,
      name: "Chai Nhựa HDPE 50mL",
      item_type: "CONSUMABLE",
      base_uom: "pcs",
    });
    await stockedLot(site, bottleItem.id, 100, "2029-12-31", { uom: "pcs" });

    // 3. Vỏ hộp ngoài: Có lưu kho, Lưu kho số nguyên, KHÔNG +Mẫu lưu QC
    const boxItem = await makeItem(site, {
      code: `BOX-${suffix}`,
      name: "Vỏ Hộp Carton M1",
      item_type: "CONSUMABLE",
      base_uom: "box",
    });
    await stockedLot(site, boxItem.id, 100, "2029-12-31", { uom: "box" });

    // 4. Phiếu in tại chuyền (KHÔNG CẤP TỒN KHO): Không lưu kho -> không giữ chỗ / trừ tồn
    const sheetItem = await makeItem(site, {
      code: `SHT-${suffix}`,
      name: "Tờ Phiếu Kiểm Tra Nội Bộ",
      item_type: "CONSUMABLE",
      base_uom: "pcs",
      is_stocked: false,
      is_integer_uom: true,
    });

    const { bom, sheetLineId } = await withTransaction(async (tx) => {
      const b = await createBom(tx, operator, {
        org_unit_id: site.dept,
        product_item_id: kitItem.id,
        name: "BOM Kit M2 Số Lẻ & Lưu Kho Số Nguyên",
        bom_category: "Tách chiết / Khác",
        tests_per_kit: 50,
        qc_retention_qty: 0.5,
      });
      await addBomLine(tx, operator, {
        bom_id: b.id,
        component_item_id: liquidItem.id,
        qty_per_base: 50,
        uom: "mL",
        box_no: 1,
        component_role: "EXTRACTION_BUFFER",
        scrap_pct: 0,
        include_in_qc_retention: true,
        is_stocked: true,
        is_integer_qty: false,
      });
      await addBomLine(tx, operator, {
        bom_id: b.id,
        component_item_id: bottleItem.id,
        qty_per_base: 1,
        uom: "pcs",
        box_no: 1,
        component_role: "PACKAGING",
        scrap_pct: 0,
        include_in_qc_retention: true,
        is_stocked: true,
        is_integer_qty: true,
      });
      await addBomLine(tx, operator, {
        bom_id: b.id,
        component_item_id: boxItem.id,
        qty_per_base: 1,
        uom: "box",
        box_no: 1,
        component_role: "PACKAGING",
        scrap_pct: 0,
        include_in_qc_retention: false,
        is_stocked: true,
        is_integer_qty: true,
      });
      const sLine = await addBomLine(tx, operator, {
        bom_id: b.id,
        component_item_id: sheetItem.id,
        qty_per_base: 1,
        uom: "pcs",
        box_no: 1,
        component_role: "PACKAGING",
        scrap_pct: 0,
        include_in_qc_retention: true,
        is_stocked: false,
        is_integer_qty: true,
      });
      return { bom: b, sheetLineId: sLine.id };
    });

    const rt = await withTransaction(async (tx) => {
      const r = await createRouting(tx, operator, {
        org_unit_id: site.dept,
        product_item_id: kitItem.id,
        routing_category: "Tách chiết / Khác",
        name: "Routing Kit M2",
      });
      await addRoutingStep(tx, operator, {
        routing_id: r.id,
        seq: 10,
        step_code: "S10",
        step_name: "Pha chế & Đóng gói",
        category: "FILLING",
        instructions: "Thực hiện theo BOM.",
      });
      return r;
    });

    await act(bomMachine, operator, bom.id, "submit_review");
    await act(bomMachine, checker, bom.id, "approve", signed);
    await act(routingMachine, operator, rt.id, "submit_review");
    await act(routingMachine, checker, rt.id, "approve", signed);

    // Không truyền qc_retention_qty -> tự kế thừa 0.5 từ BOM
    const order = await withTransaction((tx) =>
      createProductionOrder(tx, operator, {
        org_unit_id: site.dept,
        product_item_id: kitItem.id,
        bom_id: bom.id,
        routing_id: rt.id,
        warehouse_id: site.warehouse,
        planned_qty: 10,
      })
    );

    expect(Number(order.qc_retention_qty)).toBeCloseTo(0.5, 6);

    // Chặn chọn lô cho dòng Không lưu kho trên bản nháp
    await expect(
      withTransaction((tx) =>
        selectDraftMaterialLot(tx, operator, order.id, {
          bom_line_id: sheetLineId,
          lot_id: null,
        })
      )
    ).rejects.toMatchObject({ status: 422 });

    const draftDetail = await withTransaction((tx) => getProductionOrderDetail(tx, operator, order.id));
    const liqExp = draftDetail.exploded_bom.find((x: any) => x.component_item_id === liquidItem.id)!;
    const btlExp = draftDetail.exploded_bom.find((x: any) => x.component_item_id === bottleItem.id)!;
    const boxExp = draftDetail.exploded_bom.find((x: any) => x.component_item_id === boxItem.id)!;
    const shtExp = draftDetail.exploded_bom.find((x: any) => x.component_item_id === sheetItem.id)!;
    expect(liqExp).toBeDefined();
    expect(btlExp).toBeDefined();
    expect(boxExp).toBeDefined();
    expect(shtExp).toBeDefined();

    expect(liqExp.required_qty).toBeCloseTo(525, 6); // 10.5 * 50 mL
    expect(liqExp.is_integer_qty).toBe(false);
    expect(liqExp.is_stocked).toBe(true);

    expect(btlExp.raw_qty).toBeCloseTo(10.5, 6);
    expect(btlExp.required_qty).toBe(11); // CEIL(10.5)
    expect(btlExp.is_integer_qty).toBe(true);
    expect(btlExp.include_in_qc_retention).toBe(true);

    expect(boxExp.required_qty).toBe(10); // Không +Mẫu lưu QC
    expect(boxExp.include_in_qc_retention).toBe(false);

    expect(shtExp.required_qty).toBe(11);
    expect(shtExp.is_stocked).toBe(false);

    // Xác nhận lệnh -> Chỉ 3 vật tư Có lưu kho được giữ chỗ FEFO, vật tư Không lưu kho KHÔNG lỗi tồn kho và KHÔNG sinh consumption
    const confirmed = await act(productionOrderMachine, operator, order.id, "confirm");
    expect(confirmed.status).toBe("CONFIRMED");

    const confDetail = await withTransaction((tx) => getProductionOrderDetail(tx, operator, order.id));
    expect(confDetail.consumptions.length).toBe(3);

    const liqCons = confDetail.consumptions.find((c: any) => c.item_id === liquidItem.id);
    const btlCons = confDetail.consumptions.find((c: any) => c.item_id === bottleItem.id);
    const boxCons = confDetail.consumptions.find((c: any) => c.item_id === boxItem.id);
    const shtCons = confDetail.consumptions.find((c: any) => c.item_id === sheetItem.id);

    expect(Number(liqCons.planned_qty)).toBeCloseTo(525, 6);
    expect(Number(btlCons.planned_qty)).toBe(11);
    expect(Number(boxCons.planned_qty)).toBe(10);
    expect(shtCons).toBeUndefined();
  });

  it("3. Kế thừa is_stocked & is_integer_uom từ Danh mục Vật tư (master.item) sang dòng BOM và bật/tắt 1 chạm qua updateBomLine", async () => {
    const site = await makeSite();
    const { operator } = await setupKitActors(site);
    const suffix = (Date.now() + 19).toString(36).slice(-5).toUpperCase();

    const kitItem = await makeItem(site, {
      code: `KIT-M3-${suffix}`,
      name: "Kit Tách Chiết M3",
      item_type: "FINISHED_KIT",
      base_uom: "kit",
    });

    const nonStockReagent = await withTransaction((tx) =>
      createItem(tx, operator, {
        code: `NS-${suffix}`,
        name: "Nhãn In Nội Bộ Tại Xưởng",
        item_type: "CONSUMABLE",
        base_uom: "pcs",
        is_stocked: false,
        receipt_qc_required: false,
      })
    );
    expect(nonStockReagent.is_stocked).toBe(false);
    expect(nonStockReagent.is_integer_uom).toBe(true); // Tự suy từ ĐVT 'pcs'

    const updItem = await withTransaction((tx) =>
      updateItem(tx, operator, nonStockReagent.id, {
        version: nonStockReagent.version,
        is_stocked: true,
        is_integer_uom: false,
        reason: "Kiểm thử cập nhật chế độ lưu kho",
      })
    );
    expect(updItem.is_stocked).toBe(true);
    expect(updItem.is_integer_uom).toBe(false);

    const customMlItem = await withTransaction((tx) =>
      createItem(tx, operator, {
        code: `ML-INT-${suffix}`,
        name: "Dung dịch Đóng Gói Theo Bình Nguyên",
        item_type: "REAGENT",
        base_uom: "mL",
        is_stocked: false,
        is_integer_uom: true,
        receipt_qc_required: false,
      })
    );
    expect(customMlItem.is_stocked).toBe(false);
    expect(customMlItem.is_integer_uom).toBe(true);

    const bom = await withTransaction(async (tx) => {
      const b = await createBom(tx, operator, {
        org_unit_id: site.dept,
        product_item_id: kitItem.id,
        name: "BOM Test Kế Thừa Master Item",
        tests_per_kit: 50,
      });
      const line = await addBomLine(tx, operator, {
        bom_id: b.id,
        component_item_id: updItem.id,
        qty_per_base: 2.5,
        uom: "pcs",
        component_role: "REAGENT",
      });
      expect(line.is_stocked).toBe(true);

      const inheritedLine = await addBomLine(tx, operator, {
        bom_id: b.id,
        component_item_id: customMlItem.id,
        qty_per_base: 1.25,
        uom: "mL",
        component_role: "REAGENT",
      });
      // ĐVT 'mL' thông thường cho phép số lẻ, nhưng customMlItem đánh dấu is_stocked=false & is_integer_uom=true -> kế thừa chính xác
      expect(inheritedLine.is_stocked).toBe(false);
      expect(inheritedLine.is_integer_qty).toBe(true);

      const toggled = await updateBomLine(tx, operator, b.id, {
        line_id: line.id,
        is_stocked: false,
        is_integer_qty: true,
      });
      expect(toggled.is_stocked).toBe(false);
      expect(toggled.is_integer_qty).toBe(true);
      return b;
    });

    const detail = await withTransaction((tx) => getBomDetail(tx, operator, bom.id));
    expect(detail.lines[0].is_stocked).toBe(false);
    expect(detail.lines[0].is_integer_qty).toBe(true);
    expect(detail.lines[1].is_stocked).toBe(false);
    expect(detail.lines[1].is_integer_qty).toBe(true);
  });
});
