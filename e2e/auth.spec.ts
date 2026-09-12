import { expect, test } from "@playwright/test";
import { freshUser, registerViaApi, registerViaForm, signIn } from "./helpers";

test.describe("authentication", () => {
  test("a new account can register and lands in the app", async ({ page }) => {
    await registerViaForm(page, freshUser());
    // The session cookie is HttpOnly, so the only honest check is that a reload stays signed in.
    await page.reload();
    await expect(page.getByRole("heading", { name: "Chats" })).toBeVisible();
  });

  test("an existing account can sign in", async ({ page, request }) => {
    const user = await registerViaApi(request, freshUser());
    await signIn(page, user);
  });

  test("the wrong password is refused without revealing whether the account exists", async ({ page, request }) => {
    const user = await registerViaApi(request, freshUser());
    await page.goto("/login");
    await page.locator("input[autocomplete='username']").fill(user.email);
    await page.locator("input[autocomplete='current-password']").fill("not the right password");
    await page.getByRole("button", { name: /sign in|log in/i }).click();

    await expect(page.getByText(/incorrect username\/email or password/i)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Chats" })).toBeHidden();
  });

  test("signed-out visitors are sent to the sign-in screen", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("input[autocomplete='current-password']")).toBeVisible();
  });
});
