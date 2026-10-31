import { machineActionRoute } from "@/factory/http";
import { ideaMachine } from "@/factory/rd/ideas";

export const POST = machineActionRoute(ideaMachine);
