import { z } from "zod";
import type { Tx } from "../core/db";
import { writeAudit } from "../core/audit";
import { authorize, type AuthzActor } from "../core/authz";
import { vnToday } from "../core/dates";
import { conflict, invalid, notFound } from "../core/errors";
import { parseInput } from "../core/records";
import { runTransition } from "../core/stateMachine";
import { allocate, findCandidates } from "../inv/allocation";
import { createStockDocument, stockDocumentMachine } from "../inv/documents";
import { releaseDemandLotReservations, reserveLot } from "../inv/reservations";
import { getItem, toBaseQty } from "../master/service";
import { analyze } from "./analyzer";
import { loadCatalog } from "./catalog";
import { estimateConsumption, type ConsumptionLine, type ReagentRule } from "./consumption";

const DEMAND = "SYNTHESIS_BATCH" as const;

export interface Port {
  synthesizer_id: string;
  port_no: number;
  role: string;
  label: string | null;
  item_id?: string | null;
  current_lot_id: string | null;
  installed_at?: string | null;
  open_stability_hours?: number | null;
  version: number;
}

function assertPortOpenStability(p: { port_no: number; role: string; installed_at?: string | Date | null; open_stability_hours?: number | null }) {
  if (p.open_stability_hours && p.installed_at) {
    const elapsedMs = Date.now() - new Date(p.installed_at).getTime();
    if (elapsedMs > Number(p.open_stability_hours) * 3600_000) {
      throw invalid(
        `Hóa chất trên cổng ${p.port_no} (${p.role}) đã quá hạn mở nắp (${p.open_stability_hours}h). Thay chai mới trước khi chạy mẻ.`,
        undefined,
        "REAGENT_OPEN_EXPIRED"
      );
    }
  }
}

let synthPortSchemaEnsured = false;
async function ensureSynthPortSchema(_tx: Tx) {
  synthPortSchemaEnsured = true;
}

async function synthesizer(tx: Tx, id: string) {
  await ensureSynthPortSchema(tx);
  const s = (await tx.query("SELECT s.*, a.code, a.name, a.owner_org_unit_id FROM oligo.synthesizer s JOIN asset.asset a ON a.id = s.asset_id WHERE s.asset_id = $1", [id])).rows[0];
  if (!s) throw notFound("máy tổng hợp");
  return s;
}
const warehousesOf = async (tx: Tx, unit: string) =>
  (await tx.query("SELECT id FROM master.warehouse WHERE owner_org_unit_id = $1 AND status = 'ACTIVE'", [unit])).rows.map((r) => r.id as string);
const runningBatch = async (tx: Tx, synthId: string) =>
  (await tx.query("SELECT code FROM oligo.synthesis_batch WHERE synthesizer_id = $1 AND status = 'RUNNING' LIMIT 1", [synthId])).rows[0]?.code as string | undefined;

/** The stock item a port role draws: explicit port item_id first, then the reagent rule's item, or a modification's own amidite (else MOD_DEFAULT's). */
export async function itemForRole(tx: Tx, role: string, portItemId?: string | null): Promise<string | null> {
  if (portItemId) return portItemId;
  if (role.startsWith("MOD:")) {
    const m = (await tx.query("SELECT amidite_item_id FROM oligo.modification WHERE code = $1", [role.slice(4)])).rows[0];
    if (m?.amidite_item_id) return m.amidite_item_id;
    return (await tx.query("SELECT item_id FROM oligo.reagent_rule WHERE role = 'MOD_DEFAULT'")).rows[0]?.item_id ?? null;
  }
  return (await tx.query("SELECT item_id FROM oligo.reagent_rule WHERE role = $1", [role])).rows[0]?.item_id ?? null;
}

async function roleExists(tx: Tx, role: string) {
  if (role.startsWith("MOD:")) return Boolean((await tx.query("SELECT 1 FROM oligo.modification WHERE code = $1 AND status = 'ACTIVE'", [role.slice(4)])).rowCount);
  return Boolean((await tx.query("SELECT 1 FROM oligo.reagent_rule WHERE role = $1 AND status = 'ACTIVE'", [role])).rowCount);
}

/** A lot may go on a port when it is the role's item, released, unexpired and in stock in the department's warehouses. */
async function checkLotForRole(tx: Tx, synth: any, role: string, lotId: string, portItemId?: string | null) {
  const itemId = await itemForRole(tx, role, portItemId);
  if (!itemId) throw invalid(`Vai trò ${role} chưa gắn mã hàng: chọn mã hóa chất kho ngay trên cổng hoặc ở Định mức hóa chất trước khi lắp chai.`, undefined, "REAGENT_UNMAPPED");
  const lot = (await tx.query("SELECT id, code, item_id, status, expiry_date FROM inv.lot WHERE id = $1", [lotId])).rows[0];
  if (!lot) throw notFound("lô");
  if (lot.item_id !== itemId) throw invalid(`Lô ${lot.code} không phải mã hàng của vai trò ${role}.`, undefined, "WRONG_ITEM");
  if (lot.status !== "RELEASED") throw invalid(`Lô ${lot.code} chưa được giải phóng (QC).`, undefined, "LOT_NOT_RELEASED");
  if (lot.expiry_date && lot.expiry_date < vnToday()) throw invalid(`Lô ${lot.code} đã hết hạn.`, undefined, "LOT_EXPIRED");
  const prep = (
    await tx.query(
      "SELECT code, incubation_until, incubated_at FROM prep.preparation WHERE lot_id = $1 ORDER BY id DESC LIMIT 1",
      [lotId]
    )
  ).rows[0];
  if (prep && prep.incubation_until && !prep.incubated_at && String(prep.incubation_until).slice(0, 10) >= vnToday()) {
    throw invalid(
      `Lô hóa chất pha chế ${lot.code} (mẻ ${prep.code}) đang trong thời gian ủ (Incubation đến ${String(prep.incubation_until).slice(0, 10)}), chưa xác nhận hoàn tất ủ nên chưa được lắp lên cổng máy.`,
      undefined,
      "INCUBATION_INCOMPLETE"
    );
  }
  const free = (await findCandidates(tx, itemId, await warehousesOf(tx, synth.owner_org_unit_id))).filter((c) => c.lot_id === lotId);
  if (!free.length) throw invalid(`Lô ${lot.code} không còn tồn khả dụng trong kho của phòng.`, undefined, "INSUFFICIENT_STOCK");
  return { lot, itemId };
}

const portsSchema = z.object({
  ports: z
    .array(
      z.object({
        port_no: z.coerce.number().int().min(1).max(200),
        role: z.string().trim().min(1).max(60),
        label: z.string().trim().max(100).optional().nullable(),
        item_id: z.string().uuid().optional().nullable(),
        current_lot_id: z.string().uuid().optional().nullable(),
        open_stability_hours: z.coerce.number().int().positive().max(8760).optional().nullable(),
      })
    )
    .max(200),
});

/** Declares which reagent each port feeds. Not while the machine runs; a port whose role changes loses its bottle. */
export async function configurePorts(tx: Tx, actor: AuthzActor, synthId: string, input: unknown) {
  const { ports } = parseInput(portsSchema, input);
  const synth = await synthesizer(tx, synthId);
  await authorize(tx, actor, "asset.manage", synth.owner_org_unit_id);
  const running = await runningBatch(tx, synthId);
  if (running) throw conflict(`Máy đang chạy mẻ ${running}: cấu hình cổng sau khi mẻ kết thúc.`, "SYNTHESIZER_RUNNING");
  if (new Set(ports.map((p) => p.port_no)).size !== ports.length) throw invalid("Trùng số cổng.");
  if (new Set(ports.map((p) => p.role)).size !== ports.length) throw invalid("Mỗi hóa chất chỉ gắn một cổng trên một máy.");
  for (const p of ports) if (!(await roleExists(tx, p.role))) throw invalid(`Vai trò "${p.role}" không có trong định mức / danh mục modification.`);

  // Đồng bộ mã hóa chất kho (item_id) nếu người dùng chọn trực tiếp trên cổng
  for (const p of ports) {
    if (p.item_id) {
      await getItem(tx, p.item_id);
      if (p.role.startsWith("MOD:")) {
        await tx.query("UPDATE oligo.modification SET amidite_item_id = $2, version = version + 1 WHERE code = $1", [p.role.slice(4), p.item_id]);
      } else {
        await tx.query("UPDATE oligo.reagent_rule SET item_id = $2, version = version + 1 WHERE role = $1", [p.role, p.item_id]);
      }
    }
  }

  const cur: Port[] = (await tx.query("SELECT * FROM oligo.synth_port WHERE synthesizer_id = $1 ORDER BY port_no FOR UPDATE", [synthId])).rows;
  for (const c of cur) {
    const next = ports.find((p) => p.port_no === c.port_no);
    if (next && next.role === c.role) continue;
    if (c.current_lot_id) await event(tx, actor, synthId, c.port_no, c.role, "REMOVE", { old_lot_id: c.current_lot_id, notes: "Đổi cấu hình cổng" });
    await tx.query("DELETE FROM oligo.synth_port WHERE synthesizer_id = $1 AND port_no = $2", [synthId, c.port_no]);
  }
  for (const p of ports) {
    const resolvedItemId = p.item_id ?? (await itemForRole(tx, p.role));
    await tx.query(
      `INSERT INTO oligo.synth_port (synthesizer_id, port_no, role, label, item_id, open_stability_hours) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (synthesizer_id, port_no) DO UPDATE
         SET label = EXCLUDED.label,
             item_id = EXCLUDED.item_id,
             open_stability_hours = CASE WHEN $7 THEN EXCLUDED.open_stability_hours ELSE oligo.synth_port.open_stability_hours END,
             version = oligo.synth_port.version + 1`,
      [synthId, p.port_no, p.role, p.label ?? null, resolvedItemId, p.open_stability_hours ?? null, p.open_stability_hours !== undefined]
    );
    if (p.current_lot_id !== undefined) {
      const existingPort = cur.find((c) => c.port_no === p.port_no && c.role === p.role);
      if (p.current_lot_id !== (existingPort?.current_lot_id ?? null)) {
        if (p.current_lot_id) {
          await checkLotForRole(tx, synth, p.role, p.current_lot_id, resolvedItemId);
        }
        await tx.query(
          "UPDATE oligo.synth_port SET current_lot_id = $3, installed_at = now(), installed_by = $4 WHERE synthesizer_id = $1 AND port_no = $2",
          [synthId, p.port_no, p.current_lot_id, actor.userId]
        );
        await event(tx, actor, synthId, p.port_no, p.role, p.current_lot_id ? "INSTALL" : "REMOVE", {
          lot_id: p.current_lot_id,
          old_lot_id: existingPort?.current_lot_id ?? null,
        });
      }
    }
  }
  await writeAudit(tx, actor, {
    entityType: "synthesizer",
    entityId: synthId,
    action: "configure_ports",
    changes: { ports: [cur.map((c) => `${c.port_no}:${c.role}`).join(" "), ports.map((p) => `${p.port_no}:${p.role}`).join(" ")] },
  });
  return listPorts(tx, actor, synthId);
}

async function event(tx: Tx, actor: AuthzActor, synthId: string, portNo: number, role: string, kind: string, f: Record<string, unknown>) {
  await tx.query(
    `INSERT INTO oligo.bottle_event (synthesizer_id, port_no, role, event, lot_id, old_lot_id, batch_id, swap_cycle, qty_moved_base, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [synthId, portNo, role, kind, f.lot_id ?? null, f.old_lot_id ?? null, f.batch_id ?? null, f.swap_cycle ?? null, f.qty ?? null, f.notes ?? null, actor.userId]
  );
}

async function lockPort(tx: Tx, synthId: string, portNo: number): Promise<Port> {
  const p = (await tx.query("SELECT * FROM oligo.synth_port WHERE synthesizer_id = $1 AND port_no = $2 FOR UPDATE", [synthId, portNo])).rows[0];
  if (!p) throw notFound(`cổng ${portNo}`);
  return p;
}

/** Puts a bottle (lot) on a port, or takes it off (lot_id null). Between runs only: during a run use the bottle change of the batch. */
export async function setBottle(tx: Tx, actor: AuthzActor, synthId: string, portNo: number, input: unknown) {
  const { lot_id } = parseInput(z.object({ lot_id: z.string().uuid().nullable() }), input);
  const synth = await synthesizer(tx, synthId);
  await authorize(tx, actor, "oligo.batch.manage", synth.owner_org_unit_id);
  const running = await runningBatch(tx, synthId);
  if (running) throw conflict(`Máy đang chạy mẻ ${running}: thay chai trong mẻ (ghi chu kỳ thay) ở màn hình mẻ.`, "SYNTHESIZER_RUNNING");
  const port = await lockPort(tx, synthId, portNo);
  if (lot_id) await checkLotForRole(tx, synth, port.role, lot_id, port.item_id);
  await tx.query("UPDATE oligo.synth_port SET current_lot_id = $3, installed_at = now(), installed_by = $4, version = version + 1 WHERE synthesizer_id = $1 AND port_no = $2", [
    synthId, portNo, lot_id, actor.userId,
  ]);
  await event(tx, actor, synthId, portNo, port.role, lot_id ? "INSTALL" : "REMOVE", { lot_id, old_lot_id: port.current_lot_id });
}

const DEFAULT_SYNTH_PORTS: { port_no: number; role: string; label: string }[] = [
  { port_no: 1, role: "dA", label: "Bottle 1 — dA Amidite" },
  { port_no: 2, role: "dC", label: "Bottle 2 — dC Amidite" },
  { port_no: 3, role: "dG", label: "Bottle 3 — dG Amidite" },
  { port_no: 4, role: "dT", label: "Bottle 4 — dT Amidite" },
  { port_no: 5, role: "DEBLOCK", label: "Bottle 5 — TCA Deblock" },
  { port_no: 6, role: "ACTIVATOR", label: "Bottle 6 — ETT Activator" },
  { port_no: 7, role: "CAP_A", label: "Bottle 7 — Cap A (THF/Ac2O)" },
  { port_no: 8, role: "CAP_B", label: "Bottle 8 — Cap B (NMI)" },
  { port_no: 9, role: "OXIDATION", label: "Bottle 9 — Iodine Oxidizer" },
  { port_no: 10, role: "ACN", label: "Bottle 10 — Acetonitrile Wash" },
];

export async function listPorts(tx: Tx, actor: AuthzActor, synthId: string) {
  const synth = await synthesizer(tx, synthId);
  await authorize(tx, actor, "oligo.view", synth.owner_org_unit_id);
  const warehouses = await warehousesOf(tx, synth.owner_org_unit_id);

  // Tự động khởi tạo 10 cổng hóa chất chuẩn nếu máy chưa có cổng nào và chưa từng bị xóa cấu hình
  const existingCount = Number((await tx.query("SELECT count(*)::int AS c FROM oligo.synth_port WHERE synthesizer_id = $1", [synthId])).rows[0]?.c || 0);
  if (existingCount === 0) {
    const everConfigured = (
      await tx.query(
        "SELECT 1 FROM core.audit_log WHERE entity_type = 'synthesizer' AND entity_id = $1 AND action = 'configure_ports' LIMIT 1",
        [synthId]
      )
    ).rowCount;
    if (!everConfigured) {
      for (const dp of DEFAULT_SYNTH_PORTS) {
        const itemId = await itemForRole(tx, dp.role);
        let firstLotId: string | null = null;
        if (itemId) {
          const cands = await findCandidates(tx, itemId, warehouses);
          firstLotId = cands.find((c) => c.lot_id && Number(c.available) > 0)?.lot_id ?? null;
        }
        await tx.query(
          `INSERT INTO oligo.synth_port (synthesizer_id, port_no, role, label, item_id, current_lot_id, installed_at)
           VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $6::uuid IS NOT NULL THEN now() ELSE NULL END)
           ON CONFLICT (synthesizer_id, port_no) DO NOTHING`,
          [synthId, dp.port_no, dp.role, dp.label, itemId, firstLotId]
        );
      }
    }
  }

  const ports = (
    await tx.query(
      `SELECT p.port_no, p.role, p.label, p.item_id, p.current_lot_id, p.installed_at, p.open_stability_hours, l.code AS lot_code, l.expiry_date, r.name AS rule_name, r.display_name, r.qty::float AS rule_qty, r.uom AS rule_uom, r.basis AS rule_basis
         FROM oligo.synth_port p LEFT JOIN inv.lot l ON l.id = p.current_lot_id LEFT JOIN oligo.reagent_rule r ON r.role = p.role
        WHERE p.synthesizer_id = $1 ORDER BY p.port_no`,
      [synthId]
    )
  ).rows;
  for (const p of ports) {
    const itemId = await itemForRole(tx, p.role, p.item_id);
    p.item = itemId ? await getItem(tx, itemId).then((i) => ({ id: i.id, code: i.code, name: i.name, base_uom: i.base_uom })) : null;
    p.item_id = p.item?.id ?? null;
    const cands = itemId ? await findCandidates(tx, itemId, warehouses) : [];
    const byLot = new Map<string, { lot_id: string; available: number; expiry_date: string | null }>();
    for (const c of cands) {
      if (!c.lot_id) continue;
      const cur = byLot.get(c.lot_id) ?? { lot_id: c.lot_id, available: 0, expiry_date: c.expiry_date ?? null };
      cur.available += Number(c.available);
      byLot.set(c.lot_id, cur);
    }
    const codes = byLot.size ? (await tx.query("SELECT id, code FROM inv.lot WHERE id = ANY($1::uuid[])", [[...byLot.keys()]])).rows : [];
    p.lots = [...byLot.values()].map((l) => ({ ...l, code: codes.find((c) => c.id === l.lot_id)?.code }));
    p.available = p.current_lot_id ? byLot.get(p.current_lot_id)?.available ?? 0 : null;
  }
  const events = (
    await tx.query(
      `SELECT e.port_no, e.role, e.event, e.swap_cycle, e.qty_moved_base::float AS qty, e.created_at, l.code AS lot_code, o.code AS old_lot_code, b.code AS batch_code
         FROM oligo.bottle_event e LEFT JOIN inv.lot l ON l.id = e.lot_id LEFT JOIN inv.lot o ON o.id = e.old_lot_id LEFT JOIN oligo.synthesis_batch b ON b.id = e.batch_id
        WHERE e.synthesizer_id = $1 ORDER BY e.created_at DESC LIMIT 50`,
      [synthId]
    )
  ).rows;
  return { synthesizer: { id: synth.asset_id, code: synth.code, name: synth.name }, ports, events };
}

// ---- used by synthesis batches ----

/**
 * Plan: lines whose role has a port on the machine are reserved from the bottle on that port (it must be
 * installed); the rest are returned for the usual FEFO reservation. Records which bottle the batch holds.
 */
export async function reservePortLines(tx: Tx, actor: AuthzActor, batch: { id: string; synthesizer_id: string; org_unit_id: string }, lines: ConsumptionLine[]) {
  const ports: Port[] = (await tx.query("SELECT * FROM oligo.synth_port WHERE synthesizer_id = $1 ORDER BY port_no FOR UPDATE", [batch.synthesizer_id])).rows;
  const warehouses = await warehousesOf(tx, batch.org_unit_id);
  const rest: ConsumptionLine[] = [];
  const perItem = new Map<string, number>();
  for (const l of lines) {
    const port = ports.find((p) => p.role === l.role);
    if (!port) {
      rest.push(l);
      continue;
    }
    if (!port.current_lot_id) throw invalid(`Cổng ${port.port_no} (${l.label}) chưa lắp chai. Lắp chai ở tab Thiết bị & định mức trước khi lập mẻ.`, undefined, "PORT_EMPTY");
    assertPortOpenStability(port);
    const itemId = (await tx.query("SELECT item_id FROM inv.lot WHERE id = $1", [port.current_lot_id])).rows[0].item_id;
    const qty = Math.round((await toBaseQty(tx, await getItem(tx, itemId), l.qty, l.uom)) * 1e6) / 1e6;
    if (qty > 0) await reserveLot(tx, actor, { lot_id: port.current_lot_id, qty_base: qty, warehouse_ids: warehouses, demand_entity_type: DEMAND, demand_entity_id: batch.id });
    await tx.query("INSERT INTO oligo.batch_port_use (batch_id, port_no, role, item_id, lot_id, qty_base) VALUES ($1, $2, $3, $4, $5, $6)", [
      batch.id, port.port_no, l.role, itemId, port.current_lot_id, qty,
    ]);
    perItem.set(itemId, (perItem.get(itemId) ?? 0) + qty);
  }
  return { rest, perItem };
}

/** Start: a bottle changed on a port since the plan moves the batch's hold to the bottle now installed. */
export async function followInstalledBottles(tx: Tx, actor: AuthzActor, batch: { id: string; code: string; synthesizer_id: string; org_unit_id: string }) {
  await tx.query("SELECT * FROM oligo.synth_port WHERE synthesizer_id = $1 ORDER BY port_no FOR UPDATE", [batch.synthesizer_id]);
  const uses = (
    await tx.query(
      `SELECT u.*, p.current_lot_id, p.installed_at, p.open_stability_hours
         FROM oligo.batch_port_use u
         LEFT JOIN oligo.synth_port p ON p.synthesizer_id = $2 AND p.role = u.role
        WHERE u.batch_id = $1 ORDER BY u.role`,
      [batch.id, batch.synthesizer_id]
    )
  ).rows;
  const warehouses = await warehousesOf(tx, batch.org_unit_id);
  for (const u of uses) {
    assertPortOpenStability({
      port_no: u.port_no,
      role: u.role,
      installed_at: u.installed_at,
      open_stability_hours: u.open_stability_hours,
    });
    if (u.current_lot_id === u.lot_id) continue;
    if (!u.current_lot_id) throw invalid(`Cổng ${u.port_no} (${u.role}) đang không có chai.`, undefined, "PORT_EMPTY");
    await releaseDemandLotReservations(tx, actor, DEMAND, batch.id, u.lot_id, `Đổi chai trên cổng ${u.port_no} trước khi chạy mẻ ${batch.code}`);
    // other roles of the batch on the old lot (rare) keep their hold
    const others = uses.filter((o) => o.lot_id === u.lot_id && o.role !== u.role && o.current_lot_id === o.lot_id);
    for (const o of others) await reserveLot(tx, actor, { lot_id: o.lot_id, qty_base: Number(o.qty_base), warehouse_ids: warehouses, demand_entity_type: DEMAND, demand_entity_id: batch.id });
    if (Number(u.qty_base) > 0) await reserveLot(tx, actor, { lot_id: u.current_lot_id, qty_base: Number(u.qty_base), warehouse_ids: warehouses, demand_entity_type: DEMAND, demand_entity_id: batch.id });
    await tx.query("UPDATE oligo.batch_port_use SET lot_id = $3 WHERE batch_id = $1 AND role = $2", [batch.id, u.role, u.current_lot_id]);
  }
}

async function postDoc(tx: Tx, actor: AuthzActor, doc: Parameters<typeof createStockDocument>[2]) {
  const d = await createStockDocument(tx, actor, doc, { trusted: true });
  await runTransition(tx, stockDocumentMachine, actor, { id: d.id, action: "post", expectedVersion: d.version }, { trusted: true });
}

const swapSchema = z.object({ port_no: z.coerce.number().int().min(1), lot_id: z.string().uuid("chọn lô chai mới"), cycle: z.coerce.number().int().min(2, "chu kỳ thay chai từ 2 trở đi") });

/**
 * Bottle change during a run, as in OligoFlow: from `cycle` on the new bottle feeds the port. The estimated
 * consumption of the remaining cycles goes back to the old lot and is issued from the new one.
 */
export async function swapBottle(tx: Tx, actor: AuthzActor, batchId: string, input: unknown) {
  const data = parseInput(swapSchema, input);
  const batch = (await tx.query("SELECT * FROM oligo.synthesis_batch WHERE id = $1 FOR UPDATE", [batchId])).rows[0];
  if (!batch) throw notFound("mẻ tổng hợp");
  await authorize(tx, actor, "oligo.batch.manage", batch.org_unit_id);
  if (batch.status !== "RUNNING") throw invalid("Chỉ thay chai trong lúc mẻ đang chạy.");
  const synth = await synthesizer(tx, batch.synthesizer_id);
  const port = await lockPort(tx, batch.synthesizer_id, data.port_no);
  const use = (await tx.query("SELECT * FROM oligo.batch_port_use WHERE batch_id = $1 AND role = $2 FOR UPDATE", [batchId, port.role])).rows[0];
  if (!use) throw invalid(`Mẻ ${batch.code} không dùng hóa chất của cổng ${data.port_no}.`);
  if (use.lot_id === data.lot_id) throw invalid("Chai mới trùng lô chai đang lắp.");
  const { lot } = await checkLotForRole(tx, synth, port.role, data.lot_id);

  const seqs = (
    await tx.query("SELECT s.code, s.raw_sequence, s.molecule_type FROM oligo.synthesis_position p JOIN oligo.oligo_sequence s ON s.id = p.sequence_id WHERE p.batch_id = $1", [batchId])
  ).rows;
  const catalog = await loadCatalog(tx);
  const analysed = seqs.map((s) => ({ code: s.code, molecule_type: s.molecule_type, tokens: analyze(s.raw_sequence, catalog).tokens, fromCycle: data.cycle }));
  const maxCycles = Math.max(...analysed.map((a) => a.tokens.length));
  if (data.cycle > maxCycles) throw invalid(`Chu kỳ thay phải từ 2 đến ${maxCycles}.`);
  const rules: ReagentRule[] = (await tx.query("SELECT role, name, basis, qty::float AS qty, uom, item_id, status FROM oligo.reagent_rule")).rows;
  const amidites = new Map((await tx.query("SELECT code, amidite_item_id FROM oligo.modification")).rows.map((r) => [r.code, r.amidite_item_id]));
  const line = estimateConsumption(analysed, rules, (c) => amidites.get(c) ?? null).find((l) => l.role === port.role);
  const item = await getItem(tx, use.item_id);
  const qty = line ? Math.round((await toBaseQty(tx, item, line.qty, line.uom)) * 1e6) / 1e6 : 0;

  if (qty > 0) {
    const src = (
      await tx.query(
        `SELECT l.from_location_id, d.warehouse_id FROM inv.stock_document_line l JOIN inv.stock_document d ON d.id = l.document_id
          WHERE d.source_entity_type = 'SYNTHESIS_BATCH' AND d.source_entity_id = $1 AND d.doc_type = 'ISSUE' AND l.lot_id = $2 ORDER BY d.created_at DESC LIMIT 1`,
        [batchId, use.lot_id]
      )
    ).rows[0];
    if (!src) throw invalid("Không tìm thấy phiếu xuất chai cũ của mẻ.");
    await postDoc(tx, actor, {
      doc_type: "ADJUSTMENT", reason_code: "SYNTHESIS_RETURN", warehouse_id: src.warehouse_id, source_entity_type: "SYNTHESIS_BATCH", source_entity_id: batchId,
      lines: [{ item_id: use.item_id, lot_id: use.lot_id, to_location_id: src.from_location_id, qty, uom: item.base_uom }],
    });
    const plan = allocate((await findCandidates(tx, use.item_id, await warehousesOf(tx, batch.org_unit_id), { lock: true })).filter((c) => c.lot_id === data.lot_id), qty);
    if (plan.shortfall > 1e-9) throw invalid(`Lô ${lot.code} không đủ tồn cho phần còn lại của mẻ (${qty} ${item.base_uom}).`, undefined, "INSUFFICIENT_STOCK");
    for (const p of plan.picks) {
      const wh = (await tx.query("SELECT warehouse_id FROM master.location WHERE id = $1", [p.candidate.location_id])).rows[0].warehouse_id;
      await postDoc(tx, actor, {
        doc_type: "ISSUE", reason_code: "SYNTHESIS", warehouse_id: wh, source_entity_type: "SYNTHESIS_BATCH", source_entity_id: batchId,
        lines: [{ item_id: use.item_id, lot_id: data.lot_id, from_location_id: p.candidate.location_id, qty: p.qty, uom: item.base_uom }],
      });
    }
  }
  await tx.query("UPDATE oligo.batch_port_use SET lot_id = $3 WHERE batch_id = $1 AND role = $2", [batchId, port.role, data.lot_id]);
  await tx.query("UPDATE oligo.synth_port SET current_lot_id = $3, installed_at = now(), installed_by = $4, version = version + 1 WHERE synthesizer_id = $1 AND port_no = $2", [
    batch.synthesizer_id, data.port_no, data.lot_id, actor.userId,
  ]);
  await event(tx, actor, batch.synthesizer_id, data.port_no, port.role, "SWAP", { lot_id: data.lot_id, old_lot_id: use.lot_id, batch_id: batchId, swap_cycle: data.cycle, qty });
  await writeAudit(tx, actor, { entityType: "synthesis_batch", entityId: batchId, action: "swap_bottle", changes: { [`port ${data.port_no}`]: [use.lot_id, data.lot_id], from_cycle: [null, data.cycle], qty_moved: [null, qty] } });
  return { qty_moved_base: qty };
}
