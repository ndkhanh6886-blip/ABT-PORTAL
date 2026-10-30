import { factoryRoute } from "@/factory/http";
import { coaForTest } from "@/factory/qms/coa";

export const GET = factoryRoute((tx, { actor, params }) => coaForTest(tx, actor, params.id));
