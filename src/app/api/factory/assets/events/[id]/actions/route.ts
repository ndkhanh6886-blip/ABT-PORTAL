import { factoryRoute, idempotent, machineActionRoute } from "@/factory/http";
import { assetEventMachine, recordEventSparePart } from "@/factory/asset/events";

const transitionHandler = machineActionRoute(assetEventMachine);

export const POST = async (req: Request, segment: { params: Promise<any> }) => {
  const cloned = req.clone();
  const body = await cloned.json().catch(() => null);
  if (body?.action === "add_spare_part") {
    return factoryRoute((tx, ctx) =>
      idempotent(tx, ctx, "POST /api/factory/assets/events/[id]/add_spare_part", () =>
        recordEventSparePart(tx, ctx.actor, ctx.params.id, ctx.body?.payload ?? ctx.body)
      )
    )(req, segment);
  }
  return transitionHandler(req, segment);
};

