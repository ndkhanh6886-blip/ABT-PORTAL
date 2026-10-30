import { factoryRoute } from "@/factory/http";
import { authorize } from "@/factory/core/authz";
import { listSettings } from "@/factory/core/settings";

export const GET = factoryRoute(async (tx, { actor }) => {
  await authorize(tx, actor, "core.setting.manage");
  return listSettings(tx);
});
