import { factoryRoute } from "@/factory/http";
import { listFqcPeople } from "@/factory/device/assembly";

export const GET = factoryRoute((tx, { actor }) => listFqcPeople(tx, actor));
