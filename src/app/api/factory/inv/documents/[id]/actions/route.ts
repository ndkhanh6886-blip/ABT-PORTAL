import { machineActionRoute } from "@/factory/http";
import { stockDocumentMachine } from "@/factory/inv/documents";

export const POST = machineActionRoute(stockDocumentMachine);
