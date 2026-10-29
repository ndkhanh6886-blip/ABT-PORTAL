import { factoryRoute } from "@/factory/http";
import { unsplitSequence } from "@/factory/oligo/sequences";

export const POST = factoryRoute(async (tx, { actor, params }) => {
  await unsplitSequence(tx, actor, params.id);
  return { ok: true };
});
