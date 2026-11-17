import { factoryRoute } from "@/factory/http";
import { deleteAsset, updateAsset } from "@/factory/asset/service";

export const PATCH = factoryRoute((tx, { actor, params, body }) => updateAsset(tx, actor, params.id, body));

export const DELETE = factoryRoute((tx, { actor, params, body, url }) =>
  deleteAsset(tx, actor, params.id, {
    ...body,
    reason: body?.reason ?? url.searchParams.get("reason") ?? undefined,
  })
);
