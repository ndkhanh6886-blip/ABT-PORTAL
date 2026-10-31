import { machineActionRoute } from "@/factory/http";
import { deviceOrderMachine } from "@/factory/device/assembly";

export const POST = machineActionRoute(deviceOrderMachine);
