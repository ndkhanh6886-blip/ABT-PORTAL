import { machineActionRoute } from "@/factory/http";
import { subcontractOrderMachine } from "@/factory/device/subcontract";

export const POST = machineActionRoute(subcontractOrderMachine);
