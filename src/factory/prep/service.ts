import { z } from "zod";
import type { Tx } from "../core/db";
import { writeAudit } from "../core/audit";
import { authorize, authorizeAnywhere, hasFactoryPermission, registerPermissions, type AuthzActor } from "../core/authz";
import { addDays, vnToday } from "../core/dates";
import { conflict, invalid, notFound } from "../core/errors";
import { nextNumber } from "../core/numbering";
import { parseInput } from "../core/records";
import { runTransition } from "../core/stateMachine";
import { allocate, findCandidates } from "../inv/allocation";
import { createStockDocument, stockDocumentMachine } from "../inv/documents";
import { createLot, lotMachine } from "../inv/lots";
import { getItem, toBaseQty } from "../master/service";
import { ensureLegacyOligoDataSeeded } from "../oligo/legacySync";

registerPermissions([
  { code: "prep.formula.manage", description: "Soạn / sửa công thức pha chế hóa chất" },
  { code: "prep.execute", description: "Thực hiện pha chế: trừ nguyên liệu, tạo lô hóa chất pha (trong kho của phòng)" },
]);

const lineSchema = z.object({ item_id: z.string().uuid("chọn nguyên liệu"), qty: z.coerce.number().positive("lượng phải lớn hơn 0"), uom: z.string().min(1) });
const formulaSchema = z.object({
  code: z.string().trim().regex(/^[A-Z0-9_-]{2,30}$/, "mã công thức: chữ hoa, số, _ -"),
  name: z.string().trim().min(1).max(200),
  category: z.string().trim().max(60).optional().nullable(),
  output_item_id: z.string().uuid("chọn mã hàng thành phẩm pha"),
  basis_qty: z.coerce.number().positive(),
  basis_uom: z.string().min(1),
  shelf_life_days: z.coerce.number().int().positive().optional().nullable(),
  requires_qc: z.boolean().default(false),
  incubation_days: z.coerce.number().int().min(0).max(365).default(0),
  instructions: z.string().trim().max(4000).optional().nullable(),
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
  lines: z.array(lineSchema).min(1, "công thức cần ít nhất một nguyên liệu").max(50),
});

/** A formula: ingredients per `basis_qty` of the prepared item. Edits are audited old → new; preparations keep what they used. */
export async function saveFormula(tx: Tx, actor: AuthzActor, id: string | null, input: unknown) {
  await authorizeAnywhere(tx, actor, "prep.formula.manage");
  const raw = (input ?? {}) as Record<string, unknown>;
  const d = parseInput(formulaSchema, input);
  const out = await getItem(tx, d.output_item_id);
  await toBaseQty(tx, out, d.basis_qty, d.basis_uom); // the unit must convert to the item's base unit
  for (const l of d.lines) {
    if (l.item_id === d.output_item_id) throw invalid("Nguyên liệu không được trùng hóa chất thành phẩm.");
    await toBaseQty(tx, await getItem(tx, l.item_id), l.qty, l.uom);
  }
  let formulaId = id;
  if (!id) {
    if ((await tx.query("SELECT 1 FROM prep.formula WHERE code = $1", [d.code])).rowCount) throw conflict(`Đã có công thức ${d.code}.`, "DUPLICATE");
    formulaId = (
      await tx.query(
        `INSERT INTO prep.formula (code, name, category, output_item_id, basis_qty, basis_uom, shelf_life_days, requires_qc, instructions, status, created_by, updated_by, incubation_days)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11, $12) RETURNING id`,
        [d.code, d.name, d.category ?? null, d.output_item_id, d.basis_qty, d.basis_uom, d.shelf_life_days ?? null, d.requires_qc, d.instructions ?? null, d.status, actor.userId, d.incubation_days]
      )
    ).rows[0].id;
    await writeAudit(tx, actor, { entityType: "prep_formula", entityId: formulaId!, action: "create", changes: { code: [null, d.code], lines: [null, d.lines.length] } });
  } else {
    const cur = (await tx.query("SELECT * FROM prep.formula WHERE id = $1 FOR UPDATE", [id])).rows[0];
    if (!cur) throw notFound("công thức");
    if (cur.version !== Number(raw.version)) throw conflict("Công thức vừa được người khác sửa. Tải lại.", "STALE_VERSION");
    if (typeof raw.reason !== "string" || raw.reason.trim().length < 3) throw invalid("Nhập lý do sửa công thức.");
    const before = (await tx.query("SELECT item_id, qty::float AS qty, uom FROM prep.formula_line WHERE formula_id = $1 ORDER BY line_no", [id])).rows;
    await tx.query(
      `UPDATE prep.formula SET name = $2, category = $3, output_item_id = $4, basis_qty = $5, basis_uom = $6, shelf_life_days = $7, requires_qc = $8, instructions = $9, status = $10,
              incubation_days = $12, version = version + 1, updated_at = now(), updated_by = $11 WHERE id = $1`,
      [id, d.name, d.category ?? null, d.output_item_id, d.basis_qty, d.basis_uom, d.shelf_life_days ?? null, d.requires_qc, d.instructions ?? null, d.status, actor.userId, d.incubation_days]
    );
    await tx.query("DELETE FROM prep.formula_line WHERE formula_id = $1", [id]);
    await writeAudit(tx, actor, {
      entityType: "prep_formula",
      entityId: id,
      action: "update",
      changes: { lines: [JSON.stringify(before), JSON.stringify(d.lines)], basis: [`${Number(cur.basis_qty)} ${cur.basis_uom}`, `${d.basis_qty} ${d.basis_uom}`], requires_qc: [cur.requires_qc, d.requires_qc] },
      reason: raw.reason,
    });
  }
  for (const [i, l] of d.lines.entries()) {
    await tx.query("INSERT INTO prep.formula_line (formula_id, line_no, item_id, qty, uom) VALUES ($1, $2, $3, $4, $5)", [formulaId, i + 1, l.item_id, l.qty, l.uom]);
  }
  return getFormula(tx, formulaId!);
}

export async function getFormula(tx: Tx, id: string) {
  const f = (
    await tx.query(
      `SELECT f.*, f.basis_qty::float AS basis_qty, i.code AS output_code, i.name AS output_name, i.base_uom AS output_base_uom
         FROM prep.formula f JOIN master.item i ON i.id = f.output_item_id WHERE f.id = $1`,
      [id]
    )
  ).rows[0];
  if (!f) throw notFound("công thức");
  f.lines = (
    await tx.query(
      "SELECT l.line_no, l.item_id, l.qty::float AS qty, l.uom, i.code AS item_code, i.name AS item_name FROM prep.formula_line l JOIN master.item i ON i.id = l.item_id WHERE l.formula_id = $1 ORDER BY l.line_no",
      [id]
    )
  ).rows;
  return f;
}

export async function listFormulas(tx: Tx, actor: AuthzActor) {
  await ensureLegacyOligoDataSeeded(tx);
  // anyone who prepares or writes formulas, in any department
  await authorizeAnywhere(tx, actor, "prep.execute").catch((err) => {
    if (err?.code === "FORBIDDEN") return authorizeAnywhere(tx, actor, "prep.formula.manage");
    throw err;
  });
  const ids = (await tx.query("SELECT id FROM prep.formula ORDER BY status, code")).rows;
  return Promise.all(ids.map((r) => getFormula(tx, r.id)));
}

const prepareSchema = z.object({
  formula_id: z.string().uuid(),
  qty: z.coerce.number().positive("lượng pha phải lớn hơn 0"),
  uom: z.string().min(1),
  warehouse_id: z.string().uuid("chọn kho"),
  to_location_id: z.string().uuid("chọn vị trí cất").optional().nullable(),
  // chosen ingredient lots (else FEFO): one entry per formula line at most
  lots: z.array(z.object({ line_no: z.coerce.number().int(), lot_id: z.string().uuid() })).max(50).default([]),
  notes: z.string().trim().max(1000).optional().nullable(),
});

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/**
 * Prepares `qty` of the formula's item: ingredients scaled from the basis and issued (chosen lots or FEFO; released,
 * unexpired), a new lot P… received with expiry = min(today + shelf life, earliest ingredient expiry). With QC the lot
 * stays in quarantine for QA/QC; without, it is released on a normal location at once.
 */
export async function prepare(tx: Tx, actor: AuthzActor, input: unknown) {
  const d = parseInput(prepareSchema, input);
  const wh = (await tx.query("SELECT id, owner_org_unit_id FROM master.warehouse WHERE id = $1 AND status = 'ACTIVE'", [d.warehouse_id])).rows[0];
  if (!wh) throw notFound("kho");
  await authorize(tx, actor, "prep.execute", wh.owner_org_unit_id);
  const f = await getFormula(tx, d.formula_id);
  if (f.status !== "ACTIVE") throw invalid(`Công thức ${f.code} đang ngừng dùng.`);
  const outItem = await getItem(tx, f.output_item_id);
  const outBase = await toBaseQty(tx, outItem, d.qty, d.uom);
  const basisBase = await toBaseQty(tx, outItem, Number(f.basis_qty), f.basis_uom);
  const factor = outBase / basisBase;

  const used: { line_no: number; item_id: string; item_code: string; lot_id: string | null; lot_code: string | null; qty_base: number; uom: string; expiry_date: string | null }[] = [];
  const issueLines = [];
  for (const l of f.lines) {
    const item = await getItem(tx, l.item_id);
    const need = round6((await toBaseQty(tx, item, Number(l.qty), l.uom)) * factor);
    let cands = await findCandidates(tx, item.id, [wh.id], { lock: true });
    const chosen = d.lots.find((x) => x.line_no === l.line_no);
    if (chosen) cands = cands.filter((c) => c.lot_id === chosen.lot_id);
    const plan = allocate(cands, need);
    if (plan.shortfall > 1e-9) {
      throw invalid(`Không đủ ${item.code} ${chosen ? "trong lô đã chọn" : "đã giải phóng, còn hạn"} (cần ${need} ${item.base_uom}, thiếu ${plan.shortfall}).`, { line_no: l.line_no }, "INSUFFICIENT_STOCK");
    }
    for (const p of plan.picks) {
      issueLines.push({ item_id: item.id, lot_id: p.candidate.lot_id, from_location_id: p.candidate.location_id, qty: p.qty, uom: item.base_uom });
      used.push({ line_no: l.line_no, item_id: item.id, item_code: item.code, lot_id: p.candidate.lot_id, lot_code: p.candidate.lot_code, qty_base: p.qty, uom: item.base_uom, expiry_date: p.candidate.expiry_date });
    }
  }

  const today = vnToday();
  const expiries = used.map((u) => u.expiry_date).filter((x): x is string => Boolean(x));
  const shelf = f.shelf_life_days ? addDays(today, f.shelf_life_days) : null;
  const expiry = [shelf, ...expiries].filter((x): x is string => Boolean(x)).sort()[0] ?? null;
  const qcNeeded = f.requires_qc || outItem.receipt_qc_required;
  // an incubated reagent waits in quarantine until "incubated" is confirmed (then QC, or released and put away)
  const incubate = Number(f.incubation_days) > 0;
  const hold = qcNeeded || incubate;
  if (incubate && !qcNeeded) {
    const loc = d.to_location_id ? (await tx.query("SELECT warehouse_id, is_quarantine FROM master.location WHERE id = $1", [d.to_location_id])).rows[0] : null;
    if (!loc || loc.warehouse_id !== wh.id || loc.is_quarantine) throw invalid("Chọn vị trí cất lô pha sau khi ủ (vị trí thường của kho).");
  }
  const location = hold
    ? (await tx.query("SELECT id FROM master.location WHERE warehouse_id = $1 AND is_quarantine AND status = 'ACTIVE' ORDER BY code LIMIT 1", [wh.id])).rows[0]?.id
    : d.to_location_id;
  if (!location) throw invalid(hold ? "Kho chưa có vị trí biệt trữ để chờ ủ / QC lô pha." : "Chọn vị trí cất lô pha.");
  if (!hold) {
    const loc = (await tx.query("SELECT warehouse_id, is_quarantine FROM master.location WHERE id = $1", [location])).rows[0];
    if (!loc || loc.warehouse_id !== wh.id || loc.is_quarantine) throw invalid("Vị trí cất phải là vị trí thường của kho đã chọn.");
  }

  const code = await nextNumber(tx, "PREPARATION");
  const lot = await createLot(tx, actor, { item_id: outItem.id, origin: "PREPARATION", sequence_key: "LOT_PREPARATION", mfg_date: today, expiry_date: expiry, origin_entity_type: "PREPARATION" });
  const post = async (doc: Parameters<typeof createStockDocument>[2]) => {
    const created = await createStockDocument(tx, actor, doc, { trusted: true });
    await runTransition(tx, stockDocumentMachine, actor, { id: created.id, action: "post", expectedVersion: created.version }, { trusted: true });
    return created.id;
  };
  const prep = (
    await tx.query(
      `INSERT INTO prep.preparation (code, formula_id, formula_version, lines, qty_out, uom_out, warehouse_id, lot_id, notes, prepared_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [code, f.id, f.version, JSON.stringify(used.map(({ expiry_date: _e, ...u }) => u)), round6(outBase), outItem.base_uom, wh.id, lot.id, d.notes ?? null, actor.userId]
    )
  ).rows[0];
  await tx.query("UPDATE inv.lot SET origin_entity_id = $2 WHERE id = $1", [lot.id, prep.id]);
  const issueId = await post({ doc_type: "ISSUE", reason_code: "PREPARATION", warehouse_id: wh.id, source_entity_type: "PREPARATION", source_entity_id: prep.id, lines: issueLines });
  // no QC: released before it is booked onto a normal location (a quarantined lot may only sit in quarantine)
  if (!hold) {
    const cur = (await tx.query("SELECT version FROM inv.lot WHERE id = $1", [lot.id])).rows[0];
    await runTransition(tx, lotMachine, actor, { id: lot.id, action: "skip_qc", expectedVersion: cur.version }, { trusted: true });
  }
  const receiptId = await post({
    doc_type: "RECEIPT", reason_code: "PREPARATION", warehouse_id: wh.id, source_entity_type: "PREPARATION", source_entity_id: prep.id,
    lines: [{ item_id: outItem.id, lot_id: lot.id, to_location_id: location, qty: round6(outBase), uom: outItem.base_uom }],
  });
  await tx.query("UPDATE prep.preparation SET issue_document_id = $2, receipt_document_id = $3, to_location_id = $4, incubation_until = $5 WHERE id = $1", [
    prep.id, issueId, receiptId, d.to_location_id ?? null, incubate ? addDays(today, Number(f.incubation_days)) : null,
  ]);
  await writeAudit(tx, actor, { entityType: "preparation", entityId: prep.id, action: "prepare", changes: { code: [null, code], lot: [null, lot.code], qty: [null, `${round6(outBase)} ${outItem.base_uom}`] } });
  return { ...prep, lot_code: lot.code, qc_needed: qcNeeded, expiry_date: expiry, incubation_until: incubate ? addDays(today, Number(f.incubation_days)) : null };
}

/** Cancels a preparation whose lot is still untouched: both documents are reversed (ingredients back to their lots). */
export async function cancelPreparation(tx: Tx, actor: AuthzActor, id: string, reasonInput: unknown) {
  const reason = parseInput(z.string().trim().min(3, "nhập lý do hủy"), reasonInput);
  const p = (await tx.query("SELECT * FROM prep.preparation WHERE id = $1 FOR UPDATE", [id])).rows[0];
  if (!p) throw notFound("lệnh pha chế");
  const wh = (await tx.query("SELECT owner_org_unit_id FROM master.warehouse WHERE id = $1", [p.warehouse_id])).rows[0];
  await authorize(tx, actor, "prep.execute", wh.owner_org_unit_id);
  if (p.status !== "DONE") throw invalid("Lệnh pha đã hủy.");
  const bal = (await tx.query("SELECT coalesce(sum(qty_on_hand), 0) AS h, coalesce(sum(qty_reserved), 0) AS r FROM inv.stock_balance WHERE lot_id = $1", [p.lot_id])).rows[0];
  const onHand = Number(bal.h);
  const reserved = Number(bal.r);
  if (Math.abs(onHand - Number(p.qty_out)) > 1e-9 || reserved > 0) throw conflict("Lô pha đã được dùng / giữ chỗ: không hủy được, xử lý qua NCR.", "LOT_IN_USE");
  for (const docId of [p.receipt_document_id, p.issue_document_id]) {
    const doc = (await tx.query("SELECT version FROM inv.stock_document WHERE id = $1", [docId])).rows[0];
    await runTransition(tx, stockDocumentMachine, actor, { id: docId, action: "reverse", expectedVersion: doc.version, reason: `Hủy lệnh pha ${p.code}: ${reason}` }, { trusted: true });
  }
  await tx.query("UPDATE prep.preparation SET status = 'CANCELLED', cancel_reason = $2, version = version + 1 WHERE id = $1", [id, reason]);
  await writeAudit(tx, actor, { entityType: "preparation", entityId: id, action: "cancel", changes: { status: ["DONE", "CANCELLED"] }, reason });
}

export async function listPreparations(tx: Tx, actor: AuthzActor) {
  const rows = (
    await tx.query(
      `SELECT p.id, p.code, p.status, p.qty_out::float AS qty_out, p.uom_out, p.prepared_at, p.lines, p.notes, p.cancel_reason, p.warehouse_id, p.incubation_until, p.incubated_at, p.to_location_id,
              f.code AS formula_code, f.name AS formula_name, l.code AS lot_code, l.status AS lot_status, l.expiry_date, u.display_name AS prepared_by_name, w.owner_org_unit_id
         FROM prep.preparation p JOIN prep.formula f ON f.id = p.formula_id JOIN inv.lot l ON l.id = p.lot_id JOIN master.warehouse w ON w.id = p.warehouse_id
         LEFT JOIN core.user_profile u ON u.user_id = p.prepared_by
        ORDER BY p.prepared_at DESC LIMIT 200`
    )
  ).rows;
  const out = [];
  for (const r of rows) if ((await hasFactoryPermission(tx, actor, "prep.execute", r.owner_org_unit_id)) || (await hasFactoryPermission(tx, actor, "inv.stock.view", r.owner_org_unit_id))) out.push(r);
  return out;
}

/** Warehouses where the user may prepare, with their normal (non-quarantine) locations. */
export async function prepOptions(tx: Tx, actor: AuthzActor) {
  const whs = (await tx.query("SELECT w.id, w.code, w.name, w.owner_org_unit_id FROM master.warehouse w WHERE w.status = 'ACTIVE' ORDER BY w.code")).rows;
  const out = [];
  for (const w of whs) {
    if (!(await hasFactoryPermission(tx, actor, "prep.execute", w.owner_org_unit_id))) continue;
    const locations = (await tx.query("SELECT id, code, name FROM master.location WHERE warehouse_id = $1 AND status = 'ACTIVE' AND NOT is_quarantine ORDER BY code", [w.id])).rows;
    out.push({ ...w, locations });
  }
  return out;
}
