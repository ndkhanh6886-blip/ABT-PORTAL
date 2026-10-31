import { factoryRoute } from "@/factory/http";
import { listProductionPlan } from "@/factory/kit/ordersEbr";

/** Bảng Kế hoạch sản xuất Kit theo PO, QA phụ trách & tiến độ theo công đoạn. */
export const GET = factoryRoute(async (tx, { actor }) => {
  return listProductionPlan(tx, actor);
});
