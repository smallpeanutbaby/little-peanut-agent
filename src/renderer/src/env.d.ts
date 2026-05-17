import type { AppInfo, AppearanceSettings } from "@shared/types";

declare global {
  interface Window {
    electronAPI?: {
      ready: boolean;
      getAppInfo: () => Promise<AppInfo>;
      getAppearanceSettings: () => Promise<AppearanceSettings>;
      setAppearanceSettings: (settings: AppearanceSettings) => Promise<AppearanceSettings>;
    };
  }
}

export {};
