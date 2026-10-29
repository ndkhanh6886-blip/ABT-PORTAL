import { factoryRoute } from "@/factory/http";
import { listOrders } from "@/factory/intake/orders";

export const GET = factoryRoute((tx, { actor, url }) => listOrders(tx, actor, url.searchParams.get("status") || undefined));
