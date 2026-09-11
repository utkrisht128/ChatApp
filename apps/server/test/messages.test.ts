import { describe, expect, it } from "vitest";
import { signUp } from "./helpers";

let n = 0;
const cid = () => `test-client-${Date.now()}-${++n}`;

async function pair() {
  const alice = await signUp();
  const bob = await signUp();
  const chat = (await alice.post("/api/chats/direct", { userId: bob.user.id })).body.data.chat;
  const send = (who: typeof alice, body: string, extra: object = {}) => who.post(`/api/chats/${chat.id}/messages`, { clientId: cid(), body, ...extra });
  return { alice, bob, chat, send };
}

describe("sending", () => {
  it("stores the message, reveals the chat to the recipient and updates unread + last message", async () => {
    const { alice, bob, chat, send } = await pair();
    const res = await send(alice, "  Hello Bob  ");
    expect(res.status).toBe(201);
    expect(res.body.data.message).toMatchObject({ body: "Hello Bob", senderId: alice.user.id, chatId: chat.id, reactions: [] });

    const bobList = (await bob.get("/api/chats")).body.data.items;
    expect(bobList).toHaveLength(1);
    expect(bobList[0]).toMatchObject({ unreadCount: 1, lastMessage: { preview: "Hello Bob", senderId: alice.user.id } });
    expect((await alice.get("/api/chats")).body.data.items[0].unreadCount).toBe(0);
  });

  it("is idempotent per clientId — retries never duplicate", async () => {
    const { alice, chat } = await pair();
    const body = { clientId: cid(), body: "only once" };
    const results = await Promise.all([1, 2, 3].map(() => alice.post(`/api/chats/${chat.id}/messages`, body)));
    expect(new Set(results.map((r) => r.body.data.message.id)).size).toBe(1);
    const page = (await alice.get(`/api/chats/${chat.id}/messages`)).body.data;
    expect(page.items).toHaveLength(1);
  });

  it("rejects non-members, empty and oversized messages", async () => {
    const { chat } = await pair();
    const eve = await signUp();
    expect((await eve.post(`/api/chats/${chat.id}/messages`, { clientId: cid(), body: "hi" })).status).toBe(404);
    expect((await eve.get(`/api/chats/${chat.id}/messages`)).status).toBe(404);
    const { alice, chat: c2 } = await pair();
    expect((await alice.post(`/api/chats/${c2.id}/messages`, { clientId: cid(), body: "   " })).status).toBe(400);
    expect((await alice.post(`/api/chats/${c2.id}/messages`, { clientId: cid(), body: "x".repeat(4001) })).status).toBe(400);
  });

  it("replies quote the original, and the quote tracks edits and deletion", async () => {
    const { alice, bob, chat, send } = await pair();
    const original = (await send(alice, "Lunch at 1?")).body.data.message;
    const reply = (await send(bob, "Sounds good", { replyToId: original.id })).body.data.message;
    expect(reply.replyTo).toEqual({ id: original.id, senderId: alice.user.id, preview: "Lunch at 1?" });

    await alice.patch(`/api/messages/${original.id}`, { body: "Lunch at 2?" });
    let items = (await bob.get(`/api/chats/${chat.id}/messages`)).body.data.items;
    expect(items.find((m: { id: string }) => m.id === reply.id).replyTo.preview).toBe("Lunch at 2?");

    await alice.del(`/api/messages/${original.id}`);
    items = (await bob.get(`/api/chats/${chat.id}/messages`)).body.data.items;
    expect(items.find((m: { id: string }) => m.id === reply.id).replyTo.preview).toBe("Message deleted");
  });
});

describe("history", () => {
  it("paginates newest-first pages returned in chronological order", async () => {
    const { alice, chat, send } = await pair();
    for (let i = 0; i < 7; i++) await send(alice, `m${i}`);
    const first = (await alice.get(`/api/chats/${chat.id}/messages?limit=3`)).body.data;
    expect(first.items.map((m: { body: string }) => m.body)).toEqual(["m4", "m5", "m6"]);
    expect(first.receipts).toHaveLength(1);
    const second = (await alice.get(`/api/chats/${chat.id}/messages?limit=3&before=${first.nextCursor}`)).body.data;
    expect(second.items.map((m: { body: string }) => m.body)).toEqual(["m1", "m2", "m3"]);
    expect(second.receipts).toBeUndefined();
    const third = (await alice.get(`/api/chats/${chat.id}/messages?limit=3&before=${second.nextCursor}`)).body.data;
    expect(third.items.map((m: { body: string }) => m.body)).toEqual(["m0"]);
    expect(third.nextCursor).toBeNull();
  });
});

describe("editing and deleting", () => {
  it("only lets the author edit or delete-for-everyone", async () => {
    const { alice, bob, send } = await pair();
    const msg = (await send(alice, "typo")).body.data.message;
    expect((await bob.patch(`/api/messages/${msg.id}`, { body: "hacked" })).status).toBe(403);
    expect((await bob.del(`/api/messages/${msg.id}`)).status).toBe(403);

    const edited = await alice.patch(`/api/messages/${msg.id}`, { body: "fixed" });
    expect(edited.body.data.message).toMatchObject({ body: "fixed", editedAt: expect.any(String) });

    expect((await alice.del(`/api/messages/${msg.id}`)).status).toBe(204);
    const list = (await bob.get("/api/chats")).body.data.items;
    expect(list[0].lastMessage.preview).toBe("Message deleted");
    expect((await alice.patch(`/api/messages/${msg.id}`, { body: "again" })).status).toBe(400);
  });

  it("delete-for-me hides the message only for that user", async () => {
    const { alice, bob, chat, send } = await pair();
    const msg = (await send(alice, "hello")).body.data.message;
    expect((await bob.del(`/api/messages/${msg.id}?scope=me`)).status).toBe(204);
    expect((await bob.get(`/api/chats/${chat.id}/messages`)).body.data.items).toHaveLength(0);
    expect((await alice.get(`/api/chats/${chat.id}/messages`)).body.data.items).toHaveLength(1);
    expect((await bob.patch(`/api/messages/${msg.id}`, {})).status).toBe(400);
  });

  it("hides messages from non-members entirely", async () => {
    const { alice, send } = await pair();
    const eve = await signUp();
    const msg = (await send(alice, "secret")).body.data.message;
    expect((await eve.put(`/api/messages/${msg.id}/reaction`, { emoji: "👍" })).status).toBe(404);
    expect((await eve.del(`/api/messages/${msg.id}?scope=me`)).status).toBe(404);
  });
});

describe("reactions", () => {
  it("keeps one reaction per person and supports removal", async () => {
    const { alice, bob, send } = await pair();
    const msg = (await send(alice, "news!")).body.data.message;
    await bob.put(`/api/messages/${msg.id}/reaction`, { emoji: "👍" });
    await alice.put(`/api/messages/${msg.id}/reaction`, { emoji: "👍" });
    let res = await bob.put(`/api/messages/${msg.id}/reaction`, { emoji: "❤️" });
    expect(res.body.data.message.reactions).toEqual([
      { emoji: "👍", userIds: [alice.user.id] },
      { emoji: "❤️", userIds: [bob.user.id] },
    ]);
    res = await bob.put(`/api/messages/${msg.id}/reaction`, { emoji: null });
    expect(res.body.data.message.reactions).toEqual([{ emoji: "👍", userIds: [alice.user.id] }]);
    expect((await bob.put(`/api/messages/${msg.id}/reaction`, { emoji: "hello" })).status).toBe(400);
  });
});

describe("read receipts", () => {
  it("marks read, recomputes unread and exposes the pointer to the sender", async () => {
    const { alice, bob, chat, send } = await pair();
    const m1 = (await send(alice, "one")).body.data.message;
    const m2 = (await send(alice, "two")).body.data.message;
    await send(alice, "three");
    expect((await bob.get("/api/chats")).body.data.items[0].unreadCount).toBe(3);

    const res = await bob.post(`/api/chats/${chat.id}/read`, { messageId: m2.id });
    expect(res.body.data.unreadCount).toBe(1);
    // Never moves backwards.
    await bob.post(`/api/chats/${chat.id}/read`, { messageId: m1.id });
    expect((await bob.get("/api/chats")).body.data.items[0].unreadCount).toBe(1);

    const receipts = (await alice.get(`/api/chats/${chat.id}/messages`)).body.data.receipts;
    expect(receipts).toEqual([{ userId: bob.user.id, deliveredId: m2.id, readId: m2.id }]);
  });

  it("sending a message clears your own unread count and marks earlier messages read", async () => {
    const { alice, bob, chat, send } = await pair();
    await send(alice, "one");
    const two = (await send(alice, "two")).body.data.message;
    expect((await bob.get("/api/chats")).body.data.items[0].unreadCount).toBe(2);

    await send(bob, "replying without opening first");
    expect((await bob.get("/api/chats")).body.data.items[0].unreadCount).toBe(0);
    const receipts = (await alice.get(`/api/chats/${chat.id}/messages`)).body.data.receipts;
    expect(receipts[0].readId > two.id).toBe(true);
  });

  it("withholds read status when either side turns read receipts off", async () => {
    const { alice, bob, chat, send } = await pair();
    const m = (await send(alice, "hi")).body.data.message;
    await bob.patch("/api/users/me/settings", { readReceipts: false });
    await bob.post(`/api/chats/${chat.id}/read`, { messageId: m.id });
    const receipts = (await alice.get(`/api/chats/${chat.id}/messages`)).body.data.receipts;
    expect(receipts[0]).not.toHaveProperty("readId");
    expect(receipts[0].deliveredId).toBe(m.id);
  });

  it("rejects read markers for messages outside the chat", async () => {
    const a = await pair();
    const b = await pair();
    const foreign = (await b.send(b.alice, "elsewhere")).body.data.message;
    expect((await a.bob.post(`/api/chats/${a.chat.id}/read`, { messageId: foreign.id })).status).toBe(404);
  });
});
