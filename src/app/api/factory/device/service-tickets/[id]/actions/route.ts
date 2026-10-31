import { getFactoryPool } from "@/factory/core/db";
import { notFound } from "@/factory/core/errors";
import { parseInput } from "@/factory/core/records";
import { preAuthenticate, runTransition, type TransitionRequest } from "@/factory/core/stateMachine";
import { factoryRoute, idempotent } from "@/factory/http";
import { verifyPortalPassword } from "@/factory/portalBridge";
import {
  evaluateComplaintCapa,
  replaceTicketComponent,
  serviceTicketMachine,
} from "@/factory/device/serviceTickets";
import { z } from "zod";

const actionBody = z.object({
  action: z.string().min(1).max(40),
  expectedVersion: z.number().int().min(0).optional(),
  reason: z.string().trim().max(1000).optional().nullable(),
  payload: z.record(z.unknown()).optional(),
  credential: z.object({ method: z.enum(["PIN", "PASSWORD"]), secret: z.string().min(1).max(200) }).optional(),
});

export const POST = factoryRoute(
  async (tx, ctx) => {
    if (ctx.body?.action === "evaluate_capa") {
      return evaluateComplaintCapa(tx, ctx.actor, ctx.params.id, ctx.body);
    }
    if (ctx.body?.action === "replace_part") {
      return idempotent(tx, ctx, "POST /api/factory/device/service-tickets/[id]/replace", () =>
        replaceTicketComponent(tx, ctx.actor, ctx.params.id, ctx.body)
      );
    }
    const parsed = parseInput(actionBody, ctx.body);
    const req: TransitionRequest = {
      id: ctx.params.id,
      action: parsed.action,
      expectedVersion: parsed.expectedVersion ?? 0,
      reason: parsed.reason,
      payload: parsed.payload,
      credential: parsed.credential,
    };
    return runTransition(tx, serviceTicketMachine, ctx.actor, req, { signerAuthenticated: true });
  },
  {
    before: async (ctx) => {
      if (ctx.body?.action === "evaluate_capa" || ctx.body?.action === "replace_part") return;
      const parsed = parseInput(actionBody, ctx.body);
      const req: TransitionRequest = {
        id: ctx.params.id,
        action: parsed.action,
        expectedVersion: parsed.expectedVersion ?? 0,
        reason: parsed.reason,
        payload: parsed.payload,
        credential: parsed.credential,
      };
      const row = (await getFactoryPool().query("SELECT status FROM device.service_ticket WHERE id = $1", [req.id])).rows[0];
      if (!row) throw notFound("phiếu dịch vụ kỹ thuật");
      await preAuthenticate(serviceTicketMachine, row.status, req, ctx.actor, verifyPortalPassword);
    },
  }
);
