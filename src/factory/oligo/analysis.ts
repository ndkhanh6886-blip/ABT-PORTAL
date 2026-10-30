import { z } from "zod";
import type { Tx } from "../core/db";
import { writeAudit } from "../core/audit";
import { authorize, authorizeAnywhere, type AuthzActor } from "../core/authz";
import { conflict, invalid, notFound } from "../core/errors";
import { parseInput } from "../core/records";
import { runTransition } from "../core/stateMachine";
import { analyze, SequenceError } from "./analyzer";
import { loadCatalog } from "./catalog";
import { insertSequence, recomputeOrderStatus, visibleOligoUnits } from "./orders";
import { sequenceMachine } from "./sequences";

// ---- lists across orders (Primer / Probe / Amplicon) ----

const listSchema = z.object({
  type: z.enum(["PRIMER", "PROBE", "AMPLICON"]),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(50),
});

/** Every sequence of one kind over the orders the user may see, with its computed parameters (server-side paging). */
export async function listByType(tx: Tx, actor: AuthzActor, query: unknown) {
  const q = parseInput(listSchema, query);
  const units = await visibleOligoUnits(tx, actor);
  if (units !== "ALL" && !units.length) return { rows: [], total: 0, page: q.page, page_size: q.page_size };
  const types = q.type === "AMPLICON" ? ["AMPLICON_LINEAR", "AMPLICON_PLASMID"] : [q.type];
  const params: unknown[] = [types, units === "ALL" ? null : units, q.q ? `%${q.q}%` : null];
  const where = `s.product_type = ANY($1::text[]) AND ($2::uuid[] IS NULL OR s.org_unit_id = ANY($2::uuid[])) AND s.status <> 'CANCELLED'
                 AND ($3::text IS NULL OR s.code ILIKE $3 OR s.name ILIKE $3 OR s.normalized_sequence ILIKE $3 OR o.code ILIKE $3)`;
  const from = "FROM oligo.oligo_sequence s LEFT JOIN oligo.oligo_order o ON o.id = s.order_id";
  const total = Number((await tx.query(`SELECT count(*) ${from} WHERE ${where}`, params)).rows[0].count);
  params.push(q.page_size, (q.page - 1) * q.page_size);
  const rows = (
    await tx.query(
      `SELECT s.id, s.code, s.name, s.normalized_sequence, s.base_count, s.molecule_type, s.product_type, s.status, s.relation, s.version,
              s.gc_percent::float AS gc_percent, s.tm::float AS tm, s.ext_coeff_260::float AS ext_coeff_260, s.nmol_per_od::float AS nmol_per_od,
              s.ug_per_od::float AS ug_per_od, s.mw::float AS mw, s.modifications, s.fragment_design, o.code AS order_code, p.name AS plasmid_name, p.id AS plasmid_id,
              (SELECT count(*)::int FROM oligo.oligo_sequence f WHERE f.parent_sequence_id = s.id AND f.relation = 'FRAGMENT' AND f.status <> 'CANCELLED') AS fragment_count
         ${from} LEFT JOIN oligo.plasmid p ON p.id = s.plasmid_id
        WHERE ${where} ORDER BY s.created_at DESC, s.code LIMIT $4 OFFSET $5`,
      params
    )
  ).rows;
  return { rows, total, page: q.page, page_size: q.page_size };
}

// ---- plasmids ----

const plasmidSchema = z.object({
  name: z.string().trim().min(1).max(100),
  length_bp: z.coerce.number().int().positive(),
  notes: z.string().trim().max(1000).optional().nullable(),
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
});

export async function savePlasmid(tx: Tx, actor: AuthzActor, id: string | null, input: unknown) {
  await authorizeAnywhere(tx, actor, "oligo.catalog.manage");
  const raw = (input ?? {}) as Record<string, unknown>;
  const d = parseInput(plasmidSchema, input);
  const clash = (await tx.query("SELECT id FROM oligo.plasmid WHERE lower(name) = lower($1) AND id IS DISTINCT FROM $2", [d.name, id])).rows[0];
  if (clash) throw conflict(`Đã có plasmid "${d.name}".`, "DUPLICATE");
  if (!id) {
    const p = (await tx.query("INSERT INTO oligo.plasmid (name, length_bp, notes, status, created_by, updated_by) VALUES ($1, $2, $3, $4, $5, $5) RETURNING *", [
      d.name, d.length_bp, d.notes ?? null, d.status, actor.userId,
    ])).rows[0];
    await writeAudit(tx, actor, { entityType: "oligo_plasmid", entityId: p.id, action: "create", changes: { name: [null, d.name] } });
    return p;
  }
  const cur = (await tx.query("SELECT * FROM oligo.plasmid WHERE id = $1 FOR UPDATE", [id])).rows[0];
  if (!cur) throw notFound("plasmid");
  if (cur.version !== Number(raw.version)) throw conflict("Plasmid vừa được người khác sửa. Tải lại.", "STALE_VERSION");
  await tx.query("UPDATE oligo.plasmid SET name = $2, length_bp = $3, notes = $4, status = $5, version = version + 1, updated_at = now(), updated_by = $6 WHERE id = $1", [
    id, d.name, d.length_bp, d.notes ?? null, d.status, actor.userId,
  ]);
  await writeAudit(tx, actor, { entityType: "oligo_plasmid", entityId: id, action: "update", changes: { name: [cur.name, d.name], length_bp: [cur.length_bp, d.length_bp], status: [cur.status, d.status] } });
  return (await tx.query("SELECT * FROM oligo.plasmid WHERE id = $1", [id])).rows[0];
}

export async function listPlasmids(tx: Tx, actor: AuthzActor) {
  await authorizeAnywhere(tx, actor, "oligo.view");
  return (
    await tx.query(
      `SELECT p.*, (SELECT count(*)::int FROM oligo.oligo_sequence s WHERE s.plasmid_id = p.id) AS used_by FROM oligo.plasmid p ORDER BY p.status, p.name`
    )
  ).rows;
}

/** An amplicon is linear or cloned into a plasmid; the plasmid is chosen while the sequence is still pending. */
export async function setPlasmid(tx: Tx, actor: AuthzActor, seqId: string, input: unknown) {
  const { plasmid_id, version } = parseInput(z.object({ plasmid_id: z.string().uuid().nullable(), version: z.number().int() }), input);
  const s = (await tx.query("SELECT * FROM oligo.oligo_sequence WHERE id = $1 FOR UPDATE", [seqId])).rows[0];
  if (!s) throw notFound("trình tự");
  await authorize(tx, actor, "oligo.order.manage", s.org_unit_id);
  if (s.version !== version) throw conflict("Trình tự vừa thay đổi. Tải lại.", "STALE_VERSION");
  if (!s.product_type.startsWith("AMPLICON")) throw invalid("Chỉ amplicon mới gắn plasmid.");
  if (!["PENDING", "SPLIT"].includes(s.status)) throw invalid("Chỉ đổi plasmid khi amplicon chưa vào tổng hợp.");
  if (plasmid_id && !(await tx.query("SELECT 1 FROM oligo.plasmid WHERE id = $1 AND status = 'ACTIVE'", [plasmid_id])).rowCount) throw notFound("plasmid");
  const type = plasmid_id ? "AMPLICON_PLASMID" : "AMPLICON_LINEAR";
  await tx.query("UPDATE oligo.oligo_sequence SET plasmid_id = $2, product_type = $3, version = version + 1, updated_at = now(), updated_by = $4 WHERE id = $1", [seqId, plasmid_id, type, actor.userId]);
  await writeAudit(tx, actor, { entityType: "oligo_sequence", entityId: seqId, action: "set_plasmid", changes: { plasmid_id: [s.plasmid_id, plasmid_id], product_type: [s.product_type, type] } });
}

// ---- fragments for assembly ----

const COMPLEMENT: Record<string, string> = { A: "T", T: "A", U: "A", G: "C", C: "G", R: "Y", Y: "R", S: "S", W: "W", K: "M", M: "K", B: "V", V: "B", D: "H", H: "D", N: "N" };
export const reverseComplement = (s: string) => [...s].reverse().map((b) => COMPLEMENT[b] ?? "N").join("");

export interface Fragment { name: string; direction: "F" | "R"; start: number; end: number; sequence: string }

/**
 * Tiles an amplicon into oligos of `oligoLen` overlapping by `overlap` (staggered PCR assembly), alternating
 * forward and reverse-complement strands — OligoFlow's design, without its duplicate last fragment: tiling stops
 * when the end is reached, and a short last piece is extended back to full length (keeping at least the overlap).
 */
export function tileFragments(baseName: string, sequence: string, oligoLen: number, overlap: number, adapter5 = "", adapter3 = ""): Fragment[] {
  const seq = (adapter5 + sequence + adapter3).toUpperCase();
  if (!/^[ACGTURYSWKMBDHVN]+$/.test(seq)) throw new SequenceError("Chỉ chia mảnh trình tự base chuẩn (không modification).");
  if (oligoLen < 40 || oligoLen > 200) throw new SequenceError("Chiều dài oligo phải từ 40 đến 200 base.");
  if (overlap < 15 || overlap >= oligoLen) throw new SequenceError("Độ trùng lắp phải từ 15 base và nhỏ hơn chiều dài oligo.");
  if (seq.length <= oligoLen) throw new SequenceError(`Amplicon dài ${seq.length} base, không cần chia (≤ ${oligoLen}).`);
  const step = oligoLen - overlap;
  const out: Fragment[] = [];
  for (let start = 0, i = 0; ; start += step, i++) {
    const end = Math.min(start + oligoLen, seq.length);
    let s = start;
    if (end - s < oligoLen) s = Math.max(0, end - oligoLen); // last piece: full length, ending at the amplicon's end
    const piece = seq.slice(s, end);
    const forward = i % 2 === 0;
    out.push({ name: `${baseName}_${forward ? "F" : "R"}${Math.floor(i / 2) + 1}`, direction: forward ? "F" : "R", start: s + 1, end, sequence: forward ? piece : reverseComplement(piece) });
    if (end === seq.length) break;
  }
  return out;
}

const fragmentsSchema = z.object({
  version: z.number().int(),
  design: z.object({ oligo_len: z.number().int().optional(), overlap: z.number().int().optional(), adapter5: z.string().optional(), adapter3: z.string().optional(), mode: z.enum(["AUTO", "MANUAL"]) }),
  fragments: z.array(z.object({ name: z.string().trim().min(1).max(200), sequence: z.string().trim().min(10).max(500) })).min(2, "cần ít nhất 2 mảnh").max(100),
});

/**
 * Replaces a pending amplicon by its fragments: children (relation FRAGMENT) in the same order, with the amplicon's
 * scale / purification / format, which go to synthesis like any oligo; the amplicon waits as "split".
 */
export async function saveFragments(tx: Tx, actor: AuthzActor, seqId: string, input: unknown) {
  const d = parseInput(fragmentsSchema, input);
  const s = (await tx.query("SELECT * FROM oligo.oligo_sequence WHERE id = $1 FOR UPDATE", [seqId])).rows[0];
  if (!s) throw notFound("trình tự");
  await authorize(tx, actor, "oligo.order.manage", s.org_unit_id);
  if (s.version !== d.version) throw conflict("Trình tự vừa thay đổi. Tải lại.", "STALE_VERSION");
  if (!s.product_type.startsWith("AMPLICON")) throw invalid("Chỉ chia mảnh amplicon.");
  if (s.status !== "PENDING" || s.relation) throw invalid("Chỉ chia mảnh amplicon gốc đang chờ tổng hợp.");
  const catalog = await loadCatalog(tx);
  const analysed = d.fragments.map((f, i) => {
    try {
      return { f, a: analyze(f.sequence, catalog) };
    } catch (e: any) {
      throw invalid(`Mảnh ${i + 1} (${f.name}): ${e.message}`);
    }
  });
  await runTransition(tx, sequenceMachine, actor, { id: seqId, action: "split", expectedVersion: s.version });
  await tx.query("UPDATE oligo.oligo_sequence SET fragment_design = $2 WHERE id = $1", [seqId, JSON.stringify(d.design)]);
  const created = [];
  for (const { f, a } of analysed) {
    const c = await insertSequence(tx, actor, {
      order_id: s.order_id, org_unit_id: s.org_unit_id, line_no: s.line_no, name: f.name, raw: f.sequence, a,
      scale_code: s.scale_code, purification: s.purification, format: s.format, parent_sequence_id: seqId, relation: "FRAGMENT",
    });
    created.push(c.code);
  }
  await writeAudit(tx, actor, { entityType: "oligo_sequence", entityId: seqId, action: "fragment", changes: { fragments: [null, created.join(", ")], design: [null, JSON.stringify(d.design)] } });
  if (s.order_id) await recomputeOrderStatus(tx, actor, s.order_id);
  return { fragments: created };
}
