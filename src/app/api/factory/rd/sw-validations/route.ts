import { factoryRoute } from "@/factory/http";
import { listValidations } from "@/factory/rd/software";

export const GET = factoryRoute((tx, { actor }) => listValidations(tx, actor));
