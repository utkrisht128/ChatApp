import type { Server } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents } from "@chat/shared";

export type IO = Server<ClientToServerEvents, ServerToClientEvents>;
type EventName = keyof ServerToClientEvents;

/**
 * Decouples services from Socket.IO: services publish events here, and they are
 * no-ops when no socket server is running (e.g. HTTP-only tests).
 */
let io: IO | null = null;
export const setIo = (server: IO | null) => void (io = server);

export const userRoom = (userId: { toString(): string }) => `user:${userId}`;

/** Every socket of a user joins their personal room, so multiple tabs/devices all receive events. */
export function emitToUsers<E extends EventName>(userIds: Iterable<{ toString(): string }>, event: E, ...payload: Parameters<ServerToClientEvents[E]>) {
  if (!io) return;
  const rooms = [...new Set([...userIds].map(String))].map(userRoom);
  if (rooms.length) io.to(rooms).emit(event, ...payload);
}

/** Drops a user's live connections (after logout-everywhere, password change, ban). */
export function disconnectUser(userId: { toString(): string }) {
  io?.in(userRoom(userId)).disconnectSockets(true);
}
