import { machineActionRoute } from "@/factory/http";
import { workPlanMachine } from "@/factory/rd/workPlans";

export const POST = machineActionRoute(workPlanMachine);
