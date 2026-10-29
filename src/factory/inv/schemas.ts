import { z } from "zod";

const uuid = z.string().uuid();
const optUuid = uuid.optional().nullable().transform((v) => v ?? null);

export const DOC_TYPES = ["RECEIPT", "ISSUE", "TRANSFER", "ADJUSTMENT", "COUNT_ADJUST", "RETURN"] as const;
export type DocType = (typeof DOC_TYPES)[number];

/** Reasons that allow issuing stock from a lot that is not released (disposal, return to supplier). */
export const NON_RELEASED_ISSUE_REASONS = ["SCRAP", "RETURN_TO_SUPPLIER"] as const;

export const stockLineSchema = z.object({
  item_id: uuid,
  lot_id: optUuid,
  container_id: optUuid,
  from_location_id: optUuid,
  to_location_id: optUuid,
  qty: z.coerce.number().positive("số lượng phải lớn hơn 0").max(1e12),
  uom: z.string().trim().min(1, "bắt buộc"),
  unit_cost: z.coerce.number().min(0).optional().nullable(),
  reservation_id: optUuid,
});

export const createStockDocumentSchema = z.object({
  doc_type: z.enum(DOC_TYPES),
  reason_code: z
    .string()
    .trim()
    .min(2, "bắt buộc")
    .max(40)
    .regex(/^[A-Z0-9_]+$/, "mã lý do viết hoa, không dấu (ví dụ PRODUCTION, SCRAP)"),
  warehouse_id: uuid,
  source_entity_type: z.string().trim().max(60).optional().nullable(),
  source_entity_id: optUuid,
  notes: z.string().trim().max(2000).optional().nullable(),
  lines: z.array(stockLineSchema).min(1, "phiếu cần ít nhất một dòng").max(500),
});
export type CreateStockDocument = z.infer<typeof createStockDocumentSchema>;

export const SEQUENCE_BY_DOC_TYPE: Record<DocType, string> = {
  RECEIPT: "STOCK_RECEIPT",
  RETURN: "STOCK_RECEIPT",
  ISSUE: "STOCK_ISSUE",
  TRANSFER: "STOCK_TRANSFER",
  ADJUSTMENT: "STOCK_ADJUST",
  COUNT_ADJUST: "STOCK_ADJUST",
};
