import { Router } from "express";
import { createReportSchema } from "@chat/shared";
import { noContent } from "../../lib/http";
import { authOf } from "../../middleware/auth";
import { limiter } from "../../middleware/security";
import { createReport } from "./service";

// Reporting is cheap to abuse, so it is limited well below normal writes.
const reportLimiter = limiter({ windowMs: 3_600_000, limit: 20, keyGenerator: (req) => req.auth?.user.id ?? "anon" });

export const reportsRouter = Router();

reportsRouter.post("/", reportLimiter, async (req, res) => {
  const input = createReportSchema.parse(req.body);
  await createReport(authOf(req).user._id, input);
  noContent(res);
});
