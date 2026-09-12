/**
 * The authorization matrix: every route crossed with the callers who must not reach it.
 * Where a route hides a resource's existence it answers 404; where the caller may know it
 * exists but not do the thing, it answers 403.
 */
import { describe, expect, it } from "vitest";
import { User } from "../src/models/User";
import { client, signUp } from "./helpers";

type U = Awaited<ReturnType<typeof signUp>>;
type Call = (c: U) => Promise<{ status: number }>;

let n = 0;
const cid = () => `authz-${Date.now()}-${++n}`;
const OID = "507f1f77bcf86cd799439011"; // syntactically valid, belongs to nobody

/** A world with a direct chat, a group, a message and a file, plus outsiders. */
async function world() {
  const alice = await signUp();
  const bob = await signUp();
  const eve = await signUp();

  const chat = (await alice.post("/api/chats/direct", { userId: bob.user.id })).body.data.chat;
  const msg = (await alice.post(`/api/chats/${chat.id}/messages`, { clientId: cid(), body: "hello" })).body.data.message;
  const group = (await alice.post("/api/groups", { name: "Crew", memberIds: [bob.user.id] })).body.data.chat;
  return { alice, bob, eve, chat, group, msg };
}

/* ── 1. Unauthenticated callers ─────────────────────────────────────────── */

describe("every protected route rejects an unauthenticated caller", () => {
  const routes: [string, Call][] = [
    ["GET /auth/me", (c) => c.get("/api/auth/me")],
    ["POST /auth/logout-all", (c) => c.post("/api/auth/logout-all")],
    ["POST /auth/resend-verification", (c) => c.post("/api/auth/resend-verification")],
    ["POST /auth/change-password", (c) => c.post("/api/auth/change-password", { currentPassword: "x", newPassword: "yyyyyyyy" })],
    ["POST /auth/socket-ticket", (c) => c.post("/api/auth/socket-ticket")],
    ["GET /users/search", (c) => c.get("/api/users/search?q=ab")],
    ["GET /users/blocked", (c) => c.get("/api/users/blocked")],
    ["PUT /users/:id/blocked", (c) => c.put(`/api/users/${OID}/blocked`, { blocked: true })],
    ["PATCH /users/me", (c) => c.patch("/api/users/me", { displayName: "x" })],
    ["PATCH /users/me/settings", (c) => c.patch("/api/users/me/settings", { sounds: false })],
    ["PUT /users/me/avatar", (c) => c.put("/api/users/me/avatar", { fileId: null })],
    ["GET /users/:username", (c) => c.get("/api/users/someone")],
    ["GET /chats", (c) => c.get("/api/chats")],
    ["POST /chats/direct", (c) => c.post("/api/chats/direct", { userId: OID })],
    ["GET /chats/:id", (c) => c.get(`/api/chats/${OID}`)],
    ["PATCH /chats/:id/membership", (c) => c.patch(`/api/chats/${OID}/membership`, { pinned: true })],
    ["GET /chats/:id/messages", (c) => c.get(`/api/chats/${OID}/messages`)],
    ["POST /chats/:id/messages", (c) => c.post(`/api/chats/${OID}/messages`, { clientId: cid(), body: "hi" })],
    ["POST /chats/:id/read", (c) => c.post(`/api/chats/${OID}/read`, { messageId: OID })],
    ["GET /chats/:id/pinned", (c) => c.get(`/api/chats/${OID}/pinned`)],
    ["GET /messages/starred", (c) => c.get("/api/messages/starred")],
    ["POST /messages/:id/forward", (c) => c.post(`/api/messages/${OID}/forward`, { targets: [{ chatId: OID, clientId: cid() }] })],
    ["PUT /messages/:id/pinned", (c) => c.put(`/api/messages/${OID}/pinned`, { pinned: true })],
    ["PUT /messages/:id/starred", (c) => c.put(`/api/messages/${OID}/starred`, { starred: true })],
    ["PATCH /messages/:id", (c) => c.patch(`/api/messages/${OID}`, { body: "x" })],
    ["DELETE /messages/:id", (c) => c.del(`/api/messages/${OID}`)],
    ["PUT /messages/:id/reaction", (c) => c.put(`/api/messages/${OID}/reaction`, { emoji: "👍" })],
    ["POST /groups", (c) => c.post("/api/groups", { name: "x", memberIds: [OID] })],
    ["GET /groups/:id", (c) => c.get(`/api/groups/${OID}`)],
    ["PATCH /groups/:id", (c) => c.patch(`/api/groups/${OID}`, { name: "x" })],
    ["PUT /groups/:id/avatar", (c) => c.put(`/api/groups/${OID}/avatar`, { fileId: null })],
    ["POST /groups/:id/members", (c) => c.post(`/api/groups/${OID}/members`, { userIds: [OID] })],
    ["DELETE /groups/:id/members/:uid", (c) => c.del(`/api/groups/${OID}/members/${OID}`)],
    ["PATCH /groups/:id/members/:uid", (c) => c.patch(`/api/groups/${OID}/members/${OID}`, { role: "admin" })],
    ["POST /groups/:id/leave", (c) => c.post(`/api/groups/${OID}/leave`)],
    ["GET /files/:id", (c) => c.get(`/api/files/${OID}`)],
    ["DELETE /files/:id", (c) => c.del(`/api/files/${OID}`)],
    ["GET /search", (c) => c.get("/api/search?q=ab")],
    ["POST /reports", (c) => c.post("/api/reports", { subject: "user", targetId: OID, reason: "spam" })],
    ["GET /push/key", (c) => c.get("/api/push/key")],
    ["POST /push/subscribe", (c) => c.post("/api/push/subscribe", { endpoint: "https://e.example/x", keys: { p256dh: "a", auth: "b" } })],
    ["POST /push/unsubscribe", (c) => c.post("/api/push/unsubscribe", { endpoint: "https://e.example/x" })],
    ["GET /admin/stats", (c) => c.get("/api/admin/stats")],
    ["GET /admin/users", (c) => c.get("/api/admin/users")],
    ["GET /admin/reports", (c) => c.get("/api/admin/reports")],
  ];

  it.each(routes)("%s → 401", async (_name, call) => {
    const anon = client() as unknown as U;
    expect((await call(anon)).status).toBe(401);
  });
});

/* ── 2. Signed in, but not a member of the chat ─────────────────────────── */

describe("chat-scoped routes hide themselves from non-members (404, never 403)", () => {
  it("refuses every chat, message and group route", async () => {
    const { eve, chat, group, msg } = await world();
    const calls: [string, Call][] = [
      ["GET /chats/:id", (c) => c.get(`/api/chats/${chat.id}`)],
      ["PATCH /chats/:id/membership", (c) => c.patch(`/api/chats/${chat.id}/membership`, { pinned: true })],
      ["GET /chats/:id/messages", (c) => c.get(`/api/chats/${chat.id}/messages`)],
      ["POST /chats/:id/messages", (c) => c.post(`/api/chats/${chat.id}/messages`, { clientId: cid(), body: "intruding" })],
      ["POST /chats/:id/read", (c) => c.post(`/api/chats/${chat.id}/read`, { messageId: msg.id })],
      ["GET /chats/:id/pinned", (c) => c.get(`/api/chats/${chat.id}/pinned`)],
      ["PATCH /messages/:id", (c) => c.patch(`/api/messages/${msg.id}`, { body: "hacked" })],
      ["DELETE /messages/:id", (c) => c.del(`/api/messages/${msg.id}`)],
      ["DELETE /messages/:id?scope=me", (c) => c.del(`/api/messages/${msg.id}?scope=me`)],
      ["PUT /messages/:id/reaction", (c) => c.put(`/api/messages/${msg.id}/reaction`, { emoji: "👍" })],
      ["PUT /messages/:id/pinned", (c) => c.put(`/api/messages/${msg.id}/pinned`, { pinned: true })],
      ["PUT /messages/:id/starred", (c) => c.put(`/api/messages/${msg.id}/starred`, { starred: true })],
      ["POST /messages/:id/forward", (c) => c.post(`/api/messages/${msg.id}/forward`, { targets: [{ chatId: chat.id, clientId: cid() }] })],
      ["GET /groups/:id", (c) => c.get(`/api/groups/${group.id}`)],
      ["PATCH /groups/:id", (c) => c.patch(`/api/groups/${group.id}`, { name: "mine now" })],
      ["PUT /groups/:id/avatar", (c) => c.put(`/api/groups/${group.id}/avatar`, { fileId: null })],
      ["POST /groups/:id/members", (c) => c.post(`/api/groups/${group.id}/members`, { userIds: [OID] })],
      ["DELETE /groups/:id/members/:uid", (c) => c.del(`/api/groups/${group.id}/members/${OID}`)],
      ["PATCH /groups/:id/members/:uid", (c) => c.patch(`/api/groups/${group.id}/members/${OID}`, { role: "admin" })],
      ["POST /groups/:id/leave", (c) => c.post(`/api/groups/${group.id}/leave`)],
    ];

    for (const [name, call] of calls) {
      const res = await call(eve);
      expect({ name, status: res.status }).toEqual({ name, status: 404 });
    }
  });

  it("doesn't leak a chat's existence through search or the chat list", async () => {
    const { eve, chat } = await world();
    expect((await eve.get("/api/chats")).body.data.items).toEqual([]);
    expect((await eve.get(`/api/search?q=hello&type=messages`)).body.data.items).toEqual([]);
    expect((await eve.get(`/api/search?q=hello&type=messages&chatId=${chat.id}`)).status).toBe(404);
  });
});

/* ── 3. A member, but not the owner of the thing ────────────────────────── */

describe("membership is not ownership", () => {
  it("a member can't edit or delete-for-everyone someone else's message", async () => {
    const { bob, msg } = await world();
    expect((await bob.patch(`/api/messages/${msg.id}`, { body: "not mine" })).status).toBe(403);
    expect((await bob.del(`/api/messages/${msg.id}`)).status).toBe(403);
    // But they may hide it for themselves, and react to it.
    expect((await bob.put(`/api/messages/${msg.id}/reaction`, { emoji: "👍" })).status).toBe(200);
    expect((await bob.del(`/api/messages/${msg.id}?scope=me`)).status).toBe(204);
  });

  it("a plain group member can't perform admin actions", async () => {
    const { alice, bob, group } = await world();
    const carol = await signUp();
    // Default permissions: only admins may add members or edit info.
    expect((await bob.patch(`/api/groups/${group.id}`, { name: "renamed by member" })).status).toBe(403);
    expect((await bob.put(`/api/groups/${group.id}/avatar`, { fileId: null })).status).toBe(403);
    expect((await bob.post(`/api/groups/${group.id}/members`, { userIds: [carol.user.id] })).status).toBe(403);
    expect((await bob.patch(`/api/groups/${group.id}/members/${alice.user.id}`, { role: "member" })).status).toBe(403);
    expect((await bob.del(`/api/groups/${group.id}/members/${alice.user.id}`)).status).toBe(403);
    // The owner can.
    expect((await alice.post(`/api/groups/${group.id}/members`, { userIds: [carol.user.id] })).status).toBe(200);
  });

  it("an admin can't remove the owner, and the owner can't be demoted by anyone else", async () => {
    const { alice, bob, group } = await world();
    await alice.patch(`/api/groups/${group.id}/members/${bob.user.id}`, { role: "admin" });
    expect((await bob.del(`/api/groups/${group.id}/members/${alice.user.id}`)).status).toBe(403);
    expect((await bob.patch(`/api/groups/${group.id}/members/${alice.user.id}`, { role: "member" })).status).toBe(403);
  });
});

/* ── 4. Blocked and banned ──────────────────────────────────────────────── */

describe("blocked and banned callers", () => {
  it("a blocked pair can't message either way, but existing history stays readable", async () => {
    const { alice, bob, chat } = await world();
    await bob.put(`/api/users/${alice.user.id}/blocked`, { blocked: true });

    expect((await alice.post(`/api/chats/${chat.id}/messages`, { clientId: cid(), body: "hi" })).status).toBe(403);
    expect((await bob.post(`/api/chats/${chat.id}/messages`, { clientId: cid(), body: "hi" })).status).toBe(403);
    // Blocking is not deletion: both sides keep what was already said.
    expect((await alice.get(`/api/chats/${chat.id}/messages`)).body.data.items.length).toBeGreaterThan(0);
    expect((await bob.get(`/api/chats/${chat.id}/messages`)).body.data.items.length).toBeGreaterThan(0);
  });

  it("a banned user's existing session is dead on every route", async () => {
    const { alice, chat } = await world();
    await User.updateOne({ _id: alice.user.id }, { $set: { bannedAt: new Date() } });

    for (const call of [
      () => alice.get("/api/auth/me"),
      () => alice.get("/api/chats"),
      () => alice.get(`/api/chats/${chat.id}/messages`),
      () => alice.post(`/api/chats/${chat.id}/messages`, { clientId: cid(), body: "still here?" }),
      () => alice.get("/api/search?q=hello"),
      () => alice.post("/api/auth/socket-ticket"),
    ]) {
      expect((await call()).status).toBe(401);
    }
  });

  it("a banned user can't obtain a new session either", async () => {
    const target = await signUp();
    await User.updateOne({ _id: target.user.id }, { $set: { bannedAt: new Date() } });
    const res = await client().post("/api/auth/login", { identifier: target.creds.username, password: target.creds.password });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("ACCOUNT_BANNED");
  });
});

/* ── 5. Cross-tenant identifiers ────────────────────────────────────────── */

describe("identifiers from one chat are useless in another", () => {
  it("won't act on a message or file belonging to a different conversation", async () => {
    const a = await world();
    const b = await world();

    // b.alice is a real user with real chats, but not a member of a's chat.
    expect((await b.alice.patch(`/api/messages/${a.msg.id}`, { body: "x" })).status).toBe(404);
    expect((await b.alice.post(`/api/chats/${a.chat.id}/read`, { messageId: a.msg.id })).status).toBe(404);
    // A read marker for a message outside the chat is refused even for a member.
    expect((await a.bob.post(`/api/chats/${a.chat.id}/read`, { messageId: b.msg.id })).status).toBe(404);
    // Forwarding into a chat you don't belong to.
    expect(
      (await a.alice.post(`/api/messages/${a.msg.id}/forward`, { targets: [{ chatId: b.chat.id, clientId: cid() }] })).status,
    ).toBe(404);
  });

  it("rejects malformed identifiers without leaking anything", async () => {
    const { alice } = await world();
    for (const bad of ["not-an-id", "../../etc/passwd", "%00", "null"]) {
      const res = await alice.get(`/api/chats/${encodeURIComponent(bad)}`);
      expect([400, 404]).toContain(res.status);
      expect(JSON.stringify(res.body)).not.toMatch(/stack|mongo|Cast/i);
    }
  });
});
