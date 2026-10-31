import { afterAll, describe, expect, it } from "vitest";
import { createOrgUnit, createUser, grant } from "../../__tests__/helpers";
import { closeFactoryPool, getFactoryPool, withTransaction } from "../../core/db";
import { printLabels } from "../fulfilment";
import { addSequences, createOligoOrder } from "../orders";
import "../../modules";

afterAll(closeFactoryPool);

describe("tube label preview", () => {
  it("shows the labels of a pending sequence without recording a print; printing still needs the OD", async () => {
    const unit = await createOrgUnit("OLIGO");
    await getFactoryPool().query("UPDATE core.org_unit SET module_key = 'OLIGO' WHERE id = $1", [unit]);
    const viewer = await createUser("Xem đơn Oligo");
    await grant(viewer, ["oligo.view", "oligo.order.manage", "oligo.delivery.manage"], unit);
    const o = await withTransaction((tx) => createOligoOrder(tx, viewer, { org_unit_id: unit }));
    await withTransaction((tx) => addSequences(tx, viewer, o.id, { text: "F; ACGTACGTACGTACGTAC", defaults: { scale_code: "100NMOL", purification: "DESALT", format: "LYOPHILIZED" } }));
    const s = (await getFactoryPool().query("SELECT id, code FROM oligo.oligo_sequence WHERE order_id = $1", [o.id])).rows[0];
    const labels = await withTransaction((tx) => printLabels(tx, viewer, { sequence_ids: [s.id], preview: true }));
    expect(labels).toHaveLength(1);
    expect(labels[0]).toMatchObject({ code: s.code, od: null, preview: true, printable: false, tube: "1/1" });
    expect((await getFactoryPool().query("SELECT count(*)::int AS n FROM oligo.label_print WHERE sequence_id = $1", [s.id])).rows[0].n).toBe(0);
    await expect(withTransaction((tx) => printLabels(tx, viewer, { sequence_ids: [s.id] }))).rejects.toThrow(/đo OD/);
  });
});
