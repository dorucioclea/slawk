import { type Page, expect } from '@playwright/test';

/** Default test credentials */
export const TEST_USER = {
  email: 'test@example.com',
  password: 'password123',
  name: 'Test User',
};

/**
 * Login with the given credentials and wait for the channels page to load.
 * Navigates to /login, fills the form, submits, and asserts we land on the main app.
 */
export async function login(
  page: Page,
  email = TEST_USER.email,
  password = TEST_USER.password
) {
  await page.goto('/login');
  await page.getByPlaceholder('name@work-email.com').fill(email);
  await page.getByPlaceholder('Password').fill(password);
  await page.getByRole('button', { name: /sign in with email/i }).click();

  // Wait for the main app layout to appear (sidebar with channels)
  await expect(page.getByTestId('sidebar')).toBeVisible({ timeout: 10_000 });
}

/**
 * Register a new user and wait for the channels page to load.
 */
export async function register(
  page: Page,
  name: string,
  email: string,
  password: string
) {
  await page.goto('/register');
  await page.getByPlaceholder('Full name').fill(name);
  await page.getByPlaceholder('name@work-email.com').fill(email);
  await page.getByPlaceholder('Password', { exact: true }).fill(password);
  await page.getByPlaceholder('Confirm password').fill(password);
  await page.getByRole('button', { name: /create account/i }).click();

  // Wait for the main app layout to appear
  await expect(page.getByTestId('sidebar')).toBeVisible({ timeout: 10_000 });
}

/**
 * Generate a unique email address for test isolation.
 */
export function uniqueEmail() {
  return `testuser-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

/**
 * Type a message into the Quill editor and send it.
 * Quill uses a contenteditable div — we type character by character
 * so Quill's internal text-change events fire properly.
 */
export async function sendMessage(page: Page, text: string) {
  const editor = page.locator('.ql-editor');
  await editor.click();
  await page.keyboard.type(text, { delay: 10 });
  // Press Enter to send (Quill binding)
  await page.keyboard.press('Enter');
}

/**
 * Wait for a message with the given text to appear in the message list.
 * Targets the message row container (group relative flex px-5).
 * Uses a 25s timeout to account for WebSocket join latency and message delivery.
 */
export async function waitForMessage(page: Page, text: string) {
  await expect(
    page.locator('.group.relative.flex.px-5').filter({ hasText: text })
  ).toBeVisible({ timeout: 25_000 });
}

/**
 * Wait for the WebSocket channel join to settle after navigation.
 * The socket join:channel event requires a server-side DB lookup before
 * the channel room is ready to receive message broadcasts. This ensures
 * message:send is not emitted before the server has processed join:channel.
 */
export async function waitForChannelReady(page: Page) {
  // Wait for the editor to be interactive, then give socket join time to settle
  await expect(page.locator('.ql-editor')).toBeVisible({ timeout: 10_000 });
  // Allow server-side join:channel processing to complete (1.2s covers DB lookup + network latency)
  await page.waitForTimeout(1200);
}

/**
 * Click a channel by name in the sidebar.
 * Scopes to the sidebar and matches the channel name span to avoid strict mode
 * violations when channel names also appear in the channel header or messages.
 */
export async function clickChannel(page: Page, channelName: string) {
  const sidebar = page.getByTestId('sidebar');
  await sidebar
    .locator('button')
    .filter({ has: page.locator('span.truncate', { hasText: channelName }) })
    .first()
    .click();
}

/**
 * Assert a channel is visible in the sidebar by name.
 */
export async function expectChannelInSidebar(page: Page, channelName: string) {
  await expect(
    page.getByTestId('sidebar')
      .locator('button')
      .filter({ has: page.locator('span.truncate', { hasText: channelName }) })
      .first()
  ).toBeVisible({ timeout: 10_000 });
}
