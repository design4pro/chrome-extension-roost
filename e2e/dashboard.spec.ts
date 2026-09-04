import { connectSecondDevice } from './helpers/second-device'
import { seedWindow } from './helpers/seed'
import { expect, test } from './fixtures/extension'

test.describe('the dashboard', () => {
  test('shows what another device has open, and filters it', async ({
    context,
    dashboardUrl,
  }) => {
    const other = await connectSecondDevice()
    await seedWindow(other, { tabs: 5 })

    const page = await context.newPage()
    await page.goto(dashboardUrl)

    // The device is in the sidebar; its window appears once it is opened.
    const device = page.getByRole('treeitem', { name: /Second device/ })
    await expect(device).toBeVisible()
    await device.click()
    await page.getByRole('treeitem', { name: /Second device page 0/ }).click()

    // Scoped to the list: a window is named after the tab it is showing, so
    // "page 0" is also the label of the sidebar item that opened this.
    const list = page.getByRole('list')
    await expect(list.getByRole('listitem')).toHaveCount(6) // five tabs, one group
    await expect(list.getByText('Second device page 3')).toBeVisible()

    await page.getByLabel(/Search/).fill('page 3')
    await expect(list.getByText('Second device page 3')).toBeVisible()
    await expect(list.getByText('Second device page 0')).toHaveCount(0)

    other.close()
  })

  test('never parks a focused row under the sticky header', async ({
    context,
    dashboardUrl,
  }) => {
    const other = await connectSecondDevice()
    await seedWindow(other, { tabs: 60 })

    const page = await context.newPage()
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(dashboardUrl)

    await page.getByRole('treeitem', { name: /Second device/ }).click()
    await page.getByRole('treeitem', { name: /Second device page 0/ }).click()

    // Walk the whole list with the keyboard; a row that scrolled into view has
    // to clear the header, which is what `scroll-margin-top` is there for.
    for (let step = 0; step < 40; step += 1) {
      await page.keyboard.press('Tab')

      const clear = await page.evaluate(() => {
        const active = document.activeElement
        const header = document.querySelector('[data-testid="panel-header"]')
        if (active === null || header === null) return true

        const row = active.getBoundingClientRect()
        const sticky = header.getBoundingClientRect()
        // Only rows of the list are under the header at all.
        if (active.closest('[role="listbox"]') === null) return true
        return row.top >= sticky.bottom - 1
      })

      expect(clear).toBe(true)
    }

    other.close()
  })

  test('opens a row menu from the keyboard', async ({
    context,
    dashboardUrl,
  }) => {
    const other = await connectSecondDevice()
    await seedWindow(other, { tabs: 5 })

    const page = await context.newPage()
    await page.goto(dashboardUrl)
    await page.getByRole('treeitem', { name: /Second device/ }).click()
    await page.getByRole('treeitem', { name: /Second device page 0/ }).click()

    // Anchored: the row's own button opens with the title, while the one
    // beside it is "Actions for ...".
    await page.getByRole('button', { name: /^Second device page 1/ }).focus()
    await page.keyboard.press('Shift+F10')

    const menu = page.getByRole('menu')
    await expect(menu).toBeVisible()
    await expect(menu.getByRole('menuitem').first()).toBeFocused()

    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
    await expect(
      page.getByRole('button', { name: /^Second device page 1/ }),
    ).toBeFocused()

    other.close()
  })
})
