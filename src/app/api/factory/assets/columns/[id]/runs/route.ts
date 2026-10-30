import { factoryRoute } from "@/factory/http";
import { columnRuns } from "@/factory/asset/columns";

export const GET = factoryRoute((tx, { actor, params }) => columnRuns(tx, actor, params.id));
