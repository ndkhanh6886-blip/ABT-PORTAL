import { factoryRoute } from "@/factory/http";
import { cleanColumn } from "@/factory/asset/columns";

export const POST = factoryRoute(async (tx, { actor, params, body }) => {
  return cleanColumn(tx, actor, params.id, (body as { notes?: unknown } | null)?.notes);
});
