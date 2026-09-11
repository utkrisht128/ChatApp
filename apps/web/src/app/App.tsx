import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "react-router/dom";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/Tooltip";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { queryClient } from "@/lib/queryClient";
import { ThemeSync, useResolvedTheme } from "@/stores/theme";
import { router } from "./router";

function AppToaster() {
  const theme = useResolvedTheme();
  const desktop = useIsDesktop();
  return (
    <Toaster
      theme={theme}
      position={desktop ? "bottom-right" : "top-center"}
      closeButton
      toastOptions={{ style: { borderRadius: "14px" } }}
    />
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={400}>
        <ThemeSync />
        <RouterProvider router={router} />
        <AppToaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
