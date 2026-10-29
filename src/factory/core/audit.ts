import type { Tx } from "./db";

/** Who performs a request. `userId` is the ABT Portal user id; the name is snapshotted into records. */
export interface Actor {
  userId: number;
  name: string;
  onBehalfOf?: number | null;
  requestId?: string;
  ip?: string;
}

export type Changes = Record<string, [unknown, unknown]>;

/** Field-by-field difference between two versions of a record (only listed fields, only changed ones). */
export function diffChanges(before: Record<string, unknown> | null, after: Record<string, unknown>, fields: string[]): Changes {
  const changes: Changes = {};
  for (const f of fields) {
    const oldValue = before ? before[f] ?? null : null;
    const newValue = after[f] ?? null;
    if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) changes[f] = [oldValue, newValue];
  }
  return changes;
}

/** Appends to the audit trail inside the caller's transaction (the table rejects UPDATE / DELETE). */
export async function writeAudit(
  tx: Tx,
  actor: Actor,
  entry: { entityType: string; entityId: string; action: string; changes?: Changes; reason?: string | null }
): Promise<void> {
  await tx.query(
    `INSERT INTO core.audit_log (user_id, user_name, on_behalf_of, entity_type, entity_id, action, changes, reason, request_id, ip)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      actor.userId,
      actor.name,
      actor.onBehalfOf ?? null,
      entry.entityType,
      entry.entityId,
      entry.action,
      JSON.stringify(entry.changes ?? {}),
      entry.reason ?? null,
      actor.requestId ?? null,
      actor.ip ?? null,
    ]
  );
}
