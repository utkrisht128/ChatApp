import { describe, expect, it } from "vitest";
import { fetchHtml, isPublicAddress } from "../src/lib/safeFetch";
import { signUp } from "./helpers";

type U = Awaited<ReturnType<typeof signUp>>;

let n = 0;
const cid = () => `mod-client-${Date.now()}-${++n}`;

async function pair() {
  const alice = await signUp();
  const bob = await signUp();
  const chat = (await alice.post("/api/chats/direct", { userId: bob.user.id })).body.data.chat as { id: string };
  return { alice, bob, chat };
}
const send = (who: U, chatId: string, body: string) => who.post(`/api/chats/${chatId}/messages`, { clientId: cid(), body });

describe("blocking", () => {
  it("stops messages in both directions and lifts when unblocked", async () => {
    const { alice, bob, chat } = await pair();
    await send(alice, chat.id, "hello");

    expect((await bob.put(`/api/users/${alice.user.id}/blocked`, { blocked: true })).status).toBe(200);

    // Neither side can send once one of them has blocked the other.
    const blockedSend = await send(alice, chat.id, "are you there?");
    expect(blockedSend.status).toBe(403);
    expect(blockedSend.body.error.code).toBe("BLOCKED");
    expect((await send(bob, chat.id, "no thanks")).status).toBe(403);

    await bob.put(`/api/users/${alice.user.id}/blocked`, { blocked: false });
    expect((await send(alice, chat.id, "thanks")).status).toBe(201);
  });

  it("stops a blocked person starting a new chat", async () => {
    const alice = await signUp();
    const bob = await signUp();
    await bob.put(`/api/users/${alice.user.id}/blocked`, { blocked: true });
    expect((await alice.post("/api/chats/direct", { userId: bob.user.id })).status).toBe(403);
    expect((await bob.post("/api/chats/direct", { userId: alice.user.id })).status).toBe(403);
  });

  it("hides presence from a blocked person", async () => {
    const { alice, bob, chat } = await pair();
    await send(alice, chat.id, "hi");
    // Visible before the block.
    expect((await bob.get(`/api/users/${alice.user.username}`)).body.data.user).toHaveProperty("lastSeenAt");

    await bob.put(`/api/users/${alice.user.id}/blocked`, { blocked: true });
    const profile = (await bob.get(`/api/users/${alice.user.username}`)).body.data.user;
    expect(profile).not.toHaveProperty("online");
    expect(profile).not.toHaveProperty("lastSeenAt");
    const row = (await bob.get("/api/chats")).body.data.items.find((c: { id: string }) => c.id === chat.id);
    expect(row.peer).not.toHaveProperty("online");
  });

  it("lists who you blocked, and refuses blocking yourself", async () => {
    const { alice, bob } = await pair();
    expect((await alice.put(`/api/users/${alice.user.id}/blocked`, { blocked: true })).status).toBe(400);

    const res = await alice.put(`/api/users/${bob.user.id}/blocked`, { blocked: true });
    expect(res.body.data.users).toHaveLength(1);
    expect(res.body.data.users[0]).toMatchObject({ id: bob.user.id, blockedAt: expect.any(String) });
    // Blocking twice is a no-op.
    expect((await alice.put(`/api/users/${bob.user.id}/blocked`, { blocked: true })).body.data.users).toHaveLength(1);
    expect((await alice.get("/api/users/blocked")).body.data.users).toHaveLength(1);
    // The block is one-directional in the list: Bob hasn't blocked anyone.
    expect((await bob.get("/api/users/blocked")).body.data.users).toEqual([]);
  });
});

describe("reporting", () => {
  it("accepts a message report once, and refuses duplicates", async () => {
    const { alice, bob, chat } = await pair();
    const msg = (await send(alice, chat.id, "buy my coins")).body.data.message;

    expect((await bob.post("/api/reports", { subject: "message", targetId: msg.id, reason: "spam", note: "obvious scam" })).status).toBe(204);
    expect((await bob.post("/api/reports", { subject: "message", targetId: msg.id, reason: "spam" })).status).toBe(409);
  });

  it("refuses reports for messages you can't see, and for yourself", async () => {
    const { alice, chat } = await pair();
    const eve = await signUp();
    const msg = (await send(alice, chat.id, "private")).body.data.message;
    expect((await eve.post("/api/reports", { subject: "message", targetId: msg.id, reason: "spam" })).status).toBe(404);
    expect((await alice.post("/api/reports", { subject: "message", targetId: msg.id, reason: "spam" })).status).toBe(400);
    expect((await alice.post("/api/reports", { subject: "user", targetId: alice.user.id, reason: "spam" })).status).toBe(400);
  });

  it("validates the reason", async () => {
    const { alice, bob } = await pair();
    expect((await alice.post("/api/reports", { subject: "user", targetId: bob.user.id, reason: "because" })).status).toBe(400);
    expect((await alice.post("/api/reports", { subject: "user", targetId: bob.user.id, reason: "harassment" })).status).toBe(204);
  });
});

describe("link preview SSRF guards", () => {
  it("treats private, loopback, link-local and mapped addresses as unsafe", () => {
    for (const ip of ["127.0.0.1", "10.0.0.5", "192.168.1.1", "172.16.0.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "::", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) {
      expect({ ip, public: isPublicAddress(ip) }).toEqual({ ip, public: false });
    }
    for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:4700:4700::1111"]) {
      expect({ ip, public: isPublicAddress(ip) }).toEqual({ ip, public: true });
    }
  });

  it("refuses non-https schemes and hosts that resolve privately", async () => {
    // Rejected before any connection is attempted.
    expect(await fetchHtml("http://example.com")).toBeNull();
    expect(await fetchHtml("file:///etc/passwd")).toBeNull();
    expect(await fetchHtml("gopher://example.com")).toBeNull();
    expect(await fetchHtml("https://user:pass@example.com")).toBeNull();
    expect(await fetchHtml("not a url")).toBeNull();
    // Literal private addresses, and a hostname that resolves to one.
    expect(await fetchHtml("https://127.0.0.1/admin")).toBeNull();
    expect(await fetchHtml("https://169.254.169.254/latest/meta-data/")).toBeNull();
    expect(await fetchHtml("https://[::1]/")).toBeNull();
    expect(await fetchHtml("https://localhost/")).toBeNull();
  });
});
