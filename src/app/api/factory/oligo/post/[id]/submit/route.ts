import { factoryRoute } from "@/factory/http";
import { confirmOligoPostQc } from "@/factory/oligo/postProcess";

export const POST = factoryRoute((tx, { actor, params, body }) =>
  confirmOligoPostQc(tx, actor, params.id, (body && typeof body === "object" ? body : {}) as any)
);
