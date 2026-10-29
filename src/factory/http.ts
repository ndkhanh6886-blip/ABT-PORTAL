import crypto from "crypto";
import { NextResponse } from "next/server";
import { getAuthorizedUser, isAdminUser, unauthorizedResponse } from "@/backend/services/authz";
import { clientIp } from "@/backend/services/rateLimit";
import type { AuthzActor } from "./core/authz";
import { getFactoryPool, withTransaction, type Tx } from "./core/db";
import { FactoryError, notFound } from "./core/errors";
import { parseInput } from "./core/records";
import { listAllowedActions, preAuthenticate, runTransition, type MachineDef, type TransitionRequest } from "./core/stateMachine";
import { verifyPortalPassword } from "./portalBridge";
import { z } from "zod";
import { withIdempotency } from "./core/idempotency";
import { processOutbox } from "./core/worker";
import "./modules";

export interface RouteContext {
  req: Request;
  url: URL;
  actor: AuthzActor;
  params: Record<string, string>;
  /** Parsed JSON body (empty object when none). */
  body: any;
}

/**
 * Thin wrapper of every factory API route: shared ABT Portal login → factory actor (profile created
 * on first visit) → optional `before` step (e-signature re-authentication, which must commit its
 * failed-attempt counter on its own) → one business transaction → errors mapped to status +
 * Vietnamese message. Business rules live in services; routes only parse and delegate.
 */
export function factoryRoute(
  handler: (tx: Tx, ctx: RouteContext) => Promise<unknown>,
  opts: { before?: (ctx: RouteContext) => Promise<void> } = {}
) {
  return async (req: Request, segment?: { params?: Promise<Record<string, string>> }) => {
    const user = await getAuthorizedUser(req);
    if (!user) return unauthorizedResponse();
    const requestId = crypto.randomUUID();
    const actor: AuthzActor = {
      userId: Number(user.id),
      name: user.full_name || user.username,
      isPortalAdmin: isAdminUser(user),
      isRootAdmin: user.role === "admin",
      requestId,
      ip: clientIp(req),
    };
    try {
      const params = (await segment?.params) ?? {};
      const body = req.method === "GET" || req.method === "HEAD" ? {} : await req.json().catch(() => ({}));
      // Own statement, outside the business transaction: never holds the profile row lock
      // while a signature check on another connection needs it.
      await getFactoryPool().query(
        `INSERT INTO core.user_profile (user_id, display_name) VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name
         WHERE core.user_profile.display_name IS DISTINCT FROM EXCLUDED.display_name`,
        [actor.userId, actor.name]
      );
      const ctx: RouteContext = { req, url: new URL(req.url), actor, params, body };
      await opts.before?.(ctx);
      const result = await withTransaction((tx) => handler(tx, ctx));
      kickOutbox();
      return NextResponse.json(result ?? { ok: true });
    } catch (error: any) {
      if (error instanceof FactoryError) {
        return NextResponse.json({ error: error.message, code: error.code, details: error.details }, { status: error.status });
      }
      if (error?.code === "23505") {
        return NextResponse.json({ error: "Dữ liệu bị trùng với bản ghi đã có (mã hoặc khóa duy nhất).", code: "DUPLICATE" }, { status: 409 });
      }
      console.error(JSON.stringify({ level: "error", requestId, path: new URL(req.url).pathname, msg: error?.message }));
      return NextResponse.json({ error: `Lỗi hệ thống (mã tra cứu ${requestId.slice(0, 8)}). Vui lòng báo quản trị viên.`, code: "INTERNAL" }, { status: 500 });
    }
  };
}

let kicking = false;
/** Delivers fresh events right after a commit (best effort); the worker retries whatever fails. */
function kickOutbox(): void {
  if (kicking) return;
  kicking = true;
  setTimeout(() => {
    processOutbox(50)
      .catch(() => {})
      .finally(() => {
        kicking = false;
      });
  }, 0);
}

/** Document-creating commands: the client sends an Idempotency-Key header; a resend returns the first result. */
export async function idempotent<T>(tx: Tx, ctx: RouteContext, endpoint: string, run: () => Promise<T>): Promise<T> {
  const { result } = await withIdempotency(tx, { userId: ctx.actor.userId, endpoint, key: ctx.req.headers.get("idempotency-key"), body: ctx.body }, run);
  return result;
}

export const queryObject = (url: URL) => Object.fromEntries(url.searchParams.entries());

/** Body of every state-machine action request from the UI. */
const actionBody = z.object({
  action: z.string().min(1).max(40),
  expectedVersion: z.number().int().min(0),
  reason: z.string().trim().max(1000).optional().nullable(),
  payload: z.record(z.unknown()).optional(),
  credential: z.object({ method: z.enum(["PIN", "PASSWORD"]), secret: z.string().min(1).max(200) }).optional(),
});

/**
 * POST handler running one state-machine action on the record `params.id`. A signature is verified
 * before the business transaction (failed attempts are committed and count toward the lock-out);
 * `run` lets a module wrap the transition (e.g. superseding the previous effective spec).
 */
export function machineActionRoute<S extends string, Row extends { id: string; status: S; version: number }>(
  machine: MachineDef<S, Row>,
  run: (tx: Tx, actor: AuthzActor, req: TransitionRequest) => Promise<unknown> = (tx, actor, req) =>
    runTransition(tx, machine, actor, req, { signerAuthenticated: true })
) {
  const toRequest = (ctx: RouteContext): TransitionRequest => ({ ...parseInput(actionBody, ctx.body), id: ctx.params.id });
  return factoryRoute((tx, ctx) => run(tx, ctx.actor, toRequest(ctx)), {
    before: async (ctx) => {
      const req = toRequest(ctx);
      const row = (await getFactoryPool().query(`SELECT status FROM ${machine.table} WHERE id = $1`, [req.id])).rows[0];
      if (!row) throw notFound("bản ghi");
      await preAuthenticate(machine, row.status, req, ctx.actor, verifyPortalPassword);
    },
  });
}

/** Actions the signed-in user may run on a record now (drives the buttons). */
export async function allowedActionsFor<S extends string, Row extends { id: string; status: S; version: number }>(
  tx: Tx,
  machine: MachineDef<S, Row>,
  actor: AuthzActor,
  row: Row
) {
  return listAllowedActions(tx, machine, actor, row);
}
