import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import type { AppearanceSettings, BackgroundColor, ModelConfig, ProviderConfig, TextColor, ThemeMode } from "@shared/types";

export class AppDatabase {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.bootstrap();
  }

  private bootstrap() {
    this.db.exec(`
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
        is_custom INTEGER NOT NULL DEFAULT 0,
        supports_think INTEGER NOT NULL DEFAULT 0,
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
    `);
    // Migrate: add columns if missing (for existing DBs)
    try { this.db.exec("ALTER TABLE model_config ADD COLUMN is_custom INTEGER NOT NULL DEFAULT 0"); } catch { /* already exists */ }
    try { this.db.exec("ALTER TABLE model_config ADD COLUMN supports_think INTEGER NOT NULL DEFAULT 0"); } catch { /* already exists */ }
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

  getAppearanceSettings(): AppearanceSettings {
    return {
      theme: (this.getValue("appearance.theme") as ThemeMode | null) ?? "dark",
      background:
        (this.getValue("appearance.background") as BackgroundColor | null) ?? "peanut-dark",
      text: (this.getValue("appearance.text") as TextColor | null) ?? "ivory",
      language: (this.getValue("appearance.language") as "zh-CN" | "en" | null) ?? "zh-CN"
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
      }>;
    return rows.map((r) => ({
      providerId: r.provider_id,
      modelId: r.model_id,
      enabled: r.enabled === 1,
      thinkEnabled: r.think_enabled === 1,
      thinkBudget: r.think_budget as ModelConfig["thinkBudget"],
      thinkBodyOn: r.think_body_on,
      thinkBodyOff: r.think_body_off,
      forceTemperature: r.force_temperature
    }));
  }

  saveModelConfig(config: ModelConfig) {
    this.db
      .prepare(`INSERT INTO model_config (provider_id, model_id, enabled, think_enabled, think_budget, think_body_on, think_body_off, force_temperature)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(provider_id, model_id) DO UPDATE SET
          enabled = excluded.enabled,
          think_enabled = excluded.think_enabled,
          think_budget = excluded.think_budget,
          think_body_on = excluded.think_body_on,
          think_body_off = excluded.think_body_off,
          force_temperature = excluded.force_temperature`)
      .run(
        config.providerId,
        config.modelId,
        config.enabled ? 1 : 0,
        config.thinkEnabled ? 1 : 0,
        config.thinkBudget,
        config.thinkBodyOn,
        config.thinkBodyOff,
        config.forceTemperature
      );
  }

  setAllModelsEnabled(providerId: string, enabled: boolean) {
    this.db
      .prepare("UPDATE model_config SET enabled = ? WHERE provider_id = ?")
      .run(enabled ? 1 : 0, providerId);
  }

  bulkInitModels(providerId: string, modelIds: string[]) {
    const insert = this.db.prepare(
      "INSERT OR IGNORE INTO model_config (provider_id, model_id, enabled, think_enabled, think_budget, think_body_on, think_body_off, force_temperature) VALUES (?, ?, 1, 0, 'medium', '{}', '', '')"
    );
    const tx = this.db.transaction(() => {
      for (const modelId of modelIds) {
        insert.run(providerId, modelId);
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
      apiKey: row.api_key,
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
      apiKey: r.api_key,
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
        config.apiKey,
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

  addCustomModel(providerId: string, modelId: string, supportsThink: boolean) {
    this.db
      .prepare(`INSERT OR IGNORE INTO model_config (provider_id, model_id, enabled, think_enabled, think_budget, think_body_on, think_body_off, force_temperature, is_custom, supports_think)
        VALUES (?, ?, 1, 0, 'medium', '{}', '', '', 1, ?)`)
      .run(providerId, modelId, supportsThink ? 1 : 0);
  }

  deleteCustomModel(providerId: string, modelId: string) {
    this.db
      .prepare("DELETE FROM model_config WHERE provider_id = ? AND model_id = ? AND is_custom = 1")
      .run(providerId, modelId);
  }

  getCustomModels(providerId: string): Array<{ modelId: string; supportsThink: boolean }> {
    const rows = this.db
      .prepare("SELECT model_id, supports_think FROM model_config WHERE provider_id = ? AND is_custom = 1")
      .all(providerId) as Array<{ model_id: string; supports_think: number }>;
    return rows.map((r) => ({ modelId: r.model_id, supportsThink: r.supports_think === 1 }));
  }

  getAllCustomModels(): Array<{ providerId: string; modelId: string; supportsThink: boolean }> {
    const rows = this.db
      .prepare("SELECT provider_id, model_id, supports_think FROM model_config WHERE is_custom = 1")
      .all() as Array<{ provider_id: string; model_id: string; supports_think: number }>;
    return rows.map((r) => ({ providerId: r.provider_id, modelId: r.model_id, supportsThink: r.supports_think === 1 }));
  }
}
