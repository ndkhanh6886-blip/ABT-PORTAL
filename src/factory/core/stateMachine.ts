import type { Tx } from "./db";
import { writeAudit } from "./audit";
import { authorize, hasFactoryPermission, type AuthzActor } from "./authz";
import { conflict, FactoryError, invalid, notFound } from "./errors";
import { enqueueEvent } from "./outbox";
import { authenticateSigner, insertSignature, type PasswordVerifier, type SignatureCredential, type SignatureMeaning } from "./signature";

/**
 * Declarative state machines (docs/nha-may/02-may-trang-thai.md, §0). Every status change goes
 * through `runTransition`: permission → reason → guards → signature → optimistic-locked update →
 * effects → audit → outbox, all in the caller's transaction. No API may write `status` directly.
 */

export interface GuardContext<Row> {
  tx: Tx;
  actor: AuthzActor;
  row: Row;
  payload: Record<string, unknown>;
  reason?: string | null;
}

export interface Guard<Row> {
  code: string;
  /** Vietnamese, says what to do so the guard passes. */
  message: string;
  check: (ctx: GuardContext<Row>) => boolean | Promise<boolean>;
}

export interface TransitionDef<S extends string, Row> {
  action: string;
  from: S | readonly S[];
  to: S;
  permission: string;
  guards?: Guard<Row>[];
  signature?: SignatureMeaning;
  reasonRequired?: boolean;
  /** Org unit for this transition's permission when it differs from the machine's (e.g. a service department acting on another's record). */
  scopeOf?: (row: Row, tx: Tx) => string | null | undefined | Promise<string | null | undefined>;
  /** Runs right before the status UPDATE in the same transaction (never runs during GET / listAllowedActions). */
  beforeUpdate?: (ctx: GuardContext<Row>) => Promise<void>;
  /** Columns of the entity written in the same UPDATE as the status (e.g. reviewer, result). Names come from code only. */
  patch?: (ctx: GuardContext<Row>) => Record<string, unknown> | Promise<Record<string, unknown>>;
  /** Runs after the status update, same transaction; may write related records. */
  effects?: (ctx: GuardContext<Row> & { updated: Row; trusted?: boolean }) => Promise<void>;
}

export interface MachineDef<S extends string, Row> {
  entityType: string;
  table: string;
  states: readonly S[];
  terminal: readonly S[];
  transitions: TransitionDef<S, Row>[];
  /** Org unit used for scoped permissions (e.g. the owning department). */
  scopeOf?: (row: Row, tx: Tx) => string | null | undefined | Promise<string | null | undefined>;
}

const machines = new Map<string, MachineDef<any, any>>();
/** Machine by entity type (outbox handlers find the record behind an event). */
export function getMachine(entityType: string): MachineDef<any, any> | undefined {
  return machines.get(entityType);
}

export function defineMachine<S extends string, Row extends { id: string; status: S; version: number }>(
  def: MachineDef<S, Row>
): MachineDef<S, Row> {
  const seen = new Set<string>();
  if (!/^[a-z_]+\.[a-z_]+$/.test(def.table)) throw new Error(`Tên bảng không hợp lệ: ${def.table}`);
  for (const t of def.transitions) {
    const froms = Array.isArray(t.from) ? t.from : [t.from];
    for (const f of [...froms, t.to]) {
      if (!def.states.includes(f as S)) throw new Error(`${def.entityType}: trạng thái lạ "${f}" ở hành động ${t.action}`);
    }
    for (const f of froms) {
      if (def.terminal.includes(f as S)) throw new Error(`${def.entityType}: không được chuyển từ trạng thái kết thúc ${f}`);
      const key = `${f}:${t.action}`;
      if (seen.has(key)) throw new Error(`${def.entityType}: hành động ${t.action} khai báo trùng từ ${f}`);
      seen.add(key);
    }
  }
  machines.set(def.entityType, def);
  return def;
}

export function findTransition<S extends string, Row>(machine: MachineDef<S, Row>, from: S, action: string) {
  return machine.transitions.find((t) => t.action === action && (Array.isArray(t.from) ? t.from.includes(from) : t.from === from));
}

/** Actions offered from a status (permissions/guards are checked by `listAllowedActions`). */
export function actionsFrom<S extends string, Row>(machine: MachineDef<S, Row>, from: S): TransitionDef<S, Row>[] {
  return machine.transitions.filter((t) => (Array.isArray(t.from) ? t.from.includes(from) : t.from === from));
}

async function failedGuards<Row>(guards: Guard<Row>[] | undefined, ctx: GuardContext<Row>) {
  const failed: { code: string; message: string }[] = [];
  for (const g of guards ?? []) {
    if (!(await g.check(ctx))) failed.push({ code: g.code, message: g.message });
  }
  return failed;
}

export interface TransitionRequest {
  id: string;
  action: string;
  /** Version the user saw; a different current version means someone changed the record meanwhile. */
  expectedVersion: number;
  reason?: string | null;
  payload?: Record<string, unknown>;
  /** Required when the transition carries a signature. Verified before the business transaction. */
  credential?: SignatureCredential;
}

/**
 * Verifies the signer's credential in its own transaction (failed attempts must be recorded even
 * when the business change is abandoned). Call before opening the business transaction.
 */
export async function preAuthenticate<S extends string, Row>(
  machine: MachineDef<S, Row>,
  currentStatus: S,
  req: TransitionRequest,
  actor: AuthzActor,
  verifyPortalPassword?: PasswordVerifier
): Promise<void> {
  const t = findTransition(machine, currentStatus, req.action);
  if (!t?.signature) return;
  if (!req.credential?.secret) throw invalid("Thao tác này cần chữ ký điện tử: nhập mã PIN hoặc mật khẩu.", undefined, "SIGNATURE_REQUIRED");
  await authenticateSigner(actor.userId, req.credential, verifyPortalPassword);
}

export async function runTransition<S extends string, Row extends { id: string; status: S; version: number }>(
  tx: Tx,
  machine: MachineDef<S, Row>,
  actor: AuthzActor,
  req: TransitionRequest,
  /** trusted: a module-internal follow-up of an action the calling module already authorised (no permission check). */
  opts: { signerAuthenticated?: boolean; trusted?: boolean } = {}
): Promise<Row> {
  const loaded = await tx.query(`SELECT * FROM ${machine.table} WHERE id = $1 FOR UPDATE`, [req.id]);
  const row = loaded.rows[0] as Row | undefined;
  if (!row) throw notFound(`bản ghi ${machine.entityType}`);
  if (row.version !== req.expectedVersion) {
    throw conflict("Bản ghi vừa được người khác thay đổi. Tải lại trang rồi thực hiện lại.", "STALE_VERSION");
  }
  const t = findTransition(machine, row.status, req.action);
  if (!t) {
    throw invalid(`Không thể thực hiện "${req.action}" khi bản ghi đang ở trạng thái ${row.status}.`, undefined, "INVALID_TRANSITION");
  }
  if (!opts.trusted) await authorize(tx, actor, t.permission, await (t.scopeOf ?? machine.scopeOf)?.(row, tx));
  const reason = req.reason?.trim() || null;
  if (t.reasonRequired && !reason) throw invalid("Thao tác này bắt buộc nhập lý do.", undefined, "REASON_REQUIRED");
  const ctx: GuardContext<Row> = { tx, actor, row, payload: req.payload ?? {}, reason };
  const failed = await failedGuards(t.guards, ctx);
  if (failed.length) {
    throw new FactoryError(422, "GUARD_FAILED", `Chưa đủ điều kiện: ${failed.map((f) => f.message).join(" ")}`, failed);
  }
  if (t.signature && !opts.signerAuthenticated) {
    throw invalid("Thao tác này cần chữ ký điện tử: nhập mã PIN hoặc mật khẩu.", undefined, "SIGNATURE_REQUIRED");
  }
  await t.beforeUpdate?.(ctx);
  const patch = (await t.patch?.(ctx)) ?? {};
  const patchCols = Object.keys(patch);
  for (const c of patchCols) {
    if (!/^[a-z_]+$/.test(c) || ["id", "status", "version"].includes(c)) throw new Error(`Cột không được phép trong patch: ${c}`);
  }
  const upd = await tx.query(
    `UPDATE ${machine.table} SET status = $2, version = version + 1, updated_at = now(), updated_by = $3
       ${patchCols.map((c, i) => `, ${c} = $${i + 5}`).join("")}
      WHERE id = $1 AND version = $4 RETURNING *`,
    [row.id, t.to, actor.userId, row.version, ...patchCols.map((c) => patch[c])]
  );
  const updated = upd.rows[0] as Row;
  await t.effects?.({ ...ctx, updated, trusted: opts.trusted });
  if (t.signature) {
    const fresh = (await tx.query(`SELECT * FROM ${machine.table} WHERE id = $1`, [row.id])).rows[0];
    await insertSignature(tx, actor, {
      entityType: machine.entityType,
      entityId: row.id,
      entityVersion: fresh.version,
      meaning: t.signature,
      record: fresh,
      method: req.credential!.method,
      reason,
    });
  }
  await writeAudit(tx, actor, {
    entityType: machine.entityType,
    entityId: row.id,
    action: t.action,
    changes: {
      status: [row.status, t.to],
      ...Object.fromEntries(patchCols.map((c) => [c, [(row as Record<string, unknown>)[c] ?? null, patch[c] ?? null]])),
    },
    reason,
  });
  await enqueueEvent(tx, `${machine.entityType}.${t.action}`, { id: row.id, from: row.status, to: t.to, by: actor.userId });
  return updated;
}

/** Actions the actor may run now: drives which buttons the UI shows (`GET …/{id}/actions`). */
export async function listAllowedActions<S extends string, Row extends { id: string; status: S; version: number }>(
  tx: Tx,
  machine: MachineDef<S, Row>,
  actor: AuthzActor,
  row: Row
) {
  const result: { action: string; to: S; signature?: SignatureMeaning; reasonRequired: boolean; blockedBy: string[] }[] = [];
  for (const t of actionsFrom(machine, row.status)) {
    if (!(await hasFactoryPermission(tx, actor, t.permission, await (t.scopeOf ?? machine.scopeOf)?.(row, tx)))) continue;
    const failed = await failedGuards(t.guards, { tx, actor, row, payload: {} });
    result.push({ action: t.action, to: t.to, signature: t.signature, reasonRequired: Boolean(t.reasonRequired), blockedBy: failed.map((f) => f.message) });
  }
  return result;
}
