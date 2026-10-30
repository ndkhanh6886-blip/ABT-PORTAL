import { factoryRoute } from "@/factory/http";
import { consumptionReport } from "@/factory/oligo/consumptionReport";

export const GET = factoryRoute((tx, { actor, url }) => consumptionReport(tx, actor, Object.fromEntries(url.searchParams)));
