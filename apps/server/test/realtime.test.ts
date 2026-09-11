import http from "node:http";
import type { AddressInfo } from "node:net";
import { io as connect, type Socket } from "socket.io-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRealtime } from "../src/realtime";
import { setIo } from "../src/realtime/bus";
import { app, signUp } from "./helpers";

let server: http.Server;
let url: string;
const sockets: Socket[] = [];

beforeAll(async () => {
  server = http.createServer(app);
  createRealtime(server);
  await new Promise<void>((r) => server.listen(0, r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  sockets.forEach((s) => s.disconnect());
  setIo(null);
  await new Promise((r) => server.close(r));
});

type User = Awaited<ReturnType<typeof signUp>>;

async function socketFor(u: User) {
  const { ticket } = (await u.post("/api/auth/socket-ticket")).body.data;
  const s = connect(url, { auth: { ticket }, transports: ["websocket"], reconnection: false });
  sockets.push(s);
  await new Promise<void>((resolve, reject) => {
    s.once("connect", resolve);
    s.once("connect_error", reject);
  });
  return s;
}

const nextEvent = <T = unknown>(s: Socket, event: string, timeoutMs = 3000) =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), timeoutMs);
    s.once(event, (payload: T) => {
      clearTimeout(t);
      resolve(payload);
    });
  });

const noEvent = (s: Socket, event: string, ms = 400) =>
  new Promise<void>((resolve, reject) => {
    const handler = () => reject(new Error(`unexpected ${event}`));
    s.once(event, handler);
    setTimeout(() => {
      s.off(event, handler);
      resolve();
    }, ms);
  });

describe("socket authentication", () => {
  it("rejects missing, bogus and reused tickets", async () => {
    const attempt = (auth: object) =>
      new Promise<string>((resolve) => {
        const s = connect(url, { auth, transports: ["websocket"], reconnection: false });
        sockets.push(s);
        s.once("connect", () => resolve("connected"));
        s.once("connect_error", (e) => resolve(e.message));
      });
    expect(await attempt({})).toBe("UNAUTHENTICATED");
    expect(await attempt({ ticket: "x".repeat(43) })).toBe("UNAUTHENTICATED");

    const u = await signUp();
    const { ticket } = (await u.post("/api/auth/socket-ticket")).body.data;
    expect(await attempt({ ticket })).toBe("connected");
    expect(await attempt({ ticket })).toBe("UNAUTHENTICATED");
  });
});

describe("live events", () => {
  it("delivers new messages to members only, and the delivery ack becomes a receipt", async () => {
    const alice = await signUp();
    const bob = await signUp();
    const eve = await signUp();
    const chat = (await alice.post("/api/chats/direct", { userId: bob.user.id })).body.data.chat;
    const [aSock, bSock, eSock] = await Promise.all([socketFor(alice), socketFor(bob), socketFor(eve)]);

    const bobGets = nextEvent<{ message: { id: string; body: string } }>(bSock, "message:new");
    const eveGetsNothing = noEvent(eSock, "message:new");
    const sent = (await alice.post(`/api/chats/${chat.id}/messages`, { clientId: "rt-client-0001", body: "live!" })).body.data.message;
    const { message } = await bobGets;
    expect(message).toMatchObject({ id: sent.id, body: "live!" });
    await eveGetsNothing;

    const receipt = nextEvent<{ userId: string; deliveredId: string }>(aSock, "receipt:updated");
    bSock.emit("message:delivered", { chatId: chat.id, messageId: sent.id });
    expect(await receipt).toMatchObject({ chatId: chat.id, userId: bob.user.id, deliveredId: sent.id });
  });

  it("relays typing only between members, ignoring forged chat ids", async () => {
    const alice = await signUp();
    const bob = await signUp();
    const eve = await signUp();
    const chat = (await alice.post("/api/chats/direct", { userId: bob.user.id })).body.data.chat;
    const [aSock, bSock, eSock] = await Promise.all([socketFor(alice), socketFor(bob), socketFor(eve)]);

    const bobSees = nextEvent(bSock, "typing");
    aSock.emit("typing", { chatId: chat.id, isTyping: true });
    expect(await bobSees).toEqual({ chatId: chat.id, userId: alice.user.id, isTyping: true });

    // Eve isn't a member: her typing must go nowhere.
    const silent = noEvent(bSock, "typing");
    eSock.emit("typing", { chatId: chat.id, isTyping: true });
    await silent;
  });

  it("broadcasts presence to contacts, respecting privacy", async () => {
    const alice = await signUp();
    const bob = await signUp();
    await alice.post("/api/chats/direct", { userId: bob.user.id });
    const aSock = await socketFor(alice);

    const online = nextEvent<{ userId: string; online: boolean }>(aSock, "presence");
    const bSock = await socketFor(bob);
    expect(await online).toMatchObject({ userId: bob.user.id, online: true });

    const offline = nextEvent<{ online: boolean; lastSeenAt: string }>(aSock, "presence");
    bSock.disconnect();
    expect(await offline).toMatchObject({ userId: bob.user.id, online: false, lastSeenAt: expect.any(String) });

    await bob.patch("/api/users/me/settings", { onlineVisibility: "nobody", lastSeenVisibility: "nobody" });
    const hidden = noEvent(aSock, "presence");
    const again = await socketFor(bob);
    await hidden;
    again.disconnect();
  });

  it("drops a user's sockets when they log out everywhere", async () => {
    const alice = await signUp();
    const s = await socketFor(alice);
    const dropped = nextEvent(s, "disconnect");
    await alice.post("/api/auth/logout-all");
    expect(await dropped).toBe("io server disconnect");
  });
});
