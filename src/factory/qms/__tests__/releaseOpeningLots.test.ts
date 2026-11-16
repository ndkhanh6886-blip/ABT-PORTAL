import { afterAll, describe, expect, it } from "vitest";
import { createUser, grant } from "../../__tests__/helpers";
import { closeFactoryPool, getFactoryPool, withTransaction } from "../../core/db";
import { executeExcelBatchImport } from "../../import/excelImport";
import { findCandidates } from "../../inv/allocation";
import { createStockDocument, postStockDocument } from "../../inv/documents";
import { createLot } from "../../inv/lots";
import { makeItem, makeSite } from "../../inv/__tests__/fixtures";
import { getQaOpsDashboard, receiveAndCreateQcTest, releaseOpeningLotsSkipQc } from "../qaOps";
import "../../modules";

afterAll(closeFactoryPool);
const db = () => getFactoryPool();
const rnd = () => Math.random().toString(36).slice(2, 7).toUpperCase();

describe("releaseOpeningLotsSkipQc & opening balance Excel import", () => {
  it("releases OPENING lots (quarantine + pending_qc), cancels unreviewed LOT QC tests, moves stock BT -> active shelf for allocation, and leaves PURCHASE lots in IQC", async () => {
    const suffix = rnd();
    const site = await makeSite();
    const whCode = (await db().query("SELECT code FROM master.warehouse WHERE id = $1", [site.warehouse])).rows[0].code as string;
    const deptCode = (await db().query("SELECT code FROM core.org_unit WHERE id = $1", [site.dept])).rows[0].code as string;

    const importer = await createUser("Thủ kho nhập tồn");
    await grant(importer, ["master.item.manage", "master.data.view", "inv.document.post"]);

    const qaActor = await createUser("Trưởng QA");
    await grant(qaActor, ["qms.qc.view", "qms.qc.analyze", "qms.spec.manage", "inv.lot.release"]);

    const unauthorized = await createUser("Nhân sự chưa cấp quyền");
    await grant(unauthorized, ["qms.qc.view"]);

    // 1. Import 2 OPENING items with is_audited_opening_balance = false -> QUARANTINE on BT
    const code1 = `NP20A_${suffix}`;
    const lotCode1 = `NP20A-${suffix}`;
    const code2 = `DGM_${suffix}`;
    const lotCode2 = `DGM-${suffix}`;

    const importRes = await withTransaction((tx) =>
      executeExcelBatchImport(tx, importer, {
        template_key: "INVENTORY_STOCK",
        target_dept_code: deptCode,
        target_warehouse_code: whCode,
        is_audited_opening_balance: false,
        file_name: `opening_test_${suffix}.xlsx`,
        rows: [
          {
            item_code: code1,
            item_name: `Cột Silica ${suffix}`,
            item_type: "RAW_MATERIAL",
            base_uom: "pcs",
            lot_code: lotCode1,
            expiry_date: "2028-12-31",
            qty: 1200,
          },
          {
            item_code: code2,
            item_name: `Đế hộp giấy ${suffix}`,
            item_type: "CONSUMABLE",
            base_uom: "pcs",
            lot_code: lotCode2,
            expiry_date: "2028-12-31",
            qty: 500,
          },
        ],
      })
    );
    expect(importRes.error_count).toBe(0);

    const openLots = (
      await db().query(
        `SELECT l.id, l.code, l.item_id, l.status, l.origin
           FROM inv.lot l
           JOIN master.item i ON i.id = l.item_id
          WHERE i.code IN ($1, $2)`,
        [code1, code2]
      )
    ).rows;
    expect(openLots).toHaveLength(2);
    expect(openLots.every((l) => l.origin === "OPENING" && l.status === "QUARANTINE")).toBe(true);

    const lot1 = openLots.find((l) => l.code === lotCode1)!;
    const lot2 = openLots.find((l) => l.code === lotCode2)!;

    // Receive lot2 into QC (creating a PLANNED QC test & transitioning lot2 -> PENDING_QC)
    const qcCreated = await withTransaction((tx) =>
      receiveAndCreateQcTest(tx, qaActor, { lot_id: lot2.id, test_kind: "IQC" })
    );
    expect(qcCreated.test_id).toBeTruthy();

    // 2. Create a normal PURCHASE lot (supplier receipt) in QUARANTINE on BT — must NOT be skipped
    const purchaseItem = await makeItem(site, { code: `PUR_${suffix}`, receipt_qc_required: true });
    const purchaseLot = await withTransaction(async (tx) => {
      const lot = await createLot(tx, site.admin, {
        item_id: purchaseItem.id,
        origin: "PURCHASE",
        mfr_lot_no: `MFR-${suffix}`,
        expiry_date: "2028-12-31",
      });
      const rec = await createStockDocument(tx, site.admin, {
        doc_type: "RECEIPT",
        reason_code: "PURCHASE",
        warehouse_id: site.warehouse,
        lines: [{ item_id: purchaseItem.id, lot_id: lot.id, to_location_id: site.quarantine, qty: 100, uom: "µL" }],
      });
      await postStockDocument(tx, site.admin, rec.id, rec.version);
      return lot;
    });

    // Verify all 3 lots are visible in getQaOpsDashboard().reception_queue before reset
    const beforeDash = await withTransaction((tx) => getQaOpsDashboard(tx, qaActor));
    const beforeQueueIds = new Set(beforeDash.reception_queue.map((r: any) => r.lot_id));
    expect(beforeQueueIds.has(lot1.id)).toBe(true);
    expect(beforeQueueIds.has(lot2.id)).toBe(true);
    expect(beforeQueueIds.has(purchaseLot.id)).toBe(true);

    // 3. Unauthorized actor without inv.lot.release is blocked
    await expect(withTransaction((tx) => releaseOpeningLotsSkipQc(tx, unauthorized))).rejects.toThrow(/quyền/i);

    // 4. QA actor executes releaseOpeningLotsSkipQc
    const res = await withTransaction((tx) =>
      releaseOpeningLotsSkipQc(tx, qaActor, { reason: `Test giải phóng tồn đầu kỳ ${suffix}` })
    );
    expect(res.released_lots).toBeGreaterThanOrEqual(2);
    expect(res.cancelled_tests).toBeGreaterThanOrEqual(1);
    expect(res.moved_balances).toBeGreaterThanOrEqual(2);
    expect(res.transfer_docs).toBeGreaterThanOrEqual(1);

    // Both OPENING lots are RELEASED; QC test on lot2 is CANCELLED
    const afterOpenLots = (
      await db().query("SELECT id, status FROM inv.lot WHERE id = ANY($1::uuid[])", [[lot1.id, lot2.id]])
    ).rows;
    expect(afterOpenLots.every((l) => l.status === "RELEASED")).toBe(true);

    const cancelledTest = (await db().query("SELECT status FROM qms.qc_test WHERE id = $1", [qcCreated.test_id])).rows[0];
    expect(cancelledTest.status).toBe("CANCELLED");

    // Quarantine balance moved off BT onto active shelf; findCandidates finds full stock for allocation!
    const btRemain = Number(
      (
        await db().query(
          "SELECT coalesce(sum(qty_on_hand), 0)::float AS q FROM inv.stock_balance WHERE lot_id = ANY($1::uuid[]) AND location_id = $2",
          [[lot1.id, lot2.id], site.quarantine]
        )
      ).rows[0].q
    );
    expect(btRemain).toBe(0);

    const candidates1 = await withTransaction((tx) => findCandidates(tx, lot1.item_id, [site.warehouse]));
    expect(candidates1).toHaveLength(1);
    expect(candidates1[0].lot_id).toBe(lot1.id);
    expect(candidates1[0].available).toBe(1200);
    expect(candidates1[0].location_id).not.toBe(site.quarantine);

    // 5. After reset: OPENING lots are gone from queue, PURCHASE lot STILL stays in queue!
    const afterDash = await withTransaction((tx) => getQaOpsDashboard(tx, qaActor));
    const afterQueueIds = new Set(afterDash.reception_queue.map((r: any) => r.lot_id));
    expect(afterQueueIds.has(lot1.id)).toBe(false);
    expect(afterQueueIds.has(lot2.id)).toBe(false);
    expect(afterQueueIds.has(purchaseLot.id)).toBe(true);

    const afterPurLot = (await db().query("SELECT status FROM inv.lot WHERE id = $1", [purchaseLot.id])).rows[0];
    expect(afterPurLot.status).toBe("QUARANTINE");
  });

  it("allows warehouse staff without inv.lot.release to import is_audited_opening_balance=true directly as RELEASED on normal shelf without doubling on re-import", async () => {
    const suffix = rnd();
    const site = await makeSite();
    const whCode = (await db().query("SELECT code FROM master.warehouse WHERE id = $1", [site.warehouse])).rows[0].code as string;
    const deptCode = (await db().query("SELECT code FROM core.org_unit WHERE id = $1", [site.dept])).rows[0].code as string;

    const whStaff = await createUser("Thủ kho không có inv.lot.release");
    await grant(whStaff, ["master.item.manage", "master.data.view", "inv.document.post"]);

    const itemCode = `OPEN_${suffix}`;
    const lotCode = `OPEN-LOT-${suffix}`;

    // First import WITH is_audited_opening_balance: true (without inv.lot.release permission)
    const r1 = await withTransaction((tx) =>
      executeExcelBatchImport(tx, whStaff, {
        template_key: "INVENTORY_STOCK",
        target_dept_code: deptCode,
        target_warehouse_code: whCode,
        is_audited_opening_balance: true,
        file_name: `wh_open_${suffix}.xlsx`,
        rows: [
          {
            item_code: itemCode,
            item_name: `Hóa chất đầu kỳ ${suffix}`,
            item_type: "REAGENT",
            base_uom: "mL",
            lot_code: lotCode,
            expiry_date: "2028-06-30",
            qty: 500,
          },
        ],
      })
    );
    expect(r1.error_count).toBe(0);

    const lotRow = (
      await db().query(
        `SELECT l.id, l.item_id, l.status
           FROM inv.lot l
           JOIN master.item i ON i.id = l.item_id
          WHERE i.code = $1 AND l.code = $2`,
        [itemCode, lotCode]
      )
    ).rows[0];
    expect(lotRow.status).toBe("RELEASED");

    const candidates = await withTransaction((tx) => findCandidates(tx, lotRow.item_id, [site.warehouse]));
    expect(candidates).toHaveLength(1);
    expect(candidates[0].available).toBe(500);

    // Also test upgrading an older OPENING + QUARANTINE lot without doubling stock when re-imported with is_audited_opening_balance: true
    const itemCodeQ = `OPENQ_${suffix}`;
    const lotCodeQ = `OPENQ-LOT-${suffix}`;
    await withTransaction((tx) =>
      executeExcelBatchImport(tx, whStaff, {
        template_key: "INVENTORY_STOCK",
        target_dept_code: deptCode,
        target_warehouse_code: whCode,
        is_audited_opening_balance: false,
        file_name: `wh_open_q_${suffix}.xlsx`,
        rows: [
          {
            item_code: itemCodeQ,
            item_name: `Vật tư cũ biệt trữ ${suffix}`,
            item_type: "RAW_MATERIAL",
            base_uom: "pcs",
            lot_code: lotCodeQ,
            expiry_date: "2028-06-30",
            qty: 300,
          },
        ],
      })
    );
    const reimportRes = await withTransaction((tx) =>
      executeExcelBatchImport(tx, whStaff, {
        template_key: "INVENTORY_STOCK",
        target_dept_code: deptCode,
        target_warehouse_code: whCode,
        is_audited_opening_balance: true,
        file_name: `wh_open_q_${suffix}.xlsx`,
        rows: [
          {
            item_code: itemCodeQ,
            item_name: `Vật tư cũ biệt trữ ${suffix}`,
            item_type: "RAW_MATERIAL",
            base_uom: "pcs",
            lot_code: lotCodeQ,
            expiry_date: "2028-06-30",
            qty: 300,
          },
        ],
      })
    );
    expect(reimportRes.error_count).toBe(0);

    const lotQ = (
      await db().query(
        `SELECT l.id, l.item_id, l.status
           FROM inv.lot l
           JOIN master.item i ON i.id = l.item_id
          WHERE i.code = $1 AND l.code = $2`,
        [itemCodeQ, lotCodeQ]
      )
    ).rows[0];
    expect(lotQ.status).toBe("RELEASED");

    const candQ = await withTransaction((tx) => findCandidates(tx, lotQ.item_id, [site.warehouse]));
    expect(candQ).toHaveLength(1);
    expect(candQ[0].available).toBe(300);

    const totalSumQ = Number(
      (await db().query("SELECT coalesce(sum(qty_on_hand), 0)::float AS s FROM inv.stock_balance WHERE lot_id = $1", [lotQ.id])).rows[0].s
    );
    expect(totalSumQ).toBe(300);
  });
});
