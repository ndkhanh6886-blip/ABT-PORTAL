import { onEvent } from "../core/worker";
import "./permissions";


/** A message exchanged with the Kinh doanh side. `event_id` deduplicates redelivery on both sides. */
export interface BridgeEvent {
  event_id: string;
  event_type: string;
  payload: Record<string, any>;
}

/** Delivers factory events to ABT Portal (Kinh doanh). Set once by the app; tests use a fake. */
export interface KdGateway {
  deliver(event: BridgeEvent): Promise<void>;
}

let gateway: KdGateway | null = null;
export function setKdGateway(g: KdGateway | null): void {
  gateway = g;
}

/** Factory → Kinh doanh event types. They leave through the outbox (at least once). */
export const FACTORY_TO_KD = [
  "FactoryOrderAccepted",
  "FactoryOrderRejected",
  "FactoryOrderProgress",
  "FactoryShipmentPosted",
  "FactoryShipmentDelivered",
] as const;

for (const type of FACTORY_TO_KD) {
  onEvent(type, async (_tx, ev) => {
    if (!gateway) throw new Error("Chưa cấu hình cầu nối sang Kinh doanh");
    await gateway.deliver({ event_id: ev.id, event_type: ev.event_type, payload: ev.payload });
  });
}
