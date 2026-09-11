/**
 * Keeps `--app-height` equal to the *visible* viewport. On iOS Safari the on-screen
 * keyboard doesn't shrink `100dvh`, which would push the message composer under the
 * keyboard; sizing the shell to visualViewport keeps the composer above it.
 */
export function trackViewport() {
  const vv = window.visualViewport;
  if (!vv) return;
  const root = document.documentElement;
  const update = () => {
    root.style.setProperty("--app-height", `${Math.round(vv.height)}px`);
    // iOS scrolls the layout viewport when focusing an input; pin it back (unless pinch-zoomed).
    if (vv.scale === 1 && window.scrollY !== 0) window.scrollTo(0, 0);
  };
  vv.addEventListener("resize", update);
  vv.addEventListener("scroll", update);
  update();
}
