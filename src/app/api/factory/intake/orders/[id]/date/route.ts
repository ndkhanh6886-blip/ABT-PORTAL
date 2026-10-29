import { factoryRoute } from "@/factory/http";
import { changeCommittedDate } from "@/factory/intake/orders";

export const POST = factoryRoute((tx, { actor, params, body }) => changeCommittedDate(tx, actor, params.id, body));
