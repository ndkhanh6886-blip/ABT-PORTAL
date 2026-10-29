import { machineActionRoute } from "@/factory/http";
import { qcTestMachine } from "@/factory/qms/qcTests";

export const POST = machineActionRoute(qcTestMachine);
