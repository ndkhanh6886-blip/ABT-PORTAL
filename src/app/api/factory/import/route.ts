import { factoryRoute } from "@/factory/http";
import { executeExcelBatchImport, getExcelImportOverview } from "@/factory/import/excelImport";

export const GET = factoryRoute((tx, { actor }) => getExcelImportOverview(tx, actor));

export const POST = factoryRoute((tx, { actor, body }) =>
  executeExcelBatchImport(tx, actor, (body ?? {}) as Record<string, unknown>)
);
