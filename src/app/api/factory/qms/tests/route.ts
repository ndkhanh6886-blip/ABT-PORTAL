import { factoryRoute } from "@/factory/http";
import { listQcTests } from "@/factory/qms/qcTests";

export const GET = factoryRoute((tx, { actor, url }) => listQcTests(tx, actor, url.searchParams.get("status") || undefined));
