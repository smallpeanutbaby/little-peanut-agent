import { ipcMain } from "electron";
import type { AppInfo, AppearanceSettings } from "@shared/types";
import { AppDatabase } from "../db/database";

export function registerIpc(appInfo: AppInfo, database: AppDatabase) {
  ipcMain.handle("app:get-info", () => appInfo);
  ipcMain.handle("settings:get-appearance", () => database.getAppearanceSettings());
  ipcMain.handle("settings:set-appearance", (_event, settings: AppearanceSettings) => {
    database.saveAppearanceSettings(settings);
    return database.getAppearanceSettings();
  });
}
