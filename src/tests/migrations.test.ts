import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CURRENT_SCHEMA_VERSION, runMigrations } from "../main/db/migrations.js";

describe("db migrations", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  it("brings a brand-new DB to CURRENT_SCHEMA_VERSION", () => {
    expect(db.pragma("user_version", { simple: true })).toBe(0);
    runMigrations(db);
    expect(db.pragma("user_version", { simple: true })).toBe(CURRENT_SCHEMA_VERSION);
  });

  it("creates all expected tables", () => {
    runMigrations(db);
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{ name: string }>
    ).map((r) => r.name);
    for (const t of [
      "app_meta",
      "model_config",
      "provider_config",
      "project",
      "conversation",
      "message",
      "mcp_server"
    ]) {
      expect(tables).toContain(t);
    }
  });

  it("creates v2 columns (is_custom, supports_think, think_levels, mode_id, attachments)", () => {
    runMigrations(db);
    const cols = (table: string) =>
      (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((r) => r.name);

    expect(cols("model_config")).toEqual(expect.arrayContaining(["is_custom", "supports_think", "think_levels"]));
    expect(cols("conversation")).toEqual(expect.arrayContaining(["mode_id"]));
    expect(cols("message")).toEqual(expect.arrayContaining(["attachments"]));
  });

  it("creates v3 column project.path", () => {
    runMigrations(db);
    const cols = (table: string) =>
      (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((r) => r.name);
    expect(cols("project")).toEqual(expect.arrayContaining(["path"]));
  });

  it("preserves existing project rows when v3 adds the path column", () => {
    // Pre-create the v1 project schema (no `path` column), insert a row,
    // mark user_version=2, then run migrations and assert the row still
    // exists with an empty path (the column default).
    db.exec(`
      CREATE TABLE project (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        default_provider_id TEXT,
        default_model_id TEXT,
        default_think_budget TEXT,
        system_prompt TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
    db.prepare(
      "INSERT INTO project (id, name, system_prompt, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
    ).run("p1", "legacy project", "", 1, 1);
    db.pragma(`user_version = 2`);

    runMigrations(db);

    const row = db.prepare("SELECT id, name, path FROM project WHERE id=?").get("p1") as
      | { id: string; name: string; path: string }
      | undefined;
    expect(row).toBeDefined();
    expect(row?.name).toBe("legacy project");
    expect(row?.path).toBe(""); // default value
  });

  it("is idempotent — running twice keeps the same user_version", () => {
    runMigrations(db);
    const v1 = db.pragma("user_version", { simple: true });
    runMigrations(db);
    expect(db.pragma("user_version", { simple: true })).toBe(v1);
  });

  it("upgrades a 'legacy' DB that already has the v2 columns via pre-versioning ALTERs", () => {
    // Simulate an old DB that has all tables + columns from the try/catch era
    // but user_version=0 because the versioning table didn't exist yet.
    db.exec(`
      CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE model_config (
        provider_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        think_enabled INTEGER NOT NULL DEFAULT 0,
        think_budget TEXT NOT NULL DEFAULT 'medium',
        think_body_on TEXT NOT NULL DEFAULT '{}',
        think_body_off TEXT NOT NULL DEFAULT '',
        force_temperature TEXT NOT NULL DEFAULT '',
        is_custom INTEGER NOT NULL DEFAULT 0,
        supports_think INTEGER NOT NULL DEFAULT 0,
        think_levels TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (provider_id, model_id)
      );
      CREATE TABLE provider_config (id TEXT PRIMARY KEY, name TEXT NOT NULL, api_key TEXT NOT NULL DEFAULT '', base_url TEXT NOT NULL DEFAULT '', enabled INTEGER NOT NULL DEFAULT 1, protocol TEXT NOT NULL DEFAULT 'openai-chat', is_custom INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE project (id TEXT PRIMARY KEY, name TEXT NOT NULL, default_provider_id TEXT, default_model_id TEXT, default_think_budget TEXT, system_prompt TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE conversation (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        name TEXT NOT NULL,
        provider_id TEXT,
        model_id TEXT,
        think_budget TEXT,
        think_enabled INTEGER NOT NULL DEFAULT 0,
        mode_id TEXT NOT NULL DEFAULT 'chat',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE message (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        reasoning TEXT,
        tokens INTEGER,
        attachments TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE mcp_server (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', transport TEXT NOT NULL DEFAULT 'stdio', enabled INTEGER NOT NULL DEFAULT 1, command TEXT NOT NULL DEFAULT '', args TEXT NOT NULL DEFAULT '[]', env TEXT NOT NULL DEFAULT '{}', url TEXT NOT NULL DEFAULT '', headers TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    `);
    expect(db.pragma("user_version", { simple: true })).toBe(0);

    // Running migrations against this state should NOT throw on duplicate
    // column adds — both v1 (CREATE TABLE IF NOT EXISTS) and v2
    // (addColumnIfMissing) are no-ops here. user_version should advance.
    expect(() => runMigrations(db)).not.toThrow();
    expect(db.pragma("user_version", { simple: true })).toBe(CURRENT_SCHEMA_VERSION);
  });

  it("data inserted before a migration is preserved across migrations", () => {
    // Pre-create the v1 schema manually, insert a row, set user_version=1,
    // then let runMigrations advance us to v2. The row must survive.
    db.exec(`
      CREATE TABLE conversation (
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
    `);
    db.prepare(
      "INSERT INTO conversation (id, name, think_enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
    ).run("c1", "hello", 0, 1, 1);
    db.pragma(`user_version = 1`);

    runMigrations(db);

    const row = db.prepare("SELECT id, name, mode_id FROM conversation WHERE id=?").get("c1") as
      | { id: string; name: string; mode_id: string }
      | undefined;
    expect(row).toBeDefined();
    expect(row?.id).toBe("c1");
    expect(row?.name).toBe("hello");
    expect(row?.mode_id).toBe("chat"); // default applied to existing row
  });
});
