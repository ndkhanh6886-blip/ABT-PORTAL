import { factoryRoute } from "@/factory/http";

export const GET = factoryRoute(async (tx) => (await tx.query("SELECT code, name, dimension FROM master.uom WHERE status = 'ACTIVE' ORDER BY dimension, code")).rows);
