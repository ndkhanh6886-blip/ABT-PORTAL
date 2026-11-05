import { factoryRoute } from "@/factory/http";
import { getSoftwareLifecycle } from "@/factory/rd/software";

export const GET = factoryRoute((tx, { actor, params, url }) => getSoftwareLifecycle(tx, actor, params.projectId, url.searchParams.get("version")));
