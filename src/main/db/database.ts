import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import type {
  AppearanceSettings,
  BackgroundColor,
  ChatAttachment,
  ChatMessage,
  ChatRole,
  Conversation,
  McpServerConfig,
  McpTransport,
  ModelCapability,
  ModelConfig,
  Project,
  ProviderConfig,
  TextColor,
  ThemeMode,
  ThinkBudget,
  ThinkProtocol
} from "@shared/types.js";
import { decryptSecret, encryptSecret, isEncrypted } from "../security/secret-store.js";
import { CURRENT_SCHEMA_VERSION, runMigrations } from "./migrations.js";
import { AgentStore } from "./agent-store.js";

function nowMs(): number {
  return Date.now();
}
function genId(prefix: string): string {
  return prefix + "_" + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
}

export class AppDatabase {
  private readonly db: Database.Database;
  /** Sub-store owning the agent-runtime tables (introduced in v5). */
  readonly agent: AgentStore;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.bootstrap();
    this.agent = new AgentStore(this.db);
    // House-keep crashed sessions: anything marked live in tool_run /
    // agent_task at startup is by definition stale. The user can pick a
    // conversation and click "继续" if they want to resume.
    try {
      this.agent.cancelAllOrphanToolRuns();
      this.agent.killOrphanTasks();
      this.agent.clearSessionPermissionRules();
    } catch (e) {
      console.warn("[db] agent orphan cleanup failed", e);
    }
  }

  /** Raw handle — used by the agent runtime for transactional writes
   *  that span the chat tables (`message`) and the agent tables
   *  (`message_part`, `tool_run`). Avoid using this from feature code;
   *  prefer the helper methods on the store. */
  rawHandle(): Database.Database {
    return this.db;
  }

  private bootstrap() {
    // All schema setup goes through a versioned migration list keyed on
    // SQLite's `user_version` pragma. See `./migrations.ts` for the actual
    // schema. Bootstrapping a fresh DB and upgrading an existing one share
    // the exact same code path; we never silently swallow ALTER errors.
    runMigrations(this.db);

    // Sanity check — if we ever ship code that expects a newer schema than
    // what was applied (e.g. a corrupt migrations list), fail loudly here so
    // the user gets a clear error instead of cryptic SQL failures later.
    const applied = this.db.pragma("user_version", { simple: true }) as number;
    if (applied < CURRENT_SCHEMA_VERSION) {
      throw new Error(
        `[db] migrations did not reach CURRENT_SCHEMA_VERSION (applied=${applied}, expected=${CURRENT_SCHEMA_VERSION})`
      );
    }

    // One-time data migration: encrypt any legacy plaintext api_key values
    // left over from before we introduced the safeStorage wrapper.
    this.encryptLegacyApiKeys();
  }

  private encryptLegacyApiKeys() {
    try {
      const rows = this.db.prepare("SELECT id, api_key FROM provider_config").all() as Array<{ id: string; api_key: string }>;
      const update = this.db.prepare("UPDATE provider_config SET api_key = ? WHERE id = ?");
      const tx = this.db.transaction(() => {
        for (const r of rows) {
          if (r.api_key && !isEncrypted(r.api_key)) {
            update.run(encryptSecret(r.api_key), r.id);
          }
        }
      });
      tx();
    } catch {
      // safeStorage unavailable or other; skip silently
    }
  }

  private encodeLevels(levels: string[] | null | undefined): string {
    if (!levels || levels.length === 0) return "";
    return JSON.stringify(levels);
  }

  private decodeLevels(raw: string | null | undefined): string[] | undefined {
    if (!raw) return undefined;
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) && parsed.length > 0 ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  /** Encode a ModelCapability[] for storage. Empty array → "[]" so the
   *  column NOT NULL constraint is satisfied without ambiguous empty strings. */
  private encodeCapabilities(caps: ModelCapability[] | null | undefined): string {
    if (!caps || caps.length === 0) return "[]";
    return JSON.stringify(caps);
  }

  /** Decode the JSON capabilities column; defaults to ["text"] on any
   *  parse failure / legacy empty value so existing chat flows don't break. */
  private decodeCapabilities(raw: string | null | undefined): ModelCapability[] {
    if (!raw) return ["text"];
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed as ModelCapability[];
      return ["text"];
    } catch {
      return ["text"];
    }
  }

  getValue(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM app_meta WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  }

  setValue(key: string, value: string) {
    this.db
      .prepare("INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(key, value);
  }

  // ─── UI Preferences (generic key/value persisted to app_meta) ───────
  getUiPref(key: string): string | null {
    return this.getValue("ui." + key);
  }

  setUiPref(key: string, value: string) {
    this.setValue("ui." + key, value);
  }

  getAppearanceSettings(): AppearanceSettings {
    const VALID_BG = new Set<BackgroundColor>(["dark", "light"]);
    const VALID_TEXT = new Set<TextColor>([
      "ivory", "warm-white", "cream", "soft-gold", "charcoal", "snow", "linen",
      "pearl", "sand-ink", "hazel", "coffee", "ember", "graphite", "slate",
      "sage", "olive-ink", "teal-ink", "midnight-ink", "plum-ink"
    ]);
    const VALID_THEME = new Set<ThemeMode>(["light", "dark"]);
    const VALID_LANG = new Set(["zh-CN", "en"]);
    const rawTheme = this.getValue("appearance.theme");
    const rawBg = this.getValue("appearance.background");
    const rawText = this.getValue("appearance.text");
    const rawLang = this.getValue("appearance.language");
    return {
      theme: (rawTheme && VALID_THEME.has(rawTheme as ThemeMode)) ? (rawTheme as ThemeMode) : "dark",
      background: (rawBg && VALID_BG.has(rawBg as BackgroundColor)) ? (rawBg as BackgroundColor) : "dark",
      text: (rawText && VALID_TEXT.has(rawText as TextColor)) ? (rawText as TextColor) : "ivory",
      language: (rawLang && VALID_LANG.has(rawLang)) ? (rawLang as "zh-CN" | "en") : "zh-CN"
    };
  }

  saveAppearanceSettings(settings: AppearanceSettings) {
    this.setValue("appearance.theme", settings.theme);
    this.setValue("appearance.background", settings.background);
    this.setValue("appearance.text", settings.text);
    this.setValue("appearance.language", settings.language);
  }

  getModelConfigs(providerId: string): ModelConfig[] {
    const rows = this.db
      .prepare("SELECT * FROM model_config WHERE provider_id = ?")
      .all(providerId) as Array<{
        provider_id: string;
        model_id: string;
        enabled: number;
        think_enabled: number;
        think_budget: string;
        think_body_on: string;
        think_body_off: string;
        force_temperature: string;
        capabilities: string;
        think_protocol: string;
      }>;
    return rows.map((r) => ({
      providerId: r.provider_id,
      modelId: r.model_id,
      enabled: r.enabled === 1,
      capabilities: this.decodeCapabilities(r.capabilities),
      thinkProtocol: (r.think_protocol || null) as ThinkProtocol | null,
      thinkEnabled: r.think_enabled === 1,
      thinkBudget: r.think_budget as ModelConfig["thinkBudget"],
      thinkBodyOn: r.think_body_on,
      thinkBodyOff: r.think_body_off,
      forceTemperature: r.force_temperature
    }));
  }

  saveModelConfig(config: ModelConfig) {
    this.db
      .prepare(`INSERT INTO model_config (provider_id, model_id, enabled, think_enabled, think_budget, think_body_on, think_body_off, force_temperature, capabilities, think_protocol)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(provider_id, model_id) DO UPDATE SET
          enabled = excluded.enabled,
          think_enabled = excluded.think_enabled,
          think_budget = excluded.think_budget,
          think_body_on = excluded.think_body_on,
          think_body_off = excluded.think_body_off,
          force_temperature = excluded.force_temperature,
          capabilities = excluded.capabilities,
          think_protocol = excluded.think_protocol`)
      .run(
        config.providerId,
        config.modelId,
        config.enabled ? 1 : 0,
        config.thinkEnabled ? 1 : 0,
        config.thinkBudget,
        config.thinkBodyOn,
        config.thinkBodyOff,
        config.forceTemperature,
        this.encodeCapabilities(config.capabilities),
        config.thinkProtocol ?? ""
      );
  }

  setAllModelsEnabled(providerId: string, enabled: boolean) {
    this.db
      .prepare("UPDATE model_config SET enabled = ? WHERE provider_id = ?")
      .run(enabled ? 1 : 0, providerId);
  }

  /**
   * Seed a batch of model rows for a provider on first open. Each entry may
   * carry the catalog-derived capabilities + thinkProtocol; we use
   * `INSERT OR IGNORE` so re-opening the page never clobbers user-edited
   * rows. To repair old rows that still have empty capabilities (i.e. rows
   * that pre-date v4), we run a separate UPDATE for those.
   */
  bulkInitModels(providerId: string, models: Array<{ id: string; capabilities?: ModelCapability[]; thinkProtocol?: ThinkProtocol | null }>) {
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO model_config
        (provider_id, model_id, enabled, think_enabled, think_budget, think_body_on, think_body_off, force_temperature, capabilities, think_protocol)
        VALUES (?, ?, 1, 0, 'medium', '{}', '', '', ?, ?)`
    );
    // Heal rows that already exist but whose capabilities column was created
    // empty by v4 (default '[]'). Don't touch rows the user customised — we
    // only fill in when stored capabilities is the empty literal.
    const heal = this.db.prepare(
      `UPDATE model_config
         SET capabilities = ?, think_protocol = COALESCE(NULLIF(think_protocol, ''), ?)
       WHERE provider_id = ? AND model_id = ? AND (capabilities IS NULL OR capabilities = '' OR capabilities = '[]')`
    );
    const tx = this.db.transaction(() => {
      for (const m of models) {
        const caps = this.encodeCapabilities(m.capabilities);
        const proto = m.thinkProtocol ?? "";
        insert.run(providerId, m.id, caps, proto);
        // For rows that already existed but had empty capabilities, repopulate
        // from the catalog so the UI doesn't show a row with no chips.
        if (m.capabilities && m.capabilities.length > 0) {
          heal.run(caps, proto, providerId, m.id);
        }
      }
    });
    tx();
  }

  // ─── Provider Config ───────────────────────────────────────────────

  getProviderConfig(providerId: string): ProviderConfig | null {
    const row = this.db
      .prepare("SELECT * FROM provider_config WHERE id = ?")
      .get(providerId) as {
        id: string;
        name: string;
        api_key: string;
        base_url: string;
        enabled: number;
        protocol: string;
        is_custom: number;
      } | undefined;
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      apiKey: decryptSecret(row.api_key),
      baseUrl: row.base_url,
      enabled: row.enabled === 1,
      protocol: row.protocol,
      isCustom: row.is_custom === 1
    };
  }

  getAllProviderConfigs(): ProviderConfig[] {
    const rows = this.db
      .prepare("SELECT * FROM provider_config ORDER BY rowid")
      .all() as Array<{
        id: string;
        name: string;
        api_key: string;
        base_url: string;
        enabled: number;
        protocol: string;
        is_custom: number;
      }>;
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      apiKey: decryptSecret(r.api_key),
      baseUrl: r.base_url,
      enabled: r.enabled === 1,
      protocol: r.protocol,
      isCustom: r.is_custom === 1
    }));
  }

  saveProviderConfig(config: ProviderConfig) {
    this.db
      .prepare(`INSERT INTO provider_config (id, name, api_key, base_url, enabled, protocol, is_custom)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          api_key = excluded.api_key,
          base_url = excluded.base_url,
          enabled = excluded.enabled,
          protocol = excluded.protocol,
          is_custom = excluded.is_custom`)
      .run(
        config.id,
        config.name,
        encryptSecret(config.apiKey),
        config.baseUrl,
        config.enabled ? 1 : 0,
        config.protocol,
        config.isCustom ? 1 : 0
      );
  }

  deleteProviderConfig(providerId: string) {
    this.db.prepare("DELETE FROM provider_config WHERE id = ?").run(providerId);
    this.db.prepare("DELETE FROM model_config WHERE provider_id = ?").run(providerId);
  }

  // ─── Custom Models ─────────────────────────────────────────────────

  /**
   * Insert a user-added model. `supportsThink` is derived from
   * `capabilities.includes("reasoning")`; we also keep writing the legacy
   * `supports_think` flag so v3 rows continue to make sense after a
   * downgrade. `think_levels` is intentionally left empty — readers prefer
   * the new `think_protocol` column when set.
   */
  addCustomModel(
    providerId: string,
    modelId: string,
    capabilities: ModelCapability[],
    thinkProtocol: ThinkProtocol | null
  ) {
    const supportsThink = capabilities.includes("reasoning") && thinkProtocol !== null;
    this.db
      .prepare(`INSERT OR IGNORE INTO model_config
        (provider_id, model_id, enabled, think_enabled, think_budget, think_body_on, think_body_off, force_temperature, is_custom, supports_think, think_levels, capabilities, think_protocol)
        VALUES (?, ?, 1, 0, 'medium', '{}', '', '', 1, ?, '', ?, ?)`)
      .run(
        providerId,
        modelId,
        supportsThink ? 1 : 0,
        this.encodeCapabilities(capabilities),
        thinkProtocol ?? ""
      );
  }

  deleteCustomModel(providerId: string, modelId: string) {
    this.db
      .prepare("DELETE FROM model_config WHERE provider_id = ? AND model_id = ? AND is_custom = 1")
      .run(providerId, modelId);
  }

  getCustomModels(providerId: string): Array<{
    modelId: string;
    capabilities: ModelCapability[];
    thinkProtocol: ThinkProtocol | null;
    /** @deprecated v3 fallback — readers should prefer `capabilities`. */
    supportsThink: boolean;
    /** @deprecated v3 fallback — readers should prefer `thinkProtocol`. */
    thinkLevels?: string[];
  }> {
    const rows = this.db
      .prepare("SELECT model_id, supports_think, think_levels, capabilities, think_protocol FROM model_config WHERE provider_id = ? AND is_custom = 1")
      .all(providerId) as Array<{
        model_id: string;
        supports_think: number;
        think_levels: string;
        capabilities: string;
        think_protocol: string;
      }>;
    return rows.map((r) => ({
      modelId: r.model_id,
      capabilities: this.decodeCapabilities(r.capabilities),
      thinkProtocol: (r.think_protocol || null) as ThinkProtocol | null,
      supportsThink: r.supports_think === 1,
      thinkLevels: this.decodeLevels(r.think_levels)
    }));
  }

  getAllCustomModels(): Array<{
    providerId: string;
    modelId: string;
    capabilities: ModelCapability[];
    thinkProtocol: ThinkProtocol | null;
    /** @deprecated v3 fallback — readers should prefer `capabilities`. */
    supportsThink: boolean;
    /** @deprecated v3 fallback — readers should prefer `thinkProtocol`. */
    thinkLevels?: string[];
  }> {
    const rows = this.db
      .prepare("SELECT provider_id, model_id, supports_think, think_levels, capabilities, think_protocol FROM model_config WHERE is_custom = 1")
      .all() as Array<{
        provider_id: string;
        model_id: string;
        supports_think: number;
        think_levels: string;
        capabilities: string;
        think_protocol: string;
      }>;
    return rows.map((r) => ({
      providerId: r.provider_id,
      modelId: r.model_id,
      capabilities: this.decodeCapabilities(r.capabilities),
      thinkProtocol: (r.think_protocol || null) as ThinkProtocol | null,
      supportsThink: r.supports_think === 1,
      thinkLevels: this.decodeLevels(r.think_levels)
    }));
  }

  // ─── Projects ──────────────────────────────────────────────────────

  listProjects(): Project[] {
    const rows = this.db.prepare("SELECT * FROM project ORDER BY updated_at DESC").all() as Array<{
      id: string;
      name: string;
      path: string;
      default_provider_id: string | null;
      default_model_id: string | null;
      default_think_budget: string | null;
      system_prompt: string;
      created_at: number;
      updated_at: number;
    }>;
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      path: r.path ?? "",
      defaultProviderId: r.default_provider_id,
      defaultModelId: r.default_model_id,
      defaultThinkBudget: (r.default_think_budget as ThinkBudget | null) ?? null,
      systemPrompt: r.system_prompt,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }));
  }

  createProject(input: { name: string; path?: string; defaultProviderId?: string | null; defaultModelId?: string | null; defaultThinkBudget?: ThinkBudget | null; systemPrompt?: string }): Project {
    const id = genId("proj");
    const now = nowMs();
    this.db.prepare(`INSERT INTO project (id, name, path, default_provider_id, default_model_id, default_think_budget, system_prompt, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, input.name, input.path ?? "", input.defaultProviderId ?? null, input.defaultModelId ?? null,
      input.defaultThinkBudget ?? null, input.systemPrompt ?? "", now, now
    );
    return this.getProject(id)!;
  }

  getProject(id: string): Project | null {
    const list = this.listProjects().filter((p) => p.id === id);
    return list[0] ?? null;
  }

  updateProject(id: string, patch: Partial<Pick<Project, "name" | "path" | "defaultProviderId" | "defaultModelId" | "defaultThinkBudget" | "systemPrompt">>): Project | null {
    const existing = this.getProject(id);
    if (!existing) return null;
    const next: Project = { ...existing, ...patch, updatedAt: nowMs() };
    this.db.prepare(`UPDATE project SET name=?, path=?, default_provider_id=?, default_model_id=?, default_think_budget=?, system_prompt=?, updated_at=? WHERE id=?`)
      .run(next.name, next.path, next.defaultProviderId, next.defaultModelId, next.defaultThinkBudget, next.systemPrompt, next.updatedAt, id);
    return this.getProject(id);
  }

  deleteProject(id: string) {
    const tx = this.db.transaction(() => {
      const convIds = (this.db.prepare("SELECT id FROM conversation WHERE project_id=?").all(id) as Array<{ id: string }>).map((r) => r.id);
      for (const cid of convIds) this.db.prepare("DELETE FROM message WHERE conversation_id=?").run(cid);
      this.db.prepare("DELETE FROM conversation WHERE project_id=?").run(id);
      this.db.prepare("DELETE FROM project WHERE id=?").run(id);
    });
    tx();
  }

  // ─── Conversations ─────────────────────────────────────────────────

  listConversations(projectId: string | null): Conversation[] {
    const rows = projectId
      ? this.db.prepare("SELECT * FROM conversation WHERE project_id=? ORDER BY updated_at DESC").all(projectId)
      : this.db.prepare("SELECT * FROM conversation ORDER BY updated_at DESC").all();
    return (rows as Array<{
      id: string; project_id: string | null; name: string; provider_id: string | null; model_id: string | null;
      think_budget: string | null; think_enabled: number; mode_id: string | null; created_at: number; updated_at: number;
    }>).map((r) => ({
      id: r.id,
      projectId: r.project_id,
      name: r.name,
      providerId: r.provider_id,
      modelId: r.model_id,
      thinkBudget: (r.think_budget as ThinkBudget | null) ?? null,
      thinkEnabled: r.think_enabled === 1,
      modeId: r.mode_id || "chat",
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }));
  }

  getConversation(id: string): Conversation | null {
    const row = this.db.prepare("SELECT * FROM conversation WHERE id=?").get(id) as {
      id: string; project_id: string | null; name: string; provider_id: string | null; model_id: string | null;
      think_budget: string | null; think_enabled: number; mode_id: string | null; created_at: number; updated_at: number;
    } | undefined;
    if (!row) return null;
    return {
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      providerId: row.provider_id,
      modelId: row.model_id,
      thinkBudget: (row.think_budget as ThinkBudget | null) ?? null,
      thinkEnabled: row.think_enabled === 1,
      modeId: row.mode_id || "chat",
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  createConversation(input: { projectId: string | null; name: string; providerId?: string | null; modelId?: string | null; thinkBudget?: ThinkBudget | null; thinkEnabled?: boolean; modeId?: string }): Conversation {
    const id = genId("conv");
    const now = nowMs();
    this.db.prepare(`INSERT INTO conversation (id, project_id, name, provider_id, model_id, think_budget, think_enabled, mode_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, input.projectId, input.name, input.providerId ?? null, input.modelId ?? null,
      input.thinkBudget ?? null, input.thinkEnabled ? 1 : 0, input.modeId ?? "chat", now, now
    );
    return this.getConversation(id)!;
  }

  updateConversation(id: string, patch: Partial<Pick<Conversation, "name" | "providerId" | "modelId" | "thinkBudget" | "thinkEnabled" | "projectId" | "modeId">>): Conversation | null {
    const existing = this.getConversation(id);
    if (!existing) return null;
    const next: Conversation = { ...existing, ...patch, updatedAt: nowMs() };
    this.db.prepare(`UPDATE conversation SET project_id=?, name=?, provider_id=?, model_id=?, think_budget=?, think_enabled=?, mode_id=?, updated_at=? WHERE id=?`)
      .run(next.projectId, next.name, next.providerId, next.modelId, next.thinkBudget, next.thinkEnabled ? 1 : 0, next.modeId, next.updatedAt, id);
    return this.getConversation(id);
  }

  deleteConversation(id: string) {
    const tx = this.db.transaction(() => {
      this.db.prepare("DELETE FROM message WHERE conversation_id=?").run(id);
      this.db.prepare("DELETE FROM conversation WHERE id=?").run(id);
    });
    tx();
  }

  touchConversation(id: string) {
    this.db.prepare("UPDATE conversation SET updated_at=? WHERE id=?").run(nowMs(), id);
  }

  // ─── Messages ──────────────────────────────────────────────────────

  /**
   * UNFILTERED message list — used by the agent runtime to reconstruct
   * the conversation it sends back to the LLM. Includes every row, even
   * tool_result rows (those must stay in history for the OpenAI /
   * Anthropic tool-calling protocols) and synthetic pipeline-stage
   * prompts. For the UI list, use `listMessagesForRenderer` instead.
   */
  listMessages(conversationId: string): ChatMessage[] {
    // ORDER BY created_at ASC, rowid ASC — `rowid` is SQLite's implicit
    // monotonic insert counter (the `message` table uses a TEXT primary
    // key so rowid stays as a separate hidden column). We need it as
    // tiebreaker because `appendMessage` writes the user message and
    // the assistant placeholder in back-to-back calls — same millisecond,
    // same created_at — and the previous `id ASC` tiebreaker compared
    // random ids from genId(), so the placeholder occasionally sorted
    // BEFORE the user message and the renderer drew the answer above
    // the question.
    const rows = this.db.prepare("SELECT * FROM message WHERE conversation_id=? ORDER BY created_at ASC, rowid ASC").all(conversationId) as Array<{
      id: string; conversation_id: string; role: string; content: string; reasoning: string | null; tokens: number | null; attachments: string | null; created_at: number;
    }>;
    return rows.map((r) => ({
      id: r.id,
      conversationId: r.conversation_id,
      role: r.role as ChatRole,
      content: r.content,
      reasoning: r.reasoning,
      tokens: r.tokens,
      attachments: parseAttachments(r.attachments),
      createdAt: r.created_at
    }));
  }

  /**
   * FILTERED message list intended for the chat renderer.
   *
   * Hides two classes of `role='user'` rows that exist purely to feed
   * the LLM protocol and would confuse a human reader if drawn as user
   * bubbles:
   *
   *  1. **Tool-result rows.** The agent runtime persists tool_result
   *     blocks as `role='user'` messages so the LLM history stays
   *     protocol-correct. Their `message_part` rows are *all* of type
   *     `tool_result`. We detect that with a `NOT EXISTS` of any
   *     non-tool_result part. (Pure `role='user'` rows without any
   *     parts — legacy rows — get rendered normally.)
   *
   *  2. **Pipeline-stage synthetic prompts.** In multi-model pipeline
   *     mode, each stage (planner / executor / reviewer) dispatches a
   *     fresh queryLoop whose `userMessage` is an orchestration prompt
   *     like `[PLAN]\n...`, `[审查]\n...`, or `[REVIEWER FEEDBACK]\n...`.
   *     Those rows carry real text parts, so SQL alone can't tell them
   *     apart from human input — we match on a prefix sentinel.
   */
  listMessagesForRenderer(conversationId: string): ChatMessage[] {
    const rows = this.db.prepare(`
      SELECT m.* FROM message m
      WHERE m.conversation_id = ?
        AND NOT (
          m.role = 'user'
          AND EXISTS (SELECT 1 FROM message_part p WHERE p.message_id = m.id)
          AND NOT EXISTS (
            SELECT 1 FROM message_part p
            WHERE p.message_id = m.id AND p.type != 'tool_result'
          )
        )
      ORDER BY m.created_at ASC, m.rowid ASC
    `).all(conversationId) as Array<{
      id: string; conversation_id: string; role: string; content: string; reasoning: string | null; tokens: number | null; attachments: string | null; created_at: number;
    }>;

    const SYNTHETIC_USER_PREFIXES = [
      "[PLAN]",
      "[PLANNER",
      "[REVIEW]",
      "[REVIEWER",
      "[审查]",
      "[SYSTEM]"
    ];
    const isSyntheticPipelinePrompt = (role: string, content: string): boolean => {
      if (role !== "user") return false;
      const trimmed = content.trimStart();
      return SYNTHETIC_USER_PREFIXES.some((p) => trimmed.startsWith(p));
    };

    return rows
      .filter((r) => !isSyntheticPipelinePrompt(r.role, r.content ?? ""))
      .map((r) => ({
        id: r.id,
        conversationId: r.conversation_id,
        role: r.role as ChatRole,
        content: r.content,
        reasoning: r.reasoning,
        tokens: r.tokens,
        attachments: parseAttachments(r.attachments),
        createdAt: r.created_at
      }));
  }

  appendMessage(input: {
    conversationId: string;
    role: ChatRole;
    content: string;
    reasoning?: string | null;
    tokens?: number | null;
    attachments?: ChatAttachment[] | null;
  }): ChatMessage {
    const id = genId("msg");
    const now = nowMs();
    const attachmentsJson = input.attachments && input.attachments.length > 0
      ? JSON.stringify(input.attachments)
      : null;
    this.db.prepare(`INSERT INTO message (id, conversation_id, role, content, reasoning, tokens, attachments, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, input.conversationId, input.role, input.content, input.reasoning ?? null, input.tokens ?? null, attachmentsJson, now
    );
    this.touchConversation(input.conversationId);

    // Auto-title: if this is the FIRST user message in the conversation and
    // the conversation is still using the placeholder name, derive a title
    // from the message. If the user only sent images with no text, fall back
    // to a generic "[图片]" title so the sidebar doesn't show "New Conversation".
    if (input.role === "user") {
      const trimmed = input.content.trim();
      const hasAttachments = !!input.attachments && input.attachments.length > 0;
      if (trimmed || hasAttachments) {
        const conv = this.getConversation(input.conversationId);
        const placeholderNames = new Set(["New Conversation", "新对话", "新建对话", ""]);
        if (conv && placeholderNames.has(conv.name.trim())) {
          const userMsgCount = (this.db
            .prepare("SELECT COUNT(*) as c FROM message WHERE conversation_id=? AND role='user'")
            .get(input.conversationId) as { c: number }).c;
          if (userMsgCount === 1) {
            const title = trimmed ? deriveTitle(trimmed) : "[图片]";
            this.db.prepare("UPDATE conversation SET name=? WHERE id=?").run(title, input.conversationId);
          }
        }
      }
    }

    return {
      id,
      conversationId: input.conversationId,
      role: input.role,
      content: input.content,
      reasoning: input.reasoning ?? null,
      tokens: input.tokens ?? null,
      attachments: input.attachments && input.attachments.length > 0 ? input.attachments : undefined,
      createdAt: now
    };
  }

  /** Used to update the assistant message after streaming has finished. */
  finalizeMessage(id: string, content: string, reasoning: string | null) {
    this.db.prepare("UPDATE message SET content=?, reasoning=? WHERE id=?").run(content, reasoning, id);
  }

  /** Remove a message by id (e.g. cleanup of an empty assistant placeholder
   * left behind after a failed stream). */
  deleteMessage(id: string) {
    this.db.prepare("DELETE FROM message WHERE id=?").run(id);
  }

  /** Returns the last non-system message of each conversation, keyed by conv id. */
  getConversationPreviews(conversationIds: string[]): Record<string, { role: string; content: string; createdAt: number } | null> {
    if (conversationIds.length === 0) return {};
    const placeholders = conversationIds.map(() => "?").join(",");
    const rows = this.db
      .prepare(`SELECT conversation_id, role, content, created_at FROM message
                WHERE conversation_id IN (${placeholders}) AND role != 'system'
                ORDER BY created_at DESC, rowid DESC`)
      .all(...conversationIds) as Array<{ conversation_id: string; role: string; content: string; created_at: number }>;
    const out: Record<string, { role: string; content: string; createdAt: number } | null> = {};
    for (const cid of conversationIds) out[cid] = null;
    for (const r of rows) {
      if (out[r.conversation_id] === null) {
        out[r.conversation_id] = { role: r.role, content: r.content, createdAt: r.created_at };
      }
    }
    return out;
  }

  // ─── MCP Servers ─────────────────────────────────────────────────────

  listMcpServers(): McpServerConfig[] {
    const rows = this.db
      .prepare(`SELECT * FROM mcp_server ORDER BY updated_at DESC`)
      .all() as Array<{
        id: string; name: string; description: string; transport: string; enabled: number;
        command: string; args: string; env: string; url: string; headers: string;
        created_at: number; updated_at: number;
      }>;
    return rows.map(rowToMcpServer);
  }

  getMcpServer(id: string): McpServerConfig | null {
    const row = this.db.prepare(`SELECT * FROM mcp_server WHERE id=?`).get(id) as
      | { id: string; name: string; description: string; transport: string; enabled: number;
          command: string; args: string; env: string; url: string; headers: string;
          created_at: number; updated_at: number; }
      | undefined;
    return row ? rowToMcpServer(row) : null;
  }

  /** Insert or replace an MCP server config. When `id` is empty/falsy, a new
   * one is generated. Returns the full record (with id and timestamps). */
  saveMcpServer(input: Omit<McpServerConfig, "id" | "createdAt" | "updatedAt"> & { id?: string }): McpServerConfig {
    const now = nowMs();
    const existing = input.id ? this.getMcpServer(input.id) : null;
    const id = existing?.id ?? genId("mcp");
    const createdAt = existing?.createdAt ?? now;
    this.db
      .prepare(
        `INSERT INTO mcp_server (id, name, description, transport, enabled, command, args, env, url, headers, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name=excluded.name,
           description=excluded.description,
           transport=excluded.transport,
           enabled=excluded.enabled,
           command=excluded.command,
           args=excluded.args,
           env=excluded.env,
           url=excluded.url,
           headers=excluded.headers,
           updated_at=excluded.updated_at`
      )
      .run(
        id,
        input.name,
        input.description ?? "",
        input.transport,
        input.enabled ? 1 : 0,
        input.command ?? "",
        JSON.stringify(input.args ?? []),
        JSON.stringify(input.env ?? {}),
        input.url ?? "",
        JSON.stringify(input.headers ?? {}),
        createdAt,
        now
      );
    return this.getMcpServer(id)!;
  }

  deleteMcpServer(id: string) {
    this.db.prepare(`DELETE FROM mcp_server WHERE id=?`).run(id);
  }

  setMcpServerEnabled(id: string, enabled: boolean) {
    this.db.prepare(`UPDATE mcp_server SET enabled=?, updated_at=? WHERE id=?`).run(enabled ? 1 : 0, nowMs(), id);
  }
}

function rowToMcpServer(row: {
  id: string; name: string; description: string; transport: string; enabled: number;
  command: string; args: string; env: string; url: string; headers: string;
  created_at: number; updated_at: number;
}): McpServerConfig {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? "",
    transport: (row.transport as McpTransport) ?? "stdio",
    enabled: !!row.enabled,
    command: row.command ?? "",
    args: safeJson<string[]>(row.args, []),
    env: safeJson<Record<string, string>>(row.env, {}),
    url: row.url ?? "",
    headers: safeJson<Record<string, string>>(row.headers, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function safeJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

/**
 * Derive a clean ~30 char title from a user's message. Strips newlines, collapses
 * whitespace, and adds an ellipsis if truncated.
 */
function deriveTitle(text: string): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  const MAX = 30;
  if (cleaned.length <= MAX) return cleaned;
  return cleaned.slice(0, MAX) + "…";
}

/** Defensive JSON parse — returns undefined if the column is null / malformed. */
function parseAttachments(raw: string | null): ChatAttachment[] | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed as ChatAttachment[];
    return undefined;
  } catch {
    return undefined;
  }
}
