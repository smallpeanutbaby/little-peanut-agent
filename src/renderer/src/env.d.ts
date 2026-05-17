import type { AppInfo, AppearanceSettings, ModelConfig, ProviderConfig } from "@shared/types";

declare global {
  interface Window {
    electronAPI?: {
      ready: boolean;
      getAppInfo: () => Promise<AppInfo>;
      getAppearanceSettings: () => Promise<AppearanceSettings>;
      setAppearanceSettings: (settings: AppearanceSettings) => Promise<AppearanceSettings>;
      getModelConfigs: (providerId: string) => Promise<ModelConfig[]>;
      saveModelConfig: (config: ModelConfig) => Promise<ModelConfig[]>;
      setAllModelsEnabled: (providerId: string, enabled: boolean) => Promise<ModelConfig[]>;
      bulkInitModels: (providerId: string, modelIds: string[]) => Promise<ModelConfig[]>;
      // Provider config
      getAllProviderConfigs: () => Promise<ProviderConfig[]>;
      getProviderConfig: (providerId: string) => Promise<ProviderConfig | null>;
      saveProviderConfig: (config: ProviderConfig) => Promise<ProviderConfig[]>;
      deleteProviderConfig: (providerId: string) => Promise<ProviderConfig[]>;
      // Custom models
      addCustomModel: (providerId: string, modelId: string, supportsThink: boolean) => Promise<Array<{ modelId: string; supportsThink: boolean }>>;
      deleteCustomModel: (providerId: string, modelId: string) => Promise<Array<{ modelId: string; supportsThink: boolean }>>;
      getCustomModels: (providerId: string) => Promise<Array<{ modelId: string; supportsThink: boolean }>>;
      getAllCustomModels: () => Promise<Array<{ providerId: string; modelId: string; supportsThink: boolean }>>;
    };
  }
}

export {};
