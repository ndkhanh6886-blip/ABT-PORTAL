import { factoryRoute } from "@/factory/http";
import { updateAsset } from "@/factory/asset/service";

export const PATCH = factoryRoute((tx, { actor, params, body }) => updateAsset(tx, actor, params.id, body));
