import { factoryRoute, idempotent, queryObject } from "@/factory/http";
import { createManualDocument, listDocuments } from "@/factory/inv/manual";

export const GET = factoryRoute((tx, { actor, url }) => listDocuments(tx, actor, queryObject(url)));
export const POST = factoryRoute((tx, ctx) => idempotent(tx, ctx, "inv.documents.create", () => createManualDocument(tx, ctx.actor, ctx.body)));
