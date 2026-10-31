import { machineActionRoute } from "@/factory/http";
import { experimentMachine } from "@/factory/rd/eln";

export const POST = machineActionRoute(experimentMachine);
