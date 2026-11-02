import { z } from "zod";
import { factoryRoute } from "@/factory/http";
import { parseInput } from "@/factory/core/records";
import {
  getPricingConfigResponse,
  linesTotal,
  loadPriceConfig,
  orderSequenceLines,
  savePricingConfig,
  sequenceSkipsStandardBasePrice,
  standardUnitPrice,
} from "@/factory/oligo/pricing";

export const GET = factoryRoute((tx, { actor }) => getPricingConfigResponse(tx, actor));

export const PUT = factoryRoute((tx, { actor, body }) => savePricingConfig(tx, actor, body));

export const POST = factoryRoute(async (tx, { body }) => {
  const schema = z.object({
    sequence: z.string().trim().min(1, "nhập trình tự"),
    scale: z.string().trim().default("100nmol"),
    purification: z.string().trim().default("Desalt"),
    format: z.string().trim().default("Lyophilized"),
    classification: z.string().trim().default("DNA"),
    pricing_type: z.enum(["auto", "percentage", "custom", "demo"]).default("auto"),
    price_percentage: z.coerce.number().min(0).max(500).default(100),
    custom_unit_price: z.coerce.number().min(0).optional().nullable(),
    custom_total: z.coerce.number().min(0).optional().nullable(),
    enforce_lock: z.boolean().default(false),
  });
  const d = parseInput(schema, body);
  const config = await loadPriceConfig(tx);
  const lines = orderSequenceLines({
    sequenceStr: d.sequence,
    scale: d.scale,
    purification: d.purification,
    format: d.format,
    classification: d.classification,
    pricingType: d.pricing_type,
    pricePercentage: d.price_percentage,
    customUnitPrice: d.custom_unit_price ?? null,
    customTotal: d.custom_total ?? null,
    config,
    enforceLock: d.enforce_lock,
  });
  return {
    lines,
    unit_price: standardUnitPrice(lines),
    total_price: linesTotal(lines),
    skips_std_base: sequenceSkipsStandardBasePrice(d.sequence, config),
  };
});
