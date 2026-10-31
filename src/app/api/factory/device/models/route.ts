import { factoryRoute, idempotent } from "@/factory/http";
import {
  addModelBomLine,
  createDeviceModel,
  createModelRevision,
  listDeviceModels,
} from "@/factory/device/models";

export const GET = factoryRoute((tx, { actor }) => listDeviceModels(tx, actor));

export const POST = factoryRoute((tx, ctx) =>
  idempotent(tx, ctx, "POST /api/factory/device/models", async () => {
    const kind = ctx.body?.kind;
    if (kind === "revision") return createModelRevision(tx, ctx.actor, ctx.body);
    if (kind === "bom_line") return addModelBomLine(tx, ctx.actor, ctx.body);
    return createDeviceModel(tx, ctx.actor, ctx.body);
  })
);
