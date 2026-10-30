import { factoryRoute } from "@/factory/http";
import { removeAndCalibrate } from "@/factory/oligo/bottleCalibration";

/** Takes the bottle off the port with the measured volumes (calibration of the rule). */
export const POST = factoryRoute((tx, { actor, params, body }) => removeAndCalibrate(tx, actor, params.id, Number(params.port), body));
