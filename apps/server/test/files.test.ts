import { describe, expect, it } from "vitest";
import { User } from "../src/models/User";
import { signUp } from "./helpers";

type U = Awaited<ReturnType<typeof signUp>>;

// 1×1 PNG
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const PDF = Buffer.from("%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n");

let n = 0;
const cid = () => `file-client-${Date.now()}-${++n}`;

async function pair() {
  const alice = await signUp();
  const bob = await signUp();
  const chat = (await alice.post("/api/chats/direct", { userId: bob.user.id })).body.data.chat as { id: string };
  return { alice, bob, chat };
}

function upload(u: U, bytes: Buffer, type: string, query: Record<string, string>) {
  const qs = new URLSearchParams({ name: "file", ...query }).toString();
  return u.agent.post(`/api/files?${qs}`).set("X-Requested-With", "chatapp").set("Content-Type", type).send(bytes);
}
const uploadTo = (u: U, chatId: string, bytes = PNG, type = "image/png", kind = "image", name = "photo.png") =>
  upload(u, bytes, type, { purpose: "attachment", kind, chatId, name });

describe("uploading", () => {
  it("accepts allowed files and rejects spoofed or disallowed types", async () => {
    const { alice, chat } = await pair();
    const ok = await uploadTo(alice, chat.id);
    expect(ok.status).toBe(201);
    expect(ok.body.data.file).toMatchObject({ kind: "image", mime: "image/png", size: PNG.length, name: "photo.png" });

    // Text pretending to be a PNG.
    expect((await uploadTo(alice, chat.id, Buffer.from("<html><script>alert(1)</script>"), "image/png")).status).toBe(415);
    // SVG is never allowed (it can carry script).
    expect((await uploadTo(alice, chat.id, Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"), "image/svg+xml")).status).toBe(415);
    // A PDF can't be sent as an image.
    expect((await uploadTo(alice, chat.id, PDF, "application/pdf", "image")).status).toBe(415);
    expect((await uploadTo(alice, chat.id, PDF, "application/pdf", "file", "notes.pdf")).status).toBe(201);
    // Path tricks in the name are neutralised.
    const sneaky = await uploadTo(alice, chat.id, PNG, "image/png", "image", "../../etc/passwd");
    expect(sneaky.body.data.file.name).not.toContain("/");
  });

  it("requires membership of the target chat", async () => {
    const { chat } = await pair();
    const eve = await signUp();
    expect((await uploadTo(eve, chat.id)).status).toBe(404);
  });

  it("enforces the per-user storage quota", async () => {
    const { alice, chat } = await pair();
    await User.updateOne({ _id: alice.user.id }, { $set: { storageUsedBytes: 100 * 1024 * 1024 - 10 } });
    const res = await uploadTo(alice, chat.id);
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe("QUOTA_EXCEEDED");
  });
});

describe("sending attachments", () => {
  it("attaches uploads to a message (type/size taken from the stored file) and previews them", async () => {
    const { alice, bob, chat } = await pair();
    const file = (await uploadTo(alice, chat.id)).body.data.file;
    const res = await alice.post(`/api/chats/${chat.id}/messages`, {
      clientId: cid(),
      attachments: [{ fileId: file.id, width: 1, height: 1, placeholder: "data:image/jpeg;base64,AAAA" }],
    });
    expect(res.status).toBe(201);
    const msg = res.body.data.message;
    expect(msg.type).toBe("image");
    expect(msg.attachments[0]).toMatchObject({ id: file.id, kind: "image", mime: "image/png", size: PNG.length, url: `/api/files/${file.id}`, width: 1 });
    expect((await bob.get("/api/chats")).body.data.items[0].lastMessage.preview).toBe("📷 Photo");
  });

  it("won't attach a file twice, someone else's file, or a file from another chat", async () => {
    const { alice, bob, chat } = await pair();
    const other = await pair();
    const file = (await uploadTo(alice, chat.id)).body.data.file;
    await alice.post(`/api/chats/${chat.id}/messages`, { clientId: cid(), attachments: [{ fileId: file.id }] });
    expect((await alice.post(`/api/chats/${chat.id}/messages`, { clientId: cid(), attachments: [{ fileId: file.id }] })).status).toBe(400);

    const bobs = (await uploadTo(bob, chat.id)).body.data.file;
    expect((await alice.post(`/api/chats/${chat.id}/messages`, { clientId: cid(), attachments: [{ fileId: bobs.id }] })).status).toBe(400);

    const elsewhere = (await uploadTo(other.alice, other.chat.id)).body.data.file;
    expect((await other.alice.post(`/api/chats/${chat.id}/messages`, { clientId: cid(), attachments: [{ fileId: elsewhere.id }] })).status).toBe(404);
  });

  it("rejects empty messages and bogus placeholders", async () => {
    const { alice, chat } = await pair();
    expect((await alice.post(`/api/chats/${chat.id}/messages`, { clientId: cid() })).status).toBe(400);
    const file = (await uploadTo(alice, chat.id)).body.data.file;
    const bad = await alice.post(`/api/chats/${chat.id}/messages`, {
      clientId: cid(),
      attachments: [{ fileId: file.id, placeholder: "javascript:alert(1)" }],
    });
    expect(bad.status).toBe(400);
  });
});

describe("downloading", () => {
  it("serves members with safe headers, supports ranges and caching, and hides files from everyone else", async () => {
    const { alice, bob, chat } = await pair();
    const eve = await signUp();
    const file = (await uploadTo(alice, chat.id, PDF, "application/pdf", "file", "notes.pdf")).body.data.file;

    // Before sending: only the uploader can fetch it.
    expect((await bob.get(`/api/files/${file.id}`)).status).toBe(404);
    expect((await alice.get(`/api/files/${file.id}`)).status).toBe(200);

    await alice.post(`/api/chats/${chat.id}/messages`, { clientId: cid(), attachments: [{ fileId: file.id }] });
    const res = await bob.get(`/api/files/${file.id}`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/pdf");
    expect(res.headers["content-disposition"]).toMatch(/^attachment; filename="notes\.pdf"/);
    expect(res.headers["content-security-policy"]).toContain("sandbox");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");

    const partial = await bob.get(`/api/files/${file.id}`).set("Range", "bytes=0-3").buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on("data", (c: Buffer) => chunks.push(c));
      r.on("end", () => cb(null, Buffer.concat(chunks)));
    });
    expect(partial.status).toBe(206);
    expect(partial.headers["content-range"]).toBe(`bytes 0-3/${PDF.length}`);
    expect((partial.body as Buffer).toString()).toBe("%PDF");
    expect((await bob.get(`/api/files/${file.id}`).set("Range", "bytes=9999-")).status).toBe(416);
    expect((await bob.get(`/api/files/${file.id}`).set("If-None-Match", `"${file.id}"`)).status).toBe(304);

    expect((await eve.get(`/api/files/${file.id}`)).status).toBe(404);
  });

  it("deleting a message for everyone deletes its files and refunds quota", async () => {
    const { alice, bob, chat } = await pair();
    const file = (await uploadTo(alice, chat.id)).body.data.file;
    const msg = (await alice.post(`/api/chats/${chat.id}/messages`, { clientId: cid(), attachments: [{ fileId: file.id }] })).body.data.message;
    expect((await User.findById(alice.user.id))?.storageUsedBytes).toBe(PNG.length);

    await alice.del(`/api/messages/${msg.id}`);
    expect((await bob.get(`/api/files/${file.id}`)).status).toBe(404);
    expect((await User.findById(alice.user.id))?.storageUsedBytes).toBe(0);
  });
});

describe("profile and group photos", () => {
  it("sets and replaces a profile photo, visible to other signed-in users", async () => {
    const { alice, bob } = await pair();
    const first = (await upload(alice, PNG, "image/png", { purpose: "avatar", kind: "image" })).body.data.file;
    const me = (await alice.put("/api/users/me/avatar", { fileId: first.id })).body.data.user;
    expect(me.avatarUrl).toBe(`/api/files/${first.id}`);
    expect((await bob.get(`/api/files/${first.id}`)).status).toBe(200);

    const second = (await upload(alice, PNG, "image/png", { purpose: "avatar", kind: "image" })).body.data.file;
    await alice.put("/api/users/me/avatar", { fileId: second.id });
    expect((await bob.get(`/api/files/${first.id}`)).status).toBe(404); // old photo deleted
    expect((await alice.put("/api/users/me/avatar", { fileId: null })).body.data.user.avatarUrl).toBeNull();
  });

  it("group photos follow the edit-info permission", async () => {
    const [owner, member] = [await signUp(), await signUp()];
    const chat = (await owner.post("/api/groups", { name: "Photo club", memberIds: [member.user.id] })).body.data.chat;
    const photo = (await upload(member, PNG, "image/png", { purpose: "avatar", kind: "image" })).body.data.file;
    expect((await member.put(`/api/groups/${chat.id}/avatar`, { fileId: photo.id })).status).toBe(403);
    const mine = (await upload(owner, PNG, "image/png", { purpose: "avatar", kind: "image" })).body.data.file;
    const res = await owner.put(`/api/groups/${chat.id}/avatar`, { fileId: mine.id });
    expect(res.body.data.group.avatarUrl).toBe(`/api/files/${mine.id}`);
    const events = (await member.get(`/api/chats/${chat.id}/messages`)).body.data.items.map((m: { system?: { event: string } }) => m.system?.event);
    expect(events).toContain("photo_changed");
  });
});
