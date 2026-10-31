import { machineActionRoute } from "@/factory/http";
import { routingMachine } from "@/factory/kit/bomRouting";

export const POST = machineActionRoute(routingMachine);
