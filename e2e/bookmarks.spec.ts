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
    // Taken by position rather than by name: this browser's own roots come
    // from Chrome, which titles them in the language the machine is set to,
    // while every other name in this suite is the extension's English. This
    // browser is the first device in the tree, so its bar is the row below it.
    await page.getByRole('treeitem', { name: /This browser/ }).click()
    const bar = page.getByRole('treeitem').nth(1)
    // Waited for rather than assumed: `aria-expanded` appears only once a row
    // has something under it, so this is the moment the copy reached the
    // mirror - pressing before it would open an empty folder and stay there.
    await expect(bar).toHaveAttribute('aria-expanded', 'false')
    await bar.press('ArrowRight')

    // The copy is the whole subtree, so the other browser's bar arrives as a
    // folder inside this one's rather than being merged into it - and it keeps
    // the name it had there, which is why this one can be asked for by name.
    const copied = page.getByRole('treeitem', { name: /Bookmarks bar/ })
    await expect(copied).toHaveAttribute('aria-expanded', 'false')
    await copied.press('ArrowRight')
    await expect(
      page.getByRole('treeitem', { name: /Second device folder/ }),
    ).toBeVisible()

    other.close()
  })
})
