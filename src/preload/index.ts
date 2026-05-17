import type { AppearanceSettings, ModelConfig, ProviderConfig } from "@shared/types";
import { contextBridge, ipcRenderer } from "electron";

const electronAPI = {
  ready: true,
  getAppInfo: () => ipcRenderer.invoke("app:get-info"),
  getAppearanceSettings: () => ipcRenderer.invoke("settings:get-appearance") as Promise<AppearanceSettings>,
  setAppearanceSettings: (settings: AppearanceSettings) =>
    ipcRenderer.invoke("settings:set-appearance", settings) as Promise<AppearanceSettings>,
  getModelConfigs: (providerId: string) =>
    ipcRenderer.invoke("models:get-configs", providerId) as Promise<ModelConfig[]>,
  saveModelConfig: (config: ModelConfig) =>
    ipcRenderer.invoke("models:save-config", config) as Promise<ModelConfig[]>,
  setAllModelsEnabled: (providerId: string, enabled: boolean) =>
    ipcRenderer.invoke("models:set-all-enabled", providerId, enabled) as Promise<ModelConfig[]>,
  bulkInitModels: (providerId: string, modelIds: string[]) =>
    ipcRenderer.invoke("models:bulk-init", providerId, modelIds) as Promise<ModelConfig[]>,
  // Provider config
  getAllProviderConfigs: () =>
    ipcRenderer.invoke("providers:get-all") as Promise<ProviderConfig[]>,
  getProviderConfig: (providerId: string) =>
    ipcRenderer.invoke("providers:get", providerId) as Promise<ProviderConfig | null>,
  saveProviderConfig: (config: ProviderConfig) =>
    ipcRenderer.invoke("providers:save", config) as Promise<ProviderConfig[]>,
  deleteProviderConfig: (providerId: string) =>
    ipcRenderer.invoke("providers:delete", providerId) as Promise<ProviderConfig[]>
};

contextBridge.exposeInMainWorld("electronAPI", electronAPI);
