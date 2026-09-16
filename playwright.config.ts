import { defineConfig, devices } from '@playwright/test';

const PORT = 5173;

export default defineConfig({
  testDir: './e2e',
  /**
   * Tests within a file share a worker and run in order.
   *
   * There is one server, one working directory, and one in-memory store behind
   * all of this, so the suite is not as independent as it looks: the test that
   * clears the working folder deletes files other tests are in the middle of
   * using, and the dedupe test needs its first upload to still be there for the
   * second. Files still run in parallel with each other.
   */
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${String(PORT)}`,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    /**
     * Both halves. These flows upload, probe and encode for real, so the API has
     * to be up - and that means ffmpeg has to be installed. That is not an
     * awkward dependency to work around: an ffmpeg GUI whose tests never run
     * ffmpeg would be testing the half of the product that was never in doubt.
     */
    command: 'npm run dev',
    url: `http://localhost:${String(PORT)}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
