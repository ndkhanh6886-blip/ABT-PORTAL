import { factoryRoute } from "@/factory/http";
import { listCalibrations } from "@/factory/oligo/bottleCalibration";

export const GET = factoryRoute((tx, { actor }) => listCalibrations(tx, actor));
