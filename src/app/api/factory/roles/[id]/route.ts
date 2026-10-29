import { factoryRoute } from "@/factory/http";
import { updateRole } from "@/factory/core/roles";

export const PATCH = factoryRoute((tx, { actor, params, body }) => updateRole(tx, actor, params.id, body));
