import { factoryRoute, idempotent } from "@/factory/http";
import {
  createSubcontractOrder,
  createSubcontractPart,
  createVendorEvaluation,
  listSubcontractOrders,
  listSubcontractParts,
  listVendorEvaluations,
} from "@/factory/device/subcontract";

export const GET = factoryRoute(async (tx, { actor }) => {
  const [parts, orders, evaluations] = await Promise.all([
    listSubcontractParts(tx, actor),
    listSubcontractOrders(tx, actor),
    listVendorEvaluations(tx, actor),
  ]);
  return { parts, orders, evaluations };
});

export const POST = factoryRoute((tx, ctx) =>
  idempotent(tx, ctx, "POST /api/factory/device/subcontracts", async () => {
    const kind = ctx.body?.kind;
    if (kind === "part") return createSubcontractPart(tx, ctx.actor, ctx.body);
    if (kind === "vendor_eval") return createVendorEvaluation(tx, ctx.actor, ctx.body);
    return createSubcontractOrder(tx, ctx.actor, ctx.body);
  })
);
