import { create } from "zustand";

export type ThemePreference = "system" | "light" | "dark";

interface UiState {
  mobileNavOpen: boolean;
  theme: ThemePreference;
  setMobileNavOpen: (open: boolean) => void;
  setTheme: (theme: ThemePreference) => void;
}

const THEME_KEY = "medcore-theme";

function readTheme(): ThemePreference {
  if (typeof window === "undefined") return "system";
  try {
    const stored = window.localStorage.getItem(THEME_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

export function applyTheme(theme: ThemePreference): void {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
}

export const useUiStore = create<UiState>((set) => ({
  mobileNavOpen: false,
  theme: readTheme(),
  setMobileNavOpen: (mobileNavOpen) => set({ mobileNavOpen }),
  setTheme: (theme) => {
    try {
      if (theme === "system") window.localStorage.removeItem(THEME_KEY);
      else window.localStorage.setItem(THEME_KEY, theme);
    } catch {
      // Storage can be unavailable (private mode); the choice still applies now.
    }
    applyTheme(theme);
    set({ theme });
  },
}));
