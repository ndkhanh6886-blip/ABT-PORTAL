import { factoryRoute } from "@/factory/http";
import { deleteConversion, listConversions, setConversion } from "@/factory/master/service";

export const GET = factoryRoute((tx, { actor, url }) =>
  listConversions(tx, actor, {
    item_id: url.searchParams.get("item_id") || undefined,
    q: url.searchParams.get("q") || undefined,
  })
);

export const POST = factoryRoute((tx, { actor, body }) => setConversion(tx, actor, body));

export const DELETE = factoryRoute((tx, { actor, url, body }) =>
  deleteConversion(tx, actor, String(url.searchParams.get("id") || (body as { id?: string } | null)?.id || ""))
);
