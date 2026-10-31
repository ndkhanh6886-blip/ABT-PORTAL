import { factoryRoute, idempotent } from "@/factory/http";
import { getSubcontractOrderDetail, receiveSubcontractLine } from "@/factory/device/subcontract";

export const GET = factoryRoute((tx, { actor, params }) => getSubcontractOrderDetail(tx, actor, params.id));

export const POST = factoryRoute((tx, ctx) =>
  idempotent(tx, ctx, "POST /api/factory/device/subcontracts/[id]", () =>
    receiveSubcontractLine(tx, ctx.actor, ctx.params.id, ctx.body)
  )
);
