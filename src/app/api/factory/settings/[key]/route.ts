import { factoryRoute } from "@/factory/http";
import { authorize } from "@/factory/core/authz";
import { updateSetting } from "@/factory/core/settings";

export const PUT = factoryRoute(async (tx, { actor, params, body }) => {
  await authorize(tx, actor, "core.setting.manage");
  await updateSetting(tx, actor, decodeURIComponent(params.key), body as { value: unknown; version: number; reason: string });
  return { ok: true };
});
