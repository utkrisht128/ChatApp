import { useSyncExternalStore } from "react";

export function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Touch-first device (phones/tablets): long-press menus, Enter inserts a newline, etc. */
export const useIsTouch = () => useMediaQuery("(pointer: coarse)");
export const useIsDesktop = () => useMediaQuery("(min-width: 768px)");
