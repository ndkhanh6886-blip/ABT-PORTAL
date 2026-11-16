import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUser, grant } from "../../__tests__/helpers";
import { syncPermissions, type AuthzActor } from "../../core/authz";
import { closeFactoryPool, getFactoryPool, withTransaction } from "../../core/db";
import { preAuthenticate, runTransition, type MachineDef, type TransitionRequest } from "../../core/stateMachine";
import { makeItem, makeSite, stockedLot } from "../../inv/__tests__/fixtures";
import { addBomLine, addRoutingStep, bomMachine, createBom, createRouting, routingMachine } from "../../kit/bomRouting";
import { createProductionOrder } from "../../kit/ordersEbr";
import { getEnterpriseAnalyticsOverview, simulateWhatIfOrder } from "../enterpriseAnalytics";
import "../../modules";

beforeAll(() => withTransaction((tx) => syncPermissions(tx)));
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
  if (extra.credential) await preAuthenticate(machine, row.status, req, actor);
  return withTransaction((tx) => runTransition(tx, machine, actor, req, extra.credential ? { signerAuthenticated: true } : {}));
}

describe("Enterprise Analytics & Forecasting (enterpriseAnalytics.ts)", () => {
  it("1. Blocks unauthorized actor without qms.qc.view and returns 8 scorecards + Kit batch cycle for authorized actor", async () => {
    const site = await makeSite();
    const unauthorized = await createUser("Viewer No QC", PIN);
    await grant(unauthorized, ["inv.stock.view", "master.data.view"], site.dept);

    await expect(
      withTransaction((tx) => getEnterpriseAnalyticsOverview(tx, unauthorized))
    ).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });

    const kitOps = await createUser("Kit Analytics Ops", PIN);
    await grant(
      kitOps,
      [
        "kit.view",
        "kit.bom.manage",
        "kit.bom.approve",
        "kit.order.manage",
        "inv.stock.view",
        "master.data.view",
        "qms.qc.view",
      ],
      site.dept
    );
    const bomApprover = await createUser("Kit Analytics Checker", PIN);
    await grant(bomApprover, ["kit.view", "kit.bom.manage", "kit.bom.approve", "master.data.view"], site.dept);

    const suffix = Date.now().toString(36).slice(-4).toUpperCase();
    const kitItem = await makeItem(site, {
      code: `KIT-ANL-${suffix}`,
      name: `Bộ Kit Phân tích ${suffix}`,
      item_type: "FINISHED_KIT",
      base_uom: "pcs",
      shelf_life_days: 365,
    });
    const reagentItem = await makeItem(site, {
      code: `REA-ANL-${suffix}`,
      name: `Dung dịch đệm ${suffix}`,
      item_type: "REAGENT",
      base_uom: "mL",
    });
    await stockedLot(site, reagentItem.id, 200, "2028-06-01", { uom: "mL" });

    const bom = await withTransaction(async (tx) => {
      const b = await createBom(tx, kitOps, {
        org_unit_id: site.dept,
        product_item_id: kitItem.id,
        name: `BOM Analytics ${suffix}`,
        base_qty: 1,
        base_uom: "pcs",
        tests_per_kit: 50,
        shelf_life_days: 365,
      });
      await addBomLine(tx, kitOps, {
        bom_id: b.id,
        line_no: 1,
        box_no: 1,
        component_item_id: reagentItem.id,
        component_role: "MASTER_MIX",
        qty_per_base: 2,
        uom: "mL",
      });
      return b;
    });
    await act(bomMachine, kitOps, bom.id, "submit_review");
    await act(bomMachine, bomApprover, bom.id, "approve", signed);

    const rt = await withTransaction(async (tx) => {
      const r = await createRouting(tx, kitOps, {
        org_unit_id: site.dept,
        product_item_id: kitItem.id,
        name: `Routing Analytics ${suffix}`,
      });
      await addRoutingStep(tx, kitOps, {
        routing_id: r.id,
        seq: 10,
        step_code: "STEP-ANL-10",
        step_name: "Pha chế đệm chuẩn",
        category: "FORMULATION",
        required_asset_id: "",
        instructions: "Thực hiện pha chế theo SOP chuẩn.",
      });
      return r;
    });
    await act(routingMachine, kitOps, rt.id, "submit_review");
    await act(routingMachine, bomApprover, rt.id, "approve", signed);

    const order = await withTransaction((tx) =>
      createProductionOrder(tx, kitOps, {
        org_unit_id: site.dept,
        product_item_id: kitItem.id,
        warehouse_id: site.warehouse,
        planned_qty: 10,
        no_retention: true,
      })
    );

    // Mark order COMPLETED with confirmed_at & released_at 2 days apart so avg_cycle_days is computed from actual columns
    await withTransaction((tx) =>
      tx.query(
        `UPDATE kit.production_order
            SET status = 'COMPLETED',
                good_qty = 10,
                confirmed_at = now() - interval '2 days',
                released_at = now()
          WHERE id = $1`,
        [order.id]
      )
    );

    const overview = await withTransaction((tx) => getEnterpriseAnalyticsOverview(tx, kitOps));

    expect(typeof overview.overall_health_score).toBe("number");
    expect(Number.isFinite(overview.overall_health_score)).toBe(true);
    expect(overview.department_scorecards.map((d) => d.dept_code)).toEqual([
      "P-RD",
      "P-KIT",
      "P-OLIGO",
      "P-DEVICE",
      "P-QAQC",
      "P-INTAKE",
      "P-SUPPLY",
      "P-WH",
    ]);

    const kitCard = overview.department_scorecards.find((d) => d.dept_code === "P-KIT");
    expect(kitCard).toBeDefined();
    expect(kitCard!.metrics[2].value).toMatch(/\d+(\.\d+)?\s+ngày\/lô/);

    expect(Array.isArray(overview.review_by_exception_batches)).toBe(true);
    expect(Array.isArray(overview.spc_series)).toBe(true);
    expect(Array.isArray(overview.pareto_root_causes)).toBe(true);
    expect(Array.isArray(overview.material_runout_forecast)).toBe(true);
    expect(Array.isArray(overview.simulatable_products)).toBe(true);
    expect(Array.isArray(overview.bio_lots)).toBe(true);
    expect(Array.isArray(overview.genealogy_edges)).toBe(true);
    expect(overview.iso13485_management_review.sections.length).toBe(4);

    const sim = await withTransaction((tx) =>
      simulateWhatIfOrder(tx, kitOps, {
        item_id: kitItem.id,
        order_qty: 12,
      })
    );
    expect(sim.product.code).toBe(kitItem.code);
    expect(sim.product.domain).toBe("KIT");
    expect(sim.bom_lines.length).toBeGreaterThanOrEqual(1);
  });
});
