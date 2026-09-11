import { MessagesSquare } from "lucide-react";
import { Outlet, useMatch } from "react-router";
import { EmptyState } from "@/components/ui/States";
import { SplitView } from "@/layouts/SplitView";
import { ChatList } from "./ChatList";

export function ChatsSection() {
  const inChat = useMatch("/c/:chatId");
  return (
    <SplitView list={<ChatList />} showDetail={Boolean(inChat)}>
      <Outlet />
    </SplitView>
  );
}

/** Desktop placeholder when no conversation is open. */
export function NoChatSelected() {
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  return (
    <div className="grid flex-1 place-items-center bg-chat">
      <EmptyState
        icon={MessagesSquare}
        title="Select a conversation"
        description={
          <>
            Pick a chat from the list, or start a new one. Press{" "}
            <kbd className="rounded-md border border-border-strong bg-surface px-1.5 py-0.5 font-sans text-xs">{mac ? "⌘" : "Ctrl"} K</kbd> to search.
          </>
        }
      />
    </div>
  );
}
