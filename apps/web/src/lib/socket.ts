import type { Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "@chat/shared";
import { api } from "./api";

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

// The WebSocket goes straight to the API host (Netlify can't proxy upgrades); REST stays same-origin.
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || window.location.origin;

let socket: AppSocket | null = null;

export const getSocket = () => socket;

export async function connectSocket(): Promise<AppSocket> {
  // socket.io is ~25KB gzipped and is useless until someone is signed in, so it is fetched
  // on demand rather than shipped in the entry bundle with the sign-in screen.
  const { io } = await import("socket.io-client");
  socket?.disconnect();
  socket = io(SOCKET_URL, {
    transports: ["websocket", "polling"],
    tryAllTransports: true,
    withCredentials: false,
    // Called on every (re)connection attempt: each gets a fresh single-use ticket,
    // obtained over the cookie-authenticated same-origin API.
    auth: (cb) => {
      api<{ ticket: string }>("/auth/socket-ticket", { method: "POST", timeoutMs: 75_000 }).then(
        ({ ticket }) => cb({ ticket }),
        () => cb({}),
      );
    },
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10_000,
  });
  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}
