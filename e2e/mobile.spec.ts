import { expect, test } from "@playwright/test";
import { freshUser, messageBubble, registerViaApi, sendMessage, signIn, startChatWith } from "./helpers";

/**
 * Phones show one pane at a time. These tests assert that behaviour through what the user can
 * see, not through CSS classes, so a change of layout technique doesn't produce a false failure.
 */
test.describe("mobile viewport", () => {
  test("the chat list fills the screen, and opening a chat replaces it", async ({ page, request }) => {
    const alice = await registerViaApi(request, freshUser("alice"));
    const bob = await registerViaApi(request, freshUser("bob"));

    await signIn(page, alice);
    await expect(page.getByRole("heading", { name: "Chats" })).toBeVisible();

    await startChatWith(page, bob.username);

    // With a conversation open, the phone shows the conversation instead of the list.
    await expect(page.getByPlaceholder("Message")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Chats" })).toBeHidden();

    // Going back returns to the list.
    await page.goBack();
    await expect(page.getByRole("heading", { name: "Chats" })).toBeVisible();
  });

  test("a message can be sent from a phone", async ({ page, request }) => {
    const alice = await registerViaApi(request, freshUser("alice"));
    const bob = await registerViaApi(request, freshUser("bob"));

    await signIn(page, alice);
    await startChatWith(page, bob.username);

    const text = `sent from a phone ${Date.now()}`;
    await sendMessage(page, text);
    await expect(messageBubble(page, text)).toBeVisible();
  });

  test("nothing overflows horizontally at 390px", async ({ page, request }) => {
    const user = await registerViaApi(request, freshUser());
    await signIn(page, user);

    // A horizontal scrollbar on the body is the classic responsive regression.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
