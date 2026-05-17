import type { AppearanceSettings } from "@shared/types";
import { contextBridge, ipcRenderer } from "electron";

const electronAPI = {
  ready: true,
  getAppInfo: () => ipcRenderer.invoke("app:get-info"),
  getAppearanceSettings: () => ipcRenderer.invoke("settings:get-appearance") as Promise<AppearanceSettings>,
  setAppearanceSettings: (settings: AppearanceSettings) =>
    ipcRenderer.invoke("settings:set-appearance", settings) as Promise<AppearanceSettings>
};

contextBridge.exposeInMainWorld("electronAPI", electronAPI);
