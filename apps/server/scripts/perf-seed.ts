/**
 * Seeds a throwaway database with a realistic worst case (100k messages / 500 chats) so the
 * hot queries can be profiled against something the indexes actually have to work for.
 *
 * Writes to its OWN database (PERF_DB, default "chatapp_perf") on the configured server and
 * drops it first — it never touches the development data.
 *
 *   npx tsx scripts/perf-seed.ts
 */
import argon2 from "argon2";
import mongoose, { Types } from "mongoose";
import "../src/models";
import { Conversation } from "../src/models/Conversation";
import { Member } from "../src/models/Member";
import { Message } from "../src/models/Message";
import { User } from "../src/models/User";
import { syncIndexes } from "../src/lib/db";

const URI = process.env.PERF_MONGODB_URI ?? "mongodb://127.0.0.1:27017";
const DB = process.env.PERF_DB ?? "chatapp_perf";

const TOTAL_MESSAGES = 100_000;
const TOTAL_CHATS = 500;
const PEERS = 60; // a direct chat needs a distinct peer, so this caps the direct chats
const GROUP_SIZE = 6;
const BATCH = 5_000;
/** Local throwaway credentials for the seeded account, so the app can be driven end to end. */
const PERF_PASSWORD = "correct horse battery";

const WORDS =
  "the quick brown fox jumps over a lazy dog meeting tomorrow morning coffee project deadline review invoice attached photos holiday flight booking confirmed thanks sounds good let me check calling later".split(
    " ",
  );
const pick = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)]!;
const sentence = () =>
  Array.from({ length: 3 + Math.floor(Math.random() * 14) }, () => pick(WORDS)).join(" ");

/**
 * ObjectIds must sort the same way createdAt does — pagination keysets on _id. Built as
 * timestamp + a global counter rather than with createFromTime, which zeroes the remaining
 * bytes and so collides whenever two chats have a message in the same second.
 */
let seq = 0;
const idAt = (date: Date) =>
  new Types.ObjectId(
    Math.floor(date.getTime() / 1000).toString(16).padStart(8, "0") + (seq++).toString(16).padStart(16, "0"),
  );

async function main() {
  const started = Date.now();
  await mongoose.connect(URI, { dbName: DB });
  await mongoose.connection.dropDatabase();
  await syncIndexes();
  console.log(`seeding ${DB} on ${URI.replace(/\/\/[^@]*@/, "//***@")}`);

  // ── users ──────────────────────────────────────────────────────────────
  const me = new Types.ObjectId();
  const peerIds = Array.from({ length: PEERS }, () => new Types.ObjectId());
  // A real hash, so the seeded account can actually sign in for an end-to-end timing run.
  // This is throwaway local test data — the password is not a secret.
  const passwordHash = await argon2.hash(PERF_PASSWORD, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2 });
  await User.collection.insertMany(
    [me, ...peerIds].map((_id, i) => ({
      _id,
      email: i === 0 ? "perf@example.com" : `perf${i}@example.com`,
      username: i === 0 ? "perf_me" : `perf_${i}`,
      displayName: i === 0 ? "Perf Me" : `Perf Peer ${i}`,
      passwordHash,
      role: "user",
      emailVerifiedAt: new Date(),
      bannedAt: null,
      lastSeenAt: new Date(),
      settings: { readReceipts: true },
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
  );

  // ── conversations + memberships ────────────────────────────────────────
  // Every chat has the focal user in it, so the chat list has all 500 rows to page through.
  const now = Date.now();
  const convs: { _id: Types.ObjectId; type: "direct" | "group"; lastMessageAt: Date }[] = [];
  const convDocs: object[] = [];
  const memberDocs: object[] = [];

  for (let i = 0; i < TOTAL_CHATS; i++) {
    const _id = new Types.ObjectId();
    const direct = i < PEERS;
    // Spread activity over the last ~200 days so keyset pagination sees distinct timestamps.
    const lastMessageAt = new Date(now - i * 36 * 60_000);
    convs.push({ _id, type: direct ? "direct" : "group", lastMessageAt });

    convDocs.push({
      _id,
      type: direct ? "direct" : "group",
      name: direct ? "" : `Group ${i}`,
      description: "",
      avatarFileId: null,
      permissions: { send: "all", addMembers: "admins", editInfo: "admins" },
      ...(direct ? { directKey: [String(me), String(peerIds[i])].sort().join(":") } : {}),
      memberCount: direct ? 2 : GROUP_SIZE,
      lastMessage: null,
      lastMessageAt,
      pinnedMessageIds: [],
      createdBy: me,
      createdAt: new Date(now - 200 * 86_400_000),
      updatedAt: lastMessageAt,
    });

    const others = direct
      ? [peerIds[i]!]
      : Array.from({ length: GROUP_SIZE - 1 }, (_, k) => peerIds[(i + k) % PEERS]!);
    const joinedAt = new Date(now - 200 * 86_400_000);
    memberDocs.push(
      {
        conversationId: _id,
        userId: me,
        role: direct ? "member" : "owner",
        lastDeliveredMessageId: null,
        lastReadMessageId: null,
        unreadCount: i % 7,
        mentionCount: 0,
        lastMessageAt,
        hidden: false,
        // A handful of pinned and archived rows, so those branches are profiled too.
        pinnedAt: i < 5 ? new Date(now - i * 1000) : null,
        archivedAt: i >= 480 ? new Date(now) : null,
        mutedUntil: null,
        leftAt: null,
        joinedAt,
      },
      ...others.map((userId) => ({
        conversationId: _id,
        userId,
        role: "member",
        lastDeliveredMessageId: null,
        lastReadMessageId: null,
        unreadCount: 0,
        mentionCount: 0,
        lastMessageAt,
        hidden: false,
        pinnedAt: null,
        archivedAt: null,
        mutedUntil: null,
        leftAt: null,
        joinedAt,
      })),
    );
  }
  await Conversation.collection.insertMany(convDocs);
  await Member.collection.insertMany(memberDocs);
  console.log(`  ${TOTAL_CHATS} chats, ${memberDocs.length} memberships`);

  // ── messages ───────────────────────────────────────────────────────────
  // Skewed the way real usage is: one very busy chat, a long tail of quiet ones. The busy
  // chat is what makes `listMessages` interesting — 20k messages to paginate through.
  const weights = convs.map((_, i) => (i === 0 ? 200 : i < 20 ? 20 : 1));
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const counts = weights.map((w) => Math.max(1, Math.round((w / totalWeight) * TOTAL_MESSAGES)));

  let written = 0;
  let batch: object[] = [];
  const flush = async () => {
    if (!batch.length) return;
    await Message.collection.insertMany(batch, { ordered: false });
    written += batch.length;
    batch = [];
    process.stdout.write(`\r  ${written} messages`);
  };

  for (const [ci, conv] of convs.entries()) {
    const n = counts[ci]!;
    const members = memberDocs
      .filter((m) => String((m as { conversationId: Types.ObjectId }).conversationId) === String(conv._id))
      .map((m) => (m as { userId: Types.ObjectId }).userId);
    for (let k = 0; k < n; k++) {
      // Oldest first, ending at the chat's lastMessageAt.
      const createdAt = new Date(conv.lastMessageAt.getTime() - (n - k) * 60_000);
      const senderId = pick(members);
      const withFile = k % 25 === 0;
      batch.push({
        _id: idAt(createdAt),
        conversationId: conv._id,
        senderId,
        clientId: `${ci}-${k}`,
        type: "text",
        body: sentence(),
        mentions: [],
        replyTo: null,
        forwarded: false,
        system: null,
        attachments: withFile
          ? [
              {
                fileId: new Types.ObjectId(),
                kind: "image",
                mime: "image/webp",
                size: 12345,
                name: `holiday-photo-${k}.webp`,
                thumbFileId: null,
              },
            ]
          : [],
        reactions: [],
        hiddenFor: [],
        editedAt: null,
        deletedAt: null,
        createdAt,
      });
      if (batch.length >= BATCH) await flush();
    }
  }
  await flush();
  console.log();

  // The chat list reads the denormalized snapshot, so it has to be present to be realistic.
  for (const conv of convs) {
    const last = await Message.findOne({ conversationId: conv._id }).sort({ _id: -1 }).lean();
    if (!last) continue;
    await Conversation.collection.updateOne(
      { _id: conv._id },
      {
        $set: {
          lastMessage: {
            messageId: last._id,
            senderId: last.senderId,
            preview: last.body.slice(0, 200),
            type: "text",
            createdAt: last.createdAt,
          },
        },
      },
    );
  }

  console.log(`  focal user: ${me}`);
  console.log(`  busiest chat: ${convs[0]!._id} (${counts[0]} messages)`);
  console.log(`done in ${((Date.now() - started) / 1000).toFixed(1)}s`);

  // Handed to the explain script so it profiles the same ids.
  await mongoose.connection.collection("perf_meta").insertOne({
    userId: me,
    hotChatId: convs[0]!._id,
    groupChatId: convs[PEERS]!._id,
  });
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
