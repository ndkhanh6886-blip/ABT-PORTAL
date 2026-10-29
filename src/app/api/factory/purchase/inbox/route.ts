import { factoryRoute } from "@/factory/http";
import { openRequestLines } from "@/factory/purchase/requests";

export const GET = factoryRoute((tx, { actor }) => openRequestLines(tx, actor));
