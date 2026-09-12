import { describe, expect, it } from "vitest";
import { signUp } from "./helpers";

let n = 0;
const cid = () => `search-client-${Date.now()}-${++n}`;

type Client = Awaited<ReturnType<typeof signUp>>;
const send = (who: Client, chatId: string, body: string, extra: object = {}) =>
  who.post(`/api/chats/${chatId}/messages`, { clientId: cid(), body, ...extra });

async function pair() {
  const alice = await signUp();
  const bob = await signUp();
  const chat = (await alice.post("/api/chats/direct", { userId: bob.user.id })).body.data.chat;
  return { alice, bob, chat };
}

const search = (who: Client, params: string) => who.get(`/api/search?${params}`);

describe("message search", () => {
  it("finds the caller's own messages and paginates newest-first", async () => {
    const { alice, chat } = await pair();
    await send(alice, chat.id, "the quarterly budget spreadsheet");
    await send(alice, chat.id, "lunch tomorrow?");
    await send(alice, chat.id, "budget review moved to friday");

    const res = await search(alice, "q=budget&type=messages");
    expect(res.status).toBe(200);
    const bodies = res.body.data.items.map((h: { message: { body: string } }) => h.message.body);
    expect(bodies).toEqual(["budget review moved to friday", "the quarterly budget spreadsheet"]);
    expect(res.body.data.items[0].chat).toMatchObject({ id: chat.id, type: "direct" });
  });

  it("never returns messages from chats the caller isn't in", async () => {
    const { alice, chat } = await pair();
    await send(alice, chat.id, "a very distinctive passphrase");
    const eve = await signUp();
    expect((await search(eve, "q=distinctive&type=messages")).body.data.items).toEqual([]);
  });

  it("scopes to one chat when given a chatId, and 404s for a chat the caller isn't in", async () => {
    const { alice, chat } = await pair();
    const other = await pair();
    await send(alice, chat.id, "shared keyword here");
    await send(other.alice, other.chat.id, "shared keyword there");

    const scoped = await search(alice, `q=keyword&type=messages&chatId=${chat.id}`);
    expect(scoped.body.data.items).toHaveLength(1);
    expect((await search(alice, `q=keyword&type=messages&chatId=${other.chat.id}`)).status).toBe(404);
  });

  it("excludes messages deleted, hidden for the caller, and sent before they joined a group", async () => {
    const { alice, bob, chat } = await pair();
    const deleted = (await send(alice, chat.id, "findme deleted")).body.data.message;
    const hidden = (await send(alice, chat.id, "findme hidden")).body.data.message;
    await send(alice, chat.id, "findme visible");
    await alice.del(`/api/messages/${deleted.id}`);
    await bob.del(`/api/messages/${hidden.id}?scope=me`);

    const bodies = (await search(bob, "q=findme&type=messages")).body.data.items.map((h: { message: { body: string } }) => h.message.body);
    expect(bodies).toEqual(["findme visible"]);

    // Group history starts at the join date.
    const carol = await signUp();
    const group = (await alice.post("/api/groups", { name: "Team", memberIds: [bob.user.id] })).body.data.chat;
    await send(alice, group.id, "findme before carol");
    await alice.post(`/api/groups/${group.id}/members`, { userIds: [carol.user.id] });
    await send(alice, group.id, "findme after carol");
    const carolHits = (await search(carol, "q=findme&type=messages")).body.data.items.map((h: { message: { body: string } }) => h.message.body);
    expect(carolHits).toEqual(["findme after carol"]);
  });

  it("rejects a too-short query", async () => {
    const { alice } = await pair();
    expect((await search(alice, "q=a&type=messages")).status).toBe(400);
  });
});

describe("chat and user search", () => {
  it("matches group names and the other person, and only among the caller's chats", async () => {
    const { alice, bob, chat } = await pair();
    await send(alice, chat.id, "hi");
    const group = (await alice.post("/api/groups", { name: "Weekend Hikers", memberIds: [bob.user.id] })).body.data.chat;

    const chats = (await search(alice, "q=hikers&type=chats")).body.data.items;
    expect(chats.map((c: { id: string }) => c.id)).toEqual([group.id]);

    const eve = await signUp();
    expect((await search(eve, "q=hikers&type=chats")).body.data.items).toEqual([]);
  });

  it("finds users by username", async () => {
    const { alice, bob } = await pair();
    const hits = (await search(alice, `q=${bob.user.username}&type=users`)).body.data.items;
    expect(hits.map((u: { id: string }) => u.id)).toContain(bob.user.id);
  });
});
