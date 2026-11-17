import { factoryRoute } from "@/factory/http";
import { deleteTechTransferPackage, getTechTransferDetail, updateTechTransferPackage } from "@/factory/rd/transfer";

export const GET = factoryRoute((tx, { actor, params }) => getTechTransferDetail(tx, actor, params.id));

export const PUT = factoryRoute((tx, { actor, params, body }) => updateTechTransferPackage(tx, actor, params.id, body));

export const DELETE = factoryRoute((tx, { actor, params }) => deleteTechTransferPackage(tx, actor, params.id));
