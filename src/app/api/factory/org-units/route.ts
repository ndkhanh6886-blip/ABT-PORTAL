import { factoryRoute } from "@/factory/http";
import { createOrgUnit, listOrgUnits } from "@/factory/core/org";

export const GET = factoryRoute((tx) => listOrgUnits(tx));
export const POST = factoryRoute((tx, { actor, body }) => createOrgUnit(tx, actor, body));
