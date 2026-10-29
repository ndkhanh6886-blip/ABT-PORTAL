import { afterAll, describe, expect, it } from "vitest";
import { createOrgUnit, createUser, grant } from "../../__tests__/helpers";
import { closeFactoryPool, getFactoryPool, withTransaction } from "../../core/db";
import type { AuthzActor } from "../../core/authz";
import { preAuthenticate, runTransition, type MachineDef, type TransitionRequest } from "../../core/stateMachine";
import { createPartner } from "../../master/service";
import { makeItem, makeSite, type Site } from "../../inv/__tests__/fixtures";
import { createOrder, poMachine } from "../orders";
import { postGoodsReceipt } from "../receipts";
import { createRequest, openRequestLines, prMachine } from "../requests";
import "../../modules";

afterAll(closeFactoryPool);

const PIN = "583920";
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

async function team(site: Site) {
  const requester = await createUser("Nhân viên SX");
  await grant(requester, ["purchase.pr.create", "purchase.pr.view"], site.dept);
  const head = await createUser("Trưởng phòng SX");
  await grant(head, ["purchase.pr.approve", "purchase.pr.view"], site.dept);
  const bod = await createUser("Giám đốc", PIN);
  await grant(bod, ["purchase.pr.approve", "purchase.pr.approve_bod"]);
  const buyer = await createUser("Cung ứng NVL");
  await grant(buyer, ["purchase.po.manage", "purchase.po.view", "master.partner.manage"]);
  const keeper = await createUser("Thủ kho");
  await grant(keeper, ["purchase.receipt.post"], site.dept);
  const supplier = await withTransaction((tx) => createPartner(tx, buyer, { name: `NCC ${Date.now()}`, is_supplier: true }));
  return { requester, head, bod, buyer, keeper, supplier };
}

async function approvedRequest(site: Site, t: Awaited<ReturnType<typeof team>>, lines: { item_id: string; qty: number; est_price?: number }[]) {
  const pr = await withTransaction((tx) =>
    createRequest(tx, t.requester, { org_unit_id: site.dept, target_warehouse_id: site.warehouse, reason: "Sản xuất lô tháng 11", lines: lines.map((l) => ({ ...l, uom: "µL" })) })
  );
  await act(prMachine, t.requester, pr.id, "submit");
  await act(prMachine, t.head, pr.id, "approve");
  return pr;
}
const prLines = async (prId: string) =>
  (await getFactoryPool().query("SELECT id, qty::float AS qty, qty_ordered::float AS ordered FROM purchase.purchase_request_line WHERE pr_id = $1 ORDER BY line_no", [prId])).rows;
const status = async (table: string, id: string) => (await getFactoryPool().query(`SELECT status FROM ${table} WHERE id = $1`, [id])).rows[0].status;

describe("purchase requests", () => {
  it("are approved by someone else in the department; large ones go to the board with a signature", async () => {
    const site = await makeSite();
    const t = await team(site);
    const item = await makeItem(site, { receipt_qc_required: true });
    const pr = await withTransaction((tx) =>
      createRequest(tx, t.requester, { org_unit_id: site.dept, target_warehouse_id: site.warehouse, reason: "Mua enzyme", lines: [{ item_id: item.id, qty: 1000, uom: "µL", est_price: 2000 }] })
    );
    await act(prMachine, t.requester, pr.id, "submit");
    const selfApprover = await createUser("Tự duyệt");
    await grant(selfApprover, ["purchase.pr.create", "purchase.pr.approve"], site.dept);
    const own = await withTransaction((tx) =>
      createRequest(tx, selfApprover, { org_unit_id: site.dept, target_warehouse_id: site.warehouse, reason: "Thử nghiệm", lines: [{ item_id: item.id, qty: 1, uom: "µL" }] })
    );
    await act(prMachine, selfApprover, own.id, "submit");
    await expect(act(prMachine, selfApprover, own.id, "approve")).rejects.toThrow(/khác người lập/);

    await getFactoryPool().query("UPDATE core.setting SET value = '1000000' WHERE key = 'purchase.pr_bod_approval_threshold_vnd'");
    try {
      const big = await withTransaction((tx) =>
        createRequest(tx, t.requester, { org_unit_id: site.dept, target_warehouse_id: site.warehouse, reason: "Mua lớn", lines: [{ item_id: item.id, qty: 1000, uom: "µL", est_price: 2000 }] })
      );
      await act(prMachine, t.requester, big.id, "submit");
      await expect(act(prMachine, t.head, big.id, "approve")).rejects.toThrow(/Ban giám đốc/);
      await act(prMachine, t.head, big.id, "escalate");
      await expect(act(prMachine, t.bod, big.id, "bod_approve")).rejects.toMatchObject({ code: "SIGNATURE_REQUIRED" });
      await act(prMachine, t.bod, big.id, "bod_approve", signed);
      expect(await status("purchase.purchase_request", big.id)).toBe("APPROVED");
    } finally {
      await getFactoryPool().query("UPDATE core.setting SET value = 'null' WHERE key = 'purchase.pr_bod_approval_threshold_vnd'");
    }
  });

  it("are limited to the requester's department and its own warehouse", async () => {
    const site = await makeSite();
    const t = await team(site);
    const item = await makeItem(site);
    const other = await createOrgUnit("OLIGO");
    await expect(
      withTransaction((tx) => createRequest(tx, t.requester, { org_unit_id: other, target_warehouse_id: site.warehouse, reason: "Thử nghiệm", lines: [{ item_id: item.id, qty: 1, uom: "µL" }] }))
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const outsider = await createUser();
    await grant(outsider, ["purchase.pr.create"], other);
    await expect(
      withTransaction((tx) => createRequest(tx, outsider, { org_unit_id: other, target_warehouse_id: site.warehouse, reason: "Thử nghiệm", lines: [{ item_id: item.id, qty: 1, uom: "µL" }] }))
    ).rejects.toThrow(/kho của phòng đề nghị/);
  });
});

describe("purchase orders and receipts", () => {
  it("orders approved lines in parts, receives in parts into quarantine and closes the loop", async () => {
    const site = await makeSite();
    const t = await team(site);
    const item = await makeItem(site, { receipt_qc_required: true });
    const pr = await approvedRequest(site, t, [{ item_id: item.id, qty: 100 }]);
    const [line] = await prLines(pr.id);
    expect((await withTransaction((tx) => openRequestLines(tx, t.buyer))).some((l) => l.pr_line_id === line.id)).toBe(true);

    const po1 = await withTransaction((tx) => createOrder(tx, t.buyer, { supplier_id: t.supplier.id, lines: [{ pr_line_id: line.id, qty: 60, unit_price: 1000, vat_rate: 8 }] }));
    expect(await status("purchase.purchase_request", pr.id)).toBe("APPROVED");
    await expect(
      withTransaction((tx) => createOrder(tx, t.buyer, { supplier_id: t.supplier.id, lines: [{ pr_line_id: line.id, qty: 41, unit_price: 1000 }] }))
    ).rejects.toMatchObject({ code: "OVER_ORDER" });
    const po2 = await withTransaction((tx) => createOrder(tx, t.buyer, { supplier_id: t.supplier.id, lines: [{ pr_line_id: line.id, qty: 40, unit_price: 1000 }] }));
    expect(await status("purchase.purchase_request", pr.id)).toBe("ORDERED");
    await act(poMachine, t.buyer, po2.id, "cancel", { reason: "Gộp vào đơn khác" });
    expect((await prLines(pr.id))[0].ordered).toBe(60);
    expect(await status("purchase.purchase_request", pr.id)).toBe("APPROVED");

    await act(poMachine, t.buyer, po1.id, "issue");
    const poLine = (await getFactoryPool().query("SELECT id FROM purchase.purchase_order_line WHERE po_id = $1", [po1.id])).rows[0].id;
    const receive = (qty: number, extra: Record<string, unknown> = {}) =>
      withTransaction((tx) => postGoodsReceipt(tx, t.keeper, { po_id: po1.id, lines: [{ po_line_id: poLine, qty, mfr_lot_no: "SUP-001", expiry_date: "2031-01-01", ...extra }] }));
    await expect(receive(10, { mfr_lot_no: null })).rejects.toThrow(/số lô nhà sản xuất/);
    await expect(receive(10, { expiry_date: "2020-01-01" })).rejects.toThrow(/hết hạn/);
    const gr = await receive(25);
    expect(gr.lots).toHaveLength(1);
    const lot = (await getFactoryPool().query("SELECT status, supplier_id, mfr_lot_no FROM inv.lot WHERE id = $1", [gr.lots[0].id])).rows[0];
    expect(lot).toMatchObject({ status: "QUARANTINE", supplier_id: t.supplier.id, mfr_lot_no: "SUP-001" });
    const bal = (await getFactoryPool().query("SELECT location_id, qty_on_hand::float AS q FROM inv.stock_balance WHERE lot_id = $1", [gr.lots[0].id])).rows;
    expect(bal).toEqual([{ location_id: site.quarantine, q: 25 }]);
    expect(await status("purchase.purchase_order", po1.id)).toBe("PARTIALLY_RECEIVED");

    await expect(receive(36)).rejects.toMatchObject({ code: "OVER_RECEIPT" });
    await receive(35);
    expect(await status("purchase.purchase_order", po1.id)).toBe("RECEIVED");
    await expect(receive(1)).rejects.toThrow(/chưa nhận đủ/);
  });

  it("lets only one of two buyers order the same remaining quantity", async () => {
    const site = await makeSite();
    const t = await team(site);
    const item = await makeItem(site);
    const pr = await approvedRequest(site, t, [{ item_id: item.id, qty: 10 }]);
    const [line] = await prLines(pr.id);
    const race = await Promise.allSettled(
      [1, 2].map(() => withTransaction((tx) => createOrder(tx, t.buyer, { supplier_id: t.supplier.id, lines: [{ pr_line_id: line.id, qty: 10, unit_price: 1 }] })))
    );
    expect(race.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  it("releases no-QC items on receipt, needs serials for serial items and receiving rights for the warehouse", async () => {
    const site = await makeSite();
    const t = await team(site);
    const plain = await makeItem(site, { receipt_qc_required: false });
    const device = await makeItem(site, { base_uom: "pcs", tracking: "SERIAL", item_type: "COMPONENT", receipt_qc_required: false });
    const pr = await withTransaction((tx) =>
      createRequest(tx, t.requester, {
        org_unit_id: site.dept,
        target_warehouse_id: site.warehouse,
        reason: "Linh kiện",
        lines: [{ item_id: plain.id, qty: 5, uom: "µL" }, { item_id: device.id, qty: 2, uom: "pcs" }],
      })
    );
    await act(prMachine, t.requester, pr.id, "submit");
    await act(prMachine, t.head, pr.id, "approve");
    const [l1, l2] = await prLines(pr.id);
    const po = await withTransaction((tx) =>
      createOrder(tx, t.buyer, { supplier_id: t.supplier.id, lines: [{ pr_line_id: l1.id, qty: 5, unit_price: 1 }, { pr_line_id: l2.id, qty: 2, unit_price: 1 }] })
    );
    await act(poMachine, t.buyer, po.id, "issue");
    const pol = (await getFactoryPool().query("SELECT id, item_id FROM purchase.purchase_order_line WHERE po_id = $1 ORDER BY line_no", [po.id])).rows;
    const outsider = await createUser();
    await grant(outsider, ["purchase.receipt.post"], await createOrgUnit("KHAC"));
    await expect(
      withTransaction((tx) => postGoodsReceipt(tx, outsider, { po_id: po.id, lines: [{ po_line_id: pol[0].id, qty: 5, mfr_lot_no: "A", expiry_date: "2031-01-01" }] }))
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      withTransaction((tx) => postGoodsReceipt(tx, t.keeper, { po_id: po.id, lines: [{ po_line_id: pol[1].id, qty: 2, serials: ["SN1"] }] }))
    ).rejects.toThrow(/số serial/);
    const gr = await withTransaction((tx) =>
      postGoodsReceipt(tx, t.keeper, {
        po_id: po.id,
        lines: [
          { po_line_id: pol[0].id, qty: 5, mfr_lot_no: "A", expiry_date: "2031-01-01" },
          { po_line_id: pol[1].id, qty: 2, serials: ["sn-001", "sn-002"] },
        ],
      })
    );
    const lots = (await getFactoryPool().query("SELECT code, status FROM inv.lot WHERE id = ANY($1::uuid[]) ORDER BY code", [gr.lots.map((l: { id: string }) => l.id)])).rows;
    expect(lots.map((l) => l.status)).toEqual(["RELEASED", "RELEASED", "RELEASED"]);
    expect(lots.map((l) => l.code)).toEqual(expect.arrayContaining(["SN-001", "SN-002"]));
    expect(await status("purchase.purchase_order", po.id)).toBe("RECEIVED");
  });
});
