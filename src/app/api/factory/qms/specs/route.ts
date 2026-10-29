import { factoryRoute, idempotent } from "@/factory/http";
import { createSpecDraft, listSpecs } from "@/factory/qms/specs";

export const GET = factoryRoute((tx, { actor }) => listSpecs(tx, actor));
/** New specification, or with `from_code` the next revision of an existing one (always a draft). */
export const POST = factoryRoute((tx, ctx) =>
  idempotent(tx, ctx, "qms.specs.create", () => createSpecDraft(tx, ctx.actor, ctx.body, typeof ctx.body?.from_code === "string" ? ctx.body.from_code : undefined))
);
