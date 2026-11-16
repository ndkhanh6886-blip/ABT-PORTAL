import { factoryRoute } from "@/factory/http";
import { prepOptions } from "@/factory/prep/service";

export const GET = factoryRoute((tx, { actor, url }) => prepOptions(tx, actor, url.searchParams.get("dept") ?? undefined));
