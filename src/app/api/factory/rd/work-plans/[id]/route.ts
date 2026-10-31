import { factoryRoute } from "@/factory/http";
import { addWorkTask, getWorkPlanDetail } from "@/factory/rd/workPlans";

export const GET = factoryRoute((tx, { actor, params }) => getWorkPlanDetail(tx, actor, params.id));

export const POST = factoryRoute((tx, { actor, params, body }) => addWorkTask(tx, actor, params.id, body));
