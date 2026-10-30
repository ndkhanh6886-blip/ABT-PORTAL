import { factoryRoute } from "@/factory/http";
import { invalid } from "@/factory/core/errors";
import { traceSequence } from "@/factory/oligo/trace";

export const GET = factoryRoute((tx, { actor, url }) => {
  const q = url.searchParams.get("q");
  if (!q) throw invalid("Nhập mã trình tự.");
  return traceSequence(tx, actor, q);
});
