import { factoryRoute } from "@/factory/http";
import { orderCoa } from "@/factory/oligo/coa";

export const GET = factoryRoute((tx, { actor, params }) => orderCoa(tx, actor, params.id));
