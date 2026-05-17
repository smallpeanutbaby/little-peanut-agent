import { ipcMain } from "electron";
import type { AppInfo, AppearanceSettings, ModelConfig, ProviderConfig } from "@shared/types";
import { AppDatabase } from "../db/database";

export function registerIpc(appInfo: AppInfo, database: AppDatabase) {
  ipcMain.handle("app:get-info", () => appInfo);
  ipcMain.handle("settings:get-appearance", () => database.getAppearanceSettings());
  ipcMain.handle("settings:set-appearance", (_event, settings: AppearanceSettings) => {
    database.saveAppearanceSettings(settings);
    return database.getAppearanceSettings();
  });

  // ─── Model Config ──────────────────────────────────────────────────
  ipcMain.handle("models:get-configs", (_event, providerId: string) => {
    return database.getModelConfigs(providerId);
  });
  ipcMain.handle("models:save-config", (_event, config: ModelConfig) => {
    database.saveModelConfig(config);
    return database.getModelConfigs(config.providerId);
  });
  ipcMain.handle("models:set-all-enabled", (_event, providerId: string, enabled: boolean) => {
    database.setAllModelsEnabled(providerId, enabled);
    return database.getModelConfigs(providerId);
  });
  ipcMain.handle("models:bulk-init", (_event, providerId: string, modelIds: string[]) => {
    database.bulkInitModels(providerId, modelIds);
    return database.getModelConfigs(providerId);
  });

  // ─── Provider Config ───────────────────────────────────────────────
  ipcMain.handle("providers:get-all", () => {
    return database.getAllProviderConfigs();
  });
  ipcMain.handle("providers:get", (_event, providerId: string) => {
    return database.getProviderConfig(providerId);
  });
  ipcMain.handle("providers:save", (_event, config: ProviderConfig) => {
    database.saveProviderConfig(config);
    return database.getAllProviderConfigs();
  });
  ipcMain.handle("providers:delete", (_event, providerId: string) => {
    database.deleteProviderConfig(providerId);
    return database.getAllProviderConfigs();
  });

  // ─── Custom Models ─────────────────────────────────────────────────
  ipcMain.handle("models:add-custom", (_event, providerId: string, modelId: string, supportsThink: boolean) => {
    database.addCustomModel(providerId, modelId, supportsThink);
    return database.getCustomModels(providerId);
  });
  ipcMain.handle("models:delete-custom", (_event, providerId: string, modelId: string) => {
    database.deleteCustomModel(providerId, modelId);
    return database.getCustomModels(providerId);
  });
  ipcMain.handle("models:get-custom", (_event, providerId: string) => {
    return database.getCustomModels(providerId);
  });
  ipcMain.handle("models:get-all-custom", () => {
    return database.getAllCustomModels();
  });
}
