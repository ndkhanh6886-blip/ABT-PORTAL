import { factoryRoute } from "@/factory/http";
import { invalid } from "@/factory/core/errors";
import { deliveryOptions } from "@/factory/oligo/fulfilment";

export const GET = factoryRoute((tx, { actor, url }) => {
  const id = url.searchParams.get("order_id");
  if (!id) throw invalid("Thiếu đơn Oligo.");
  return deliveryOptions(tx, actor, id);
});
