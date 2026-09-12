import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { trackViewport } from "./lib/viewport";
import "./styles/index.css";

trackViewport();

// The service worker provides the offline shell and receives push notifications.
// Navigations are network-first, so it never serves stale HTML while online.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).catch(() => {
      // An unavailable service worker only costs offline support; the app still runs.
    });
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
