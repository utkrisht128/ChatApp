import { sameId, type Id } from "../../lib/ids";
import { Block } from "../../models/Block";

/**
 * Block lookups, kept apart from the moderation service so that chats, messages and users
 * can enforce blocking without importing a module that imports them back.
 */

/** True if either person blocks the other. Blocking cuts both ways for contact. */
export async function blockExists(a: Id, b: Id): Promise<boolean> {
  if (sameId(a, b)) return false;
  return Boolean(
    await Block.exists({
      $or: [
        { blockerId: a, blockedId: b },
        { blockerId: b, blockedId: a },
      ],
    }),
  );
}

/** Of `ids`, those who block the viewer or are blocked by them. */
export async function blockedPeerIds(viewerId: Id, ids: Id[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const blocks = await Block.find({
    $or: [
      { blockerId: viewerId, blockedId: { $in: ids } },
      { blockedId: viewerId, blockerId: { $in: ids } },
    ],
  })
    .select("blockerId blockedId")
    .lean();
  const viewer = String(viewerId);
  return new Set(blocks.map((b) => (String(b.blockerId) === viewer ? String(b.blockedId) : String(b.blockerId))));
}
