import type { Tx } from "../core/db";
import { authorize, type AuthzActor } from "../core/authz";
import { invalid } from "../core/errors";
import { getSetting } from "../core/settings";
import { getQcTest } from "./qcTests";

export async function coaHeader(tx: Tx) {
  return { header: await getSetting<string>(tx, "company.coa_header"), footer: await getSetting<string>(tx, "company.coa_footer") };
}

/** The reviewer's e-signature of a test (meaning REVIEWED), printed on the certificate. */
export async function reviewSignature(tx: Tx, testId: string) {
  return (
    (await tx.query("SELECT signer_name, signed_at, meaning FROM core.e_signature WHERE entity_type = 'qc_test' AND entity_id = $1 AND meaning = 'REVIEWED' ORDER BY signed_at DESC LIMIT 1", [testId])).rows[0] ??
    null
  );
}

/** Certificate of analysis of one reviewed QC test (a lot, or a sequence): results as reviewed, never re-entered. */
export async function coaForTest(tx: Tx, actor: AuthzActor, testId: string) {
  await authorize(tx, actor, "qms.qc.view");
  const t = await getQcTest(tx, testId);
  if (t.status !== "REVIEWED") throw invalid("Chỉ in COA cho phiếu QC đã được duyệt.", undefined, "NOT_REVIEWED");
  const lot =
    t.entity_type === "LOT"
      ? (
          await tx.query(
            "SELECT l.code, l.mfr_lot_no, l.mfg_date, l.expiry_date, i.code AS item_code, i.name AS item_name FROM inv.lot l JOIN master.item i ON i.id = l.item_id WHERE l.id = $1",
            [t.entity_id]
          )
        ).rows[0]
      : t.entity_type === "PRODUCTION_ORDER"
        ? (
            await tx.query(
              `SELECT l.code, l.mfr_lot_no, COALESCE(po.mfg_date, l.mfg_date) AS mfg_date, COALESCE(po.expiry_date, l.expiry_date) AS expiry_date,
                      i.code AS item_code, i.name AS item_name
                 FROM kit.production_order po
                 JOIN master.item i ON i.id = po.product_item_id
                 LEFT JOIN inv.lot l ON l.id = po.lot_id
                WHERE po.id = $1`,
              [t.entity_id]
            )
          ).rows[0]
        : null;
  return { ...(await coaHeader(tx)), test: t, lot, signature: await reviewSignature(tx, testId) };
}
