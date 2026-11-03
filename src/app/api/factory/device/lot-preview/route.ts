import { factoryRoute } from "@/factory/http";
import { previewDeviceLot } from "@/factory/device/assembly";

export const GET = factoryRoute((tx, { actor, url }) =>
  previewDeviceLot(tx, actor, {
    model_id: url.searchParams.get("model_id") ?? "",
    qty: Number(url.searchParams.get("qty") ?? 1),
    lot_no: url.searchParams.get("lot_no"),
  })
);
