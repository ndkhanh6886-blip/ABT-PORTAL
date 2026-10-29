import { machineActionRoute } from "@/factory/http";
import { prMachine } from "@/factory/purchase/requests";

export const POST = machineActionRoute(prMachine);
