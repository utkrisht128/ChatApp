/**
 * In-memory presence: live socket count per user. A single Render instance is the
 * deployment target; scaling out would move this to Redis alongside the Socket.IO adapter.
 */
const connections = new Map<string, number>();

export const isOnline = (userId: string) => (connections.get(userId) ?? 0) > 0;

/** Returns true when this connection brought the user online. */
export function addConnection(userId: string) {
  const n = (connections.get(userId) ?? 0) + 1;
  connections.set(userId, n);
  return n === 1;
}

/** Returns true when this was the user's last connection. */
export function removeConnection(userId: string) {
  const n = (connections.get(userId) ?? 1) - 1;
  if (n <= 0) {
    connections.delete(userId);
    return true;
  }
  connections.set(userId, n);
  return false;
}
