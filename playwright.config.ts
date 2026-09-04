import { defineConfig } from '@playwright/test'

/**
 * End-to-end tests run the real extension against a real Worker.
 *
 * The Worker is `wrangler dev` holding the same pairing key the fixtures use,
 * so the hub's check is exercised for real rather than stubbed - the extension
 * has no way to tell this apart from the deployed hub, which is the point.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  // The extension has one connection and one hub; running specs in parallel
  // would have them writing over each other's state.
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  snapshotPathTemplate: '{testDir}/__screenshots__/{platform}/{arg}{ext}',
  use: {
    baseURL: 'http://localhost:3011',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      // Branded Chrome 137 and later refuses --load-extension, so these tests
      // only ever run against the bundled Chromium. `channel: 'chromium'` is
      // load-bearing next to `headless`: it picks the full browser, whose
      // headless mode runs extensions, rather than the headless shell
      // Playwright would otherwise use - that one loads none and says nothing.
      use: { channel: 'chromium', headless: true },
    },
  ],
  webServer: {
    // A hub that starts empty every time. The Durable Object keeps what it is
    // told for as long as the state directory lives, and a run that inherits
    // another run's devices and windows fails on counts that have nothing to
    // do with the change being tested.
    command: 'pnpm dev:worker:e2e',
    url: 'http://localhost:3011/api/health',
    // Never reused: the point of the command above is the state it throws
    // away, and a server already running has not thrown anything away.
    reuseExistingServer: false,
    timeout: 120_000,
    // The Worker answers this with a 401 until a key is presented, which is
    // proof enough that it is up and checking.
    ignoreHTTPSErrors: true,
  },
})
