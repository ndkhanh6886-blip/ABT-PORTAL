import { machineActionRoute } from "@/factory/http";
import { techTransferMachine } from "@/factory/rd/transfer";

export const POST = machineActionRoute(techTransferMachine);
