// One collection run from the command line (Render Cron Job, local testing, or demos).
// Usage: npm run collect [-- --trigger=schedule]
import { closeDb, openDb } from "../src/db.js";
import { runCollection } from "../src/pipeline.js";

const triggerArg = process.argv.find((a) => a.startsWith("--trigger="));
const trigger = triggerArg ? triggerArg.split("=")[1] : "cli";

const db = await openDb();
const result = await runCollection(db, { trigger });
console.log(JSON.stringify(result, null, 2));
await closeDb();
process.exit(result.outcome === "failed" ? 1 : 0);
