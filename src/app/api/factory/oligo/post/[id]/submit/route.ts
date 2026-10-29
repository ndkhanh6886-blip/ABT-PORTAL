import { factoryRoute } from "@/factory/http";
import { sendToQc } from "@/factory/oligo/postProcess";

export const POST = factoryRoute((tx, { actor, params }) => sendToQc(tx, actor, params.id));
