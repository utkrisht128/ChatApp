import { QueryClient } from "@tanstack/react-query";
import { ApiError, setUnauthenticatedHandler } from "./api";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      // Client errors (4xx) won't fix themselves; network/5xx get two retries.
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
    mutations: { retry: false },
  },
});

setUnauthenticatedHandler(() => queryClient.setQueryData(["me"], null));
