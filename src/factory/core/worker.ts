import { withTransaction, type Tx } from "./db";
import { vnToday } from "./dates";

export interface OutboxEvent {
  id: string;
  event_type: string;
  target: "FACTORY" | "KD";
  payload: Record<string, any>;
  attempts: number;
}

type Handler = (tx: Tx, event: OutboxEvent) => Promise<void>;
const handlers = new Map<string, Handler[]>();

/** Subscribes to a domain event. Handlers must be idempotent: delivery is at least once. */
export function onEvent(eventType: string, handler: Handler): void {
  handlers.set(eventType, [...(handlers.get(eventType) ?? []), handler]);
}

const MAX_ATTEMPTS = 10;

/**
 * Delivers pending events, each in its own transaction with its handlers, so one failing event
 * never blocks the others. Failures retry with growing delay; SKIP LOCKED lets several workers run.
 */
export async function processOutbox(batchSize = 50): Promise<{ processed: number; failed: number }> {
  let processed = 0;
  let failed = 0;
  for (let i = 0; i < batchSize; i++) {
    const outcome = await withTransaction(async (tx) => {
      const ev = (
        await tx.query(
          `SELECT id, event_type, target, payload, attempts FROM core.outbox_event
            WHERE processed_at IS NULL AND available_at <= now() AND attempts < $1
            ORDER BY available_at, id LIMIT 1 FOR UPDATE SKIP LOCKED`,
          [MAX_ATTEMPTS]
        )
      ).rows[0] as OutboxEvent | undefined;
      if (!ev) return "empty" as const;
      await tx.query("SAVEPOINT handle");
      try {
        for (const h of handlers.get(ev.event_type) ?? []) await h(tx, ev);
        await tx.query("UPDATE core.outbox_event SET processed_at = now(), attempts = attempts + 1, last_error = NULL WHERE id = $1", [ev.id]);
        return "ok" as const;
      } catch (error: any) {
        await tx.query("ROLLBACK TO SAVEPOINT handle");
        await tx.query(
          `UPDATE core.outbox_event SET attempts = attempts + 1, last_error = $2,
                  available_at = now() + make_interval(secs => least(3600, 15 * power(2, attempts)))
            WHERE id = $1`,
          [ev.id, String(error?.message ?? error).slice(0, 2000)]
        );
        return "failed" as const;
      }
    });
    if (outcome === "empty") break;
    if (outcome === "ok") processed++;
    else failed++;
  }
  return { processed, failed };
}

type DailyJob = (tx: Tx, today: string) => Promise<unknown>;
const dailyJobs = new Map<string, DailyJob>();

export function registerDailyJob(name: string, job: DailyJob): void {
  dailyJobs.set(name, job);
}

/** Runs each daily job at most once per Vietnamese calendar day (`core.job_run` is the guard). */
export async function runDailyJobs(today = vnToday()): Promise<Record<string, unknown>> {
  const results: Record<string, unknown> = {};
  for (const [name, job] of dailyJobs) {
    results[name] = await withTransaction(async (tx) => {
      const claimed = await tx.query("INSERT INTO core.job_run (job_name, run_date) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING job_name", [name, today]);
      if (!claimed.rowCount) return "đã chạy hôm nay";
      const result = await job(tx, today);
      await tx.query("UPDATE core.job_run SET finished_at = now(), result = $3 WHERE job_name = $1 AND run_date = $2", [
        name,
        today,
        JSON.stringify(result ?? null),
      ]);
      return result;
    });
  }
  return results;
}
