import { chromium } from '@playwright/test'
const p = '/Users/rafalwolak/dev/cloudflare/tab-sync/.output/chrome-mv3-e2e'
const ctx = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  headless: false,
  args: [`--disable-extensions-except=${p}`, `--load-extension=${p}`],
})
try {
  const w =
    ctx.serviceWorkers()[0] ??
    (await ctx.waitForEvent('serviceworker', { timeout: 15000 }))
  console.log('HEADED sw:', w.url())
} catch (e) {
  console.log('HEADED no sw')
}
await ctx.close()
process.exit(0)
