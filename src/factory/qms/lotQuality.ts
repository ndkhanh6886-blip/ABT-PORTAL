import { registerLotQualityGuards, type Lot } from "../inv/lots";
import type { Tx } from "../core/db";
import { hasOpenNcr, raiseDeviation } from "./incidents";
import { createQcTest } from "./qcTests";
import { findEffectiveSpec } from "./specs";

/** Receipts are checked against the receiving (IQC) spec first, then the general item spec. */
async function specForLot(tx: Tx, lot: Lot) {
  const origin = (await tx.query("SELECT origin FROM inv.lot WHERE id = $1", [lot.id])).rows[0]?.origin;
  return findEffectiveSpec(tx, lot.item_id, origin === "PURCHASE" ? ["RECEIPT", "ITEM"] : ["ITEM", "PRODUCT"]);
}

async function latestReviewed(tx: Tx, lotId: string) {
  return (
    await tx.query(
      "SELECT overall_result, analyst_id FROM qms.qc_test WHERE entity_type = 'LOT' AND entity_id = $1 AND status = 'REVIEWED' ORDER BY reviewed_at DESC LIMIT 1",
      [lotId]
    )
  ).rows[0] as { overall_result: string; analyst_id: number } | undefined;
}

/**
 * QC rules of a lot's quality status (docs 02 §1.1):
 * sampling needs an effective spec and opens a QC test; release needs the latest reviewed test to pass,
 * no test still open, and a releaser who did not analyse; un-hold needs no open NCR; rejection opens an NCR.
 */
registerLotQualityGuards({
  sample: [
    {
      code: "NO_SPEC",
      message: "Vật tư chưa có tiêu chuẩn QC hiệu lực. QA cần phê duyệt tiêu chuẩn trước khi lấy mẫu.",
      check: async ({ tx, row }) => (await specForLot(tx, row)) !== null,
    },
  ],
  onSample: [
    async ({ tx, actor, row }) => {
      const spec = (await specForLot(tx, row))!;
      const origin = (await tx.query("SELECT origin FROM inv.lot WHERE id = $1", [row.id])).rows[0].origin;
      await createQcTest(tx, actor, { entity_type: "LOT", entity_id: row.id, spec_id: spec.id, test_kind: origin === "PURCHASE" ? "IQC" : "RELEASE" });
    },
  ],
  release: [
    {
      code: "QC_OPEN",
      message: "Lô còn phiếu QC chưa được duyệt.",
      check: async ({ tx, row }) =>
        !(await tx.query("SELECT 1 FROM qms.qc_test WHERE entity_type = 'LOT' AND entity_id = $1 AND status IN ('PLANNED', 'IN_PROGRESS', 'RESULTS_ENTERED')", [row.id])).rowCount,
    },
    {
      code: "QC_RESULT",
      message: "Kết quả QC được duyệt gần nhất của lô không phải ĐẠT.",
      // a concession (NCR "use as is") approved by QA and the board also allows release
      check: async ({ tx, row }) =>
        (await latestReviewed(tx, row.id))?.overall_result === "PASS" ||
        Boolean((await tx.query("SELECT 1 FROM qms.ncr WHERE lot_id = $1 AND disposition = 'USE_AS_IS' AND status IN ('APPROVED', 'CLOSED')", [row.id])).rowCount),
    },
    {
      code: "SAME_PERSON",
      message: "Người giải phóng lô phải khác người kiểm nghiệm.",
      check: async ({ tx, row, actor }) => (await latestReviewed(tx, row.id))?.analyst_id !== actor.userId,
    },
  ],
  unhold: [{ code: "OPEN_NCR", message: "Lô còn NCR chưa đóng.", check: async ({ tx, row }) => !(await hasOpenNcr(tx, row.id)) }],
  onReject: [
    async ({ tx, actor, row, reason }) => {
      if (await hasOpenNcr(tx, row.id)) return; // the failed QC test already opened one
      await raiseDeviation(tx, actor, {
        source_module: "QMS",
        entity_type: "LOT",
        entity_id: row.id,
        severity: "MEDIUM",
        description: `Loại lô ${row.code}: ${reason ?? ""}`.trim(),
        ncr: { item_id: row.item_id, lot_id: row.id },
      });
    },
  ],
});
