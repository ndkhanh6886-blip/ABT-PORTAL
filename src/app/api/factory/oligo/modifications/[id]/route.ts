import { factoryRoute } from "@/factory/http";
import { updateCatalogEntry } from "@/factory/oligo/catalog";

export const PATCH = factoryRoute((tx, { actor, params, body }) => updateCatalogEntry(tx, actor, params.id, body));
