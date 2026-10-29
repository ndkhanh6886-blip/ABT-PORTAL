import { factoryRoute } from "@/factory/http";
import { listUsersWithGrants } from "@/factory/core/roles";
import { portalDirectory } from "@/factory/portalBridge";

export const GET = factoryRoute((tx, { actor, url }) => listUsersWithGrants(tx, actor, portalDirectory, url.searchParams.get("q") ?? ""));
