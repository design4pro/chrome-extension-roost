import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, test as base } from '@playwright/test'
import type { BrowserContext, Worker } from '@playwright/test'

/**
 * A Chrome with the extension loaded, already paired with the hub.
 *
 * Clicking through onboarding in every test would be testing the onboarding
 * form. The pairing key is written straight to storage instead - the same key
 * `wrangler dev` was started with, so the Worker's check is a real one.
 */

/** Typed just enough for the snippets that run inside the service worker. */
declare const chrome: {
  storage: { local: { set: (values: object) => Promise<void> } }
  runtime: { reload: () => void }
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const EXTENSION_PATH = path.join(root, 'build/chrome-mv3-e2e')
const WORKER_URL = 'http://localhost:3011'
/** The same key `.dev.vars` gives the Worker the e2e run talks to. */
const PAIRING_SECRET = 'local-development-pairing-key'
/**
 * This browser's device id, fixed rather than minted.
 *
 * Every test gets a fresh profile, so the extension would mint a new id each
 * time and the hub - which outlives the run - would fill up with offline
 * devices nobody closed. One id means one "This browser" row, whichever test
 * is looking.
 */
const DEVICE_ID = '11111111-1111-4111-8111-111111111111'

/**
 * The build, with every language but English taken out.
 *
 * The extension reads its strings through `chrome.i18n`, which follows the
 * browser's UI language - and that comes from the machine: `--lang` does not
 * move it on macOS, and neither does a profile preference. Every role name in
 * these specs is English, so what changes is what the extension can offer.
 * Dropping the other locales leaves `default_locale` as the only answer.
 */
function englishBuild(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roost-e2e-'))
  const copy = path.join(dir, 'extension')
  fs.cpSync(EXTENSION_PATH, copy, { recursive: true })

  const locales = path.join(copy, '_locales')
  for (const entry of fs.readdirSync(locales)) {
    if (entry !== 'en')
      fs.rmSync(path.join(locales, entry), { recursive: true })
  }
  return copy
}

/** The extension's service worker, running or just woken. */
const worker = async (context: BrowserContext): Promise<Worker> =>
  context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))

export const test = base.extend<{
  context: BrowserContext
  extensionId: string
  serviceWorker: Worker
  dashboardUrl: string
}>({
  // eslint-disable-next-line no-empty-pattern -- Playwright's fixture signature
  context: async ({}, use) => {
    const extension = englishBuild()
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      args: [
        `--disable-extensions-except=${extension}`,
        `--load-extension=${extension}`,
      ],
    })

    // Paired here rather than in a fixture a test has to remember to ask for:
    // "already paired" is what this context is, and the extension starts
    // syncing on the write, so nothing has to be restarted afterwards.
    await worker(context).then((sw) =>
      sw.evaluate(
        async ([workerUrl, pairingSecret, deviceId]: string[]) => {
          await chrome.storage.local.set({
            workerUrl,
            pairingSecret,
            deviceId,
            deviceName: 'Playwright Chrome',
          })
        },
        [WORKER_URL, PAIRING_SECRET, DEVICE_ID],
      ),
    )

    await use(context)
    await context.close()
  },

  serviceWorker: async ({ context }, use) => {
    await use(await worker(context))
  },

  extensionId: async ({ serviceWorker }, use) => {
    await use(new URL(serviceWorker.url()).host)
  },

  dashboardUrl: async ({ extensionId }, use) => {
    await use(`chrome-extension://${extensionId}/dashboard.html`)
  },
})

export const expect = test.expect
export { PAIRING_SECRET, WORKER_URL }
