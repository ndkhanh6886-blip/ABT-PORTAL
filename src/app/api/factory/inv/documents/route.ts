import { factoryRoute, idempotent } from "@/factory/http";
import { createManualDocument, listDocuments } from "@/factory/inv/manual";

export const GET = factoryRoute((tx, { actor, url }) => listDocuments(tx, actor, url.searchParams.get("warehouse_id") || undefined));
export const POST = factoryRoute((tx, ctx) => idempotent(tx, ctx, "inv.documents.create", () => createManualDocument(tx, ctx.actor, ctx.body)));
