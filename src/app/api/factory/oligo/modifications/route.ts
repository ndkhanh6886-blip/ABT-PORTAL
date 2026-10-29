import { factoryRoute } from "@/factory/http";
import { listCatalog } from "@/factory/oligo/catalog";

export const GET = factoryRoute((tx, { actor }) => listCatalog(tx, actor));
