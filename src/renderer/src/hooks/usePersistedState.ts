import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

/**
 * Persisted React state — initial value is used until the saved value is
 * hydrated from SQLite (via window.electronAPI.getUiPref). Subsequent
 * updates are debounced (300 ms) and written back to SQLite (app_meta
 * with key prefix "ui."). Falls back to in-memory only state if
 * electronAPI is unavailable (e.g. SSR / tests).
 */
export function usePersistedState<T>(key: string, defaultValue: T): [T, Dispatch<SetStateAction<T>>] {
  const [state, setState] = useState<T>(defaultValue);
  const hydrated = useRef(false);

  // Load saved value on mount.
  useEffect(() => {
    let cancelled = false;
    const api = window.electronAPI;
    if (!api?.getUiPref) {
      hydrated.current = true;
      return;
    }
    void api
      .getUiPref(key)
      .then((raw) => {
        if (cancelled) return;
        if (raw != null) {
          try {
            setState(JSON.parse(raw) as T);
          } catch {
            /* ignore malformed */
          }
        }
        hydrated.current = true;
      })
      .catch(() => {
        hydrated.current = true;
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  // Persist updates (debounced) once hydration has finished.
  useEffect(() => {
    if (!hydrated.current) return;
    const api = window.electronAPI;
    if (!api?.setUiPref) return;
    const handle = setTimeout(() => {
      void api.setUiPref(key, JSON.stringify(state)).catch(() => {});
    }, 300);
    return () => clearTimeout(handle);
  }, [key, state]);

  return [state, setState];
}
