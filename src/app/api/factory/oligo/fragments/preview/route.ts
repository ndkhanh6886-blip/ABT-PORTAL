import { z } from "zod";
import { factoryRoute } from "@/factory/http";
import { authorizeAnywhere } from "@/factory/core/authz";
import { invalid } from "@/factory/core/errors";
import { parseInput } from "@/factory/core/records";
import { SequenceError } from "@/factory/oligo/analyzer";
import { tileFragments } from "@/factory/oligo/analysis";

const schema = z.object({
  name: z.string().trim().min(1).max(100),
  sequence: z.string().trim().min(1).max(20000),
  oligo_len: z.coerce.number().int(),
  overlap: z.coerce.number().int(),
  adapter5: z.string().trim().max(100).default(""),
  adapter3: z.string().trim().max(100).default(""),
});

/** Fragment design preview (pure; nothing is saved). The same tiling as the save path uses. */
export const POST = factoryRoute(async (tx, { actor, body }) => {
  await authorizeAnywhere(tx, actor, "oligo.view");
  const d = parseInput(schema, body);
  try {
    return tileFragments(d.name, d.sequence, d.oligo_len, d.overlap, d.adapter5, d.adapter3);
  } catch (e) {
    if (e instanceof SequenceError) throw invalid(e.message);
    throw e;
  }
});
