import { describe, expect, it } from "vitest";
import { PushSubscription } from "../src/models/PushSubscription";
import { client, signUp } from "./helpers";

const subscription = (endpoint: string) => ({ endpoint, keys: { p256dh: "BNc-fake-p256dh-key", auth: "fake-auth" } });

describe("push subscriptions", () => {
  it("reports whether push is configured", async () => {
    const alice = await signUp();
    const res = await alice.get("/api/push/key");
    expect(res.status).toBe(200);
    // No VAPID keys in the test environment, so the feature reports itself as unavailable.
    expect(res.body.data).toHaveProperty("key", null);
  });

  it("stores one subscription per endpoint and removes it on unsubscribe", async () => {
    const alice = await signUp();
    const endpoint = `https://push.example.com/${Date.now()}`;

    expect((await alice.post("/api/push/subscribe", subscription(endpoint))).status).toBe(204);
    expect(await PushSubscription.countDocuments({ userId: alice.user.id })).toBe(1);

    // Re-subscribing with the same endpoint updates rather than duplicating.
    expect((await alice.post("/api/push/subscribe", subscription(endpoint))).status).toBe(204);
    expect(await PushSubscription.countDocuments({ userId: alice.user.id })).toBe(1);

    // A second device is its own subscription.
    await alice.post("/api/push/subscribe", subscription(`${endpoint}-phone`));
    expect(await PushSubscription.countDocuments({ userId: alice.user.id })).toBe(2);

    expect((await alice.post("/api/push/unsubscribe", { endpoint })).status).toBe(204);
    expect(await PushSubscription.countDocuments({ userId: alice.user.id })).toBe(1);
  });

  it("only lets you remove your own subscription", async () => {
    const alice = await signUp();
    const bob = await signUp();
    const endpoint = `https://push.example.com/private-${Date.now()}`;
    await alice.post("/api/push/subscribe", subscription(endpoint));

    expect((await bob.post("/api/push/unsubscribe", { endpoint })).status).toBe(204);
    // Bob's request was accepted but changed nothing of Alice's.
    expect(await PushSubscription.countDocuments({ userId: alice.user.id })).toBe(1);
  });

  it("requires authentication and a well-formed subscription", async () => {
    const anon = client();
    expect((await anon.post("/api/push/subscribe", subscription("https://push.example.com/x"))).status).toBe(401);

    const alice = await signUp();
    expect((await alice.post("/api/push/subscribe", { endpoint: "https://push.example.com/y" })).status).toBe(400);
    expect((await alice.post("/api/push/subscribe", { endpoint: "", keys: { p256dh: "a", auth: "b" } })).status).toBe(400);
    expect((await alice.post("/api/push/unsubscribe", {})).status).toBe(400);
  });
});
