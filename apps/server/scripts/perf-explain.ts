/**
 * Runs the real hot queries against the seeded database with executionStats, so index choices
 * are measured rather than assumed. Reads the ids written by perf-seed.ts.
 *
 *   npx tsx scripts/perf-explain.ts
 *
 * The queries below mirror the shapes in chats/service.ts, messages/service.ts and
 * search/service.ts. If those change, change these too — a profile of a stale query shape
 * is worse than none.
 */
import mongoose, { Types } from "mongoose";
import "../src/models";
import { Member } from "../src/models/Member";
import { Message } from "../src/models/Message";
import { searchFiles, searchMessages } from "../src/modules/search/service";

const URI = process.env.PERF_MONGODB_URI ?? "mongodb://127.0.0.1:27017";
const DB = process.env.PERF_DB ?? "chatapp_perf";

type Explain = {
  executionStats: {
    nReturned: number;
    executionTimeMillis: number;
    totalKeysExamined: number;
    totalDocsExamined: number;
    executionStages: Record<string, unknown>;
  };
  queryPlanner: { winningPlan: Record<string, unknown> };
};

/** Walks the plan tree for the index actually chosen (or COLLSCAN). */
function planSummary(stage: Record<string, unknown> | undefined): string {
  if (!stage) return "?";
  const names: string[] = [];
  const walk = (s: Record<string, unknown> | undefined) => {
    if (!s) return;
    const type = s["stage"] as string | undefined;
    if (type === "IXSCAN") names.push(`IXSCAN ${JSON.stringify(s["keyPattern"])}`);
    else if (type === "COLLSCAN") names.push("COLLSCAN");
    else if (type === "TEXT_MATCH" || type === "TEXT") names.push(type);
    for (const key of ["inputStage", "shards"]) walk(s[key] as Record<string, unknown>);
    for (const child of (s["inputStages"] as Record<string, unknown>[]) ?? []) walk(child);
  };
  walk(stage);
  return names.length ? [...new Set(names)].join(" + ") : String(stage["stage"] ?? "?");
}

const rows: string[] = [];
async function profile(label: string, run: () => Promise<unknown>) {
  const ex = (await run()) as Explain;
  const s = ex.executionStats;
  const plan = planSummary(ex.queryPlanner.winningPlan);
  // Docs examined per document returned is the number that matters: 1.0 means the index did
  // all the work, high ratios mean the database is filtering in memory.
  const ratio = s.nReturned ? (s.totalDocsExamined / s.nReturned).toFixed(1) : "-";
  rows.push(
    [
      label.padEnd(38),
      `${s.executionTimeMillis}ms`.padStart(7),
      `ret ${s.nReturned}`.padStart(9),
      `keys ${s.totalKeysExamined}`.padStart(12),
      `docs ${s.totalDocsExamined}`.padStart(12),
      `${ratio}x`.padStart(8),
      plan,
    ].join("  "),
  );
}

async function main() {
  await mongoose.connect(URI, { dbName: DB });
  // Profile against the indexes the models declare now, not the ones that existed at seed time.
  await Message.createIndexes();
  const meta = await mongoose.connection
    .collection("perf_meta")
    .findOne<{ userId: Types.ObjectId; hotChatId: Types.ObjectId; groupChatId: Types.ObjectId }>({});
  if (!meta) throw new Error("No perf_meta — run scripts/perf-seed.ts first.");
  const { userId, hotChatId, groupChatId } = meta;

  const counts = {
    messages: await Message.estimatedDocumentCount(),
    members: await Member.estimatedDocumentCount(),
  };
  console.log(`${DB}: ${counts.messages} messages, ${counts.members} memberships\n`);

  /* ── chat list ──────────────────────────────────────────────────────── */
  const base = { userId, hidden: false, leftAt: null, archivedAt: null };

  await profile("chat list: pinned rows", () =>
    Member.find({ ...base, pinnedAt: { $ne: null } })
      .sort({ pinnedAt: -1 })
      .explain("executionStats"),
  );

  await profile("chat list: first page (30)", () =>
    Member.find({ ...base, pinnedAt: null })
      .sort({ lastMessageAt: -1, _id: -1 })
      .limit(31)
      .explain("executionStats"),
  );

  // Deep page: the keyset should make this cost the same as the first page.
  const deep = await Member.find({ ...base, pinnedAt: null })
    .sort({ lastMessageAt: -1, _id: -1 })
    .skip(300)
    .limit(1)
    .lean();
  const cursor = deep[0]!;
  await profile("chat list: page 11 (keyset)", () =>
    Member.find({
      ...base,
      pinnedAt: null,
      $or: [{ lastMessageAt: { $lt: cursor.lastMessageAt } }, { lastMessageAt: cursor.lastMessageAt, _id: { $lt: cursor._id } }],
    })
      .sort({ lastMessageAt: -1, _id: -1 })
      .limit(31)
      .explain("executionStats"),
  );

  /* ── message history ────────────────────────────────────────────────── */
  await profile("history: newest page, busy chat", () =>
    Message.find({ conversationId: hotChatId, hiddenFor: { $ne: userId } })
      .sort({ _id: -1 })
      .limit(51)
      .explain("executionStats"),
  );

  const old = await Message.find({ conversationId: hotChatId }).sort({ _id: 1 }).limit(1).lean();
  await profile("history: oldest page (deep cursor)", () =>
    Message.find({ conversationId: hotChatId, hiddenFor: { $ne: userId }, _id: { $lt: old[0]!._id } })
      .sort({ _id: -1 })
      .limit(51)
      .explain("executionStats"),
  );

  await profile("history: group (joinedAt filter)", () =>
    Message.find({ conversationId: groupChatId, hiddenFor: { $ne: userId }, createdAt: { $gte: new Date(0) } })
      .sort({ _id: -1 })
      .limit(51)
      .explain("executionStats"),
  );

  /* ── search ─────────────────────────────────────────────────────────── */
  // The real scope filter: one clause per group (for the join date) plus one $in for directs.
  const members = await Member.find({ userId, leftAt: null })
    .select("conversationId joinedAt")
    .sort({ lastMessageAt: -1 })
    .limit(300)
    .lean();
  const convTypes = new Map(
    (
      await mongoose.connection
        .collection("conversations")
        .find({ _id: { $in: members.map((m) => m.conversationId) } }, { projection: { type: 1 } })
        .toArray()
    ).map((c) => [String(c._id), c["type"] as string]),
  );
  const direct: Types.ObjectId[] = [];
  const groups: object[] = [];
  for (const m of members) {
    if (convTypes.get(String(m.conversationId)) === "group") groups.push({ conversationId: m.conversationId, createdAt: { $gte: m.joinedAt } });
    else direct.push(m.conversationId);
  }
  const visible = { $or: [...(direct.length ? [{ conversationId: { $in: direct } }] : []), ...groups], hiddenFor: { $ne: userId }, deletedAt: null };
  console.log(`search scope: ${direct.length} direct + ${groups.length} group clauses\n`);

  await profile("search messages: common word", () =>
    Message.find({ ...visible, type: { $ne: "system" }, $text: { $search: "meeting" } })
      .sort({ _id: -1 })
      .limit(26)
      .explain("executionStats"),
  );

  await profile("search messages: rare word", () =>
    Message.find({ ...visible, type: { $ne: "system" }, $text: { $search: "kumquat" } })
      .sort({ _id: -1 })
      .limit(26)
      .explain("executionStats"),
  );

  await profile("search messages: scoped to one chat", () =>
    Message.find({ conversationId: hotChatId, hiddenFor: { $ne: userId }, deletedAt: null, $text: { $search: "meeting" } })
      .sort({ _id: -1 })
      .limit(26)
      .explain("executionStats"),
  );

  await profile("search files: name regex", () =>
    Message.find({ ...visible, "attachments.name": { $regex: /holiday/i } })
      .sort({ _id: -1 })
      .limit(26)
      .explain("executionStats"),
  );

  console.log(
    ["query".padEnd(38), "time".padStart(7), "returned".padStart(9), "keys".padStart(12), "docs".padStart(12), "docs/ret".padStart(8), "plan"].join("  "),
  );
  console.log("-".repeat(140));
  console.log(rows.join("\n"));

  console.log("\nindexes on messages:");
  for (const i of await Message.collection.indexes()) console.log(`   ${i.name}`);

  /* ── the real service functions ─────────────────────────────────────── */
  // The shapes above are hand-written mirrors, which drift. These call the actual exported
  // functions, so what is reported is what the API serves.
  console.log("\nreal service calls (what the API actually runs):");
  const timeReal = async (label: string, run: () => Promise<{ items: unknown[] }>) => {
    const t0 = Date.now();
    const { items } = await run();
    console.log(`  ${label.padEnd(44)} ${String(Date.now() - t0).padStart(6)} ms   ${items.length} results`);
  };
  const query = (q: string, type: "messages" | "files", chatId?: string) => ({ q, type, ...(chatId ? { chatId } : {}) }) as never;
  await timeReal("searchMessages: common word", () => searchMessages(userId, query("meeting", "messages")));
  await timeReal("searchMessages: rare word", () => searchMessages(userId, query("kumquat", "messages")));
  await timeReal("searchMessages: scoped to one chat", () => searchMessages(userId, query("meeting", "messages", String(hotChatId))));
  await timeReal("searchFiles: name match", () => searchFiles(userId, query("holiday", "files")));

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
