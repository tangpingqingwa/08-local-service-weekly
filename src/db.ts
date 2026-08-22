import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CITIES } from "./cities";

export type AppDb = import("better-sqlite3").Database;

const Database = createRequire(import.meta.url)(
  "better-sqlite3",
) as typeof import("better-sqlite3");

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "migrations");

type MigrationRow = { id: string };

/** SPEC §4 */
export type CategorySlug =
  | "movers"
  | "dentists"
  | "immigration_lawyers"
  | "tutors";

/** SPEC §10 */
export type TakedownReason =
  | "unlicensed"
  | "impersonation"
  | "complaint"
  | "nsfw"
  | "chat_link"
  | "other";

/** SPEC §4 */
export type Listing = {
  id: string;
  business: string;
  category: CategorySlug;
  city: string;
  siteUrl: string;
  licenseId: string | null;
  bidUsd: number;
  weekId: string;
  createdAt: string;
  raisedAt: string | null;
  clicks: number;
  hidden: boolean;
  hiddenReason: TakedownReason | null;
};

/** SPEC §6 */
export type Week = {
  id: string;
  timezone: string;
  opensAt: string;
  closesAt: string;
};

export function defaultDatabasePath(): string {
  return process.env.DATABASE_PATH ?? join(process.cwd(), "data", "app.sqlite");
}

export function openDatabase(path: string = defaultDatabasePath()): AppDb {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new Database(path);
  if (path !== ":memory:") {
    db.pragma("journal_mode = WAL");
  }
  db.pragma("foreign_keys = ON");
  migrate(db);
  seedCities(db);
  return db;
}

export function migrate(db: AppDb): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);
  const applied = new Set(
    db
      .prepare<[], MigrationRow>("SELECT id FROM schema_migrations")
      .all()
      .map((row) => row.id),
  );
  const insert = db.prepare(
    "INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)",
  );
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const file of files) {
    if (applied.has(file)) {
      continue;
    }
    db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
    insert.run(file, new Date().toISOString());
  }
}

export function seedCities(db: AppDb): void {
  const upsert = db.prepare(
    `INSERT INTO cities (slug, display, public)
     VALUES (@slug, @display, @public)
     ON CONFLICT(slug) DO UPDATE SET
       display = excluded.display,
       public = excluded.public`,
  );
  for (const city of CITIES) {
    upsert.run({
      slug: city.slug,
      display: city.display,
      public: city.public ? 1 : 0,
    });
  }
}

let cached: AppDb | undefined;
let cachedPath: string | undefined;

export function getDb(): AppDb {
  const dbPath = defaultDatabasePath();
  if (!cached || cachedPath !== dbPath) {
    cached?.close();
    cached = openDatabase(dbPath);
    cachedPath = dbPath;
  }
  return cached;
}
