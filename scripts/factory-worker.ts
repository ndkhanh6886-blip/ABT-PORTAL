// Background worker of the factory platform: delivers outbox events and runs daily jobs.
// Usage: npm run factory:worker   (run as its own process next to the web app)
import { loadEnv } from "./lib/loadEnv";

const OUTBOX_INTERVAL_MS = 5_000;
const DAILY_CHECK_MS = 60_000;

async function main() {
  loadEnv();
  const { processOutbox, runDailyJobs } = await import("../src/factory/core/worker");
  const { closeFactoryPool } = await import("../src/factory/core/db");
  await import("../src/factory/jobs");
  const { dispatchKdOutbox } = await import("../src/backend/services/factoryBridge");

  let stopping = false;
  const stop = () => {
    stopping = true;
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  let lastDaily = 0;
  console.log(JSON.stringify({ level: "info", msg: "factory worker started" }));
  while (!stopping) {
    try {
      const r = await processOutbox();
      const kd = await dispatchKdOutbox();
      if (kd) console.log(JSON.stringify({ level: "info", msg: "kd outbox", sent: kd }));
      if (r.processed || r.failed) console.log(JSON.stringify({ level: "info", msg: "outbox", ...r }));
      if (Date.now() - lastDaily >= DAILY_CHECK_MS) {
        lastDaily = Date.now();
        // after 00:05 Vietnam time, so a lot expiring "today" stays usable until the day ends
        const vnMinutes = (new Date().getUTCHours() * 60 + new Date().getUTCMinutes() + 7 * 60) % 1440;
        if (vnMinutes >= 5) {
          const results = await runDailyJobs();
          const ran = Object.entries(results).filter(([, v]) => v !== "đã chạy hôm nay");
          if (ran.length) console.log(JSON.stringify({ level: "info", msg: "daily jobs", results: Object.fromEntries(ran) }));
        }
      }
    } catch (error: any) {
      console.error(JSON.stringify({ level: "error", msg: error?.message ?? String(error) }));
    }
    await new Promise((resolve) => setTimeout(resolve, OUTBOX_INTERVAL_MS));
  }
  await closeFactoryPool();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
