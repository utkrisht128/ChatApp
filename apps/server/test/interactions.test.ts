import { describe, expect, it } from "vitest";
import { User } from "../src/models/User";
import { signUp } from "./helpers";

type U = Awaited<ReturnType<typeof signUp>>;

// 1×1 PNG
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

let n = 0;
const cid = () => `int-client-${Date.now()}-${++n}`;

const send = (who: U, chatId: string, body: string, extra: object = {}) =>
  who.post(`/api/chats/${chatId}/messages`, { clientId: cid(), body, ...extra });

const uploadTo = (u: U, chatId: string) =>
  u.agent
    .post(`/api/files?${new URLSearchParams({ purpose: "attachment", kind: "image", chatId, name: "photo.png" })}`)
    .set("X-Requested-With", "chatapp")
    .set("Content-Type", "image/png")
    .send(PNG);

async function pair() {
  const alice = await signUp();
  const bob = await signUp();
  const chat = (await alice.post("/api/chats/direct", { userId: bob.user.id })).body.data.chat as { id: string };
  return { alice, bob, chat };
}

const chatRow = async (who: U, chatId: string) =>
  (await who.get("/api/chats")).body.data.items.find((c: { id: string }) => c.id === chatId);

describe("mentions", () => {
  it("counts a mention only for real members, and never for the sender", async () => {
    const { alice, bob, chat } = await pair();
    const res = await send(alice, chat.id, `morning @${bob.user.username}, and @nobody_at_all, from @${alice.user.username}`);
    expect(res.body.data.message.mentions).toEqual([bob.user.id]);
    expect((await chatRow(bob, chat.id)).mentionCount).toBe(1);

    // Reading the chat clears it.
    await bob.post(`/api/chats/${chat.id}/read`, { messageId: res.body.data.message.id });
    expect((await chatRow(bob, chat.id)).mentionCount).toBe(0);
  });

  it("ignores an @name for someone who isn't in the chat", async () => {
    const { alice, chat } = await pair();
    const outsider = await signUp();
    const res = await send(alice, chat.id, `hey @${outsider.user.username}`);
    expect(res.body.data.message.mentions).toEqual([]);
  });

  it("doesn't treat an email address as a mention", async () => {
    const { alice, bob, chat } = await pair();
    const res = await send(alice, chat.id, `write to me@${bob.user.username}.example.com`);
    expect(res.body.data.message.mentions).toEqual([]);
  });
});

describe("forwarding", () => {
  it("copies a message into another chat, marked as forwarded, and is idempotent", async () => {
    const { alice, chat } = await pair();
    const carol = await signUp();
    const other = (await alice.post("/api/chats/direct", { userId: carol.user.id })).body.data.chat;
    const msg = (await send(alice, chat.id, "worth sharing")).body.data.message;

    const clientId = cid();
    const res = await alice.post(`/api/messages/${msg.id}/forward`, { targets: [{ chatId: other.id, clientId }] });
    expect(res.status).toBe(201);
    expect(res.body.data.messages[0]).toMatchObject({ body: "worth sharing", forwarded: true, chatId: other.id });
    expect((await carol.get(`/api/chats/${other.id}/messages`)).body.data.items).toHaveLength(1);

    // A retry with the same clientId doesn't send it twice.
    const again = await alice.post(`/api/messages/${msg.id}/forward`, { targets: [{ chatId: other.id, clientId }] });
    expect(again.body.data.messages[0].id).toBe(res.body.data.messages[0].id);
    expect((await carol.get(`/api/chats/${other.id}/messages`)).body.data.items).toHaveLength(1);
  });

  it("refuses chats you aren't in and messages you can't see", async () => {
    const { alice, chat } = await pair();
    const eve = await signUp();
    const msg = (await send(alice, chat.id, "private")).body.data.message;
    expect((await eve.post(`/api/messages/${msg.id}/forward`, { targets: [{ chatId: chat.id, clientId: cid() }] })).status).toBe(404);

    const eveChat = (await eve.post("/api/chats/direct", { userId: alice.user.id })).body.data.chat;
    const strangerChat = (await (await signUp()).post("/api/chats/direct", { userId: eve.user.id })).body.data.chat;
    expect((await alice.post(`/api/messages/${msg.id}/forward`, { targets: [{ chatId: strangerChat.id, clientId: cid() }] })).status).toBe(404);
    // Alice can forward into her own chat with Eve.
    expect((await alice.post(`/api/messages/${msg.id}/forward`, { targets: [{ chatId: eveChat.id, clientId: cid() }] })).status).toBe(201);
  });

  it("shares the stored file: the copy keeps working after the original is deleted", async () => {
    const { alice, chat } = await pair();
    const carol = await signUp();
    const other = (await alice.post("/api/chats/direct", { userId: carol.user.id })).body.data.chat;
    const file = (await uploadTo(alice, chat.id)).body.data.file;
    const msg = (await alice.post(`/api/chats/${chat.id}/messages`, { clientId: cid(), attachments: [{ fileId: file.id }] })).body.data.message;

    const fwd = (await alice.post(`/api/messages/${msg.id}/forward`, { targets: [{ chatId: other.id, clientId: cid() }] })).body.data.messages[0];
    expect(fwd.attachments[0].id).toBe(file.id);
    // Forwarding costs no extra storage, and the new chat can read the file.
    expect((await User.findById(alice.user.id))?.storageUsedBytes).toBe(PNG.length);
    expect((await carol.get(`/api/files/${file.id}`)).status).toBe(200);

    await alice.del(`/api/messages/${msg.id}`);
    expect((await carol.get(`/api/files/${file.id}`)).status).toBe(200);

    // Only once no message shows it any more is the file removed and the quota refunded.
    await alice.del(`/api/messages/${fwd.id}`);
    expect((await carol.get(`/api/files/${file.id}`)).status).toBe(404);
    expect((await User.findById(alice.user.id))?.storageUsedBytes).toBe(0);
  });
});

describe("pinning", () => {
  it("pins for everyone in a direct chat and unpins on delete", async () => {
    const { alice, bob, chat } = await pair();
    const msg = (await send(alice, chat.id, "the address is 12 High St")).body.data.message;

    const res = await alice.put(`/api/messages/${msg.id}/pinned`, { pinned: true });
    expect(res.body.data.messages.map((m: { id: string }) => m.id)).toEqual([msg.id]);
    expect((await bob.get(`/api/chats/${chat.id}/pinned`)).body.data.messages).toHaveLength(1);

    await alice.put(`/api/messages/${msg.id}/pinned`, { pinned: false });
    expect((await bob.get(`/api/chats/${chat.id}/pinned`)).body.data.messages).toHaveLength(0);

    await alice.put(`/api/messages/${msg.id}/pinned`, { pinned: true });
    await alice.del(`/api/messages/${msg.id}`);
    expect((await bob.get(`/api/chats/${chat.id}/pinned`)).body.data.messages).toHaveLength(0);
  });

  it("is an admin action in groups unless everyone may edit group info", async () => {
    const owner = await signUp();
    const member = await signUp();
    const group = (await owner.post("/api/groups", { name: "Trip", memberIds: [member.user.id] })).body.data.chat;
    const msg = (await send(member, group.id, "meeting point")).body.data.message;

    expect((await member.put(`/api/messages/${msg.id}/pinned`, { pinned: true })).status).toBe(403);
    expect((await owner.put(`/api/messages/${msg.id}/pinned`, { pinned: true })).status).toBe(200);

    await owner.patch(`/api/groups/${group.id}`, { permissions: { editInfo: "all" } });
    expect((await member.put(`/api/messages/${msg.id}/pinned`, { pinned: false })).status).toBe(200);
  });

  it("hides pinned messages from people who can't see them", async () => {
    const { alice, chat } = await pair();
    const eve = await signUp();
    const msg = (await send(alice, chat.id, "pin me")).body.data.message;
    await alice.put(`/api/messages/${msg.id}/pinned`, { pinned: true });
    expect((await eve.get(`/api/chats/${chat.id}/pinned`)).status).toBe(404);
  });
});

describe("starring", () => {
  it("is private to the person who starred, and survives until unstarred or deleted", async () => {
    const { alice, bob, chat } = await pair();
    const msg = (await send(alice, chat.id, "remember this")).body.data.message;

    expect((await bob.put(`/api/messages/${msg.id}/starred`, { starred: true })).status).toBe(204);
    expect((await bob.get("/api/messages/starred")).body.data.messages.map((m: { id: string }) => m.id)).toEqual([msg.id]);
    // Alice starred nothing, so her list stays empty.
    expect((await alice.get("/api/messages/starred")).body.data.messages).toEqual([]);

    // Starring twice is a no-op rather than an error.
    expect((await bob.put(`/api/messages/${msg.id}/starred`, { starred: true })).status).toBe(204);
    expect((await bob.get("/api/messages/starred")).body.data.messages).toHaveLength(1);

    await bob.put(`/api/messages/${msg.id}/starred`, { starred: false });
    expect((await bob.get("/api/messages/starred")).body.data.messages).toEqual([]);
  });

  it("drops starred messages that are deleted or in a group you left", async () => {
    const { alice, bob, chat } = await pair();
    const deleted = (await send(alice, chat.id, "temporary")).body.data.message;
    await bob.put(`/api/messages/${deleted.id}/starred`, { starred: true });
    await alice.del(`/api/messages/${deleted.id}`);
    expect((await bob.get("/api/messages/starred")).body.data.messages).toEqual([]);

    const group = (await alice.post("/api/groups", { name: "Book club", memberIds: [bob.user.id] })).body.data.chat;
    const inGroup = (await send(alice, group.id, "chapter 4 notes")).body.data.message;
    await bob.put(`/api/messages/${inGroup.id}/starred`, { starred: true });
    expect((await bob.get("/api/messages/starred")).body.data.messages).toHaveLength(1);
    await bob.post(`/api/groups/${group.id}/leave`);
    expect((await bob.get("/api/messages/starred")).body.data.messages).toEqual([]);
  });

  it("refuses to star a message you can't see", async () => {
    const { alice, chat } = await pair();
    const eve = await signUp();
    const msg = (await send(alice, chat.id, "secret")).body.data.message;
    expect((await eve.put(`/api/messages/${msg.id}/starred`, { starred: true })).status).toBe(404);
  });
});
