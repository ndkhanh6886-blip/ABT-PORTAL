import { machineActionRoute } from "@/factory/http";
import { swProblemMachine } from "@/factory/rd/software";

export const POST = machineActionRoute(swProblemMachine);
