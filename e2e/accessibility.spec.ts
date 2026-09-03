import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { connectSecondDevice } from './helpers/second-device'
import { seedWindow } from './helpers/seed'
import { expect, test } from './fixtures/extension'

/** Typed just enough for the snippets that run inside the service worker. */
declare const chrome: {
  storage: { local: { remove: (keys: string) => Promise<void> } }
  runtime: { reload: () => void }
}

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa']

const audit = async (page: Page) => {
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze()
  expect(violations).toEqual([])
}

test.describe('accessibility', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`onboarding in ${scheme}`, async ({
      context,
      serviceWorker,
      dashboardUrl,
    }) => {
      // The fixture signs the browser in; onboarding is the state before that.
      await serviceWorker.evaluate(() =>
        chrome.storage.local.remove('workerUrl'),
      )

      const page = await context.newPage()
      await page.emulateMedia({ colorScheme: scheme })
      await page.goto(dashboardUrl)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await audit(page)
    })

    test(`the empty dashboard in ${scheme}`, async ({
      context,
      dashboardUrl,
    }) => {
      const page = await context.newPage()
      await page.emulateMedia({ colorScheme: scheme })
      await page.goto(dashboardUrl)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await audit(page)
    })

    test(`a populated dashboard in ${scheme}`, async ({
      context,
      serviceWorker,
      dashboardUrl,
    }) => {
      const other = await connectSecondDevice()
      await serviceWorker.evaluate(() => chrome.runtime.reload())
      await seedWindow(other, { tabs: 8 })

      const page = await context.newPage()
      await page.emulateMedia({ colorScheme: scheme })
      await page.goto(dashboardUrl)
      await page.getByRole('treeitem', { name: /Second device/ }).click()
      await page.getByRole('treeitem', { name: /Second device page 0/ }).click()
      await expect(page.getByRole('option').first()).toBeVisible()

      await audit(page)
      other.close()
    })
  }
})
