import type { UserDoc } from "../models/User";

declare global {
  namespace Express {
    interface Request {
      auth?: { user: UserDoc; sessionId: string };
    }
  }
}

export {};
