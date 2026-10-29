import { factoryRoute } from "@/factory/http";
import { parseInput } from "@/factory/core/records";
import { setOwnPin, setPinSchema } from "@/factory/core/roles";
import { authenticateSigner } from "@/factory/core/signature";
import { verifyPortalPassword } from "@/factory/portalBridge";

/** Sets one's own signature PIN after re-entering the ABT Portal password. */
export const POST = factoryRoute((tx, { actor, body }) => setOwnPin(tx, actor, parseInput(setPinSchema, body).pin), {
  before: async ({ actor, body }) => {
    const { password } = parseInput(setPinSchema, body);
    await authenticateSigner(actor.userId, { method: "PASSWORD", secret: password }, verifyPortalPassword);
  },
});
