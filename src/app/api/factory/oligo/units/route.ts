import { factoryRoute } from "@/factory/http";
import { hasFactoryPermission } from "@/factory/core/authz";
import { invalid } from "@/factory/core/errors";
import { ensureFactoryBootstrapped } from "@/factory/bootstrap";

/** Departments where the user holds the given permission (Oligo units for oligo.*, or all active departments for plan.* / asset.* / prep.*). */
export const GET = factoryRoute(async (tx, { actor, url }) => {
  await ensureFactoryBootstrapped(tx, actor);
  const perm = url.searchParams.get("perm") ?? "oligo.view";
  if (!/^(oligo|asset|plan|prep|work)\.[a-z.]+$/.test(perm)) throw invalid("Quyền không hợp lệ.");
  const onlyOligo = perm.startsWith("oligo.");
  const units = (
    await tx.query(
      onlyOligo
        ? "SELECT id, code, name, module_key FROM core.org_unit WHERE module_key = 'OLIGO' AND status = 'ACTIVE' ORDER BY code"
        : "SELECT id, code, name, module_key FROM core.org_unit WHERE status = 'ACTIVE' ORDER BY code"
    )
  ).rows;
  const out = [];
  for (const u of units) {
    if (await hasFactoryPermission(tx, actor, perm, u.id)) out.push(u);
  }
  return out;
});
