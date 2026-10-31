import { machineActionRoute } from "@/factory/http";
import { productionOrderMachine } from "@/factory/kit/ordersEbr";

export const POST = machineActionRoute(productionOrderMachine);
