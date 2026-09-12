import { expect, test, type Browser } from "@playwright/test";
import { freshUser, messageBubble, registerViaApi, sendMessage, signIn, startChatWith, waitForRealtime, type User } from "./helpers";

/** A second signed-in browser, so two real users can talk to each other. */
async function signedInContext(browser: Browser, user: User) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, user);
  return { context, page };
}

test.describe("messaging between two users", () => {
  test("a message sent by one user arrives live for the other", async ({ browser, page, request }) => {
    const alice = await registerViaApi(request, freshUser("alice"));
    const bob = await registerViaApi(request, freshUser("bob"));

    await signIn(page, alice);
    const { context: bobContext, page: bobPage } = await signedInContext(browser, bob);

    try {
      // Both sides connected before anything is sent, so "arrives live" means the socket
      // delivered it rather than a refetch happening to pick it up.
      await waitForRealtime(page);
      await waitForRealtime(bobPage);

      await startChatWith(page, bob.username);
      const greeting = `hello from alice ${Date.now()}`;
      await sendMessage(page, greeting);

      // Alice sees her own message immediately (optimistically, then confirmed).
      await expect(messageBubble(page, greeting)).toBeVisible();

      // Bob never reloads: the chat has to appear over the socket. A direct chat stays hidden
      // for the recipient until the first message arrives, so this covers that rule too.
      const bobChatRow = bobPage.locator("a[href^='/c/']").filter({ hasText: alice.displayName });
      await expect(bobChatRow).toBeVisible({ timeout: 20_000 });
      await bobChatRow.click();
      await expect(messageBubble(bobPage, greeting)).toBeVisible();

      // And the reply travels back to Alice without her reloading either.
      const reply = `hi alice, bob here ${Date.now()}`;
      await sendMessage(bobPage, reply);
      await expect(messageBubble(page, reply)).toBeVisible({ timeout: 20_000 });
    } finally {
      await bobContext.close();
    }
  });

  test("a sent message survives a reload", async ({ page, request }) => {
    const alice = await registerViaApi(request, freshUser("alice"));
    const bob = await registerViaApi(request, freshUser("bob"));

    await signIn(page, alice);
    await startChatWith(page, bob.username);

    const text = `persisted ${Date.now()}`;
    await sendMessage(page, text);
    await expect(messageBubble(page, text)).toBeVisible();

    // Proves it was actually stored, not just rendered optimistically.
    await page.reload();
    await expect(messageBubble(page, text)).toBeVisible();
  });

  test("typing in one chat shows an indicator in the other", async ({ browser, page, request }) => {
    const alice = await registerViaApi(request, freshUser("alice"));
    const bob = await registerViaApi(request, freshUser("bob"));

    await signIn(page, alice);
    await startChatWith(page, bob.username);
    // The chat only reaches Bob once something has been sent.
    await sendMessage(page, `opening ${Date.now()}`);

    const { context: bobContext, page: bobPage } = await signedInContext(browser, bob);
    try {
      const row = bobPage.locator("a[href^='/c/']").filter({ hasText: alice.displayName });
      await expect(row).toBeVisible({ timeout: 20_000 });
      await row.click();
      await expect(bobPage.getByPlaceholder("Message")).toBeVisible();

      // Typing is socket-only — it is never refetched — so both sides must be connected first,
      // or this asserts nothing about the feature and everything about timing.
      await waitForRealtime(page);
      await waitForRealtime(bobPage);

      await page.getByPlaceholder("Message").fill("composing something...");
      // "typing…" appears in the chat list row as well as the conversation header.
      await expect(bobPage.getByText("typing…").first()).toBeVisible({ timeout: 20_000 });
    } finally {
      await bobContext.close();
    }
  });
});
