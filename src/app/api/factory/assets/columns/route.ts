import { factoryRoute } from "@/factory/http";
import { createColumn, listColumns } from "@/factory/asset/columns";

export const GET = factoryRoute((tx, { actor }) => listColumns(tx, actor));
export const POST = factoryRoute((tx, { actor, body }) => createColumn(tx, actor, body));
