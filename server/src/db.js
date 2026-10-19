// Database access. Production uses Postgres (e.g. Supabase) via DATABASE_URL.
// Without DATABASE_URL, an embedded PGlite database on local disk is used for development and tests.
import { mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "./config.js";

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");

let db = null;

export async function openDb(options = {}) {
  if (!db) db = await createDb(options);
  return db;
}

// Non-shared connection (tests use one in-memory database each).
export async function createDb(options = {}) {
  let db;
  const databaseUrl = options.databaseUrl ?? env.databaseUrl;
  if (databaseUrl) {
    const { default: pg } = await import("pg");
    const pool = new pg.Pool({
      connectionString: databaseUrl,
      ssl: /localhost|127\.0\.0\.1/.test(databaseUrl) ? false : { rejectUnauthorized: false },
      max: 5
    });
    db = {
      kind: "postgres",
      query: (sql, params) => pool.query(sql, params),
      close: () => pool.end()
    };
  } else {
    const { PGlite } = await import("@electric-sql/pglite");
    // options.memory: in-memory database for tests
    const dir = options.pgliteDir ?? env.pgliteDir;
    if (!options.memory) await mkdir(dir, { recursive: true });
    const lite = options.memory ? new PGlite() : new PGlite(dir);
    await lite.waitReady;
    db = {
      kind: "pglite",
      query: (sql, params) => lite.query(sql, params),
      exec: (sql) => lite.exec(sql),
      close: () => lite.close()
    };
  }

  await migrate(db);
  return db;
}

export async function closeDb() {
  if (db) {
    await db.close();
    db = null;
  }
}

async function migrate(conn) {
  await conn.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
  const applied = new Set((await conn.query("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(path.join(migrationsDir, file), "utf8");
    // Run statements one at a time so the same code works on pg and PGlite.
    for (const statement of splitSql(sql)) {
      await conn.query(statement);
    }
    await conn.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
  }
}

function splitSql(sql) {
  // Migrations must not contain "--" or ";" inside string literals.
  return sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}
