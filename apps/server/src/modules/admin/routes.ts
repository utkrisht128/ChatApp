import { Router } from "express";
import { adminReportsQuerySchema, adminUsersQuerySchema, resolveReportSchema, setBanSchema, setUserRoleSchema } from "@chat/shared";
import { ok } from "../../lib/http";
import { authOf } from "../../middleware/auth";
import * as admin from "./service";

/** Mounted behind `requireAdmin`, which answers 404 so the admin surface isn't advertised. */
export const adminRouter = Router();

adminRouter.get("/stats", async (_req, res) => {
  ok(res, { stats: await admin.getStats() });
});

adminRouter.get("/users", async (req, res) => {
  ok(res, await admin.listUsers(adminUsersQuerySchema.parse(req.query)));
});

adminRouter.put("/users/:userId/ban", async (req, res) => {
  const { banned, reason } = setBanSchema.parse(req.body);
  ok(res, { user: await admin.setBan(authOf(req).user._id, req.params.userId as string, banned, reason) });
});

adminRouter.put("/users/:userId/role", async (req, res) => {
  const { role } = setUserRoleSchema.parse(req.body);
  ok(res, { user: await admin.setRole(authOf(req).user._id, req.params.userId as string, role) });
});

adminRouter.get("/reports", async (req, res) => {
  ok(res, await admin.listReports(adminReportsQuerySchema.parse(req.query)));
});

adminRouter.put("/reports/:reportId", async (req, res) => {
  const input = resolveReportSchema.parse(req.body);
  ok(res, { report: await admin.resolveReport(authOf(req).user._id, req.params.reportId as string, input) });
});
