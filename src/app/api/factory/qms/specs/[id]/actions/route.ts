import { machineActionRoute } from "@/factory/http";
import { approveSpec, specMachine } from "@/factory/qms/specs";
import { runTransition } from "@/factory/core/stateMachine";

export const POST = machineActionRoute(specMachine, (tx, actor, req) =>
  req.action === "approve" ? approveSpec(tx, actor, req, true) : runTransition(tx, specMachine, actor, req, { signerAuthenticated: true })
);
