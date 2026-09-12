import { Router } from "express";
import { pushSubscriptionSchema, pushUnsubscribeSchema } from "@chat/shared";
import { noContent, ok } from "../../lib/http";
import { authOf } from "../../middleware/auth";
import * as push from "./service";

export const pushRouter = Router();

/** The public VAPID key the browser needs to subscribe; null when push isn't configured. */
pushRouter.get("/key", (_req, res) => {
  ok(res, { key: push.publicKey() });
});

pushRouter.post("/subscribe", async (req, res) => {
  const input = pushSubscriptionSchema.parse(req.body);
  await push.subscribe(authOf(req).user._id, input, req.get("user-agent") ?? "");
  noContent(res);
});

pushRouter.post("/unsubscribe", async (req, res) => {
  const { endpoint } = pushUnsubscribeSchema.parse(req.body);
  await push.unsubscribe(authOf(req).user._id, endpoint);
  noContent(res);
});
