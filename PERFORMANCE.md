# Performance (Phase 7)

Every number here was produced by running the code, not by reading it. The harness seeds a
throwaway database and drives the **production build** in a real browser:

- `apps/server/scripts/perf-seed.ts` — seeds **99,841 messages / 500 chats / 2,760 memberships**
  into its own database (`chatapp_perf`), never the development data. Busiest chat: 18,868 messages.
- `apps/server/scripts/perf-explain.ts` — `executionStats` for each hot query, plus timings of the
  real exported service functions (hand-copied query shapes drift; the service calls can't).

**Result: both exit criteria met.** Chat opens in **145 ms** (budget 300 ms) and initial JS is
**199.6 KB gzip** (budget ~200 KB). Two changes I wrote for this phase were **measured, found
useless or harmful, and reverted** — see §4.

---

## 1. Queries at 100k messages

| Query | Time | docs examined / row returned | Plan |
|---|---|---|---|
| Chat list, first page | 0 ms | 1.0× | `IXSCAN` |
| Chat list, page 11 (keyset) | 1 ms | 1.0× | `IXSCAN` — deep paging costs the same as page 1 |
| History, newest page (18.8k-message chat) | 0 ms | 1.0× | `IXSCAN` |
| History, group (joined-at filter) | 0 ms | 1.0× | `IXSCAN` |
| **Message search, common word** | **~800 ms** | **1993×** | text index + in-memory sort |
| Message search, rare word | 5 ms | — | text index |
| File search by name | 48 ms | 24× | `IXSCAN {_id:1}` |

The chat-list and history indexes are doing exactly what they were designed for: a 1.0× ratio
means the index did all the work, and the keyset pagination means page 11 costs what page 1 does.

**Message search is the one genuinely expensive query.** A text index cannot be prefixed by
`conversationId` (a `$in` is not an equality match), so the visibility scope can't narrow the index
scan. Searching a common word matches 25,911 messages; MongoDB materialises **51,822 documents**,
applies the scope, and sorts by `_id` in memory — to return 26. Scoping the search to a single chat
does not help, for the same reason.

This is a property of MongoDB text indexes, not of the query. Fixing it properly needs an engine
that filters and ranks together (Atlas Search, or a dedicated search service). It is left as a
known limit, documented in `modules/search/service.ts`, rather than papered over.

## 2. The frontend, on the production build

Measured over the real bundle with the API proxied first-party, as in production.

| | Before | After |
|---|---|---|
| Open a chat, warm cache | 164 ms | **145 ms** (budget 300) |
| Rows retained after scrolling back 10 pages | 850 | **300** |
| Scroll frame cost at that depth | 56 ms/frame (~18 fps) | **30 ms/frame** |
| Initial JS | 223.1 KB gz | **199.6 KB gz** (budget ~200) |
| 3G + 4× CPU, cold load | 5.4 s | 5.0 s |
| 3G + 4× CPU, open chat (warm) | 2.4 s | 2.5 s |

A sampling profile of the scroll attributes **~33% to `(program)`** — browser layout and paint —
and under 12% to application JavaScript. The frame cost is laying rows out, not React work, which
is why capping the number of retained rows helped and further JS tuning would not have.

### What changed

1. **`maxPages: 6` on the message history query.** Scrolling back otherwise keeps every page
   mounted forever. Pages scrolled past are refetched if the user returns, which is cheap
   (`staleTime: Infinity` plus the HTTP cache).
2. **The chat-list dialogs and search panel load on demand** — `SearchPanel`, `StarredDialog`,
   `NewChatDialog`, `NewGroupDialog`. They pulled uploads, media handling and the message cache
   into first paint. A small hook keeps each mounted after its first open so it still animates closed.
3. **socket.io loads after sign-in, not before it.** It is ~13 KB gz of the entry and is useless on
   the sign-in screen. `connectSocket()` is now async; `useRealtime` handles teardown that happens
   before the library arrives.
4. **`"sideEffects": false` on `@chat/shared`.** The package is pure, but without the declaration the
   bundler must assume the barrel (`export *` over 11 modules) has side effects and keeps all of it.

## 3. Why the last ~23 KB is zod, and why it stays

zod now sits in its own eagerly-loaded `schemas` chunk (23 KB gz). It is on the critical path
because a few *runtime* values — `summarizeMessage`, `MIN_SEARCH_LENGTH`, `ALLOWED_MIME`,
`DEFAULT_MAX_UPLOAD_BYTES` — live in shared modules that also define schemas, and the chat list
imports them. Everything else the shell takes from `@chat/shared` is type-only and costs nothing.

Moving those few constants into zod-free modules would drop the chunk from first paint. It is not
done here because the budget is already met, and the change touches the package every other module
depends on. It is the obvious next lever if the budget tightens.

## 4. Two changes that were reverted

Both were written, measured, and removed. They are recorded because the measurement is the useful
part — without it, either would have looked like an improvement in review.

1. **Ranking message search by `textScore` before ordering newest-first.** Intended to bound the
   work with a candidate cap. Measured: the real service call went from **807 ms to 1227 ms**. The
   `$match` still fetches every match before anything can be capped, so the cap saved nothing and
   the extra sort cost 50% more. Reverted to the original query.
2. **An index on `attachments.name`.** File search matches it with an unanchored, case-insensitive
   regex, which no b-tree index can serve. Measured: the planner ignored it and still walked `_id`
   (627 docs examined, unchanged). It would have cost write throughput and disk for nothing.
   Reverted, with a comment in `models/Message.ts` recording why the obvious index is absent.

## 5. Reproducing

```bash
# Seeds chatapp_perf (drops and recreates it; never touches the dev database)
cd apps/server && npx tsx --env-file=.env scripts/perf-seed.ts
npx tsx --env-file=.env scripts/perf-explain.ts
```

The seeded account is `perf@example.com`, with a throwaway local password set in the script, so the
app can be driven end to end against the seeded data.
