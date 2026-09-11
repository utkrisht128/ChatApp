import { describe, expect, it } from "vitest";
import { Member } from "../src/models/Member";
import { signUp } from "./helpers";

describe("direct chats", () => {
  it("is idempotent — concurrent opens produce one chat", async () => {
    const alice = await signUp();
    const bob = await signUp();
    const results = await Promise.all([1, 2, 3].map(() => alice.post("/api/chats/direct", { userId: bob.user.id })));
    const ids = new Set(results.map((r) => r.body.data.chat.id));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(ids.size).toBe(1);
    const chat = results[0]!.body.data.chat;
    expect(chat).toMatchObject({ type: "direct", name: bob.user.username, memberCount: 2, unreadCount: 0 });
    expect(chat.peer.id).toBe(bob.user.id);
  });

  it("stays hidden from the recipient until a message arrives", async () => {
    const alice = await signUp();
    const bob = await signUp();
    await alice.post("/api/chats/direct", { userId: bob.user.id });
    expect((await alice.get("/api/chats")).body.data.items).toHaveLength(1);
    expect((await bob.get("/api/chats")).body.data.items).toHaveLength(0);
  });

  it("rejects chatting with yourself or unknown users", async () => {
    const alice = await signUp();
    expect((await alice.post("/api/chats/direct", { userId: alice.user.id })).status).toBe(400);
    expect((await alice.post("/api/chats/direct", { userId: "0123456789abcdef01234567" })).status).toBe(404);
    expect((await alice.post("/api/chats/direct", { userId: { $gt: "" } })).status).toBe(400);
  });

  it("returns 404 (not 403) to non-members", async () => {
    const alice = await signUp();
    const bob = await signUp();
    const eve = await signUp();
    const { id } = (await alice.post("/api/chats/direct", { userId: bob.user.id })).body.data.chat;
    for (const res of [
      await eve.get(`/api/chats/${id}`),
      await eve.patch(`/api/chats/${id}/membership`, { pinned: true }),
      await eve.get("/api/chats/not-an-id"),
    ]) {
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("CHAT_NOT_FOUND");
    }
  });

  it("requires authentication", async () => {
    const { client } = await import("./helpers");
    expect((await client().get("/api/chats")).status).toBe(401);
  });
});

describe("chat list preferences", () => {
  it("pins, archives and mutes per user", async () => {
    const alice = await signUp();
    const bob = await signUp();
    const carol = await signUp();
    const a = (await alice.post("/api/chats/direct", { userId: bob.user.id })).body.data.chat;
    const b = (await alice.post("/api/chats/direct", { userId: carol.user.id })).body.data.chat;

    await alice.patch(`/api/chats/${a.id}/membership`, { pinned: true });
    let list = (await alice.get("/api/chats")).body.data.items;
    expect(list[0].id).toBe(a.id);
    expect(list[0].pinned).toBe(true);

    const until = new Date(Date.now() + 3_600_000).toISOString();
    const muted = await alice.patch(`/api/chats/${b.id}/membership`, { mutedUntil: until });
    expect(muted.body.data.chat.mutedUntil).toBeTruthy();

    await alice.patch(`/api/chats/${a.id}/membership`, { archived: true });
    list = (await alice.get("/api/chats")).body.data.items;
    expect(list.map((c: { id: string }) => c.id)).toEqual([b.id]);
    const archived = (await alice.get("/api/chats?archived=true")).body.data.items;
    expect(archived).toHaveLength(1);
    expect(archived[0]).toMatchObject({ id: a.id, archived: true, pinned: false });
  });

  it("caps the number of pinned chats", async () => {
    const alice = await signUp();
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) {
      const other = await signUp();
      ids.push((await alice.post("/api/chats/direct", { userId: other.user.id })).body.data.chat.id);
    }
    for (const id of ids.slice(0, 5)) expect((await alice.patch(`/api/chats/${id}/membership`, { pinned: true })).status).toBe(200);
    expect((await alice.patch(`/api/chats/${ids[5]}/membership`, { pinned: true })).status).toBe(400);
  });

  it("paginates with a stable cursor", async () => {
    const alice = await signUp();
    for (let i = 0; i < 32; i++) {
      const other = await signUp();
      await alice.post("/api/chats/direct", { userId: other.user.id });
    }
    // Give every chat a distinct activity time.
    const members = await Member.find({ userId: alice.user.id });
    await Promise.all(members.map((m, i) => Member.updateOne({ _id: m._id }, { lastMessageAt: new Date(Date.now() - i * 1000) })));

    const first = (await alice.get("/api/chats")).body.data;
    expect(first.items).toHaveLength(30);
    expect(first.nextCursor).toBeTruthy();
    const second = (await alice.get(`/api/chats?cursor=${encodeURIComponent(first.nextCursor)}`)).body.data;
    expect(second.items).toHaveLength(2);
    expect(second.nextCursor).toBeNull();
    const all = [...first.items, ...second.items].map((c: { id: string }) => c.id);
    expect(new Set(all).size).toBe(32);
  });
});

describe("users", () => {
  it("searches by username prefix or display name, excluding yourself, safely escaping regex", async () => {
    const alice = await signUp({ username: "alice_w" });
    await signUp({ username: "alicia" });
    await signUp({ username: "bob" });
    const res = await alice.get("/api/users/search?q=ali");
    expect(res.body.data.items.map((u: { username: string }) => u.username)).toEqual(["alicia"]);
    expect((await alice.get("/api/users/search?q=.*")).body.data.items).toEqual([]);
    expect(JSON.stringify(res.body)).not.toMatch(/email/);
  });

  it("updates profile and settings partially, enforcing unique usernames", async () => {
    const alice = await signUp();
    await signUp({ username: "taken_name" });
    expect((await alice.patch("/api/users/me", { username: "Taken_Name" })).status).toBe(409);

    const profile = await alice.patch("/api/users/me", { displayName: "Alice W", bio: "hello" });
    expect(profile.body.data.user).toMatchObject({ displayName: "Alice W", bio: "hello" });

    const s = await alice.patch("/api/users/me/settings", { theme: "dark", notifications: { sounds: undefined, mentions: false } });
    expect(s.body.data.user.settings).toMatchObject({ theme: "dark", readReceipts: true, notifications: { mentions: false, messages: true } });
    expect((await alice.patch("/api/users/me/settings", { theme: "neon" })).status).toBe(400);
    expect((await alice.patch("/api/users/me", { role: "admin" })).status).toBe(400);
  });

  it("hides presence according to privacy settings", async () => {
    const alice = await signUp();
    const bob = await signUp();
    await bob.patch("/api/users/me/settings", { lastSeenVisibility: "nobody", onlineVisibility: "contacts" });
    let profile = (await alice.get(`/api/users/${bob.user.username}`)).body.data.user;
    expect(profile).not.toHaveProperty("lastSeenAt");
    expect(profile).not.toHaveProperty("online");

    await alice.post("/api/chats/direct", { userId: bob.user.id });
    profile = (await alice.get(`/api/users/${bob.user.username}`)).body.data.user;
    expect(profile).toHaveProperty("online", false);
    expect(profile).not.toHaveProperty("lastSeenAt");
  });
});
