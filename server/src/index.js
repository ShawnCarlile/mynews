import { env } from "./config.js";
import { openDb } from "./db.js";
import { createApp } from "./api.js";
import { runCollection } from "./pipeline.js";

const db = await openDb();
const app = createApp(db);

app.listen(env.port, () => {
  console.log(`My News API listening on :${env.port} (${db.kind})`);
});

// Optional in-process hourly schedule for hosts that keep the process running (not free tiers that sleep).
// The recommended deployment uses an external scheduler instead; see README "Hourly schedule".
if (env.internalScheduler) {
  const scheduleNext = () => {
    const now = new Date();
    const next = new Date(now);
    next.setUTCMinutes(5, 0, 0);
    if (next <= now) next.setUTCHours(next.getUTCHours() + 1);
    setTimeout(async () => {
      try {
        const result = await runCollection(db, { trigger: "schedule" });
        console.log("scheduled collection", result.outcome ?? result.reason);
      } finally {
        scheduleNext();
      }
    }, next - now);
  };
  scheduleNext();
  console.log("internal hourly scheduler enabled (runs at :05 past each hour UTC)");
}
