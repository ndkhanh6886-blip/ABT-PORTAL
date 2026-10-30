import { factoryRoute } from "@/factory/http";
import { retireColumn } from "@/factory/asset/columns";

export const POST = factoryRoute(async (tx, { actor, params, body }) => {
  await retireColumn(tx, actor, params.id, (body as { reason?: unknown } | null)?.reason);
  return { ok: true };
});
