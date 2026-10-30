import { z } from "zod";
import type { Tx } from "../core/db";
import { authorize, authorizeAnywhere, registerPermissions, type AuthzActor } from "../core/authz";
import { conflict, invalid, notFound } from "../core/errors";
import { parseInput, updateRecord } from "../core/records";
import { analyze, SequenceError, type Analysis, type CatalogEntry } from "./analyzer";

registerPermissions([
  { code: "oligo.view", description: "Xem phân hệ Tổng hợp Oligo, tính thông số trình tự" },
  { code: "oligo.catalog.manage", description: "Sửa danh mục base / modification Oligo (MW, ε260, tên gọi khác)" },
]);

const COLUMNS =
  "id, code, name, kind, base_letter, nn_role, mw::float AS mw, mw_delta::float AS mw_delta, ext_coeff_260::float AS ext_coeff_260, aliases, position_type, status, version, amidite_item_id";

/** Catalogue cached until any entry changes (count + newest update), so edits apply at once everywhere. */
let cache: { key: string; entries: CatalogEntry[] } | null = null;
export async function loadCatalog(tx: Tx): Promise<CatalogEntry[]> {
  const stamp = (await tx.query("SELECT count(*)::int AS n, max(updated_at)::text AS t FROM oligo.modification")).rows[0];
  const key = `${stamp.n}|${stamp.t}`;
  if (cache?.key === key) return cache.entries;
  const entries = (await tx.query(`SELECT ${COLUMNS} FROM oligo.modification WHERE status = 'ACTIVE'`)).rows;
  cache = { key, entries };
  return entries;
}

export async function listCatalog(tx: Tx, actor: AuthzActor) {
  await authorize(tx, actor, "oligo.view");
  return (await tx.query(`SELECT ${COLUMNS} FROM oligo.modification ORDER BY array_position(ARRAY['BASE','LNA','OME','F2','METHYL','DYE','QUENCHER','MODIFIER','SPACER'], kind), code`)).rows;
}

const updateSchema = z.object({
  version: z.number().int().min(0),
  reason: z.string().trim().min(3, "nhập lý do thay đổi thông số"),
  name: z.string().trim().min(1).max(200).optional(),
  mw: z.coerce.number().positive().optional().nullable(),
  mw_delta: z.coerce.number().optional().nullable(),
  ext_coeff_260: z.coerce.number().min(0).optional(),
  aliases: z.array(z.string().trim().min(1).max(40)).max(50).optional(),
  position_type: z.enum(["ANY", "5PRIME", "3PRIME", "INTERNAL"]).optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  amidite_item_id: z.string().uuid().nullable().optional(),
});

/** Parameter changes alter every later calculation: reason required and audited old → new; aliases must stay unambiguous. */
export async function updateCatalogEntry(tx: Tx, actor: AuthzActor, id: string, input: unknown) {
  await authorizeAnywhere(tx, actor, "oligo.catalog.manage");
  const { version, reason, ...patch } = parseInput(updateSchema, input);
  const cur = (await tx.query("SELECT code, kind, mw, mw_delta FROM oligo.modification WHERE id = $1", [id])).rows[0];
  if (!cur) throw notFound("mục danh mục");
  if (cur.kind === "BASE" && patch.status === "INACTIVE") throw invalid("Không ngừng dùng base chuẩn.");
  if (patch.mw !== undefined && patch.mw_delta !== undefined) throw invalid("Chỉ nhập MW tuyệt đối hoặc MW chênh lệch, không cả hai.");
  if (patch.aliases) {
    const keys = patch.aliases.map((a) => a.toUpperCase());
    const clash = await tx.query(
      "SELECT code FROM oligo.modification WHERE id <> $1 AND (upper(code) = ANY($2::text[]) OR EXISTS (SELECT 1 FROM unnest(aliases) a WHERE upper(a) = ANY($2::text[]))) LIMIT 1",
      [id, keys]
    );
    if (clash.rowCount) throw conflict(`Tên gọi khác trùng với mục ${clash.rows[0].code}: mỗi tên chỉ được trỏ tới một mục.`, "ALIAS_CLASH");
    patch.aliases = [...new Set(patch.aliases.map((a) => a.toUpperCase()))];
  }
  return updateRecord(tx, actor, "oligo.modification", "oligo_modification", id, version, patch, reason);
}

export interface AnalysisRow {
  line: number;
  name: string | null;
  input: string;
  result?: Omit<Analysis, "tokens">;
  error?: string;
}

/** One sequence per line, optionally "name<TAB or ;>sequence". Each line succeeds or reports its own error. */
export async function analyzeBatch(tx: Tx, actor: AuthzActor, input: unknown): Promise<AnalysisRow[]> {
  await authorize(tx, actor, "oligo.view");
  const { text } = parseInput(z.object({ text: z.string().max(200_000) }), input);
  const catalog = await loadCatalog(tx);
  const lines = text.split(/\r?\n/).map((l, i) => ({ l: l.trim(), i: i + 1 })).filter((x) => x.l);
  if (lines.length > 500) throw invalid("Tối đa 500 trình tự mỗi lần.");
  return lines.map(({ l, i }) => {
    const m = l.match(/^([^\t;]+)[\t;]\s*(.+)$/);
    const name = m ? m[1].trim() : null;
    const seq = m ? m[2].trim() : l;
    try {
      const { tokens: _tokens, ...result } = analyze(seq, catalog);
      return { line: i, name, input: seq, result };
    } catch (e) {
      if (e instanceof SequenceError) return { line: i, name, input: seq, error: e.message };
      throw e;
    }
  });
}
