import { machineActionRoute } from "@/factory/http";
import { bomMachine } from "@/factory/kit/bomRouting";

export const POST = machineActionRoute(bomMachine);
