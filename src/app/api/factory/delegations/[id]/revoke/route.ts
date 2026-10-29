import { factoryRoute } from "@/factory/http";
import { revokeDelegation } from "@/factory/core/roles";

export const POST = factoryRoute(async (tx, { actor, params }) => {
  await revokeDelegation(tx, actor, params.id);
  return { ok: true };
});
