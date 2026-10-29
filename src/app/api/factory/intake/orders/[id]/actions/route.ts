import { machineActionRoute } from "@/factory/http";
import { orderMachine } from "@/factory/intake/orders";

export const POST = machineActionRoute(orderMachine);
