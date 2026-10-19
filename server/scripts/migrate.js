// Applies migrations/*.sql to DATABASE_URL (or the local PGlite database).
import { closeDb, openDb } from "../src/db.js";

const db = await openDb();
console.log(`migrations applied (${db.kind})`);
await closeDb();
