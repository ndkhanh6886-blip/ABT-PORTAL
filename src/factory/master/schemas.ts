import { z } from "zod";

const code = z
  .string()
  .trim()
  .min(2, "tối thiểu 2 ký tự")
  .max(40, "tối đa 40 ký tự")
  .regex(/^[A-Za-z0-9._-]+$/, "chỉ gồm chữ không dấu, số, dấu chấm, gạch ngang, gạch dưới")
  .transform((s) => s.toUpperCase());
const name = z.string().trim().min(1, "bắt buộc").max(255, "tối đa 255 ký tự");
const qty = z.coerce.number().min(0, "không được âm").max(1e12);
const optionalText = z.string().trim().max(1000).optional().nullable().transform((s) => s || null);

export const ITEM_TYPES = ["RAW_MATERIAL", "REAGENT", "CONSUMABLE", "COMPONENT", "SEMI_FINISHED", "FINISHED_KIT", "DEVICE", "OLIGO_SERVICE", "SPARE_PART"] as const;
export const STORAGE = ["RT", "2-8", "-20", "-80"] as const;

export const itemFields = {
  name,
  item_type: z.enum(ITEM_TYPES, { message: "loại vật tư không hợp lệ" }),
  category_id: z.string().uuid().optional().nullable(),
  base_uom: z.string().trim().min(1, "bắt buộc"),
  tracking: z.enum(["NONE", "LOT", "SERIAL"]).default("LOT"),
  shelf_life_days: z.coerce.number().int().positive("phải lớn hơn 0").optional().nullable(),
  open_shelf_life_days: z.coerce.number().int().positive("phải lớn hơn 0").optional().nullable(),
  storage_condition: z.enum(STORAGE).default("RT"),
  min_stock: qty.default(0),
  reorder_qty: qty.default(0),
  receipt_qc_required: z.boolean().default(true),
  is_purchasable: z.boolean().default(true),
  is_saleable: z.boolean().default(false),
  is_manufacturable: z.boolean().default(false),
  hazard_class: optionalText,
  kd_item_code: z.string().trim().max(60).optional().nullable().transform((s) => s || null),
  /** Unit the Kinh doanh side orders in (e.g. "Hộp"), and how many base units one of it holds. */
  kd_unit: z.string().trim().max(30).optional().nullable().transform((s) => s || null),
  kd_unit_factor: z.coerce.number().positive("hệ số quy đổi phải lớn hơn 0").default(1),
  notes: optionalText,
};

export const createItemSchema = z.object({ code: code.optional(), ...itemFields });

// base_uom and tracking are fixed once stock exists (checked in the service)
export const updateItemSchema = z
  .object(itemFields)
  .partial()
  .extend({ version: z.number().int().min(0), reason: optionalText });

export const createCategorySchema = z.object({ code, name, parent_id: z.string().uuid().optional().nullable() });

export const createPartnerSchema = z
  .object({
    code: code.optional(),
    name,
    tax_code: z.string().trim().regex(/^\d{10}(-\d{3})?$/, "mã số thuế gồm 10 số hoặc 10 số-3 số").optional().nullable().or(z.literal("").transform(() => null)),
    is_supplier: z.boolean().default(false),
    is_customer: z.boolean().default(false),
    is_subcontractor: z.boolean().default(false),
    address: optionalText,
    payment_terms: optionalText,
  })
  .refine((p) => p.is_supplier || p.is_customer || p.is_subcontractor, { message: "chọn ít nhất một vai trò: nhà cung cấp, khách hàng hoặc gia công" });

export const createWarehouseSchema = z.object({
  code,
  name,
  owner_org_unit_id: z.string().uuid("chọn phòng sở hữu"),
  purpose: z.enum(["RAW", "FINISHED", "QUARANTINE", "RD", "OLIGO", "DEVICE_PARTS"]),
  access_mode: z.enum(["OWNER_ONLY", "SHARED_READ"]).default("OWNER_ONLY"),
});

export const createLocationSchema = z.object({
  warehouse_id: z.string().uuid(),
  parent_id: z.string().uuid().optional().nullable(),
  code,
  name,
  temperature_condition: z.enum(STORAGE).default("RT"),
  is_quarantine: z.boolean().default(false),
});

export const conversionSchema = z.object({
  from_uom: z.string().min(1),
  to_uom: z.string().min(1),
  factor: z.coerce.number().positive("hệ số phải lớn hơn 0"),
  item_id: z.string().uuid().optional().nullable(),
});

export const listQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(50),
  status: z.enum(["ACTIVE", "INACTIVE", "ALL"]).default("ACTIVE"),
});
