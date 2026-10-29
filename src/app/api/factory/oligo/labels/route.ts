import { factoryRoute } from "@/factory/http";
import { printLabels } from "@/factory/oligo/fulfilment";

/** POST, not GET: every print is recorded (a reprint needs a reason). */
export const POST = factoryRoute((tx, { actor, body }) => printLabels(tx, actor, body));
