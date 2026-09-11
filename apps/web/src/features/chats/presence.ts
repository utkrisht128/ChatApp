import type { ChatSummary } from "@chat/shared";
import { formatLastSeen } from "@/lib/format";

/** Header subtitle: presence for direct chats, member count for groups. */
export function presenceText(chat: ChatSummary) {
  if (chat.type === "group") return `${chat.memberCount} member${chat.memberCount === 1 ? "" : "s"}`;
  const peer = chat.peer;
  if (!peer) return "";
  if (peer.online) return "online";
  if (peer.lastSeenAt !== undefined) return formatLastSeen(peer.lastSeenAt);
  return `@${peer.username}`;
}
