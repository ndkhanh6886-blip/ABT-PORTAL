import { factoryRoute } from "@/factory/http";
import { listNotifications, markRead } from "@/factory/core/notifications";

export const GET = factoryRoute((tx, { actor, url }) => listNotifications(tx, actor.userId, { unreadOnly: url.searchParams.get("unread") === "1" }));
export const POST = factoryRoute(async (tx, { actor, body }) => {
  await markRead(tx, actor.userId, Array.isArray(body?.ids) ? body.ids.filter((x: unknown) => typeof x === "string") : []);
  return { ok: true };
});
