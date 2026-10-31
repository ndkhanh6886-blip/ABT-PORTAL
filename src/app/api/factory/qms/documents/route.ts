import { factoryRoute, idempotent } from "@/factory/http";
import {
  createControlledDocument,
  listControlledDocuments,
  listTrainingRecords,
  recordTraining,
} from "@/factory/qms/documents";

export const GET = factoryRoute(async (tx, { actor, url }) => {
  const document_id = url.searchParams.get("document_id") || undefined;
  const documents = await listControlledDocuments(tx, actor);
  const trainings = await listTrainingRecords(tx, actor, document_id);
  return { documents, trainings };
});

export const POST = factoryRoute(async (tx, ctx) => {
  const b = (ctx.body ?? {}) as Record<string, unknown>;
  if (b.kind === "training") {
    const training = await idempotent(tx, ctx, "qms:training", () => recordTraining(tx, ctx.actor, b));
    return { training };
  }
  const document = await idempotent(tx, ctx, "qms:documents", () => createControlledDocument(tx, ctx.actor, b));
  return { document };
});
