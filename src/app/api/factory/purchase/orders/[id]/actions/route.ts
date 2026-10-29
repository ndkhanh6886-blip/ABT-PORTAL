import { machineActionRoute } from "@/factory/http";
import { poMachine } from "@/factory/purchase/orders";

export const POST = machineActionRoute(poMachine);
