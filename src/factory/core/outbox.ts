import type { Tx } from "./db";

/**
 * Domain events, written in the same transaction as the change that caused them and delivered
 * later by the worker (at least once; consumers dedupe on the event id).
 */
export async function enqueueEvent(
  tx: Tx,
  eventType: string,
  payload: Record<string, unknown>,
  target: "FACTORY" | "KD" = "FACTORY"
): Promise<string> {
  const res = await tx.query(
    "INSERT INTO core.outbox_event (event_type, target, payload) VALUES ($1, $2, $3) RETURNING id",
    [eventType, target, JSON.stringify(payload)]
  );
  return res.rows[0].id;
}
