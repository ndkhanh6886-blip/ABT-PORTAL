import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUser, grant } from "../../__tests__/helpers";
import { syncPermissions } from "../../core/authz";
import { closeFactoryPool, getFactoryPool, withTransaction } from "../../core/db";
import { makeItem, makeSite, stockedLot } from "../../inv/__tests__/fixtures";
import { cascadeQuarantineLotTree } from "../enterpriseAnalytics";
import "../../modules";

beforeAll(() => withTransaction((tx) => syncPermissions(tx)));
afterAll(closeFactoryPool);

const q = (sql: string, params: unknown[]) => getFactoryPool().query(sql, params);

describe("Phong tỏa liên hoàn (cascadeQuarantineLotTree)", () => {
  it("lô không có lô liên đới: ghi rõ 'không có', lưu lý do tạm giữ; bấm lần 2 không tạo NCR trùng", async () => {
    const site = await makeSite();
    const qa = await createUser("QA phong tỏa");
    await grant(qa, ["qms.qc.review", "qms.qc.view"], site.dept);
    const sfx = Date.now().toString(36).slice(-5).toUpperCase();
    const item = await makeItem(site, { code: `ST-CQ-${sfx}`, name: `EDTA ${sfx}`, item_type: "REAGENT", base_uom: "mL" });
    const lot = await stockedLot(site, item.id, 100, "2028-01-01", { uom: "mL" });
    const reason = "Nghi ngờ pH ngoài giới hạn khi pha";

    const res = await withTransaction((tx) => cascadeQuarantineLotTree(tx, qa, { lot_id: lot.id, reason }));
    expect(res.quarantined_lot_codes).toEqual([lot.code]);
    expect(res.downstream_lot_codes).toEqual([]);

    const row = (await q("SELECT status, hold_reason FROM inv.lot WHERE id = $1", [lot.id])).rows[0];
    expect(row.status).toBe("ON_HOLD");
    expect(row.hold_reason).toContain(reason);

    const ncrs = (await q("SELECT description FROM qms.ncr WHERE lot_id = $1", [lot.id])).rows;
    expect(ncrs).toHaveLength(1);
    expect(ncrs[0].description).toContain("không có lô thành phẩm/bán thành phẩm liên đới nào");
    expect(ncrs[0].description).not.toMatch(/0 lô thành phẩm/);

    await expect(
      withTransaction((tx) => cascadeQuarantineLotTree(tx, qa, { lot_id: lot.id, reason }))
    ).rejects.toMatchObject({ status: 409, code: "ALREADY_QUARANTINED" });
    expect((await q("SELECT count(*)::int AS n FROM qms.ncr WHERE lot_id = $1", [lot.id])).rows[0].n).toBe(1);
    expect((await q("SELECT count(*)::int AS n FROM qms.deviation WHERE entity_id = $1", [lot.id])).rows[0].n).toBe(1);
  });

  it("khóa cả lô con theo phả hệ và liệt kê đúng mã lô con (không lặp lô gốc)", async () => {
    const site = await makeSite();
    const qa = await createUser("QA phong tỏa 2");
    await grant(qa, ["qms.qc.review", "qms.qc.view"], site.dept);
    const sfx = Date.now().toString(36).slice(-5).toUpperCase();
    const raw = await makeItem(site, { code: `RAW-CQ-${sfx}`, name: `NVL ${sfx}`, item_type: "REAGENT", base_uom: "mL" });
    const semi = await makeItem(site, { code: `BTP-CQ-${sfx}`, name: `BTP ${sfx}`, item_type: "REAGENT", base_uom: "mL" });
    const parent = await stockedLot(site, raw.id, 50, "2028-01-01", { uom: "mL" });
    const child = await stockedLot(site, semi.id, 20, "2028-01-01", { uom: "mL" });
    await q("INSERT INTO kit.lot_genealogy (parent_lot_id, child_lot_id, qty_used, uom) VALUES ($1, $2, 5, 'mL')", [parent.id, child.id]);

    const res = await withTransaction((tx) =>
      cascadeQuarantineLotTree(tx, qa, { lot_id: parent.id, reason: "Nhà cung cấp thu hồi lô NVL" })
    );
    expect(res.downstream_lot_codes).toEqual([child.code]);
    expect(res.quarantined_lot_codes.sort()).toEqual([parent.code, child.code].sort());
    expect((await q("SELECT status FROM inv.lot WHERE id = $1", [child.id])).rows[0].status).toBe("ON_HOLD");
    const desc = (await q("SELECT description FROM qms.ncr WHERE lot_id = $1", [parent.id])).rows[0].description;
    expect(desc).toContain(`1 lô thành phẩm/bán thành phẩm liên đới (${child.code})`);
  });
});
