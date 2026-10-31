import { machineActionRoute } from "@/factory/http";
import { deviceUnitMachine } from "@/factory/device/assembly";

export const POST = machineActionRoute(deviceUnitMachine);
