import { machineActionRoute } from "@/factory/http";
import { lotMachine } from "@/factory/inv/lots";

export const POST = machineActionRoute(lotMachine);
