import { test, expect } from '@playwright/test';
import { login, clickChannel, waitForChannelReady } from './helpers';

test.describe('@mention rendering', () => {
  test('@mentions in announcements render as highlighted spans not italic', async ({ page }) => {
    await login(page, 'alice@slawk.dev', 'password123');
    await clickChannel(page, 'announcements');
    await waitForChannelReady(page);

    // Find the message with @Priya mention
    const mention = page.locator('.mention-highlight').filter({ hasText: '@Priya' }).first();
    await expect(mention).toBeVisible({ timeout: 10_000 });

    // Verify it's a span with the mention-highlight class, not an <em> element
    const tagName = await mention.evaluate((el) => el.tagName.toLowerCase());
    expect(tagName).toBe('span');
  });
});
