import { factoryRoute } from "@/factory/http";
import { planBoard } from "@/factory/plan/service";

export const GET = factoryRoute((tx, { actor, url }) => planBoard(tx, actor, Object.fromEntries(url.searchParams)));
