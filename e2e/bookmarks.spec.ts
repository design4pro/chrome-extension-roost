import { connectSecondDevice } from './helpers/second-device'
import { seedBookmarks } from './helpers/seed'
import { expect, test } from './fixtures/extension'

/** Typed just enough for the snippets that run inside the service worker. */
declare const chrome: {
  bookmarks: {
    search: (query: { title: string }) => Promise<Array<{ id: string }>>
    getChildren: (id: string) => Promise<Array<{ title: string; url?: string }>>
  }
}

test.describe('bookmarks', () => {
  test('shows another browser tree without merging it into this one', async ({
    context,
    dashboardUrl,
  }) => {
    const other = await connectSecondDevice()
    await seedBookmarks(other)

    const page = await context.newPage()
    await page.goto(dashboardUrl)

    await page.getByRole('treeitem', { name: /Second device/ }).click()
    const bar = page.getByRole('treeitem', { name: /Bookmarks bar/ })
    await expect(bar).toHaveAttribute('aria-expanded', 'false')

    await bar.press('ArrowRight')
    await page.getByRole('treeitem', { name: /Second device folder/ }).click()
    await expect(page.getByText('Second device bookmark')).toBeVisible()

    other.close()
  })

  test('copies a folder from the second device into this browser', async ({
    context,
    serviceWorker,
    dashboardUrl,
  }) => {
    const other = await connectSecondDevice()
    await seedBookmarks(other)

    const page = await context.newPage()
    await page.goto(dashboardUrl)
    await page.getByRole('treeitem', { name: /Second device/ }).click()
    await page.getByRole('treeitem', { name: /Bookmarks bar/ }).click()
    await page.getByRole('button', { name: /Copy to this browser/ }).click()

    // Chrome is the record: the copy exists because `chrome.bookmarks.create`
    // made it, not because anything wrote to the mirror directly.
    await expect
      .poll(
        () =>
          serviceWorker.evaluate(async () => {
            const [folder] = await chrome.bookmarks.search({
              title: 'Second device folder',
            })
            if (folder === undefined) return []
            const children = await chrome.bookmarks.getChildren(folder.id)
            return children.map((child) => child.title)
          }),
        { timeout: 10_000 },
      )
      .toEqual(['Second device bookmark'])

    // And the capture events that copy produced are what put it in the mirror,
    // under this browser rather than under the one it came from.
    await page.reload()
    // Found by shape rather than by name: this browser's own roots come from
    // Chrome, which titles them in the language the machine is set to, while
    // every other name in this suite is the extension's English. Only this
    // device is expanded after the reload, and of its rows only a folder with
    // something under it carries `aria-expanded` - its windows never do and
    // its empty roots do not either. So the first such row is the bar that
    // just received the copy, and waiting for it to exist is waiting for the
    // copy to reach the mirror; pressing earlier opens an empty folder and
    // stays there.
    await page.getByRole('treeitem', { name: /This browser/ }).click()
    const bar = page
      .locator('[role="treeitem"][aria-level="2"][aria-expanded]')
      .first()
    await expect(bar).toHaveAttribute('aria-expanded', 'false')
    await bar.press('ArrowRight')

    // The copy is the whole subtree, so the other browser's bar arrives as a
    // folder inside this one's rather than being merged into it. Asking for it
    // by name would be ambiguous on an English machine, where this browser's
    // own bar is called the same thing - so again by shape: one level deeper
    // than that bar, and holding a folder of its own.
    const copied = page
      .locator('[role="treeitem"][aria-level="3"][aria-expanded]')
      .first()
    await expect(copied).toHaveAttribute('aria-expanded', 'false')
    await copied.press('ArrowRight')
    await expect(
      page.getByRole('treeitem', { name: /Second device folder/ }),
    ).toBeVisible()

    other.close()
  })
})
