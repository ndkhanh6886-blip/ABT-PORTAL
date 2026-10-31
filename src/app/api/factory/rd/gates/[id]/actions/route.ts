import { machineActionRoute } from "@/factory/http";
import { projectGateMachine } from "@/factory/rd/projects";

export const POST = machineActionRoute(projectGateMachine);
