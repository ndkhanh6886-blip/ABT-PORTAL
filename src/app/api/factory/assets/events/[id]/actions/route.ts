import { machineActionRoute } from "@/factory/http";
import { assetEventMachine } from "@/factory/asset/events";

export const POST = machineActionRoute(assetEventMachine);
