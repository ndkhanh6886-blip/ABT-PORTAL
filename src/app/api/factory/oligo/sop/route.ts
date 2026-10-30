import { factoryRoute } from "@/factory/http";
import { listSop } from "@/factory/oligo/postSop";

export const GET = factoryRoute((tx, { actor }) => listSop(tx, actor));
