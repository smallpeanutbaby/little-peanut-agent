import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import type { AppearanceSettings, BackgroundColor, TextColor, ThemeMode } from "@shared/types";

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
    `);
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
}
