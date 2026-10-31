import { getFactoryPool } from "@/factory/core/db";
import { notFound } from "@/factory/core/errors";
import { parseInput } from "@/factory/core/records";
import { preAuthenticate, runTransition, type TransitionRequest } from "@/factory/core/stateMachine";
import { factoryRoute } from "@/factory/http";
import { retainSampleMachine, stabilityStudyMachine } from "@/factory/kit/qualityTrace";
import { verifyPortalPassword } from "@/factory/portalBridge";
import { z } from "zod";

const actionBody = z.object({
  action: z.string().min(1).max(40),
  expectedVersion: z.number().int().min(0),
  reason: z.string().trim().max(1000).optional().nullable(),
  payload: z.record(z.unknown()).optional(),
  credential: z.object({ method: z.enum(["PIN", "PASSWORD"]), secret: z.string().min(1).max(200) }).optional(),
});

export const POST = factoryRoute(
  async (tx, ctx) => {
    const req: TransitionRequest = { ...parseInput(actionBody, ctx.body), id: ctx.params.id };
    if (req.payload?.entity === "stability_study") {
      const study = await runTransition(tx, stabilityStudyMachine, ctx.actor, req, { signerAuthenticated: true });
      return { study };
    }
    const retain_sample = await runTransition(tx, retainSampleMachine, ctx.actor, req, { signerAuthenticated: true });
    return { retain_sample };
  },
  {
    before: async (ctx) => {
      const req: TransitionRequest = { ...parseInput(actionBody, ctx.body), id: ctx.params.id };
      const isStudy = req.payload?.entity === "stability_study";
      const machine = isStudy ? stabilityStudyMachine : retainSampleMachine;
      const row = (await getFactoryPool().query(`SELECT status FROM ${machine.table} WHERE id = $1`, [req.id])).rows[0];
      if (!row) throw notFound("bản ghi");
      await preAuthenticate(machine as any, row.status, req, ctx.actor, verifyPortalPassword);
    },
  }
);
