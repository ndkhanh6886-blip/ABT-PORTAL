import { factoryRoute } from "@/factory/http";
import { getDeviceModelDetail } from "@/factory/device/models";

export const GET = factoryRoute((tx, { actor, params }) => getDeviceModelDetail(tx, actor, params.id));
