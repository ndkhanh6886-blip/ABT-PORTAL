import { factoryRoute } from "@/factory/http";
import { authorize } from "@/factory/core/authz";

export const GET = factoryRoute(async (tx, { actor }) => {
  await authorize(tx, actor, "oligo.view");
  return (await tx.query("SELECT code, label, synth_nmol::float AS synth_nmol, od_min::float AS od_min, od_max::float AS od_max FROM oligo.scale WHERE status = 'ACTIVE' ORDER BY sort_order")).rows;
});
