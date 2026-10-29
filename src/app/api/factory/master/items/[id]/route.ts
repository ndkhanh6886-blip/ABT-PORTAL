import { factoryRoute } from "@/factory/http";
import { updateItem } from "@/factory/master/service";

export const PATCH = factoryRoute((tx, { actor, params, body }) => updateItem(tx, actor, params.id, body));
