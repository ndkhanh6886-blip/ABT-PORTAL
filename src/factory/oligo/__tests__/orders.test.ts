import { afterAll, describe, expect, it } from "vitest";
import { createOrgUnit, createUser, grant } from "../../__tests__/helpers";
import { closeFactoryPool, getFactoryPool, withTransaction } from "../../core/db";
import { addSequences, cancelOligoOrder, createOligoOrder, getOligoOrder, recomputeOrderStatus } from "../orders";
import { cancelSequence, editSequence, poolCandidates, poolSequences, splitSequence, unpoolSequences, unsplitSequence } from "../sequences";
import "../../modules";

afterAll(closeFactoryPool);

async function setup() {
  const dept = await createOrgUnit("OLIGO");
  await getFactoryPool().query("UPDATE core.org_unit SET module_key = 'OLIGO' WHERE id = $1", [dept]);
  const staff = await createUser("NV Oligo");
  await grant(staff, ["oligo.view", "oligo.order.manage"], dept);
  return { dept, staff };
}
const defaults = { scale_code: "100NMOL", purification: "DESALT", format: "LYOPHILIZED" };
const seqs = async (orderId: string) => (await getFactoryPool().query("SELECT * FROM oligo.oligo_sequence WHERE order_id = $1 ORDER BY code", [orderId])).rows;
const orderStatus = async (id: string) => (await getFactoryPool().query("SELECT status FROM oligo.oligo_order WHERE id = $1", [id])).rows[0].status;

describe("Oligo orders", () => {
  it("adds pasted sequences with computed properties, all or nothing", async () => {
    const { dept, staff } = await setup();
    const order = await withTransaction((tx) => createOligoOrder(tx, staff, { org_unit_id: dept, customer_label: "BV X" }));
    expect(order.code).toMatch(/^OL\d{4}-\d{4}$/);
    const bad = "F1; ATGCATGCATGC\nP1; /FAMX/ATGC/BHQ1/\nR1; ATGC; 7 tấn";
    await expect(withTransaction((tx) => addSequences(tx, staff, order.id, { text: bad, defaults }))).rejects.toMatchObject({
      code: "SEQUENCE_LINES_INVALID",
      details: [expect.objectContaining({ line: 2 }), expect.objectContaining({ line: 3 })],
    });
    expect(await seqs(order.id)).toHaveLength(0);
    await withTransaction((tx) =>
      addSequences(tx, staff, order.id, { text: "F1; ATGCATGCATGC\nProbe\t5'-FAM-ATGCTTTAGCAGGAC-BHQ1-3'\tOD10-20\tHPLC\tLIQUID", defaults })
    );
    const rows = await seqs(order.id);
    expect(rows.map((r) => [r.name, r.normalized_sequence, r.scale_code, r.purification, r.product_type, Number(r.mw)])).toEqual([
      ["F1", "ATGCATGCATGC", "100NMOL", "DESALT", "PRIMER", 3645.44],
      ["Probe", "/FAM/ATGCTTTAGCAGGAC/BHQ1/", "OD10-20", "HPLC", "PROBE", expect.any(Number)],
    ]);
    expect(rows[0].code).toMatch(/^O\d{4}\d{5}$/);
  });

  it("refuses an order outside an Oligo department and people of other departments", async () => {
    const { dept, staff } = await setup();
    const kit = await createOrgUnit("KIT");
    await expect(withTransaction((tx) => createOligoOrder(tx, staff, { org_unit_id: kit }))).rejects.toMatchObject({ code: "FORBIDDEN" });
    const outsider = await createUser();
    await grant(outsider, ["oligo.order.manage"], kit);
    await expect(withTransaction((tx) => createOligoOrder(tx, outsider, { org_unit_id: dept }))).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("edits only pending sequences and recomputes their properties", async () => {
    const { dept, staff } = await setup();
    const order = await withTransaction((tx) => createOligoOrder(tx, staff, { org_unit_id: dept }));
    await withTransaction((tx) => addSequences(tx, staff, order.id, { text: "A; ATGCATGCATGC", defaults }));
    const [s] = await seqs(order.id);
    await withTransaction((tx) => editSequence(tx, staff, s.id, { version: s.version, raw_sequence: "GCGCGCGCGC" }));
    const [e] = await seqs(order.id);
    expect(Number(e.mw)).toBe(3029.99);
    expect(e.warnings.join(" ")).toMatch(/tự bổ sung/);
    await withTransaction((tx) => cancelSequence(tx, staff, e.id, "Khách bỏ"));
    await expect(withTransaction((tx) => editSequence(tx, staff, e.id, { version: e.version + 2, name: "x" }))).rejects.toThrow(/đang chờ/);
  });

  it("splits into tubes and undoes it while nothing moved on", async () => {
    const { dept, staff } = await setup();
    const order = await withTransaction((tx) => createOligoOrder(tx, staff, { org_unit_id: dept }));
    await withTransaction((tx) => addSequences(tx, staff, order.id, { text: "Primer; ATGCATGCATGC", defaults }));
    const [s] = await seqs(order.id);
    await withTransaction((tx) => splitSequence(tx, staff, s.id, { parts: [{ scale_code: "100NMOL" }, { scale_code: "200NMOL" }] }));
    let rows = await seqs(order.id);
    expect(rows.filter((r) => r.relation === "SPLIT").map((r) => [r.name, r.status, r.scale_code])).toEqual([
      ["Primer-1", "PENDING", "100NMOL"],
      ["Primer-2", "PENDING", "200NMOL"],
    ]);
    expect(rows.find((r) => r.id === s.id).status).toBe("SPLIT");
    const child = rows.find((r) => r.relation === "SPLIT");
    await expect(withTransaction((tx) => splitSequence(tx, staff, child.id, { parts: [{ scale_code: "100NMOL" }, { scale_code: "100NMOL" }] }))).rejects.toThrow(/trình tự gốc/);
    await withTransaction((tx) => unsplitSequence(tx, staff, s.id));
    rows = await seqs(order.id);
    expect(rows.find((r) => r.id === s.id).status).toBe("PENDING");
    expect(rows.filter((r) => r.relation === "SPLIT").every((r) => r.status === "CANCELLED")).toBe(true);
  });

  it("pools identical sequences across orders with shares totalling 100 %, and dissolves the pool", async () => {
    const { dept, staff } = await setup();
    const o1 = await withTransaction((tx) => createOligoOrder(tx, staff, { org_unit_id: dept }));
    const o2 = await withTransaction((tx) => createOligoOrder(tx, staff, { org_unit_id: dept }));
    const primer = `ACGT${Math.random().toString(2).slice(2, 14).replace(/0/g, "A").replace(/1/g, "G")}`;
    await withTransaction((tx) => addSequences(tx, staff, o1.id, { text: `a; ${primer}\nb; ${primer}TT`, defaults }));
    await withTransaction((tx) => addSequences(tx, staff, o2.id, { text: `c; ${primer}`, defaults }));
    const [a, b] = await seqs(o1.id);
    const [c] = await seqs(o2.id);
    const groups = await withTransaction((tx) => poolCandidates(tx, staff));
    expect(groups.some((g) => g.normalized_sequence === primer && g.sequences.length === 2)).toBe(true);

    await expect(withTransaction((tx) => poolSequences(tx, staff, { sequence_ids: [a.id, b.id], scale_code: "200NMOL" }))).rejects.toMatchObject({ code: "POOL_MISMATCH" });
    await expect(withTransaction((tx) => poolSequences(tx, staff, { sequence_ids: [a.id, c.id], scale_code: "200NMOL", ratios: [60, 30] }))).rejects.toThrow(/100%/);
    const master = await withTransaction((tx) => poolSequences(tx, staff, { sequence_ids: [a.id, c.id], scale_code: "200NMOL", ratios: [60, 40] }));
    expect(master.relation).toBe("POOL_MASTER");
    expect(master.order_id).toBeNull();
    expect((await seqs(o1.id)).find((r) => r.id === a.id).status).toBe("POOLED");
    const shares = (await getFactoryPool().query("SELECT ratio_pct::float AS r FROM oligo.oligo_pool_member pm JOIN oligo.oligo_pool p ON p.id = pm.pool_id WHERE p.master_sequence_id = $1 ORDER BY r", [master.id])).rows;
    expect(shares.map((s) => s.r)).toEqual([40, 60]);
    await expect(withTransaction((tx) => cancelOligoOrder(tx, staff, o2.id, "Khách hủy"))).rejects.toThrow(/gộp hoặc xếp mẻ/);

    await withTransaction((tx) => unpoolSequences(tx, staff, master.id));
    expect((await seqs(o1.id)).find((r) => r.id === a.id)).toMatchObject({ status: "PENDING", pool_id: null });
    await withTransaction((tx) => cancelOligoOrder(tx, staff, o2.id, "Khách hủy"));
    expect(await orderStatus(o2.id)).toBe("CANCELLED");
  });

  it("derives the order status from its sequences", async () => {
    const { dept, staff } = await setup();
    const o = await withTransaction((tx) => createOligoOrder(tx, staff, { org_unit_id: dept }));
    await withTransaction((tx) => addSequences(tx, staff, o.id, { text: "a; ATGCATGC\nb; GGCCAATT", defaults }));
    const [a, b] = await seqs(o.id);
    await getFactoryPool().query("UPDATE oligo.oligo_sequence SET status = 'SYNTHESIZING' WHERE id = $1", [a.id]); // fixture: batch module not built yet
    await withTransaction((tx) => recomputeOrderStatus(tx, staff, o.id));
    expect(await orderStatus(o.id)).toBe("IN_PROGRESS");
    await getFactoryPool().query("UPDATE oligo.oligo_sequence SET status = 'COMPLETED' WHERE id = ANY($1::uuid[])", [[a.id, b.id]]);
    await withTransaction((tx) => recomputeOrderStatus(tx, staff, o.id));
    expect(await orderStatus(o.id)).toBe("COMPLETED");
    const full = await withTransaction((tx) => getOligoOrder(tx, staff, o.id));
    expect(full.sequences).toHaveLength(2);
  });
});
