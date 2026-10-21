/** Cost / purchase prices are only returned to users holding "warehouse.view_cost_price" (or admins). */
const COST_KEYS = new Set(["cost_price", "costPrice", "unit_cost", "unitCost", "purchase_price", "purchasePrice"]);

export function stripCostFields<T>(value: T): T {
  if (Array.isArray(value)) return value.map(v => stripCostFields(v)) as unknown as T;
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (COST_KEYS.has(k)) continue;
      out[k] = stripCostFields(v);
    }
    return out as T;
  }
  return value;
}
