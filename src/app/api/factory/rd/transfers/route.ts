import { factoryRoute, idempotent } from "@/factory/http";
import { createTechTransferPackage, getProjectTransferPrefill, listTechTransfers } from "@/factory/rd/transfer";

export const GET = factoryRoute((tx, { actor, url }) => {
  const prefillProjId = url.searchParams.get("prefill_project_id");
  if (prefillProjId) {
    return getProjectTransferPrefill(tx, actor, prefillProjId);
  }
  return listTechTransfers(tx, actor, url.searchParams.get("project_id") ?? undefined);
});

export const POST = factoryRoute((tx, ctx) =>
  idempotent(tx, ctx, "rd.transfer.create", () => createTechTransferPackage(tx, ctx.actor, ctx.body))
);
