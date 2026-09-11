import { create } from "zustand";

export type ConnectionStatus = "connecting" | "connected" | "reconnecting" | "disconnected";

/** Real-time connection state, driven by the socket client. */
export const useConnection = create<{ status: ConnectionStatus; setStatus: (s: ConnectionStatus) => void }>()((set) => ({
  status: "connected",
  setStatus: (status) => set({ status }),
}));
