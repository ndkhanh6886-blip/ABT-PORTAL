import { factoryRoute } from "@/factory/http";
import { analyzeBatch } from "@/factory/oligo/catalog";

/** Body { text }: one sequence per line, optionally "name<TAB>sequence". */
export const POST = factoryRoute((tx, { actor, body }) => analyzeBatch(tx, actor, body));
