import { machineActionRoute } from "@/factory/http";
import { reworkOrderMachine } from "@/factory/kit/qualityTrace";

export const POST = machineActionRoute(reworkOrderMachine);
