import { machineActionRoute } from "@/factory/http";
import { batchMachine } from "@/factory/oligo/batches";

export const POST = machineActionRoute(batchMachine);
