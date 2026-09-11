import { describe, expect, it, vi } from "vitest";
import { client, signUp } from "./helpers";

// Capture outgoing email so tests can follow verification/reset links.
const outbox = vi.hoisted(() => [] as { to: string; text: string }[]);
vi.mock("../src/lib/mailer", () => ({
  sendMail: async (mail: { to: string; text: string }) => void outbox.push(mail),
}));
const lastTokenFor = (email: string) => {
  const mail = [...outbox].reverse().find((m) => m.to === email);
  return mail?.text.match(/token=([\w-]+)/)?.[1];
};
const flush = () => new Promise((r) => setTimeout(r, 50)); // verification mail is fire-and-forget

describe("registration", () => {
  it("creates an account, sets an httpOnly session cookie and never returns the password hash", async () => {
    const c = client();
    const res = await c.post("/api/auth/register", {
      email: "  Alice@Example.com ",
      username: "Alice",
      password: "correct horse battery",
    });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user).toMatchObject({ email: "alice@example.com", username: "alice", emailVerified: false });
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);

    const cookie = res.headers["set-cookie"]?.[0] ?? "";
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);

    const me = await c.get("/api/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.data.user.username).toBe("alice");
  });

  it("rejects duplicate usernames and emails case-insensitively with field errors", async () => {
    await signUp({ email: "bob@example.com", username: "bob" });
    const res = await client().post("/api/auth/register", {
      email: "BOB@example.com",
      username: "BOB",
      password: "another password",
    });
    expect(res.status).toBe(409);
    expect(res.body.error.fields).toHaveProperty("email");
    expect(res.body.error.fields).toHaveProperty("username");
  });

  it("validates input and reports field-level errors", async () => {
    const res = await client().post("/api/auth/register", { email: "nope", username: "a!", password: "short" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(Object.keys(res.body.error.fields)).toEqual(expect.arrayContaining(["email", "username", "password"]));
  });

  it("rejects unknown fields (no mass assignment of role etc.)", async () => {
    const res = await client().post("/api/auth/register", {
      email: "mallory@example.com",
      username: "mallory",
      password: "correct horse battery",
      role: "admin",
    });
    expect(res.status).toBe(400);
  });
});

describe("login", () => {
  it("accepts username or email and rejects wrong passwords with a generic error", async () => {
    const { creds } = await signUp();
    expect((await client().post("/api/auth/login", { identifier: creds.username, password: creds.password })).status).toBe(200);
    expect((await client().post("/api/auth/login", { identifier: creds.email.toUpperCase(), password: creds.password })).status).toBe(200);

    const wrong = await client().post("/api/auth/login", { identifier: creds.username, password: "wrong password" });
    const missing = await client().post("/api/auth/login", { identifier: "ghost", password: "wrong password" });
    expect(wrong.status).toBe(401);
    expect(missing.status).toBe(401);
    expect(wrong.body.error).toEqual(missing.body.error); // no account enumeration
  });

  it("rejects NoSQL operator injection", async () => {
    await signUp();
    const res = await client().post("/api/auth/login", { identifier: { $ne: null }, password: { $ne: null } });
    expect(res.status).toBe(400);
  });
});

describe("sessions", () => {
  it("requires authentication for /me", async () => {
    const res = await client().get("/api/auth/me");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ success: false, error: expect.objectContaining({ code: "UNAUTHENTICATED" }) });
  });

  it("logout revokes the session server-side", async () => {
    const u = await signUp();
    const cookie = (await u.agent.get("/api/auth/me")).request.cookies;
    expect((await u.post("/api/auth/logout")).status).toBe(204);
    expect((await u.get("/api/auth/me")).status).toBe(401);
    // Replaying the old cookie must not work either.
    const replay = await client().agent.get("/api/auth/me").set("Cookie", cookie);
    expect(replay.status).toBe(401);
  });

  it("blocks state-changing requests without the CSRF header or from a foreign origin", async () => {
    const u = await signUp();
    expect((await u.agent.post("/api/auth/logout")).status).toBe(403);
    const foreign = await u.agent.post("/api/auth/logout").set("X-Requested-With", "chatapp").set("Origin", "https://evil.example");
    expect(foreign.status).toBe(403);
    expect(foreign.body.error.code).toBe("CSRF_REJECTED");
  });
});

describe("email verification and admin policy", () => {
  it("verifies email with a single-use token and only then grants admin to ADMIN_EMAILS", async () => {
    const u = await signUp({ email: "admin@example.com", username: "boss" });
    expect(u.user.role).toBe("user"); // not granted at signup — the address is unproven
    await flush();
    const token = lastTokenFor("admin@example.com");
    expect(token).toBeTruthy();

    expect((await client().post("/api/auth/verify-email", { token })).status).toBe(200);
    const me = await u.get("/api/auth/me");
    expect(me.body.data.user).toMatchObject({ emailVerified: true, role: "admin" });

    const reuse = await client().post("/api/auth/verify-email", { token });
    expect(reuse.status).toBe(400);
    expect(reuse.body.error.code).toBe("TOKEN_INVALID");
  });
});

describe("password reset", () => {
  it("does not reveal whether an account exists", async () => {
    const res = await client().post("/api/auth/forgot-password", { email: "nobody@example.com" });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ sent: true });
  });

  it("resets the password once, revokes every session and accepts the new password", async () => {
    const u = await signUp();
    await client().post("/api/auth/forgot-password", { email: u.creds.email });
    const token = lastTokenFor(u.creds.email);

    expect((await client().post("/api/auth/reset-password", { token, password: "a brand new password" })).status).toBe(200);
    expect((await u.get("/api/auth/me")).status).toBe(401);
    expect((await client().post("/api/auth/reset-password", { token, password: "another new password" })).status).toBe(400);

    const old = await client().post("/api/auth/login", { identifier: u.creds.username, password: u.creds.password });
    const fresh = await client().post("/api/auth/login", { identifier: u.creds.username, password: "a brand new password" });
    expect(old.status).toBe(401);
    expect(fresh.status).toBe(200);
  });

  it("change-password keeps the current session but revokes others", async () => {
    const u = await signUp();
    const other = client();
    await other.post("/api/auth/login", { identifier: u.creds.username, password: u.creds.password });

    const bad = await u.post("/api/auth/change-password", { currentPassword: "nope", newPassword: "whatever123" });
    expect(bad.status).toBe(400);
    const res = await u.post("/api/auth/change-password", { currentPassword: u.creds.password, newPassword: "a brand new password" });
    expect(res.status).toBe(200);
    expect((await u.get("/api/auth/me")).status).toBe(200);
    expect((await other.get("/api/auth/me")).status).toBe(401);
  });
});

describe("socket tickets", () => {
  it("are issued only to signed-in users and can be redeemed exactly once", async () => {
    expect((await client().post("/api/auth/socket-ticket")).status).toBe(401);
    const u = await signUp();
    const { ticket } = (await u.post("/api/auth/socket-ticket")).body.data;
    const { redeemSocketTicket } = await import("../src/modules/auth/service");
    expect((await redeemSocketTicket(ticket))?.username).toBe(u.user.username);
    expect(await redeemSocketTicket(ticket)).toBeNull();
  });
});

describe("error handling", () => {
  it("returns the standard envelope for unknown routes and malformed JSON", async () => {
    const missing = await client().get("/api/nope");
    expect(missing.status).toBe(404);
    expect(missing.body.success).toBe(false);

    const malformed = await client()
      .agent.post("/api/auth/login")
      .set("X-Requested-With", "chatapp")
      .set("Content-Type", "application/json")
      .send("{not json");
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe("BAD_REQUEST");
  });
});
