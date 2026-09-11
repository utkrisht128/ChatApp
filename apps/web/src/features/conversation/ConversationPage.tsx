import { ArrowLeft, MessageSquareOff } from "lucide-react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import type { ChatSummary } from "@chat/shared";
import { Avatar } from "@/components/ui/Avatar";
import { SidePanel } from "@/components/ui/Dialog";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { useChat } from "@/features/chats/api";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { ApiError } from "@/lib/api";
import { useUi } from "@/stores/ui";
import { ChatDetails } from "./ChatDetails";
import { Composer } from "./Composer";
import { ConversationHeader } from "./ConversationHeader";

export default function ConversationPage() {
  const { chatId = "" } = useParams();
  const chat = useChat(chatId);

  if (chat.isPending) return <ConversationSkeleton />;
  if (chat.isError) {
    if (chat.error instanceof ApiError && chat.error.status === 404) {
      return (
        <div className="grid flex-1 place-items-center bg-chat">
          <EmptyState
            icon={MessageSquareOff}
            title="Chat not found"
            description="It may have been removed, or you don't have access to it."
            action={
              <Link to="/" className="inline-flex items-center gap-1.5 font-semibold text-accent hover:underline">
                <ArrowLeft className="size-4" /> Back to chats
              </Link>
            }
          />
        </div>
      );
    }
    return (
      <div className="grid flex-1 place-items-center bg-chat">
        <ErrorState title="Couldn't open this chat" error={chat.error} onRetry={() => chat.refetch()} />
      </div>
    );
  }
  return <Conversation key={chatId} chat={chat.data} />;
}

function Conversation({ chat }: { chat: ChatSummary }) {
  const detailsOpen = useUi((s) => s.detailsOpen);
  const setDetailsOpen = useUi((s) => s.setDetailsOpen);
  const wide = useMediaQuery("(min-width: 1280px)");

  return (
    <div className="flex min-h-0 flex-1 max-md:animate-slide-in-right">
      <section aria-label={`Conversation with ${chat.name}`} className="flex min-w-0 flex-1 flex-col bg-chat">
        <ConversationHeader chat={chat} />
        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
          <ConversationIntro chat={chat} />
        </div>
        <Composer chatId={chat.id} onSend={() => toast.info("Sending messages is enabled in the next phase.")} />
      </section>

      {wide ? (
        detailsOpen && (
          <aside aria-label="Chat info" className="scrollbar-thin w-80 shrink-0 overflow-y-auto border-l border-border bg-surface">
            <ChatDetails chat={chat} />
          </aside>
        )
      ) : (
        <SidePanel open={detailsOpen} onOpenChange={setDetailsOpen} title="Chat info">
          <ChatDetails chat={chat} />
        </SidePanel>
      )}
    </div>
  );
}

function ConversationIntro({ chat }: { chat: ChatSummary }) {
  return (
    <div className="flex h-full items-end justify-center px-4 py-8">
      <div className="flex max-w-xs flex-col items-center rounded-3xl bg-surface/80 px-6 py-6 text-center shadow-bubble backdrop-blur">
        <Avatar name={chat.name} src={chat.avatarUrl} seed={chat.peer?.id ?? chat.id} size="xl" />
        <p className="mt-3 font-semibold">{chat.name}</p>
        {chat.peer && <p className="text-sm text-muted">@{chat.peer.username}</p>}
        <p className="mt-3 text-sm text-muted">No messages here yet. Say hello 👋</p>
      </div>
    </div>
  );
}

function ConversationSkeleton() {
  return (
    <div role="status" aria-label="Loading conversation" className="flex min-h-0 flex-1 flex-col bg-chat">
      <div className="flex h-16 items-center gap-3 border-b border-border bg-surface px-4">
        <Skeleton className="size-10 rounded-full" />
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-3.5 w-32" />
          <Skeleton className="h-3 w-20" />
        </div>
      </div>
      <div className="flex flex-1 flex-col justify-end gap-3 p-4">
        {["w-48", "w-64", "w-36", "w-56", "w-40"].map((w, i) => (
          <Skeleton key={w} className={`h-10 max-w-[70%] rounded-2xl ${w} ${i % 2 ? "self-end" : "self-start"}`} />
        ))}
      </div>
      <div className="h-16 border-t border-border bg-surface" />
    </div>
  );
}
