import { factoryRoute } from "@/factory/http";
import { configurePorts, listPorts } from "@/factory/oligo/synthPorts";

export const GET = factoryRoute((tx, { actor, params }) => listPorts(tx, actor, params.id));
export const PUT = factoryRoute((tx, { actor, params, body }) => configurePorts(tx, actor, params.id, body));
