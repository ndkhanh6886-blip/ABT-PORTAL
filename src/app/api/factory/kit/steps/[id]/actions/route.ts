import { machineActionRoute } from "@/factory/http";
import { productionStepMachine } from "@/factory/kit/ordersEbr";

export const POST = machineActionRoute(productionStepMachine);
