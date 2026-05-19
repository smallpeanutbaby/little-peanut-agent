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
  },
  {
    version: 4,
    description: "Add model_config.capabilities + think_protocol (multi-capability model layer)",
    up: (db) => {
      // capabilities: JSON-encoded ModelCapability[]. Default seeds an empty
      // array so existing rows look like "we don't know yet" — the renderer's
      // bulkInitModels pass will repopulate from the built-in catalog the next
      // time the user opens AI 配置.
      addColumnIfMissing(db, "model_config", "capabilities", "TEXT NOT NULL DEFAULT '[]'");
      // think_protocol: one of openai / anthropic / gemini / qwen / binary, or
      // empty string for non-reasoning models. We keep the older
      // `think_levels` column around for backwards compatibility — readers
      // prefer think_protocol when set, falling back to think_levels for rows
      // that pre-date v4.
      addColumnIfMissing(db, "model_config", "think_protocol", "TEXT NOT NULL DEFAULT ''");
    }
  },
  {
    version: 5,
    description:
      "Agent runtime tables: message_part, tool_run, agent_todo, agent_task, " +
      "permission_rule, memory_index, agent_cost_log. Migrates legacy `message.content` " +
      "into `message_part` rows so the chat view can render structured blocks for " +
      "everything (text only for old turns, tool_use + tool_result for new agent turns).",
    up: (db) => {
      db.exec(`
        /* Structured content blocks - one message can carry many ordered
           parts. type is one of text | reasoning | tool_use | tool_result |
           attachment_ref | compact_marker. tool_call_id ties tool_use to
           tool_result pairs so the runtime can re-marshal them for the next
           model turn. Big outputs spill to output_file_path (kept under
           Electron userData) and only a short preview is inlined. */
        CREATE TABLE IF NOT EXISTS message_part (
          id TEXT PRIMARY KEY,
          message_id TEXT NOT NULL,
          seq INTEGER NOT NULL,
          type TEXT NOT NULL,
          tool_call_id TEXT,
          tool_name TEXT,
          input_json TEXT,
          output_json TEXT,
          output_preview TEXT,
          is_error INTEGER NOT NULL DEFAULT 0,
          output_file_path TEXT,
          tokens INTEGER,
          text_content TEXT,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_message_part_msg ON message_part(message_id, seq ASC);
        CREATE INDEX IF NOT EXISTS idx_message_part_tool_call ON message_part(tool_call_id);

        /* Tool-execution lifecycle. One row per tool call the model emits.
           Kept as a separate table from message_part so the agent runtime
           can update status / timings / cost without rewriting the block
           that the chat renderer is already showing. */
        CREATE TABLE IF NOT EXISTS tool_run (
          tool_call_id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL,
          message_id TEXT NOT NULL,
          tool_name TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          started_at INTEGER NOT NULL,
          ended_at INTEGER,
          error_code TEXT,
          cost_usd REAL,
          permission_decision_json TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_tool_run_conv ON tool_run(conversation_id, started_at DESC);
        CREATE INDEX IF NOT EXISTS idx_tool_run_status ON tool_run(status);

        /* TodoWrite-driven planning state. project-scoped so closing/
           reopening a conversation under the same project shows the same
           list. seq keeps insertion order; status is pending/in_progress/
           completed (no cancelled - Claude Code's TodoWrite spec). */
        CREATE TABLE IF NOT EXISTS agent_todo (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          conversation_id TEXT,
          content TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          seq INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_agent_todo_proj ON agent_todo(project_id, seq ASC);

        /* Long-running async tasks (subagent runs, background bash, …).
           Keep separate from agent_todo because lifecycle is different
           (pending/running/completed/failed/killed) and we may carry pid /
           payload for resumes. */
        CREATE TABLE IF NOT EXISTS agent_task (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          conversation_id TEXT,
          type TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          payload_json TEXT NOT NULL DEFAULT '{}',
          result_json TEXT,
          pid INTEGER,
          started_at INTEGER NOT NULL,
          ended_at INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_agent_task_status ON agent_task(status);
        CREATE INDEX IF NOT EXISTS idx_agent_task_proj ON agent_task(project_id, started_at DESC);

        /* Permission rules — answers the question "should canUseTool grant
           access?". Scope decides match precedence: session > project >
           user (deny always wins regardless of scope). pattern_json carries
           tool-specific match data (a glob, a regex, the literal command,
           …); the gate interprets it per tool. */
        CREATE TABLE IF NOT EXISTS permission_rule (
          id TEXT PRIMARY KEY,
          scope TEXT NOT NULL,
          project_id TEXT,
          conversation_id TEXT,
          tool_name TEXT NOT NULL,
          pattern_json TEXT NOT NULL DEFAULT '{}',
          behavior TEXT NOT NULL,
          source TEXT NOT NULL DEFAULT 'user_decision',
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_permission_rule_lookup
          ON permission_rule(tool_name, scope, project_id);

        /* Lightweight index over .agent/memory/*.md. The .md files
           themselves remain the source of truth (so users can edit them by
           hand). We mirror the frontmatter description + mtime here so the
           runtime can preview / sort without re-parsing every file each
           turn. */
        CREATE TABLE IF NOT EXISTS memory_index (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          relative_path TEXT NOT NULL,
          type TEXT NOT NULL DEFAULT 'note',
          description TEXT NOT NULL DEFAULT '',
          mtime INTEGER NOT NULL,
          bytes INTEGER NOT NULL,
          UNIQUE(project_id, relative_path)
        );

        /* Per-call cost log. Aggregated by conversation/project for the
           CostBadge UI. */
        CREATE TABLE IF NOT EXISTS agent_cost_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          conversation_id TEXT NOT NULL,
          provider TEXT NOT NULL,
          model TEXT NOT NULL,
          prompt_tokens INTEGER NOT NULL DEFAULT 0,
          completion_tokens INTEGER NOT NULL DEFAULT 0,
          cost_usd REAL NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_cost_conv ON agent_cost_log(conversation_id, created_at DESC);
      `);

      // Smooth migration of pre-agent messages: every legacy row gets a
      // single text part so the new block-based renderer can show it. Skip
      // rows that already have parts (would happen if this migration ran
      // partially and got resumed mid-way).
      type LegacyMessageRow = {
        id: string;
        content: string;
        reasoning: string | null;
        tokens: number | null;
        created_at: number;
      };
      const rows = db
        .prepare(
          `SELECT m.id, m.content, m.reasoning, m.tokens, m.created_at
             FROM message m
             WHERE NOT EXISTS (SELECT 1 FROM message_part p WHERE p.message_id = m.id)`
        )
        .all() as LegacyMessageRow[];

      const insertPart = db.prepare(
        `INSERT INTO message_part
           (id, message_id, seq, type, text_content, tokens, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );

      // Idempotent enough: we just won't insert into rows that already
      // have parts. ROWID-derived id is fine because message ids are
      // already unique strings; we re-use the message id with a suffix.
      for (const r of rows) {
        let seq = 0;
        if (r.reasoning) {
          insertPart.run(
            `${r.id}_p${seq}`,
            r.id,
            seq,
            "reasoning",
            r.reasoning,
            null,
            r.created_at
          );
          seq += 1;
        }
        // Always emit a text part — even if content is empty so the
        // renderer still has a single anchor block per message.
        insertPart.run(
          `${r.id}_p${seq}`,
          r.id,
          seq,
          "text",
          r.content ?? "",
          r.tokens,
          r.created_at
        );
      }
    }
  },
  {
    version: 6,
    description:
      "Recovery markers on conversation: last_run_status + last_run_id to surface 'resume' toast after crashes.",
    up: (db) => {
      // SQLite ALTER TABLE ADD COLUMN is idempotent only via PRAGMA
      // check; better-sqlite3 throws on duplicate so guard with table_info.
      const cols = db.pragma(`table_info(conversation)`) as Array<{ name: string }>;
      const have = new Set(cols.map((c) => c.name));
      if (!have.has("last_run_status")) {
        db.exec(`ALTER TABLE conversation ADD COLUMN last_run_status TEXT`);
      }
      if (!have.has("last_run_id")) {
        db.exec(`ALTER TABLE conversation ADD COLUMN last_run_id TEXT`);
      }
      if (!have.has("last_run_ended_at")) {
        db.exec(`ALTER TABLE conversation ADD COLUMN last_run_ended_at INTEGER`);
      }
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
