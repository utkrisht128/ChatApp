import { describe, expect, it } from "vitest";
import { signUp } from "./helpers";

type U = Awaited<ReturnType<typeof signUp>>;
let n = 0;
const cid = () => `grp-client-${Date.now()}-${++n}`;

async function group(owner: U, members: U[], extra: object = {}) {
  const res = await owner.post("/api/groups", { name: "Weekend trip", memberIds: members.map((m) => m.user.id), ...extra });
  expect(res.status).toBe(201);
  return res.body.data.chat as { id: string; type: string; name: string; memberCount: number; role: string };
}
const send = (u: U, chatId: string, body: string) => u.post(`/api/chats/${chatId}/messages`, { clientId: cid(), body });
const messages = async (u: U, chatId: string) => (await u.get(`/api/chats/${chatId}/messages`)).body.data.items as { type: string; body: string; system: { event: string } | null }[];

describe("creating groups", () => {
  it("creates the group with the creator as owner and posts a system event that doesn't count as unread", async () => {
    const [owner, a, b] = [await signUp(), await signUp(), await signUp()];
    const chat = await group(owner, [a, b, a]);
    expect(chat).toMatchObject({ type: "group", name: "Weekend trip", memberCount: 3, role: "owner" });

    const aList = (await a.get("/api/chats")).body.data.items;
    expect(aList[0]).toMatchObject({ id: chat.id, role: "member", unreadCount: 0, lastMessage: { type: "system" } });
    expect(aList[0].lastMessage.preview).toMatch(/created the group “Weekend trip”/);

    const info = (await a.get(`/api/groups/${chat.id}`)).body.data.group;
    expect(info.members.map((m: { role: string }) => m.role)).toEqual(["owner", "member", "member"]);
    expect(info.permissions).toEqual({ send: "all", addMembers: "admins", editInfo: "admins" });
    expect((await messages(a, chat.id))[0]?.system?.event).toBe("group_created");
  });

  it("validates input and hides groups from non-members", async () => {
    const owner = await signUp();
    const eve = await signUp();
    expect((await owner.post("/api/groups", { name: " ", memberIds: [eve.user.id] })).status).toBe(400);
    expect((await owner.post("/api/groups", { name: "Solo", memberIds: [owner.user.id] })).status).toBe(400);
    expect((await owner.post("/api/groups", { name: "Ghost", memberIds: ["0123456789abcdef01234567"] })).status).toBe(400);
    const chat = await group(owner, [await signUp()]);
    expect((await eve.get(`/api/groups/${chat.id}`)).status).toBe(404);
    expect((await eve.post(`/api/groups/${chat.id}/members`, { userIds: [eve.user.id] })).status).toBe(404);
  });
});

describe("permissions", () => {
  it("members can't edit info or settings until allowed; admins can", async () => {
    const [owner, a] = [await signUp(), await signUp()];
    const chat = await group(owner, [a]);
    expect((await a.patch(`/api/groups/${chat.id}`, { name: "Hijacked" })).status).toBe(403);
    expect((await a.patch(`/api/groups/${chat.id}`, { permissions: { editInfo: "all" } })).status).toBe(403);

    const renamed = await owner.patch(`/api/groups/${chat.id}`, { name: "Road trip", permissions: { editInfo: "all" } });
    expect(renamed.body.data.group).toMatchObject({ name: "Road trip", permissions: { editInfo: "all" } });
    expect((await a.patch(`/api/groups/${chat.id}`, { description: "Bring snacks" })).status).toBe(200);
    const events = (await messages(a, chat.id)).map((m) => m.system?.event);
    expect(events).toEqual(["group_created", "renamed", "permissions_changed", "description_changed"]);
  });

  it("send=admins blocks members from posting", async () => {
    const [owner, a] = [await signUp(), await signUp()];
    const chat = await group(owner, [a]);
    await owner.patch(`/api/groups/${chat.id}`, { permissions: { send: "admins" } });
    expect((await send(a, chat.id, "hello?")).status).toBe(403);
    expect((await send(owner, chat.id, "announcement")).status).toBe(201);
  });

  it("enforces the role hierarchy for promoting, demoting and removing", async () => {
    const [owner, admin, admin2, member] = [await signUp(), await signUp(), await signUp(), await signUp()];
    const chat = await group(owner, [admin, admin2, member]);
    expect((await member.patch(`/api/groups/${chat.id}/members/${admin.user.id}`, { role: "admin" })).status).toBe(403);
    await owner.patch(`/api/groups/${chat.id}/members/${admin.user.id}`, { role: "admin" });
    // An admin can promote members…
    expect((await admin.patch(`/api/groups/${chat.id}/members/${admin2.user.id}`, { role: "admin" })).status).toBe(200);
    // …but not demote or remove other admins, and nobody can touch the owner.
    expect((await admin.patch(`/api/groups/${chat.id}/members/${admin2.user.id}`, { role: "member" })).status).toBe(403);
    expect((await admin.del(`/api/groups/${chat.id}/members/${admin2.user.id}`)).status).toBe(403);
    expect((await admin.del(`/api/groups/${chat.id}/members/${owner.user.id}`)).status).toBe(403);
    expect((await admin.patch(`/api/groups/${chat.id}/members/${owner.user.id}`, { role: "member" })).status).toBe(403);
    // Admins can remove ordinary members; the owner can remove admins.
    expect((await admin.del(`/api/groups/${chat.id}/members/${member.user.id}`)).status).toBe(200);
    expect((await owner.del(`/api/groups/${chat.id}/members/${admin2.user.id}`)).status).toBe(200);
  });
});

describe("membership changes", () => {
  it("new members only see history from when they joined", async () => {
    const [owner, a, late] = [await signUp(), await signUp(), await signUp()];
    const chat = await group(owner, [a]);
    await send(owner, chat.id, "before you joined");
    await owner.post(`/api/groups/${chat.id}/members`, { userIds: [late.user.id] });
    await send(a, chat.id, "welcome!");
    const seen = (await messages(late, chat.id)).map((m) => m.body || m.system?.event);
    expect(seen).not.toContain("before you joined");
    expect(seen.at(-1)).toBe("welcome!");
    expect((await late.get(`/api/groups/${chat.id}`)).body.data.group.memberCount).toBe(3);
  });

  it("members can only add people when the group allows it", async () => {
    const [owner, a, c] = [await signUp(), await signUp(), await signUp()];
    const chat = await group(owner, [a]);
    expect((await a.post(`/api/groups/${chat.id}/members`, { userIds: [c.user.id] })).status).toBe(403);
    await owner.patch(`/api/groups/${chat.id}`, { permissions: { addMembers: "all" } });
    expect((await a.post(`/api/groups/${chat.id}/members`, { userIds: [c.user.id] })).status).toBe(200);
  });

  it("removed members lose access immediately", async () => {
    const [owner, a] = [await signUp(), await signUp()];
    const chat = await group(owner, [a]);
    await owner.del(`/api/groups/${chat.id}/members/${a.user.id}`);
    expect((await a.get(`/api/chats/${chat.id}/messages`)).status).toBe(404);
    expect((await send(a, chat.id, "still here?")).status).toBe(404);
    expect((await a.get("/api/chats")).body.data.items).toHaveLength(0);
  });

  it("when the owner leaves, the longest-serving admin takes over", async () => {
    const [owner, a, b] = [await signUp(), await signUp(), await signUp()];
    const chat = await group(owner, [a, b]);
    await owner.patch(`/api/groups/${chat.id}/members/${b.user.id}`, { role: "admin" });
    expect((await owner.post(`/api/groups/${chat.id}/leave`)).status).toBe(204);
    const info = (await a.get(`/api/groups/${chat.id}`)).body.data.group;
    const roles = Object.fromEntries(info.members.filter((m: { active: boolean }) => m.active).map((m: { user: { id: string }; role: string }) => [m.user.id, m.role]));
    expect(roles).toEqual({ [b.user.id]: "owner", [a.user.id]: "member" });
    expect(info.memberCount).toBe(2);
    expect((await messages(a, chat.id)).at(-1)?.system?.event).toBe("member_left");
  });

  it("system events can't be reacted to or deleted for everyone", async () => {
    const [owner, a] = [await signUp(), await signUp()];
    const chat = await group(owner, [a]);
    const items = (await owner.get(`/api/chats/${chat.id}/messages`)).body.data.items;
    const sys = items[0].id;
    expect((await a.put(`/api/messages/${sys}/reaction`, { emoji: "👍" })).status).toBe(400);
    expect((await owner.del(`/api/messages/${sys}`)).status).toBe(400);
  });
});
