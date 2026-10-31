import { machineActionRoute } from "@/factory/http";
import { projectMachine } from "@/factory/rd/projects";

export const POST = machineActionRoute(projectMachine);
