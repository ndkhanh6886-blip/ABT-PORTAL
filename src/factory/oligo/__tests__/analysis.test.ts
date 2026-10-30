import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createOrgUnit, createUser, grant } from "../../__tests__/helpers";
import { closeFactoryPool, getFactoryPool, withTransaction } from "../../core/db";
import type { AuthzActor } from "../../core/authz";
import { listByType, reverseComplement, saveFragments, savePlasmid, setPlasmid, tileFragments } from "../analysis";
import { addSequences, createOligoOrder } from "../orders";
import { unsplitSequence } from "../sequences";
import "../../modules";

afterAll(closeFactoryPool);
const db = () => getFactoryPool();

const amplicon = (n: number) => Array.from({ length: n }, (_, i) => "ACGT"[(i * 7 + (i >> 3)) % 4]).join("");

describe("fragment tiling (staggered PCR assembly)", () => {
  it("alternates strands with the given overlap and never repeats the last fragment", () => {
    const seq = amplicon(100);
    const f = tileFragments("HPV", seq, 60, 20);
    // OligoFlow's loop gave a third fragment identical to the second here
    expect(f.map((x) => [x.name, x.start, x.end])).toEqual([["HPV_F1", 1, 60], ["HPV_R1", 41, 100]]);
    expect(f[1].sequence).toBe(reverseComplement(seq.slice(40, 100)));

    const g = tileFragments("A", amplicon(150), 60, 20);
    expect(g.map((x) => [x.start, x.end])).toEqual([[1, 60], [41, 100], [81, 140], [91, 150]]); // last piece kept at full length
    expect(g.every((x) => x.sequence.length === 60)).toBe(true);
    expect(g.map((x) => x.direction)).toEqual(["F", "R", "F", "R"]);
  });

  it("adds adapters and refuses designs that cannot assemble", () => {
    const f = tileFragments("X", amplicon(100), 60, 20, "GAATTC", "GGATCC");
    expect(f[0].sequence.startsWith("GAATTC")).toBe(true);
    expect(f.at(-1)!.end).toBe(112);
    expect(() => tileFragments("X", amplicon(100), 60, 10)).toThrow(/trùng lắp/);
    expect(() => tileFragments("X", amplicon(50), 60, 20)).toThrow(/không cần chia/);
    expect(() => tileFragments("X", "ACGT[FAM]ACGT".repeat(10), 60, 20)).toThrow(/base chuẩn/);
  });
});

let dept: string;
let op: AuthzActor, lead: AuthzActor;
beforeAll(async () => {
  dept = await createOrgUnit("OLIGO");
  await db().query("UPDATE core.org_unit SET module_key = 'OLIGO' WHERE id = $1", [dept]);
  op = await createUser("KTV Oligo");
  await grant(op, ["oligo.view", "oligo.order.manage"], dept);
  lead = await createUser("Trưởng phòng");
  await grant(lead, ["oligo.view", "oligo.catalog.manage"], dept);
});

describe("amplicons: fragments, plasmid, lists", () => {
  it("replaces a pending amplicon by its fragments and can undo it", async () => {
    const o = await withTransaction((tx) => createOligoOrder(tx, op, { org_unit_id: dept }));
    const seq = amplicon(150);
    await withTransaction((tx) => addSequences(tx, op, o.id, { text: `Amp; ${seq}\nP1; ACGTACGTACGTACGTAC`, defaults: { scale_code: "100NMOL", purification: "PAGE", format: "LYOPHILIZED" } }));
    const amp = (await db().query("SELECT * FROM oligo.oligo_sequence WHERE order_id = $1 AND name = 'Amp'", [o.id])).rows[0];
    expect(amp.product_type).toBe("AMPLICON_LINEAR");

    const fr = tileFragments("Amp", seq, 60, 20).map((f) => ({ name: f.name, sequence: f.sequence }));
    await withTransaction((tx) => saveFragments(tx, op, amp.id, { version: amp.version, design: { mode: "AUTO", oligo_len: 60, overlap: 20 }, fragments: fr }));
    const kids = (await db().query("SELECT name, purification, relation, status FROM oligo.oligo_sequence WHERE parent_sequence_id = $1 ORDER BY code", [amp.id])).rows;
    expect(kids).toHaveLength(4);
    expect(kids.every((k) => k.relation === "FRAGMENT" && k.purification === "PAGE" && k.status === "PENDING")).toBe(true);
    expect((await db().query("SELECT status, fragment_design FROM oligo.oligo_sequence WHERE id = $1", [amp.id])).rows[0]).toMatchObject({ status: "SPLIT", fragment_design: { overlap: 20 } });

    const amps = await withTransaction((tx) => listByType(tx, op, { type: "AMPLICON" }));
    expect(amps.rows.find((r: any) => r.id === amp.id)).toMatchObject({ fragment_count: 4, order_code: o.code });
    const primers = await withTransaction((tx) => listByType(tx, op, { type: "PRIMER", q: o.code }));
    expect(primers.rows.map((r: any) => r.name)).toEqual(expect.arrayContaining(["P1", "Amp_F1"]));

    await withTransaction((tx) => unsplitSequence(tx, op, amp.id));
    expect((await db().query("SELECT count(*)::int AS n FROM oligo.oligo_sequence WHERE parent_sequence_id = $1 AND status <> 'CANCELLED'", [amp.id])).rows[0].n).toBe(0);

    const p = await withTransaction((tx) => savePlasmid(tx, lead, null, { name: `pUC19-${Math.random().toString(36).slice(2, 6)}`, length_bp: 2686 }));
    await expect(withTransaction((tx) => savePlasmid(tx, op, null, { name: "x", length_bp: 10 }))).rejects.toThrow(/quyền/);
    const cur = (await db().query("SELECT version FROM oligo.oligo_sequence WHERE id = $1", [amp.id])).rows[0];
    await withTransaction((tx) => setPlasmid(tx, op, amp.id, { plasmid_id: p.id, version: cur.version }));
    expect((await db().query("SELECT product_type FROM oligo.oligo_sequence WHERE id = $1", [amp.id])).rows[0].product_type).toBe("AMPLICON_PLASMID");
  });
});
