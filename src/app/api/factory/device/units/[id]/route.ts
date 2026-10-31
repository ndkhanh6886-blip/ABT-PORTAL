import { factoryRoute, idempotent } from "@/factory/http";
import {
  getDeviceUnitDetail,
  installUnitComponent,
  recordBurnInRun,
  recordUnitFqcResult,
} from "@/factory/device/assembly";

export const GET = factoryRoute((tx, { actor, params }) => getDeviceUnitDetail(tx, actor, params.id));

export const POST = factoryRoute((tx, ctx) =>
  idempotent(tx, ctx, "POST /api/factory/device/units/[id]", async () => {
    const kind = ctx.body?.kind;
    if (kind === "burn_in") return recordBurnInRun(tx, ctx.actor, ctx.params.id, ctx.body);
    if (kind === "fqc") return recordUnitFqcResult(tx, ctx.actor, ctx.params.id, ctx.body);
    return installUnitComponent(tx, ctx.actor, ctx.params.id, ctx.body);
  })
);
