import { expect, type APIRequestContext, type Page } from "@playwright/test";

/** Unique per run, so tests never collide with data left by an earlier run. */
export function freshUser(prefix = "e2e") {
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return {
    username: `${prefix}_${id}`.slice(0, 24),
    email: `${prefix}_${id}@example.com`,
    password: "correct horse battery",
    displayName: `Test ${id.slice(-4)}`,
  };
}

export type User = ReturnType<typeof freshUser>;

/**
 * Registers through the API rather than the form, for tests whose subject isn't the form.
 * Mirrors what the app sends: the CSRF header the server requires on writes.
 *
 * This deliberately goes through the app's own origin and /api proxy — the same path the browser
 * uses. Posting straight to the API port instead once let registration and sign-in reach two
 * different servers, which made a test pass for the wrong reason.
 */
export async function registerViaApi(request: APIRequestContext, user: User) {
  const res = await request.post("/api/auth/register", {
    headers: { "X-Requested-With": "chatapp", Origin: "http://localhost:5173" },
    data: { email: user.email, username: user.username, password: user.password, displayName: user.displayName },
  });
  expect(res.status(), await res.text()).toBe(201);
  return user;
}

/** Signs in through the UI and waits until the chat list is actually usable. */
export async function signIn(page: Page, user: User) {
  await page.goto("/login");
  await page.locator("input[autocomplete='username']").fill(user.email);
  await page.locator("input[autocomplete='current-password']").fill(user.password);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await expect(page.getByRole("heading", { name: "Chats" })).toBeVisible();
}

/** Registers through the form. Returns once the app itself is on screen. */
export async function registerViaForm(page: Page, user: User) {
  await page.goto("/register");
  // "Name" alone also matches "Username" — label matching is substring-based.
  await page.getByLabel("Name", { exact: true }).fill(user.displayName);
  await page.getByLabel("Username", { exact: true }).fill(user.username);
  await page.getByLabel("Email", { exact: true }).fill(user.email);
  await page.locator("input[autocomplete='new-password']").fill(user.password);
  await page.getByRole("button", { name: /create|sign up|register/i }).click();
  await expect(page.getByRole("heading", { name: "Chats" })).toBeVisible();
}

/** Opens a direct chat with someone by searching for their username. */
export async function startChatWith(page: Page, username: string) {
  await page.getByRole("button", { name: "New chat" }).click();
  const search = page.getByLabel("Search people");
  await search.fill(username);
  await page.getByRole("list", { name: "People" }).getByText(`@${username}`).click();
  await expect(page.getByPlaceholder("Message")).toBeVisible();
}

export async function sendMessage(page: Page, text: string) {
  await page.getByPlaceholder("Message").fill(text);
  await page.getByRole("button", { name: "Send message" }).click();
}

/** A message bubble carrying this exact text, anywhere in the open conversation. */
export const messageBubble = (page: Page, text: string) => page.locator("[data-msg-row]").filter({ hasText: text });

/**
 * Waits until the realtime socket is actually connected.
 *
 * The connection banner shows "Connecting…" and disappears once the socket reports connected, so
 * its absence is the signal. Tests that assert something arrives *live* need this first —
 * otherwise a slow socket makes them pass or fail on whether a refetch happened to fire.
 */
export async function waitForRealtime(page: Page) {
  await expect(page.getByText(/^(Connecting|Reconnecting)…$/)).toBeHidden({ timeout: 30_000 });
}
