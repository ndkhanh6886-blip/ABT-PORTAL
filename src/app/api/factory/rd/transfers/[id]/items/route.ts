import { factoryRoute } from "@/factory/http";
import { invalid } from "@/factory/core/errors";
import { deleteTechTransferChecklistItem, saveTechTransferChecklistItem } from "@/factory/rd/transfer";

export const POST = factoryRoute((tx, { actor, params, body }) => saveTechTransferChecklistItem(tx, actor, params.id, body));

export const DELETE = factoryRoute((tx, { actor, params, url }) => {
  const itemId = url.searchParams.get("item_id");
  if (!itemId) throw invalid("Thiếu item_id hạng mục cần xóa.");
  return deleteTechTransferChecklistItem(tx, actor, params.id, itemId);
});
