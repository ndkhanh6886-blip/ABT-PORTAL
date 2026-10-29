import { factoryRoute } from "@/factory/http";
import { hasFactoryPermission } from "@/factory/core/authz";
import { invalid } from "@/factory/core/errors";

/** Oligo departments where the user holds the given oligo.* permission (for pickers on plan / config screens). */
export const GET = factoryRoute(async (tx, { actor, url }) => {
  const perm = url.searchParams.get("perm") ?? "oligo.view";
  if (!/^(oligo|asset)\.[a-z.]+$/.test(perm)) throw invalid("Quyền không hợp lệ.");
  const units = (await tx.query("SELECT id, code, name FROM core.org_unit WHERE module_key = 'OLIGO' AND status = 'ACTIVE' ORDER BY code")).rows;
  const out = [];
  for (const u of units) if (await hasFactoryPermission(tx, actor, perm, u.id)) out.push(u);
  return out;
});
