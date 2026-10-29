import { factoryRoute } from "@/factory/http";
import { invalid } from "@/factory/core/errors";
import { batchCandidates } from "@/factory/oligo/batchQueries";

export const GET = factoryRoute((tx, { actor, url }) => {
  const unit = url.searchParams.get("org_unit_id");
  if (!unit) throw invalid("Thiếu phòng.");
  return batchCandidates(tx, actor, unit);
});
