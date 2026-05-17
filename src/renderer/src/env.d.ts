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
    };
  }
}

export {};
