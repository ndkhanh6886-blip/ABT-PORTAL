import { z } from "zod";
import { parseInput } from "@/factory/core/records";
import { authenticateSigner } from "@/factory/core/signature";
import { getIssueSlip, signIssueSlip } from "@/factory/device/issueSlip";
import { factoryRoute } from "@/factory/http";
import { verifyPortalPassword } from "@/factory/portalBridge";

const credential = z.object({ method: z.enum(["PIN", "PASSWORD"]), secret: z.string().min(1).max(200) });

export const GET = factoryRoute((tx, { actor, params }) => getIssueSlip(tx, actor, params.id));

/** Signs one box of BM 21-01: the signer re-authenticates (PIN / password) before the business transaction. */
export const POST = factoryRoute(
  async (tx, { actor, params, body }) => {
    await signIssueSlip(tx, actor, params.id, body, parseInput(credential, body?.credential).method);
    return getIssueSlip(tx, actor, params.id);
  },
  { before: async ({ actor, body }) => authenticateSigner(actor.userId, parseInput(credential, body?.credential), verifyPortalPassword) }
);
