import { afterAll, describe, expect, it } from "vitest";
import { createUser, grant } from "../../__tests__/helpers";
import { closeFactoryPool, getFactoryPool, withTransaction } from "../../core/db";
import type { AuthzActor } from "../../core/authz";
import { preAuthenticate, runTransition, type MachineDef, type TransitionRequest } from "../../core/stateMachine";
import { lotMachine } from "../../inv/lots";
import { createManualDocument, putAwayLot } from "../../inv/manual";
import { makeItem, makeSite, stockedLot, type Site } from "../../inv/__tests__/fixtures";
import { raiseDeviation } from "../incidents";
import { deviationMachine, ncrMachine } from "../ncr";
import "../../modules";

afterAll(closeFactoryPool);

const PIN = "583920";
const signed = { credential: { method: "PIN" as const, secret: PIN } };

async function act<S extends string, R extends { id: string; status: S; version: number }>(machine: MachineDef<S, R>, actor: AuthzActor, id: string, action: string, extra: Partial<TransitionRequest> = {}) {
  const row = (await getFactoryPool().query(`SELECT status, version FROM ${machine.table} WHERE id = $1`, [id])).rows[0];
  const req: TransitionRequest = { id, action, expectedVersion: row.version, ...extra };
  await preAuthenticate(machine, row.status, req, actor);
  return withTransaction((tx) => runTransition(tx, machine, actor, req, { signerAuthenticated: true }));
}

/** A lot held in quarantine with a failed QC result: status PENDING_QC and an open NCR (test fixture). */
async function failedLot(site: Site) {
  const item = await makeItem(site, { receipt_qc_required: true });
  const lot = await stockedLot(site, item.id, 20, null, { release: false });
  await getFactoryPool().query("UPDATE inv.lot SET status = 'PENDING_QC' WHERE id = $1", [lot.id]);
  const qa = await createUser("QA", PIN);
  const { deviation_id, ncr_id } = await withTransaction((tx) =>
    raiseDeviation(tx, qa, { source_module: "QMS", entity_type: "LOT", entity_id: lot.id, severity: "MEDIUM", description: "QC không đạt", ncr: { item_id: item.id, lot_id: lot.id } })
  );
  return { item, lot, deviation_id, ncr_id: ncr_id! };
}

async function people() {
  const head = await createUser("Trưởng phòng", PIN);
  await grant(head, ["qms.ncr.propose", "qms.qc.view"]);
  const qa = await createUser("QA duyệt", PIN);
  await grant(qa, ["qms.ncr.approve", "qms.qc.view", "inv.lot.release"]);
  const bod = await createUser("Giám đốc", PIN);
  await grant(bod, ["qms.ncr.approve_bod"]);
  return { head, qa, bod };
}

describe("NCR disposition", () => {
  it("scrap: proposed, approved by QA with a signature, lot rejected; closes only after the stock is gone", async () => {
    const site = await makeSite();
    const p = await people();
    const f = await failedLot(site);
    await expect(act(ncrMachine, p.head, f.ncr_id, "propose", { payload: { disposition: "SCRAP" } })).rejects.toThrow(/căn cứ/);
    await act(ncrMachine, p.head, f.ncr_id, "propose", { payload: { disposition: "SCRAP", note: "Độ tinh khiết 90%, không thể làm lại" } });
    await expect(act(ncrMachine, p.head, f.ncr_id, "approve", signed)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await act(ncrMachine, p.qa, f.ncr_id, "approve", signed);
    expect((await getFactoryPool().query("SELECT status FROM inv.lot WHERE id = $1", [f.lot.id])).rows[0].status).toBe("REJECTED");

    await expect(act(ncrMachine, p.qa, f.ncr_id, "close", { ...signed, reason: "Đã hủy" })).rejects.toThrow(/còn tồn/);
    await withTransaction((tx) =>
      createManualDocument(tx, site.admin, {
        doc_type: "ISSUE",
        reason_code: "SCRAP",
        warehouse_id: site.warehouse,
        notes: `Hủy theo NCR`,
        lines: [{ item_id: f.item.id, lot_id: f.lot.id, from_location_id: site.quarantine, qty: 20, uom: "µL" }],
      })
    );
    await act(ncrMachine, p.qa, f.ncr_id, "close", { ...signed, reason: "Đã xuất hủy toàn bộ lô" });
    await act(deviationMachine, p.qa, f.deviation_id, "close", { ...signed, reason: "Nguyên nhân: NCC giao lô lỗi" });
    expect((await getFactoryPool().query("SELECT status FROM qms.deviation WHERE id = $1", [f.deviation_id])).rows[0].status).toBe("CLOSED");
  });

  it("use as is: QA then the board must sign; then the lot can be released", async () => {
    const site = await makeSite();
    const p = await people();
    const f = await failedLot(site);
    await act(ncrMachine, p.head, f.ncr_id, "propose", { payload: { disposition: "USE_AS_IS", note: "Sai lệch nhỏ, không ảnh hưởng chức năng" } });
    await expect(act(ncrMachine, p.qa, f.ncr_id, "approve", signed)).rejects.toThrow(/Ban giám đốc/);
    await expect(act(lotMachine, p.qa, f.lot.id, "release", signed)).rejects.toThrow(/không phải ĐẠT/);
    await act(ncrMachine, p.qa, f.ncr_id, "qa_approve_concession", signed);
    await act(ncrMachine, p.bod, f.ncr_id, "bod_approve", signed);
    const released = await act(lotMachine, p.qa, f.lot.id, "release", signed);
    expect(released.status).toBe("RELEASED");
  });

  it("a deviation with an open NCR cannot be closed", async () => {
    const site = await makeSite();
    const p = await people();
    const f = await failedLot(site);
    await expect(act(deviationMachine, p.qa, f.deviation_id, "close", { ...signed, reason: "x" })).rejects.toThrow(/NCR chưa đóng/);
  });
});

describe("manual stock documents and put-away", () => {
  it("checks the reason against the type and asks for an explanation", async () => {
    const site = await makeSite();
    const item = await makeItem(site);
    const lot = await stockedLot(site, item.id, 10, null);
    const base = { warehouse_id: site.warehouse, lines: [{ item_id: item.id, lot_id: lot.id, from_location_id: site.shelf, qty: 1, uom: "µL" }] };
    await expect(withTransaction((tx) => createManualDocument(tx, site.admin, { ...base, doc_type: "ISSUE", reason_code: "PUTAWAY" }))).rejects.toThrow(/không dùng cho phiếu/);
    await expect(withTransaction((tx) => createManualDocument(tx, site.admin, { ...base, doc_type: "ISSUE", reason_code: "OTHER" }))).rejects.toThrow(/diễn giải/);
    const doc = await withTransaction((tx) => createManualDocument(tx, site.admin, { ...base, doc_type: "ISSUE", reason_code: "PRODUCTION" }));
    expect(doc.status).toBe("POSTED");
  });

  it("puts a released lot away from quarantine, never an unreleased one", async () => {
    const site = await makeSite();
    const item = await makeItem(site, { receipt_qc_required: true });
    const held = await stockedLot(site, item.id, 10, null, { release: false });
    await expect(withTransaction((tx) => putAwayLot(tx, site.admin, { lot_id: held.id, to_location_id: site.shelf }))).rejects.toThrow(/chưa được giải phóng/);
    await getFactoryPool().query("UPDATE inv.lot SET status = 'RELEASED' WHERE id = $1", [held.id]); // fixture: released by QA
    await expect(withTransaction((tx) => putAwayLot(tx, site.admin, { lot_id: held.id, to_location_id: site.quarantine }))).rejects.toThrow(/không phải biệt trữ/);
    await withTransaction((tx) => putAwayLot(tx, site.admin, { lot_id: held.id, to_location_id: site.shelf2 }));
    const bal = (await getFactoryPool().query("SELECT location_id, qty_on_hand::float AS q FROM inv.stock_balance WHERE lot_id = $1 AND qty_on_hand > 0", [held.id])).rows;
    expect(bal).toEqual([{ location_id: site.shelf2, q: 10 }]);
  });
});
