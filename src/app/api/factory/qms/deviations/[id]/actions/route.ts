import { machineActionRoute } from "@/factory/http";
import { deviationMachine } from "@/factory/qms/ncr";

export const POST = machineActionRoute(deviationMachine);
