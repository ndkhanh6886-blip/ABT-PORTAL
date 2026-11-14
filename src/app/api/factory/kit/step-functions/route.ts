import { authorizeAnywhere } from "@/factory/core/authz";
import { invalid } from "@/factory/core/errors";
import { factoryRoute } from "@/factory/http";
import {
  deleteCustomStepFunction,
  listCustomStepFunctions,
  upsertCustomStepFunction,
} from "@/factory/kit/bomRouting";

export const GET = factoryRoute(async (tx, ctx) => {
  await authorizeAnywhere(tx, ctx.actor, "kit.view");
  return { items: await listCustomStepFunctions(tx) };
});

export const POST = factoryRoute(async (tx, ctx) => {
  const body = ctx.body ?? {};
  if (body.operation === "delete") {
    if (typeof body.key !== "string" || !body.key.trim()) {
      throw invalid("Thiếu mã chức năng công đoạn cần xóa.");
    }
    return await deleteCustomStepFunction(tx, ctx.actor, body.key);
  }
  return await upsertCustomStepFunction(tx, ctx.actor, body);
});
