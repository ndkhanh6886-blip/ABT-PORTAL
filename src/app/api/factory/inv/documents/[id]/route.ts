import { factoryRoute } from "@/factory/http";
import { getDocumentDetail } from "@/factory/inv/manual";

export const GET = factoryRoute((tx, { actor, params }) => getDocumentDetail(tx, actor, params.id));
