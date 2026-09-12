import { describe, expect, it } from "vitest";
import { User } from "../src/models/User";
import { client, signUp } from "./helpers";

type U = Awaited<ReturnType<typeof signUp>>;

let n = 0;
const cid = () => `admin-client-${Date.now()}-${++n}`;

/** Admin is normally granted by verifying an ADMIN_EMAILS address; set it directly here. */
async function admin() {
  const u = await signUp();
  await User.updateOne({ _id: u.user.id }, { $set: { role: "admin", emailVerifiedAt: new Date() } });
  return u;
}

const ADMIN_ROUTES: [string, (u: U) => Promise<{ status: number }>][] = [
  ["GET /admin/stats", (u) => u.get("/api/admin/stats")],
  ["GET /admin/users", (u) => u.get("/api/admin/users")],
  ["GET /admin/reports", (u) => u.get("/api/admin/reports")],
  ["PUT /admin/users/:id/ban", (u) => u.put(`/api/admin/users/${u.user.id}/ban`, { banned: true })],
  ["PUT /admin/users/:id/role", (u) => u.put(`/api/admin/users/${u.user.id}/role`, { role: "admin" })],
  ["PUT /admin/reports/:id", (u) => u.put(`/api/admin/reports/507f1f77bcf86cd799439011`, { status: "reviewed" })],
];

describe("admin authorization", () => {
  it("hides every admin route from ordinary users with 404, not 403", async () => {
    const user = await signUp();
    for (const [name, call] of ADMIN_ROUTES) {
      const res = await call(user);
      expect({ name, status: res.status }).toEqual({ name, status: 404 });
    }
  });

  it("requires authentication", async () => {
    const anon = client();
    expect((await anon.get("/api/admin/stats")).status).toBe(401);
    expect((await anon.get("/api/admin/users")).status).toBe(401);
  });

  it("lets an admin through", async () => {
    const boss = await admin();
    expect((await boss.get("/api/admin/stats")).status).toBe(200);
    expect((await boss.get("/api/admin/users")).status).toBe(200);
  });

  it("stops being available the moment the role is removed", async () => {
    const boss = await admin();
    expect((await boss.get("/api/admin/stats")).status).toBe(200);
    await User.updateOne({ _id: boss.user.id }, { $set: { role: "user" } });
    expect((await boss.get("/api/admin/stats")).status).toBe(404);
  });
});

describe("user management", () => {
  it("bans an account, ejects it immediately and restores it on unban", async () => {
    const boss = await admin();
    const target = await signUp();
    expect((await target.get("/api/auth/me")).status).toBe(200);

    const res = await boss.put(`/api/admin/users/${target.user.id}/ban`, { banned: true, reason: "spam" });
    expect(res.status).toBe(200);
    expect(res.body.data.user).toMatchObject({ id: target.user.id, bannedAt: expect.any(String), banReason: "spam" });

    // The existing session is dead, and signing back in is refused.
    expect((await target.get("/api/auth/me")).status).toBe(401);
    const login = await client().post("/api/auth/login", { identifier: target.creds.username, password: target.creds.password });
    expect(login.status).toBe(403);
    expect(login.body.error.code).toBe("ACCOUNT_BANNED");

    await boss.put(`/api/admin/users/${target.user.id}/ban`, { banned: false });
    expect((await client().post("/api/auth/login", { identifier: target.creds.username, password: target.creds.password })).status).toBe(200);
  });

  it("won't let an admin ban or demote themselves, or ban another admin outright", async () => {
    const boss = await admin();
    const other = await admin();

    expect((await boss.put(`/api/admin/users/${boss.user.id}/ban`, { banned: true })).status).toBe(400);
    expect((await boss.put(`/api/admin/users/${boss.user.id}/role`, { role: "user" })).status).toBe(400);

    // An admin has to be demoted before they can be banned.
    expect((await boss.put(`/api/admin/users/${other.user.id}/ban`, { banned: true })).status).toBe(403);
    expect((await boss.put(`/api/admin/users/${other.user.id}/role`, { role: "user" })).status).toBe(200);
    expect((await boss.put(`/api/admin/users/${other.user.id}/ban`, { banned: true })).status).toBe(200);
  });

  it("only promotes people who have verified their email", async () => {
    const boss = await admin();
    const target = await signUp();
    const denied = await boss.put(`/api/admin/users/${target.user.id}/role`, { role: "admin" });
    expect(denied.status).toBe(400);

    await User.updateOne({ _id: target.user.id }, { $set: { emailVerifiedAt: new Date() } });
    expect((await boss.put(`/api/admin/users/${target.user.id}/role`, { role: "admin" })).body.data.user.role).toBe("admin");
  });

  it("searches and filters, and exposes fields ordinary users never see", async () => {
    const boss = await admin();
    const target = await signUp();
    await boss.put(`/api/admin/users/${target.user.id}/ban`, { banned: true, reason: "abuse" });

    const found = (await boss.get(`/api/admin/users?q=${target.user.username}`)).body.data.items;
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ email: target.creds.email, banReason: "abuse" });

    const bannedOnly = (await boss.get("/api/admin/users?filter=banned")).body.data.items;
    expect(bannedOnly.map((u: { id: string }) => u.id)).toContain(target.user.id);
    const adminsOnly = (await boss.get("/api/admin/users?filter=admins")).body.data.items;
    expect(adminsOnly.every((u: { role: string }) => u.role === "admin")).toBe(true);
  });
});

describe("reports queue", () => {
  async function reported() {
    const boss = await admin();
    const alice = await signUp();
    const bob = await signUp();
    const chat = (await alice.post("/api/chats/direct", { userId: bob.user.id })).body.data.chat;
    const msg = (await alice.post(`/api/chats/${chat.id}/messages`, { clientId: cid(), body: "buy my coins" })).body.data.message;
    await bob.post("/api/reports", { subject: "message", targetId: msg.id, reason: "spam", note: "scam" });
    return { boss, alice, bob, chat, msg };
  }

  it("lists open reports with both people and the snapshotted text", async () => {
    const { boss, alice, bob, msg } = await reported();
    const items = (await boss.get("/api/admin/reports?status=open")).body.data.items;
    const hit = items.find((r: { targetId: string }) => r.targetId === msg.id);
    expect(hit).toMatchObject({
      subject: "message",
      reason: "spam",
      note: "scam",
      snapshot: "buy my coins",
      status: "open",
      reporter: { id: bob.user.id },
      targetUser: { id: alice.user.id, email: alice.creds.email },
    });
  });

  it("resolves a report and can remove the reported message for everyone", async () => {
    const { boss, alice, bob, chat, msg } = await reported();
    const reportId = (await boss.get("/api/admin/reports?status=open")).body.data.items.find(
      (r: { targetId: string }) => r.targetId === msg.id,
    ).id;

    const res = await boss.put(`/api/admin/reports/${reportId}`, { status: "actioned", removeMessage: true });
    expect(res.status).toBe(200);
    expect(res.body.data.report).toMatchObject({ status: "actioned", reviewedAt: expect.any(String) });

    // Removed for both people, not just the reporter.
    for (const who of [alice, bob]) {
      const items = (await who.get(`/api/chats/${chat.id}/messages`)).body.data.items;
      expect(items.find((m: { id: string }) => m.id === msg.id)).toMatchObject({ body: "", deletedAt: expect.any(String) });
    }
    expect((await boss.get("/api/admin/reports?status=open")).body.data.items.map((r: { id: string }) => r.id)).not.toContain(reportId);
  });

  it("rejects removal for a user report and unknown report ids", async () => {
    const boss = await admin();
    const alice = await signUp();
    const bob = await signUp();
    await bob.post("/api/reports", { subject: "user", targetId: alice.user.id, reason: "harassment" });
    const reportId = (await boss.get("/api/admin/reports?status=open")).body.data.items[0].id;

    expect((await boss.put(`/api/admin/reports/${reportId}`, { status: "actioned", removeMessage: true })).status).toBe(400);
    expect((await boss.put("/api/admin/reports/507f1f77bcf86cd799439011", { status: "reviewed" })).status).toBe(404);
    expect((await boss.put(`/api/admin/reports/${reportId}`, { status: "nonsense" })).status).toBe(400);
  });
});

describe("stats", () => {
  it("counts users, messages, chats and open reports", async () => {
    const boss = await admin();
    const alice = await signUp();
    const chat = (await alice.post("/api/chats/direct", { userId: boss.user.id })).body.data.chat;
    await alice.post(`/api/chats/${chat.id}/messages`, { clientId: cid(), body: "hello" });

    const { stats } = (await boss.get("/api/admin/stats")).body.data;
    expect(stats.users.total).toBeGreaterThanOrEqual(2);
    expect(stats.users.admins).toBeGreaterThanOrEqual(1);
    expect(stats.messages.total).toBeGreaterThanOrEqual(1);
    expect(stats.messages.today).toBeGreaterThanOrEqual(1);
    expect(stats.chats.direct).toBeGreaterThanOrEqual(1);
    expect(typeof stats.storageBytes).toBe("number");
  });
});
