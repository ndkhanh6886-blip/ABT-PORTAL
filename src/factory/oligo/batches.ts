import { z } from "zod";
import type { Tx } from "../core/db";
import { writeAudit } from "../core/audit";
import { authorize, registerPermissions, type AuthzActor } from "../core/authz";
import { invalid, notFound } from "../core/errors";
import { nextNumber } from "../core/numbering";
import { parseInput } from "../core/records";
import { defineMachine, runTransition, type GuardContext } from "../core/stateMachine";
import { assertUsable } from "../asset/service";
import { allocate, findCandidates } from "../inv/allocation";
import { createStockDocument, stockDocumentMachine } from "../inv/documents";
import { releaseDemandReservations, reserve, reserveLot } from "../inv/reservations";
import { getItem, toBaseQty } from "../master/service";
import { raiseDeviation } from "../qms/incidents";
import { analyze } from "./analyzer";
import { loadCatalog } from "./catalog";
import { estimateConsumption, type ReagentRule } from "./consumption";
import { recomputeOrdersOf } from "./orders";
import { sequenceMachine } from "./sequences";
import { followInstalledBottles, reservePortLines } from "./synthPorts";

registerPermissions([
  { code: "oligo.batch.manage", description: "Lập, chạy, hoàn tất, hủy mẻ tổng hợp Oligo" },
  { code: "oligo.batch.lead", description: "Dừng (abort) mẻ tổng hợp đang chạy" },
  { code: "oligo.reagent.manage", description: "Sửa định mức hóa chất và gắn vật tư cho mẻ tổng hợp" },
]);

type BatchStatus = "PLANNED" | "RUNNING" | "COMPLETED" | "CANCELLED" | "ABORTED";
export interface Batch {
  id: string;
  code: string;
  org_unit_id: string;
  synthesizer_id: string;
  status: BatchStatus;
  version: number;
}

const DEMAND = "SYNTHESIS_BATCH" as const;

async function warehousesOf(tx: Tx, orgUnitId: string): Promise<string[]> {
  return (await tx.query("SELECT id FROM master.warehouse WHERE owner_org_unit_id = $1 AND status = 'ACTIVE'", [orgUnitId])).rows.map((r) => r.id);
}

/** Moves the batch's sequences and re-derives the status of every order they serve (pool members included). */
async function moveSequences(tx: Tx, actor: AuthzActor, batchId: string, action: string, filter: (pos: any) => boolean = () => true, reason?: string) {
  const rows = (
    await tx.query(
      `SELECT p.*, s.version AS seq_version FROM oligo.synthesis_position p JOIN oligo.oligo_sequence s ON s.id = p.sequence_id
        WHERE p.batch_id = $1 ORDER BY p.sequence_id FOR UPDATE OF s`,
      [batchId]
    )
  ).rows.filter(filter);
  for (const r of rows) {
    await runTransition(tx, sequenceMachine, actor, { id: r.sequence_id, action, expectedVersion: r.seq_version, reason }, { trusted: true });
  }
  await recomputeOrdersOf(tx, actor, rows.map((r) => r.sequence_id));
}

/** Issues everything reserved for the batch, one document per warehouse, consuming the reservations. */
async function issueReserved(tx: Tx, actor: AuthzActor, batch: Batch) {
  const res = (
    await tx.query(
      `SELECT r.id, r.item_id, r.lot_id, r.location_id, (r.qty_base - r.qty_consumed)::float AS qty, i.base_uom, loc.warehouse_id
         FROM inv.reservation r JOIN master.item i ON i.id = r.item_id JOIN master.location loc ON loc.id = r.location_id
        WHERE r.demand_entity_type = $1 AND r.demand_entity_id = $2 AND r.status = 'ACTIVE' ORDER BY loc.warehouse_id, r.id`,
      [DEMAND, batch.id]
    )
  ).rows;
  for (const wh of [...new Set(res.map((r) => r.warehouse_id))]) {
    const lines = res.filter((r) => r.warehouse_id === wh).map((r) => ({ item_id: r.item_id, lot_id: r.lot_id, from_location_id: r.location_id, qty: r.qty, uom: r.base_uom, reservation_id: r.id }));
    const doc = await createStockDocument(tx, actor, { doc_type: "ISSUE", reason_code: "SYNTHESIS", warehouse_id: wh, source_entity_type: "SYNTHESIS_BATCH", source_entity_id: batch.id, lines }, { trusted: true });
    await runTransition(tx, stockDocumentMachine, actor, { id: doc.id, action: "post", expectedVersion: doc.version }, { trusted: true });
  }
}

const finishSchema = z.object({
  positions: z.array(z.object({ position_no: z.number().int(), coupling_efficiency_pct: z.coerce.number().min(0).max(100), ok: z.boolean() })),
  reagents: z.array(z.object({ item_id: z.string().uuid(), actual_qty_base: z.coerce.number().min(0) })),
});

/** Actual minus expected consumption is booked: an extra issue (FEFO) or a return to the lot it came from. */
async function adjustToActual(tx: Tx, actor: AuthzActor, batch: Batch, reagents: z.infer<typeof finishSchema>["reagents"]) {
  const uses = (await tx.query("SELECT id, item_id, est_qty_base::float AS est FROM oligo.synthesis_reagent_use WHERE batch_id = $1", [batch.id])).rows;
  const warehouses = await warehousesOf(tx, batch.org_unit_id);
  for (const u of uses) {
    const actual = reagents.find((r) => r.item_id === u.item_id)!.actual_qty_base;
    await tx.query("UPDATE oligo.synthesis_reagent_use SET actual_qty_base = $2 WHERE id = $1", [u.id, actual]);
    const diff = Math.round((actual - u.est) * 1e6) / 1e6;
    if (diff === 0) continue;
    const item = await getItem(tx, u.item_id);
    if (diff > 0) {
      // the bottle on the port first, then FEFO
      const portLot = (await tx.query("SELECT lot_id FROM oligo.batch_port_use WHERE batch_id = $1 AND item_id = $2 LIMIT 1", [batch.id, u.item_id])).rows[0]?.lot_id;
      const cands = await findCandidates(tx, u.item_id, warehouses, { lock: true });
      const first = portLot ? allocate(cands.filter((c) => c.lot_id === portLot), diff) : { picks: [], shortfall: diff };
      const second = first.shortfall > 1e-9 ? allocate(cands.filter((c) => c.lot_id !== portLot), first.shortfall) : { picks: [], shortfall: 0 };
      const plan = { picks: [...first.picks, ...second.picks], shortfall: second.shortfall };
      if (plan.shortfall > 1e-9) throw invalid(`Không đủ tồn ${item.code} để ghi phần dùng vượt dự kiến (${diff} ${item.base_uom}).`, undefined, "INSUFFICIENT_STOCK");
      const byWh = new Map<string, any[]>();
      for (const p of plan.picks) {
        const whId = (await tx.query("SELECT warehouse_id FROM master.location WHERE id = $1", [p.candidate.location_id])).rows[0].warehouse_id;
        byWh.set(whId, [...(byWh.get(whId) ?? []), { item_id: u.item_id, lot_id: p.candidate.lot_id, from_location_id: p.candidate.location_id, qty: p.qty, uom: item.base_uom }]);
      }
      for (const [wh, lines] of byWh) {
        const doc = await createStockDocument(tx, actor, { doc_type: "ISSUE", reason_code: "SYNTHESIS", warehouse_id: wh, source_entity_type: "SYNTHESIS_BATCH", source_entity_id: batch.id, lines }, { trusted: true });
        await runTransition(tx, stockDocumentMachine, actor, { id: doc.id, action: "post", expectedVersion: doc.version }, { trusted: true });
      }
    } else {
      const src = (
        await tx.query(
          `SELECT l.lot_id, l.from_location_id, d.warehouse_id FROM inv.stock_document_line l JOIN inv.stock_document d ON d.id = l.document_id
            WHERE d.source_entity_type = 'SYNTHESIS_BATCH' AND d.source_entity_id = $1 AND l.item_id = $2 AND d.doc_type = 'ISSUE' ORDER BY d.created_at DESC, l.line_no LIMIT 1`,
          [batch.id, u.item_id]
        )
      ).rows[0];
      const doc = await createStockDocument(
        tx,
        actor,
        { doc_type: "ADJUSTMENT", reason_code: "SYNTHESIS_RETURN", warehouse_id: src.warehouse_id, source_entity_type: "SYNTHESIS_BATCH", source_entity_id: batch.id,
          lines: [{ item_id: u.item_id, lot_id: src.lot_id, to_location_id: src.from_location_id, qty: -diff, uom: item.base_uom }] },
        { trusted: true }
      );
      await runTransition(tx, stockDocumentMachine, actor, { id: doc.id, action: "post", expectedVersion: doc.version }, { trusted: true });
    }
  }
}

async function failPositions(tx: Tx, actor: AuthzActor, batch: Batch, positionNos: number[] | "ALL", reason: string) {
  const rows = (
    await tx.query("SELECT p.position_no, s.id, s.code, s.org_unit_id FROM oligo.synthesis_position p JOIN oligo.oligo_sequence s ON s.id = p.sequence_id WHERE p.batch_id = $1", [batch.id])
  ).rows.filter((r) => positionNos === "ALL" || positionNos.includes(r.position_no));
  await moveSequences(tx, actor, batch.id, "fail", (p) => rows.some((r) => r.id === p.sequence_id), reason);
  for (const r of rows) {
    await raiseDeviation(tx, actor, {
      source_module: "OLIGO",
      entity_type: "OLIGO_SEQUENCE",
      entity_id: r.id,
      severity: "MEDIUM",
      description: `Trình tự ${r.code} lỗi ở mẻ tổng hợp ${batch.code}: ${reason}`,
      step_ref: `${batch.code} #${r.position_no}`,
      ncr: {},
    });
  }
}

export const batchMachine = defineMachine<BatchStatus, Batch>({
  entityType: "synthesis_batch",
  table: "oligo.synthesis_batch",
  states: ["PLANNED", "RUNNING", "COMPLETED", "CANCELLED", "ABORTED"],
  terminal: ["COMPLETED", "CANCELLED", "ABORTED"],
  scopeOf: (row) => row.org_unit_id,
  transitions: [
    {
      action: "start",
      from: "PLANNED",
      to: "RUNNING",
      permission: "oligo.batch.manage",
      guards: [{ code: "ASSET", message: "Máy tổng hợp không sẵn sàng hoặc quá hạn hiệu chuẩn.", check: async ({ tx, row }) => assertUsable(tx, row.synthesizer_id).then(() => true, () => false) }],
      patch: ({ actor }) => ({ started_at: new Date(), operator_id: actor.userId }),
      effects: async ({ tx, actor, updated }) => {
        await followInstalledBottles(tx, actor, updated);
        await issueReserved(tx, actor, updated);
        await moveSequences(tx, actor, updated.id, "start_synthesis");
      },
    },
    {
      action: "finish",
      from: "RUNNING",
      to: "COMPLETED",
      permission: "oligo.batch.manage",
      guards: [
        {
          code: "RESULTS",
          message: "Nhập hiệu suất ghép và kết quả cho mọi vị trí, lượng thực tế cho mọi hóa chất.",
          check: async ({ tx, row, payload }) => {
            const p = finishSchema.safeParse(payload);
            if (!p.success) return false;
            const pos = (await tx.query("SELECT position_no FROM oligo.synthesis_position WHERE batch_id = $1", [row.id])).rows.map((r) => r.position_no);
            const items = (await tx.query("SELECT item_id FROM oligo.synthesis_reagent_use WHERE batch_id = $1", [row.id])).rows.map((r) => r.item_id);
            return pos.every((n) => p.data.positions.some((x) => x.position_no === n)) && items.every((i) => p.data.reagents.some((x) => x.item_id === i));
          },
        },
      ],
      patch: () => ({ finished_at: new Date() }),
      effects: async ({ tx, actor, updated, payload }: GuardContext<Batch> & { updated: Batch }) => {
        const data = finishSchema.parse(payload);
        for (const p of data.positions) {
          await tx.query("UPDATE oligo.synthesis_position SET coupling_efficiency_pct = $3, result = $4 WHERE batch_id = $1 AND position_no = $2", [
            updated.id, p.position_no, p.coupling_efficiency_pct, p.ok ? "OK" : "FAILED",
          ]);
        }
        await adjustToActual(tx, actor, updated, data.reagents);
        const okSeq = (await tx.query("SELECT sequence_id FROM oligo.synthesis_position WHERE batch_id = $1 AND result = 'OK'", [updated.id])).rows.map((r) => r.sequence_id);
        await moveSequences(tx, actor, updated.id, "synthesized", (p) => okSeq.includes(p.sequence_id));
        const failed = data.positions.filter((p) => !p.ok).map((p) => p.position_no);
        if (failed.length) await failPositions(tx, actor, updated, failed, "Tổng hợp không đạt (hiệu suất / trityl).");
      },
    },
    {
      action: "cancel",
      from: "PLANNED",
      to: "CANCELLED",
      permission: "oligo.batch.manage",
      reasonRequired: true,
      effects: async ({ tx, actor, updated, reason }) => {
        await releaseDemandReservations(tx, actor, DEMAND, updated.id, reason ?? "Hủy mẻ");
        await moveSequences(tx, actor, updated.id, "dequeue");
        await tx.query("UPDATE oligo.synthesis_position SET active = false WHERE batch_id = $1", [updated.id]);
      },
    },
    {
      action: "abort",
      from: "RUNNING",
      to: "ABORTED",
      permission: "oligo.batch.lead",
      reasonRequired: true,
      effects: async ({ tx, actor, updated, reason }) => {
        // what was issued at start stays consumed; every sequence of the batch fails with an NCR
        await failPositions(tx, actor, updated, "ALL", `Mẻ bị dừng: ${reason}`);
        await tx.query("UPDATE oligo.synthesis_position SET active = false, result = 'FAILED' WHERE batch_id = $1", [updated.id]);
      },
    },
  ],
});

const planSchema = z.object({
  org_unit_id: z.string().uuid(),
  synthesizer_id: z.string().uuid("chọn máy tổng hợp"),
  program_name: z.string().trim().max(200).optional().nullable(),
  planned_start: z.string().datetime({ offset: true }).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  positions: z.array(z.object({ sequence_id: z.string().uuid(), column_lot_id: z.string().uuid("chọn lô cột CPG") })).min(1, "chọn ít nhất một trình tự"),
});

/**
 * Plans a batch: checks the synthesizer (in service, calibrated, enough positions, scale supported),
 * claims the sequences atomically (PENDING → QUEUED; a sequence already queued elsewhere stops the plan),
 * reserves one CPG column per position and the expected reagents (FEFO, released and unexpired only).
 */
export async function planBatch(tx: Tx, actor: AuthzActor, input: unknown) {
  const data = parseInput(planSchema, input);
  await authorize(tx, actor, "oligo.batch.manage", data.org_unit_id);
  const synth = (await tx.query("SELECT s.*, a.owner_org_unit_id, a.code FROM oligo.synthesizer s JOIN asset.asset a ON a.id = s.asset_id WHERE s.asset_id = $1", [data.synthesizer_id])).rows[0];
  if (!synth || synth.owner_org_unit_id !== data.org_unit_id) throw invalid("Máy tổng hợp không thuộc phòng này.");
  await assertUsable(tx, data.synthesizer_id);
  if (data.positions.length > synth.column_positions) throw invalid(`Máy ${synth.code} chỉ có ${synth.column_positions} vị trí cột.`);
  const ids = data.positions.map((p) => p.sequence_id);
  if (new Set(ids).size !== ids.length) throw invalid("Một trình tự chỉ đặt vào một vị trí.");

  const seqs = (await tx.query("SELECT * FROM oligo.oligo_sequence WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE", [ids])).rows;
  if (seqs.length !== ids.length) throw notFound("trình tự");
  const catalog = await loadCatalog(tx);
  for (const s of seqs) {
    if (s.status !== "PENDING") throw invalid(`${s.code} đã được xếp mẻ khác hoặc không còn chờ tổng hợp. Tải lại trang.`, undefined, "SEQUENCE_TAKEN");
    if (s.org_unit_id !== data.org_unit_id) throw invalid(`${s.code} thuộc phòng khác.`);
    if (synth.supported_scales.length && !synth.supported_scales.includes(s.scale_code)) throw invalid(`Máy ${synth.code} không chạy thang ${s.scale_code} của ${s.code}.`);
  }
  const bySeq = new Map(seqs.map((s) => [s.id, s]));
  const analysed = data.positions.map((p) => {
    const s = bySeq.get(p.sequence_id);
    return { p, s, tokens: analyze(s.raw_sequence, catalog).tokens };
  });

  const rules: ReagentRule[] = (await tx.query("SELECT role, name, basis, qty::float AS qty, uom, item_id, status FROM oligo.reagent_rule")).rows;
  const amidites = new Map((await tx.query("SELECT code, amidite_item_id FROM oligo.modification")).rows.map((r) => [r.code, r.amidite_item_id]));
  let lines;
  try {
    lines = estimateConsumption(analysed.map((a) => ({ code: a.s.code, molecule_type: a.s.molecule_type, tokens: a.tokens })), rules, (c) => amidites.get(c) ?? null);
  } catch (e: any) {
    throw invalid(e.message);
  }

  const code = await nextNumber(tx, "SYNTHESIS_BATCH");
  const batch = (
    await tx.query(
      `INSERT INTO oligo.synthesis_batch (code, org_unit_id, synthesizer_id, program_name, planned_start, notes, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7) RETURNING *`,
      [code, data.org_unit_id, data.synthesizer_id, data.program_name ?? null, data.planned_start ?? null, data.notes ?? null, actor.userId]
    )
  ).rows[0] as Batch;
  const warehouses = await warehousesOf(tx, data.org_unit_id);
  for (const [i, a] of analysed.entries()) {
    await tx.query("INSERT INTO oligo.synthesis_position (batch_id, position_no, sequence_id, column_lot_id, couplings) VALUES ($1, $2, $3, $4, $5)", [
      batch.id, i + 1, a.s.id, a.p.column_lot_id, a.tokens.length,
    ]);
    await reserveLot(tx, actor, { lot_id: a.p.column_lot_id, qty_base: 1, warehouse_ids: warehouses, demand_entity_type: DEMAND, demand_entity_id: batch.id });
  }
  // roles fed by a port on the machine are held from the bottle installed there; the rest FEFO
  const ported = await reservePortLines(tx, actor, batch, lines);
  const perItem = new Map<string, number>();
  for (const l of ported.rest) {
    const itemId = l.catalog_item_id ?? l.item_id ?? null;
    if (!itemId) throw invalid(`Định mức "${l.label}" chưa gắn vật tư. Vào Tổng hợp Oligo → Định mức hóa chất để gắn mã vật tư.`, undefined, "REAGENT_UNMAPPED");
    const item = await getItem(tx, itemId);
    const qty = Math.round((await toBaseQty(tx, item, l.qty, l.uom)) * 1e6) / 1e6;
    perItem.set(itemId, (perItem.get(itemId) ?? 0) + qty);
  }
  for (const [itemId, qty] of [...perItem.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (qty <= 0) continue;
    await reserve(tx, actor, { item_id: itemId, qty_base: qty, warehouse_ids: warehouses, demand_entity_type: DEMAND, demand_entity_id: batch.id });
  }
  const total = new Map(perItem);
  for (const [itemId, qty] of ported.perItem) total.set(itemId, (total.get(itemId) ?? 0) + qty);
  for (const [itemId, qty] of [...total.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (qty <= 0) continue;
    const roles = (await tx.query("SELECT role FROM oligo.batch_port_use WHERE batch_id = $1 AND item_id = $2", [batch.id, itemId])).rows.map((r) => r.role);
    roles.push(...ported.rest.filter((l) => (l.catalog_item_id ?? l.item_id) === itemId).map((l) => l.role));
    await tx.query("INSERT INTO oligo.synthesis_reagent_use (batch_id, role, item_id, est_qty_base) VALUES ($1, $2, $3, $4)", [batch.id, roles.join(", "), itemId, Math.round(qty * 1e6) / 1e6]);
  }
  await moveSequences(tx, actor, batch.id, "queue");
  await writeAudit(tx, actor, { entityType: "synthesis_batch", entityId: batch.id, action: "plan", changes: { code: [null, code], positions: [null, analysed.length] } });
  return batch;
}
