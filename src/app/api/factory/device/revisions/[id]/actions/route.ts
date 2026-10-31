import { machineActionRoute } from "@/factory/http";
import { modelRevisionMachine } from "@/factory/device/models";

export const POST = machineActionRoute(modelRevisionMachine);
