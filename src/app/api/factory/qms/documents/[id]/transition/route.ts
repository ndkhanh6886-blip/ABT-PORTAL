import { machineActionRoute } from "@/factory/http";
import { controlledDocMachine } from "@/factory/qms/documents";

export const POST = machineActionRoute(controlledDocMachine);
