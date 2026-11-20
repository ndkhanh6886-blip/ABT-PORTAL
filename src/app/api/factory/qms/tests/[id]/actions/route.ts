import { machineActionRoute } from "@/factory/http";
import { qcTestMachine } from "@/factory/qms/qcTests";
import "@/factory/device/assembly";
import "@/factory/kit/ordersEbr";
import "@/factory/oligo/postProcess";
import "@/factory/qms/qaOps";

export const POST = machineActionRoute(qcTestMachine);
