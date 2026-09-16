import { expect, test } from '@playwright/test';

test('the app shell loads', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveTitle('Scrub');
  await expect(page.getByRole('link', { name: 'Scrub' })).toBeVisible();
  await expect(page.getByText('Drop a video or audio file')).toBeVisible();

  // The command bar is present on the empty state too - seeing it from the first
  // second is what sets up what the tool is.
  await expect(page.getByLabel('Example command')).toContainText('ffmpeg');
});
