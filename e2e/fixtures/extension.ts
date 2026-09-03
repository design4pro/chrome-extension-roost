import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, test as base } from '@playwright/test'
import type { BrowserContext, Worker } from '@playwright/test'
import { devToken } from '../../scripts/dev-token'

/**
 * A Chrome with the extension loaded, already signed in.
 *
 * Signing in through Access by hand in every test would be testing Cloudflare's
 * login page. The cookie is seeded instead, with a token signed by the same
 * local key the Worker verifies against - so the Worker's check is real even
 * though the login was not.
 */

/** Typed just enough for the snippets that run inside the service worker. */
declare const chrome: {
  storage: { local: { set: (values: object) => Promise<void> } }
  runtime: { reload: () => void }
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const EXTENSION_PATH = path.join(root, '.output/chrome-mv3-e2e')
const WORKER_URL = 'http://localhost:3011'

export const test = base.extend<{
  context: BrowserContext
  extensionId: string
  serviceWorker: Worker
  dashboardUrl: string
}>({
  // eslint-disable-next-line no-empty-pattern -- Playwright's fixture signature
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
      ],
    })

    await context.addCookies([
      {
        name: 'CF_Authorization',
        value: await devToken(),
        domain: 'localhost',
        path: '/',
      },
    ])

    await use(context)
    await context.close()
  },

  serviceWorker: async ({ context }, use) => {
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent('serviceworker'))
    // The extension does nothing until onboarding has told it where its hub is.
    await worker.evaluate(async (workerUrl: string) => {
      await chrome.storage.local.set({
        workerUrl,
        deviceName: 'Playwright Chrome',
      })
    }, WORKER_URL)
    await use(worker)
  },

  extensionId: async ({ serviceWorker }, use) => {
    await use(new URL(serviceWorker.url()).host)
  },

  dashboardUrl: async ({ extensionId }, use) => {
    await use(`chrome-extension://${extensionId}/dashboard.html`)
  },
})

export const expect = test.expect
export { WORKER_URL }
