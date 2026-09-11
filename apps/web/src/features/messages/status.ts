import type { Receipt } from "@chat/shared";

export type DeliveryStatus = "sending" | "failed" | "sent" | "delivered" | "read";

// ObjectIds are fixed-length hex with a leading timestamp, so string order is creation order.
const reached = (pointer: string | null | undefined, id: string) => Boolean(pointer && pointer >= id);

/** Status of one of *my* messages: read/delivered once every other member has reached it. */
export function statusOf(messageId: string, receipts: Receipt[]): Exclude<DeliveryStatus, "sending" | "failed"> {
  if (receipts.length === 0) return "sent";
  if (receipts.every((r) => reached(r.readId, messageId))) return "read";
  if (receipts.every((r) => reached(r.deliveredId, messageId))) return "delivered";
  return "sent";
}
