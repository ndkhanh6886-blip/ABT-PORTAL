import { machineActionRoute } from "@/factory/http";
import { swReleaseMachine } from "@/factory/rd/transfer";

export const POST = machineActionRoute(swReleaseMachine);
