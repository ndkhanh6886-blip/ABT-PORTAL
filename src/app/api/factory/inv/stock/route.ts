import { factoryRoute, queryObject } from "@/factory/http";
import { listStock } from "@/factory/inv/queries";

export const GET = factoryRoute((tx, { actor, url }) => listStock(tx, actor, queryObject(url)));
