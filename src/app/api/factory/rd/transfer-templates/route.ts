import { factoryRoute } from "@/factory/http";
import { invalid } from "@/factory/core/errors";
import { deleteTransferTemplate, listTransferTemplates, saveTransferTemplate } from "@/factory/rd/transfer";

export const GET = factoryRoute((tx, { actor, url }) =>
  listTransferTemplates(tx, actor, url.searchParams.get("domain") ?? undefined)
);

export const POST = factoryRoute((tx, { actor, body }) => saveTransferTemplate(tx, actor, body));

export const DELETE = factoryRoute((tx, { actor, url }) => {
  const id = url.searchParams.get("id");
  if (!id) throw invalid("Thiếu id mẫu hồ sơ chuyển giao cần xóa.");
  return deleteTransferTemplate(tx, actor, id);
});
