import { create } from "zustand";
import type { AppInfo, BackgroundColor, TextColor, ThemeMode } from "@shared/types";

interface UiState {
  appInfo: AppInfo | null;
  theme: ThemeMode;
  background: BackgroundColor;
  text: TextColor;
  language: "zh-CN" | "en";
  setAppInfo: (value: AppInfo) => void;
  setTheme: (value: ThemeMode) => void;
  setBackground: (value: BackgroundColor) => void;
  setText: (value: TextColor) => void;
  setLanguage: (value: "zh-CN" | "en") => void;
}

export const useUiStore = create<UiState>((set) => ({
  appInfo: null,
  theme: "dark",
  background: "dark",
  text: "ivory",
  language: "zh-CN",
  setAppInfo: (appInfo) => set({ appInfo }),
  setTheme: (theme) => set({ theme }),
  setBackground: (background) => set({ background }),
  setText: (text) => set({ text }),
  setLanguage: (language) => set({ language })
}));
