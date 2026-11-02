import { factoryRoute } from "@/factory/http";
import { syncFromLiveOligoFlowServer } from "@/factory/oligo/legacySync";

export const POST = factoryRoute((tx, { actor, body }) => syncFromLiveOligoFlowServer(tx, actor, body));
