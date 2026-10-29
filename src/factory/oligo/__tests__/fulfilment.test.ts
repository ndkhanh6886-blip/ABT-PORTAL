import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createOrgUnit, createUser, grant } from "../../__tests__/helpers";
import { closeFactoryPool, getFactoryPool, withTransaction } from "../../core/db";
import { SYSTEM_ACTOR, type AuthzActor } from "../../core/authz";
import { preAuthenticate, runTransition, type TransitionRequest } from "../../core/stateMachine";
import { raiseDeviation } from "../../qms/incidents";
import { ncrMachine } from "../../qms/ncr";
import { createDelivery, deliveryOptions, printLabels } from "../fulfilment";
import { addSequences, createOligoOrder } from "../orders";
import "../../modules";

afterAll(closeFactoryPool);

const PIN = "771204";
const signed = { credential: { method: "PIN" as const, secret: PIN } };
const db = () => getFactoryPool();

let dept: string;
let op: AuthzActor, head: AuthzActor, qa: AuthzActor, bod: AuthzActor;
beforeAll(async () => {
  dept = await createOrgUnit("OLIGO");
  await db().query("UPDATE core.org_unit SET module_key = 'OLIGO' WHERE id = $1", [dept]);
  op = await createUser("KTV giao Oligo");
  await grant(op, ["oligo.view", "oligo.order.manage", "oligo.delivery.manage", "intake.shipment.post"], dept);
  head = await createUser("Trưởng phòng Oligo", PIN);
  await grant(head, ["qms.ncr.propose", "qms.qc.view"]);
  qa = await createUser("QA", PIN);
  await grant(qa, ["qms.ncr.approve", "qms.qc.view"]);
  bod = await createUser("Giám đốc", PIN);
  await grant(bod, ["qms.ncr.approve_bod"]);
});

async function ncrAct(actor: AuthzActor, id: string, action: string, extra: Partial<TransitionRequest> = {}) {
  const row = (await db().query("SELECT status, version FROM qms.ncr WHERE id = $1", [id])).rows[0];
  const req: TransitionRequest = { id, action, expectedVersion: row.version, ...extra };
  await preAuthenticate(ncrMachine, row.status, req, actor);
  return withTransaction((tx) => runTransition(tx, ncrMachine, actor, req, { signerAuthenticated: true }));
}

async function order(internalOrderId: string | null = null, text = "F; ACGTACGTACGTACGTAC") {
  const o = await withTransaction((tx) => createOligoOrder(tx, op, { org_unit_id: dept, internal_order_id: internalOrderId }));
  await withTransaction((tx) => addSequences(tx, op, o.id, { text, defaults: { scale_code: "100NMOL", purification: "DESALT", format: "LYOPHILIZED" } }));
  const seqs = (await db().query("SELECT * FROM oligo.oligo_sequence WHERE order_id = $1 ORDER BY line_no", [o.id])).rows;
  return { o, seqs };
}
/** Stands in for synthesis + post-processing: a submitted record of 20 OD in 2 tubes, and the given status. */
async function processed(seqId: string, status: string) {
  await db().query(
    `INSERT INTO oligo.post_process (sequence_id, status, purification, format, cleavage_done, deprotection_done, purification_done, a260, stock_volume_ul, od_total, nmol, ug, tube_count, od_per_tube)
     VALUES ($1, 'SUBMITTED', 'DESALT', 'LYOPHILIZED', true, true, true, 0.4, 500, 20, 100, 660, 2, 10)`,
    [seqId]
  );
  await db().query("UPDATE oligo.oligo_sequence SET status = $2 WHERE id = $1", [seqId, status]);
}
async function failedWithNcr(seqId: string) {
  await db().query("UPDATE oligo.oligo_sequence SET status = 'FAILED' WHERE id = $1", [seqId]);
  const r = await withTransaction((tx) =>
    raiseDeviation(tx, SYSTEM_ACTOR, { source_module: "QMS", entity_type: "OLIGO_SEQUENCE", entity_id: seqId, severity: "MEDIUM", description: "QC không đạt", ncr: { item_id: null, lot_id: null } })
  );
  return r.ncr_id!;
}
const status = async (id: string) => (await db().query("SELECT status FROM oligo.oligo_sequence WHERE id = $1", [id])).rows[0].status;
const orderStatus = async (id: string) => (await db().query("SELECT status FROM oligo.oligo_order WHERE id = $1", [id])).rows[0].status;

describe("NCR dispositions on a sequence", () => {
  it("a synthesis failure can only be resynthesised or scrapped; resynthesis queues a linked new sequence", async () => {
    const { o, seqs } = await order();
    const ncr = await failedWithNcr(seqs[0].id);
    await expect(ncrAct(head, ncr, "propose", { payload: { disposition: "REWORK", note: "Tinh sạch lại" } })).rejects.toMatchObject({ code: "DISPOSITION_FIT" });
    await expect(ncrAct(head, ncr, "propose", { payload: { disposition: "RETURN_TO_SUPPLIER", note: "Trả lại hàng" } })).rejects.toThrow(/không áp dụng cho Oligo/);
    await ncrAct(head, ncr, "propose", { payload: { disposition: "RESYNTHESIZE", note: "Hiệu suất ghép thấp" } });
    await ncrAct(qa, ncr, "approve", signed);
    const child = (await db().query("SELECT * FROM oligo.oligo_sequence WHERE parent_sequence_id = $1 AND relation = 'RESYNTH'", [seqs[0].id])).rows[0];
    expect(child).toMatchObject({ status: "PENDING", order_id: o.id, normalized_sequence: seqs[0].normalized_sequence });
    expect(await orderStatus(o.id)).toBe("PENDING"); // the failed original no longer counts
  });

  it("rework sends a tested product back to post-processing; use as is needs QA and the board", async () => {
    const { o, seqs } = await order(null, "A; ACGTACGTAC\nB; GGCCTTAAGG");
    await processed(seqs[0].id, "FAILED");
    await processed(seqs[1].id, "FAILED");
    const n1 = await failedWithNcr(seqs[0].id);
    await ncrAct(head, n1, "propose", { payload: { disposition: "REWORK", note: "Tinh sạch HPLC lại" } });
    await ncrAct(qa, n1, "approve", signed);
    expect(await status(seqs[0].id)).toBe("POST_PROCESSING");
    const recs = (await db().query("SELECT status FROM oligo.post_process WHERE sequence_id = $1 ORDER BY created_at", [seqs[0].id])).rows.map((r) => r.status);
    expect(recs).toEqual(["VOID", "OPEN"]);

    const n2 = await failedWithNcr(seqs[1].id);
    await ncrAct(head, n2, "propose", { payload: { disposition: "USE_AS_IS", note: "Khách đồng ý, sai lệch nhỏ" } });
    await expect(ncrAct(qa, n2, "approve", signed)).rejects.toThrow(/Ban giám đốc/);
    await ncrAct(qa, n2, "qa_approve_concession", signed);
    expect(await status(seqs[1].id)).toBe("FAILED");
    await ncrAct(bod, n2, "bod_approve", signed);
    expect(await status(seqs[1].id)).toBe("COMPLETED");
    expect(await orderStatus(o.id)).toBe("IN_PROGRESS");
  });
});

describe("labels and delivery", () => {
  it("prints one label per tube from the measurement, records every print and needs a reason to reprint", async () => {
    const { seqs } = await order();
    await processed(seqs[0].id, "COMPLETED");
    const labels = await withTransaction((tx) => printLabels(tx, op, { sequence_ids: [seqs[0].id] }));
    expect(labels).toHaveLength(2);
    expect(labels[0]).toMatchObject({ code: seqs[0].code, tube: "1/2", od: 10, nmol: 50, released: true });
    await expect(withTransaction((tx) => printLabels(tx, op, { sequence_ids: [seqs[0].id] }))).rejects.toMatchObject({ code: "REPRINT_REASON" });
    await withTransaction((tx) => printLabels(tx, op, { sequence_ids: [seqs[0].id], reason: "Nhãn bị nhòe" }));
    expect((await db().query("SELECT reprint FROM oligo.label_print WHERE sequence_id = $1 ORDER BY printed_at", [seqs[0].id])).rows.map((r) => r.reprint)).toEqual([false, true]);
  });

  it("hands over an order without a PO internally, only labelled sequences and only once", async () => {
    const { o, seqs } = await order();
    await processed(seqs[0].id, "COMPLETED");
    const deliver = (extra = {}) => withTransaction((tx) => createDelivery(tx, op, { order_id: o.id, sequence_ids: [seqs[0].id], ...extra }));
    await expect(deliver({ recipient: "Phòng R&D" })).rejects.toMatchObject({ code: "NOT_LABELLED" });
    await withTransaction((tx) => printLabels(tx, op, { sequence_ids: [seqs[0].id] }));
    await expect(deliver()).rejects.toThrow(/người \/ bộ phận nhận/);
    const d = await deliver({ recipient: "Phòng R&D" });
    expect(d.code).toMatch(/^GH\d{4}-\d{4}$/);
    expect(await status(seqs[0].id)).toBe("DELIVERED");
    expect(await orderStatus(o.id)).toBe("DELIVERED");
    await expect(deliver({ recipient: "Phòng R&D" })).rejects.toMatchObject({ code: "NOT_DELIVERABLE" });
  });

  it("delivers an order from a Kinh doanh PO as a shipment against the PO lines and tells Kinh doanh", async () => {
    const io = (
      await db().query(
        `INSERT INTO intake.internal_order (code, kd_po_id, kd_po_code, org_unit_id, ship_mode, status) VALUES ($1, 1, $1, $2, 'TO_KD', 'ACCEPTED') RETURNING id`,
        [`DN-T${Math.random().toString(36).slice(2, 8)}`, dept]
      )
    ).rows[0];
    const line = (
      await db().query("INSERT INTO intake.internal_order_line (order_id, line_no, kd_line_index, kd_item_code, kd_unit, qty, transfer_price) VALUES ($1, 1, 0, 'OLIGO-DNA', 'trình tự', 2, 90000) RETURNING id", [io.id])
    ).rows[0];
    const { o, seqs } = await order(io.id, "A; ACGTACGTAC\nB; GGCCTTAAGG");
    for (const s of seqs) await processed(s.id, "COMPLETED");
    await withTransaction((tx) => printLabels(tx, op, { sequence_ids: seqs.map((s) => s.id) }));
    const opts = await withTransaction((tx) => deliveryOptions(tx, op, o.id));
    expect(opts.sequences).toHaveLength(2);
    const ship = (qty: number, ids = seqs.map((s) => s.id)) => withTransaction((tx) => createDelivery(tx, op, { order_id: o.id, sequence_ids: ids, lines: [{ order_line_id: line.id, qty }] }));
    await expect(ship(3)).rejects.toMatchObject({ code: "OVER_DELIVERY" });
    const d = await ship(1, [seqs[0].id]);
    expect((await db().query("SELECT status FROM intake.internal_order WHERE id = $1", [io.id])).rows[0].status).toBe("PARTIALLY_DELIVERED");
    const sh = (await db().query("SELECT kind, warehouse_id, stock_document_id FROM intake.shipment WHERE id = $1", [d.shipment_id])).rows[0];
    expect(sh).toEqual({ kind: "OLIGO", warehouse_id: null, stock_document_id: null });
    const ev = (await db().query("SELECT payload FROM core.outbox_event WHERE event_type = 'FactoryShipmentPosted' AND payload->>'shipment_id' = $1", [d.shipment_id])).rows[0].payload;
    expect(ev.lines[0]).toMatchObject({ product_code: "OLIGO-DNA", quantity: 1, lot_number: o.code });
    expect(ev.oligo_sequences.map((s: any) => s.code)).toEqual([seqs[0].code]);
    await ship(1, [seqs[1].id]);
    expect(await orderStatus(o.id)).toBe("DELIVERED");
    expect((await db().query("SELECT status FROM intake.internal_order WHERE id = $1", [io.id])).rows[0].status).toBe("DELIVERED");
  });
});
