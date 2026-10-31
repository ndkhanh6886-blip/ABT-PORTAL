import { factoryRoute } from "@/factory/http";
import { heldPermissions } from "@/factory/core/org";
import { ensureFactoryBootstrapped } from "@/factory/bootstrap";

/** The signed-in user's factory profile and held permissions (used to show tabs and buttons). */
export const GET = factoryRoute(async (tx, { actor }) => {
  await ensureFactoryBootstrapped(tx, actor);
  const profile = (await tx.query("SELECT user_id, display_name, org_unit_id, (pin_hash IS NOT NULL) AS has_pin FROM core.user_profile WHERE user_id = $1", [actor.userId])).rows[0];
  return { profile, is_root: Boolean(actor.isRootAdmin), permissions: await heldPermissions(tx, actor) };
});
