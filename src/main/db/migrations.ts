import type Database from "better-sqlite3";

/**
 * Versioned schema migrations.
 *
 * Each entry is run inside its own transaction. After it succeeds, the SQLite
 * `user_version` pragma is bumped so the next launch knows to skip it.
 *
 * RULES:
 *  - NEVER mutate a migration after it's shipped. If you need to change
 *    something, add a new migration at the end of the array.
 *  - Migrations must be IDEMPOTENT against partially-applied state. Prefer
 *    `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`. For
 *    `ALTER TABLE ... ADD COLUMN`, query `PRAGMA table_info(table)` first so
 *    you don't fail on a DB that already has the column from the previous
 *    (try/catch) migration era.
 *  - Migration #1 is intentionally the "initial schema" — it represents the
 *    full set of tables/columns as of the moment we introduced this
 *    versioning system. Older DBs that already had those columns (added via
 *    the legacy `try { ALTER TABLE ... } catch {}` block) will simply skip
 *    each `ADD COLUMN` thanks to the column-existence check helper below.
 */

type MigrationFn = (db: Database.Database) => void;

interface Migration {
  /** Monotonically increasing positive integer. Must match the index+1 in the array. */
  version: number;
  description: string;
  up: MigrationFn;
}

/** Returns true if `table` already has a column named `column`. */
function hasColumn(db: Database.Database, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((r) => r.name === column);
}

/** Add `column` to `table` only if it doesn't already exist. */
function addColumnIfMissing(db: Database.Database, table: string, column: string, definition: string): void {
  if (!hasColumn(db, table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: "Initial schema (consolidated from pre-versioning era)",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS app_meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS model_config (
          provider_id TEXT NOT NULL,
          model_id TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1,
          think_enabled INTEGER NOT NULL DEFAULT 0,
          think_budget TEXT NOT NULL DEFAULT 'medium',
          think_body_on TEXT NOT NULL DEFAULT '{}',
          think_body_off TEXT NOT NULL DEFAULT '',
          force_temperature TEXT NOT NULL DEFAULT '',
          PRIMARY KEY (provider_id, model_id)
        );
        CREATE TABLE IF NOT EXISTS provider_config (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          api_key TEXT NOT NULL DEFAULT '',
          base_url TEXT NOT NULL DEFAULT '',
          enabled INTEGER NOT NULL DEFAULT 1,
          protocol TEXT NOT NULL DEFAULT 'openai-chat',
          is_custom INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS project (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          default_provider_id TEXT,
          default_model_id TEXT,
          default_think_budget TEXT,
          system_prompt TEXT NOT NULL DEFAULT '',
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS conversation (
          id TEXT PRIMARY KEY,
          project_id TEXT,
          name TEXT NOT NULL,
          provider_id TEXT,
          model_id TEXT,
          think_budget TEXT,
          think_enabled INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS message (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          reasoning TEXT,
          tokens INTEGER,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS mcp_server (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          transport TEXT NOT NULL DEFAULT 'stdio',
          enabled INTEGER NOT NULL DEFAULT 1,
          command TEXT NOT NULL DEFAULT '',
          args TEXT NOT NULL DEFAULT '[]',
          env TEXT NOT NULL DEFAULT '{}',
          url TEXT NOT NULL DEFAULT '',
          headers TEXT NOT NULL DEFAULT '{}',
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_conv_project ON conversation(project_id, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_msg_conv ON message(conversation_id, created_at ASC);
        CREATE INDEX IF NOT EXISTS idx_mcp_updated ON mcp_server(updated_at DESC);
      `);
    }
  },
  {
    version: 2,
    description: "Add custom-model / think-level / mode_id / attachments columns",
    up: (db) => {
      // These columns were originally added via the try/catch ALTER block.
      // We use idempotent ADD COLUMN so DBs that already have them (because
      // they ran the old code path) simply no-op here.
      addColumnIfMissing(db, "model_config", "is_custom", "INTEGER NOT NULL DEFAULT 0");
      addColumnIfMissing(db, "model_config", "supports_think", "INTEGER NOT NULL DEFAULT 0");
      addColumnIfMissing(db, "model_config", "think_levels", "TEXT NOT NULL DEFAULT ''");
      addColumnIfMissing(db, "conversation", "mode_id", "TEXT NOT NULL DEFAULT 'chat'");
      addColumnIfMissing(db, "message", "attachments", "TEXT");
    }
  },
  {
    version: 3,
    description: "Add project.path for local-folder-backed projects",
    up: (db) => {
      // Absolute path of the local folder this project is bound to. Empty
      // string for legacy projects that were created without a folder
      // (e.g. via the old name-only "New project" UI).
      addColumnIfMissing(db, "project", "path", "TEXT NOT NULL DEFAULT ''");
    }
  }
];

export const CURRENT_SCHEMA_VERSION: number = MIGRATIONS[MIGRATIONS.length - 1].version;

/**
 * Apply any migrations whose `version` is greater than the DB's current
 * `user_version`. Each migration runs in its own transaction so a partial
 * failure leaves us on a clean previous version (rather than an
 * inconsistent in-between state).
 */
export function runMigrations(db: Database.Database): void {
  // Sanity check the migration list at boot — easier to find a bad release.
  for (let i = 0; i < MIGRATIONS.length; i++) {
    if (MIGRATIONS[i].version !== i + 1) {
      throw new Error(
        `[db] migration list is malformed: index ${i} declares version ${MIGRATIONS[i].version}`
      );
    }
  }

  const current = db.pragma("user_version", { simple: true }) as number;
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    const tx = db.transaction(() => {
      m.up(db);
      // pragmas can't be bound; user_version is a small int from our control.
      db.pragma(`user_version = ${m.version}`);
    });
    tx();
  }
}
