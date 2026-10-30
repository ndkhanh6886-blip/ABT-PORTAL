import { z } from "zod";
import type { Tx } from "../core/db";
import { writeAudit } from "../core/audit";
import { authorize, hasFactoryPermission, registerPermissions, type AuthzActor } from "../core/authz";
import { vnToday } from "../core/dates";
import { invalid, notFound } from "../core/errors";
import { parseInput } from "../core/records";
import { runTransition } from "../core/stateMachine";
import { allocate, findCandidates, type Candidate } from "../inv/allocation";
import { createStockDocument, stockDocumentMachine } from "../inv/documents";
import { getItem, toBaseQty } from "../master/service";

registerPermissions([{ code: "asset.operate", description: "Vận hành thiết bị: lắp / thay chai hóa chất, ghi tiêu hao (chạy mẫu, rửa máy, bảo trì, hao hụt)" }]);

export const USAGE_KINDS = ["RUN", "PURGE", "MAINTENANCE", "LOSS"] as const;
const USAGE_LABEL: Record<(typeof USAGE_KINDS)[number], string> = { RUN: "Chạy mẫu", PURGE: "Rửa / cân bằng máy", MAINTENANCE: "Bảo trì", LOSS: "Hao hụt" };

async function asset(tx: Tx, id: string) {
  const a = (await tx.query("SELECT id, code, name, asset_type, owner_org_unit_id FROM asset.asset WHERE id = $1", [id])).rows[0];
  if (!a) throw notFound("thiết bị");
  return a;
}
const warehousesOf = async (tx: Tx, unit: string) =>
  (await tx.query("SELECT id FROM master.warehouse WHERE owner_org_unit_id = $1 AND status = 'ACTIVE'", [unit])).rows.map((r) => r.id as string);

const slotsSchema = z.object({
  slots: z.array(z.object({ slot_no: z.coerce.number().int().min(1).max(50), label: z.string().trim().min(1).max(60), item_id: z.string().uuid("chọn mã hàng") })).max(50),
});

/** Declares the positions of an instrument and the item each takes. A position whose item changes loses its bottle. */
export async function configureSlots(tx: Tx, actor: AuthzActor, assetId: string, input: unknown) {
  const { slots } = parseInput(slotsSchema, input);
  const a = await asset(tx, assetId);
  await authorize(tx, actor, "asset.manage", a.owner_org_unit_id);
  if (new Set(slots.map((s) => s.slot_no)).size !== slots.length) throw invalid("Trùng số vị trí.");
  for (const s of slots) await getItem(tx, s.item_id);
  const cur = (await tx.query("SELECT * FROM asset.reagent_slot WHERE asset_id = $1 FOR UPDATE", [assetId])).rows;
  for (const c of cur) {
    const next = slots.find((s) => s.slot_no === c.slot_no);
    if (next && next.item_id === c.item_id) continue;
    if (c.current_lot_id) await event(tx, actor, assetId, c.slot_no, "REMOVE", { lot_id: c.current_lot_id, notes: "Đổi cấu hình vị trí" });
    await tx.query("DELETE FROM asset.reagent_slot WHERE asset_id = $1 AND slot_no = $2", [assetId, c.slot_no]);
  }
  for (const s of slots) {
    await tx.query(
      `INSERT INTO asset.reagent_slot (asset_id, slot_no, label, item_id) VALUES ($1, $2, $3, $4)
       ON CONFLICT (asset_id, slot_no) DO UPDATE SET label = EXCLUDED.label, version = asset.reagent_slot.version + 1`,
      [assetId, s.slot_no, s.label, s.item_id]
    );
  }
  await writeAudit(tx, actor, { entityType: "asset", entityId: assetId, action: "configure_slots", changes: { slots: [cur.length, slots.map((s) => `${s.slot_no}:${s.label}`).join(" ")] } });
}

async function event(tx: Tx, actor: AuthzActor, assetId: string, slotNo: number, kind: string, f: Record<string, unknown>) {
  await tx.query(
    `INSERT INTO asset.slot_event (asset_id, slot_no, event, lot_id, usage_kind, qty_base, stock_document_id, source_ref, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [assetId, slotNo, kind, f.lot_id ?? null, f.usage_kind ?? null, f.qty ?? null, f.doc ?? null, f.source_ref ?? null, f.notes ?? null, actor.userId]
  );
}

async function lockSlot(tx: Tx, assetId: string, slotNo: number) {
  const s = (await tx.query("SELECT * FROM asset.reagent_slot WHERE asset_id = $1 AND slot_no = $2 FOR UPDATE", [assetId, slotNo])).rows[0];
  if (!s) throw notFound(`vị trí ${slotNo}`);
  return s;
}

/** Puts a bottle on a position (released, unexpired lot of the position's item, in stock) or takes it off. */
export async function setSlotBottle(tx: Tx, actor: AuthzActor, assetId: string, slotNo: number, input: unknown) {
  const { lot_id } = parseInput(z.object({ lot_id: z.string().uuid().nullable() }), input);
  const a = await asset(tx, assetId);
  await authorize(tx, actor, "asset.operate", a.owner_org_unit_id);
  const slot = await lockSlot(tx, assetId, slotNo);
  if (lot_id) {
    const lot = (await tx.query("SELECT code, item_id, status, expiry_date FROM inv.lot WHERE id = $1", [lot_id])).rows[0];
    if (!lot) throw notFound("lô");
    if (lot.item_id !== slot.item_id) throw invalid(`Lô ${lot.code} không phải mã hàng của vị trí ${slot.label}.`, undefined, "WRONG_ITEM");
    if (lot.status !== "RELEASED") throw invalid(`Lô ${lot.code} chưa được giải phóng (QC).`, undefined, "LOT_NOT_RELEASED");
    if (lot.expiry_date && lot.expiry_date < vnToday()) throw invalid(`Lô ${lot.code} đã hết hạn.`, undefined, "LOT_EXPIRED");
    if (!(await lotCandidates(tx, a, slot.item_id, lot_id)).length) throw invalid(`Lô ${lot.code} không còn tồn khả dụng trong kho của phòng.`, undefined, "INSUFFICIENT_STOCK");
  }
  if (slot.current_lot_id) await event(tx, actor, assetId, slotNo, "REMOVE", { lot_id: slot.current_lot_id });
  await tx.query("UPDATE asset.reagent_slot SET current_lot_id = $3, installed_at = now(), installed_by = $4, version = version + 1 WHERE asset_id = $1 AND slot_no = $2", [
    assetId, slotNo, lot_id, actor.userId,
  ]);
  if (lot_id) await event(tx, actor, assetId, slotNo, "INSTALL", { lot_id });
}

async function lotCandidates(tx: Tx, a: { owner_org_unit_id: string }, itemId: string, lotId: string, lock = false): Promise<Candidate[]> {
  return (await findCandidates(tx, itemId, await warehousesOf(tx, a.owner_org_unit_id), { lock })).filter((c) => c.lot_id === lotId);
}

async function issueFrom(tx: Tx, actor: AuthzActor, picks: { candidate: Candidate; qty: number }[], itemId: string, uom: string, reason: string, source: { type: string; id: string }) {
  let first: string | null = null;
  const byWh = new Map<string, any[]>();
  for (const p of picks) {
    const wh = (await tx.query("SELECT warehouse_id FROM master.location WHERE id = $1", [p.candidate.location_id])).rows[0].warehouse_id;
    byWh.set(wh, [...(byWh.get(wh) ?? []), { item_id: itemId, lot_id: p.candidate.lot_id, from_location_id: p.candidate.location_id, qty: p.qty, uom }]);
  }
  for (const [wh, lines] of byWh) {
    const doc = await createStockDocument(tx, actor, { doc_type: "ISSUE", reason_code: reason, warehouse_id: wh, source_entity_type: source.type, source_entity_id: source.id, lines }, { trusted: true });
    await runTransition(tx, stockDocumentMachine, actor, { id: doc.id, action: "post", expectedVersion: doc.version }, { trusted: true });
    first ??= doc.id;
  }
  return first;
}

const usageSchema = z.object({ kind: z.enum(USAGE_KINDS), qty: z.coerce.number().positive("lượng phải lớn hơn 0"), uom: z.string().min(1).optional(), notes: z.string().trim().max(500).optional().nullable() });

/** Usage outside a sample run (purge, maintenance, loss) — or a run logged by hand — issued from the bottle on the position. */
export async function logSlotUsage(tx: Tx, actor: AuthzActor, assetId: string, slotNo: number, input: unknown) {
  const d = parseInput(usageSchema, input);
  const a = await asset(tx, assetId);
  await authorize(tx, actor, "asset.operate", a.owner_org_unit_id);
  const slot = await lockSlot(tx, assetId, slotNo);
  if (!slot.current_lot_id) throw invalid(`Vị trí ${slot.label} chưa lắp chai.`, undefined, "SLOT_EMPTY");
  const item = await getItem(tx, slot.item_id);
  const qty = Math.round((await toBaseQty(tx, item, d.qty, d.uom ?? item.base_uom)) * 1e6) / 1e6;
  const plan = allocate(await lotCandidates(tx, a, slot.item_id, slot.current_lot_id, true), qty);
  if (plan.shortfall > 1e-9) throw invalid(`Chai đang lắp ở ${slot.label} không đủ tồn sổ sách (${qty} ${item.base_uom}). Thay chai hoặc kiểm kê.`, undefined, "INSUFFICIENT_STOCK");
  const doc = await issueFrom(tx, actor, plan.picks, slot.item_id, item.base_uom, `EQUIPMENT_${d.kind}`, { type: "ASSET", id: assetId });
  await event(tx, actor, assetId, slotNo, "USAGE", { lot_id: slot.current_lot_id, usage_kind: d.kind, qty, doc, notes: d.notes });
  return { qty_base: qty };
}

/**
 * A step reagent drawn on an instrument used in the same step (e.g. HPLC buffer during the run): taken from the
 * bottle on the matching position first, recorded as a RUN usage. Returns what is still to issue (FEFO).
 */
export async function drawFromInstrument(tx: Tx, actor: AuthzActor, assetIds: string[], itemId: string, qtyBase: number, source: { type: string; id: string; ref: string }) {
  let left = qtyBase;
  const docs: string[] = [];
  for (const assetId of assetIds) {
    if (left <= 1e-9) break;
    const slot = (await tx.query("SELECT * FROM asset.reagent_slot WHERE asset_id = $1 AND item_id = $2 AND current_lot_id IS NOT NULL ORDER BY slot_no LIMIT 1 FOR UPDATE", [assetId, itemId])).rows[0];
    if (!slot) continue;
    const a = await asset(tx, assetId);
    const plan = allocate(await lotCandidates(tx, a, itemId, slot.current_lot_id, true), left);
    const taken = plan.picks.reduce((n, p) => n + p.qty, 0);
    if (taken <= 0) continue;
    const item = await getItem(tx, itemId);
    const doc = await issueFrom(tx, actor, plan.picks, itemId, item.base_uom, "POST_SYNTHESIS", source);
    if (doc) docs.push(doc);
    await event(tx, actor, assetId, slot.slot_no, "USAGE", { lot_id: slot.current_lot_id, usage_kind: "RUN", qty: taken, doc, source_ref: source.ref });
    left = Math.round((left - taken) * 1e6) / 1e6;
  }
  return { left, docs };
}

export async function listSlots(tx: Tx, actor: AuthzActor, assetId: string) {
  const a = await asset(tx, assetId);
  if (!(await hasFactoryPermission(tx, actor, "asset.view", a.owner_org_unit_id)) && !(await hasFactoryPermission(tx, actor, "oligo.view", a.owner_org_unit_id))) throw notFound("thiết bị");
  const slots = (
    await tx.query(
      `SELECT s.slot_no, s.label, s.item_id, s.current_lot_id, s.installed_at, i.code AS item_code, i.name AS item_name, i.base_uom, l.code AS lot_code, l.expiry_date
         FROM asset.reagent_slot s JOIN master.item i ON i.id = s.item_id LEFT JOIN inv.lot l ON l.id = s.current_lot_id
        WHERE s.asset_id = $1 ORDER BY s.slot_no`,
      [assetId]
    )
  ).rows;
  const warehouses = await warehousesOf(tx, a.owner_org_unit_id);
  for (const s of slots) {
    const cands = await findCandidates(tx, s.item_id, warehouses);
    const byLot = new Map<string, any>();
    for (const c of cands) {
      if (!c.lot_id) continue;
      const cur = byLot.get(c.lot_id) ?? { lot_id: c.lot_id, code: c.lot_code, available: 0, expiry_date: c.expiry_date };
      cur.available += Number(c.available);
      byLot.set(c.lot_id, cur);
    }
    s.lots = [...byLot.values()];
    s.available = s.current_lot_id ? byLot.get(s.current_lot_id)?.available ?? 0 : null;
    // what the bottle now on the position has been used for since it was installed
    s.usage = s.current_lot_id
      ? (
          await tx.query(
            `SELECT usage_kind, sum(qty_base)::float AS qty FROM asset.slot_event
              WHERE asset_id = $1 AND slot_no = $2 AND lot_id = $3 AND event = 'USAGE' AND created_at >= $4 GROUP BY usage_kind`,
            [assetId, s.slot_no, s.current_lot_id, s.installed_at]
          )
        ).rows.map((r) => ({ kind: r.usage_kind, label: USAGE_LABEL[r.usage_kind as keyof typeof USAGE_LABEL], qty: r.qty }))
      : [];
  }
  const events = (
    await tx.query(
      `SELECT e.slot_no, e.event, e.usage_kind, e.qty_base::float AS qty, e.source_ref, e.notes, e.created_at, l.code AS lot_code, p.display_name AS by_name
         FROM asset.slot_event e LEFT JOIN inv.lot l ON l.id = e.lot_id LEFT JOIN core.user_profile p ON p.user_id = e.created_by
        WHERE e.asset_id = $1 ORDER BY e.created_at DESC LIMIT 100`,
      [assetId]
    )
  ).rows;
  return { asset: a, slots, events };
}
