import { machineActionRoute } from "@/factory/http";
import { swValidationMachine } from "@/factory/rd/software";

export const POST = machineActionRoute(swValidationMachine);
