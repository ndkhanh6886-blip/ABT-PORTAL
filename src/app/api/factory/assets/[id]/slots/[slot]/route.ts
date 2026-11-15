import { factoryRoute } from "@/factory/http";
import { deleteSlot } from "@/factory/asset/slots";

export const DELETE = factoryRoute((tx, { actor, params }) => deleteSlot(tx, actor, params.id, Number(params.slot)));
