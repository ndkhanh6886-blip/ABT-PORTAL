import { factoryRoute } from "@/factory/http";
import { startPostProcess } from "@/factory/oligo/postProcess";

export const POST = factoryRoute((tx, { actor, params }) => startPostProcess(tx, actor, params.id));
