import type { Response } from "express";
import type { ApiSuccess } from "@chat/shared";

export function ok<T>(res: Response, data: T, status = 200) {
  return res.status(status).json({ success: true, data } satisfies ApiSuccess<T>);
}

export function noContent(res: Response) {
  return res.status(204).end();
}
