import { useEffect } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useMediaQuery } from "@/hooks/useMediaQuery";

export type ThemePreference = "system" | "light" | "dark";

type ThemeState = { preference: ThemePreference; setPreference: (p: ThemePreference) => void };

// The storage key is also read by the pre-paint script in index.html.
export const useThemeStore = create<ThemeState>()(
  persist((set) => ({ preference: "system", setPreference: (preference) => set({ preference }) }), {
    name: "chatapp-theme",
  }),
);

export function useResolvedTheme(): "light" | "dark" {
  const preference = useThemeStore((s) => s.preference);
  const systemDark = useMediaQuery("(prefers-color-scheme: dark)");
  return preference === "system" ? (systemDark ? "dark" : "light") : preference;
}

/** Applies the resolved theme to <html> and the browser UI colour. */
export function ThemeSync() {
  const theme = useResolvedTheme();
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    root.style.colorScheme = theme;
    const color = theme === "dark" ? "#0b0d12" : "#f5f6f8";
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", color));
  }, [theme]);
  return null;
}
