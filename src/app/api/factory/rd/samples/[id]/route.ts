import { factoryRoute } from "@/factory/http";
import { getSampleDetail, recordSampleEvent } from "@/factory/rd/samples";

export const GET = factoryRoute((tx, { actor, params }) => getSampleDetail(tx, actor, params.id));

export const POST = factoryRoute((tx, { actor, params, body }) => recordSampleEvent(tx, actor, params.id, body));
