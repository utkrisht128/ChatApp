import request from "supertest";
import { createApp } from "../src/app";

export const app = createApp();

/** A cookie-keeping client that sends the CSRF header the real frontend sends. */
export function client() {
  const agent = request.agent(app);
  return {
    agent,
    get: (path: string) => agent.get(path),
    post: (path: string, body?: object) => agent.post(path).set("X-Requested-With", "chatapp").send(body),
    patch: (path: string, body?: object) => agent.patch(path).set("X-Requested-With", "chatapp").send(body),
    put: (path: string, body?: object) => agent.put(path).set("X-Requested-With", "chatapp").send(body),
    del: (path: string) => agent.delete(path).set("X-Requested-With", "chatapp"),
  };
}

let seq = 0;
export async function signUp(overrides: Partial<{ email: string; username: string; password: string }> = {}) {
  seq += 1;
  const creds = {
    email: `user${seq}@example.com`,
    username: `user_${seq}`,
    password: "correct horse battery",
    ...overrides,
  };
  const c = client();
  const res = await c.post("/api/auth/register", creds);
  if (res.status !== 201) throw new Error(`signUp failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { ...c, creds, user: res.body.data.user as { id: string; username: string; role: string } };
}
