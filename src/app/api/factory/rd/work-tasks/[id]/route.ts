import { factoryRoute } from "@/factory/http";
import { updateWorkTaskAction } from "@/factory/rd/workPlans";

export const POST = factoryRoute((tx, { actor, params, body }) => updateWorkTaskAction(tx, actor, params.id, body));
