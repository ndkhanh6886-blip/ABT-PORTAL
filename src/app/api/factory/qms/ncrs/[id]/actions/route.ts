import { machineActionRoute } from "@/factory/http";
import { ncrMachine } from "@/factory/qms/ncr";

export const POST = machineActionRoute(ncrMachine);
