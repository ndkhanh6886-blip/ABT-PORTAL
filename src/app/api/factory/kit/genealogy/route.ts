import { invalid } from "@/factory/core/errors";
import { factoryRoute } from "@/factory/http";
import { traceKitLotGenealogy } from "@/factory/kit/qualityTrace";

export const GET = factoryRoute(async (tx, { actor, req }) => {
  const url = new URL(req.url);
  const lotId = url.searchParams.get("lot_id");
  if (!lotId) throw invalid("Vui lòng chọn lô (lot_id) cần truy xuất phả hệ hai chiều.");
  return traceKitLotGenealogy(tx, actor, lotId);
});
