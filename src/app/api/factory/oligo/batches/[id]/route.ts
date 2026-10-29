import { factoryRoute } from "@/factory/http";
import { getBatch } from "@/factory/oligo/batchQueries";

export const GET = factoryRoute((tx, { actor, params }) => getBatch(tx, actor, params.id));
