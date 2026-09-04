import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import { browser } from 'wxt/browser'
import { Onboarding } from './Onboarding'
import * as probe from '../state/probe'
import { DEPLOY_URL } from '../pairing'

/**
 * The first screen, which is the only one that can leave the user stuck.
 *
 * `t()` is not mocked here: the tests assert on labels and roles the way a
 * screen reader would reach them, and the fake i18n returns the key itself.
 */

const HUB = 'https://roost.example.workers.dev'

const fill = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } })

const submit = () =>
  fireEvent.click(screen.getByRole('button', { name: 'onboarding_connect' }))

/**
 * The generated key arrives a tick after the first render, and the field is
 * `required` - so submitting before it lands is the browser refusing the form,
 * not the code under test refusing anything.
 */
const mintedKey = async (): Promise<string> => {
  const field: HTMLInputElement = await screen.findByLabelText(
    'onboarding_secret_label',
  )
  await waitFor(() => expect(field.value).not.toBe(''))
  return field.value
}

// Re-stubbed per test, because `restoreMocks` puts the original back.
beforeEach(() => {
  fakeBrowser.reset()
  vi.spyOn(fakeBrowser.i18n, 'getMessage').mockImplementation(
    (key: string) => key,
  )
  // The fake types this as returning nothing; the real one answers with
  // whether the user said yes, which is what the component branches on.
  vi.spyOn(browser.permissions, 'request').mockResolvedValue(true as never)
})

describe('Onboarding', () => {
  it('offers a key of its own so the user never has to invent one', async () => {
    render(<Onboarding onDone={() => undefined} />)

    expect(await mintedKey()).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('links to the deploy page under a name a screen reader can announce', async () => {
    render(<Onboarding onDone={() => undefined} />)

    const link = await screen.findByRole('link', {
      name: 'onboarding_deploy_link',
    })
    expect(link).toHaveAttribute('href', DEPLOY_URL)
  })

  it('keeps the same key across a reload of the page', async () => {
    const first = render(<Onboarding onDone={() => undefined} />)
    const minted = await mintedKey()
    first.unmount()

    // Cloudflare already has this key by now; generating another one here
    // would pair the browser with a hub that has never heard of it.
    render(<Onboarding onDone={() => undefined} />)
    expect(await mintedKey()).toBe(minted)
  })

  it('stores the address, the key and the name once the hub accepts them', async () => {
    vi.spyOn(probe, 'probeWorker').mockResolvedValue('ok')
    const onDone = vi.fn()
    render(<Onboarding onDone={onDone} />)

    const minted = await mintedKey()

    fill('onboarding_url_label', `${HUB}/`)
    fill('onboarding_name_label', 'Canary')
    submit()

    await waitFor(() => expect(onDone).toHaveBeenCalledOnce())
    expect(await fakeBrowser.storage.local.get(null)).toMatchObject({
      workerUrl: HUB,
      deviceName: 'Canary',
      pairingSecret: minted,
    })
  })

  it('tells a refused key apart from an address that answers nothing', async () => {
    const probing = vi
      .spyOn(probe, 'probeWorker')
      .mockResolvedValue('wrong_key')
    render(<Onboarding onDone={() => undefined} />)
    await mintedKey()

    fill('onboarding_url_label', HUB)
    submit()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'onboarding_error_wrong_key',
    )

    probing.mockResolvedValue('unreachable')
    submit()
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'onboarding_error_unreachable',
      ),
    )
  })

  it('offers a Worker found in another tab, and pairs with it on one click', async () => {
    vi.spyOn(probe, 'probeWorker').mockResolvedValue('ok')
    await fakeBrowser.tabs.create({ url: `${HUB}/` })
    const onDone = vi.fn()
    render(<Onboarding onDone={onDone} />)

    const minted = await mintedKey()
    fireEvent.click(
      await screen.findByRole('button', { name: 'roost.example.workers.dev' }),
    )

    // Nothing was typed: the address came from the tab, the key from this
    // screen, and the name from the browser itself.
    await waitFor(() => expect(onDone).toHaveBeenCalledOnce())
    expect(await fakeBrowser.storage.local.get(null)).toMatchObject({
      workerUrl: HUB,
      pairingSecret: minted,
    })
  })

  it('says so when the found Worker does not know this key', async () => {
    vi.spyOn(probe, 'probeWorker').mockResolvedValue('wrong_key')
    await fakeBrowser.tabs.create({ url: `${HUB}/` })
    render(<Onboarding onDone={() => undefined} />)
    await mintedKey()

    fireEvent.click(
      await screen.findByRole('button', { name: 'roost.example.workers.dev' }),
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'onboarding_error_wrong_key',
    )
    expect(await fakeBrowser.storage.local.get('workerUrl')).toEqual({})
  })

  it('carries the pairing to other browsers only when asked', async () => {
    vi.spyOn(probe, 'probeWorker').mockResolvedValue('ok')
    render(<Onboarding onDone={() => undefined} />)
    const minted = await mintedKey()

    fill('onboarding_url_label', HUB)
    fireEvent.click(screen.getByLabelText('onboarding_sync_label'))
    submit()

    await waitFor(async () =>
      expect(await fakeBrowser.storage.sync.get(null)).toEqual({
        workerUrl: HUB,
        pairingSecret: minted,
      }),
    )
  })

  it('leaves nothing in the synced account when the box is clear', async () => {
    vi.spyOn(probe, 'probeWorker').mockResolvedValue('ok')
    const onDone = vi.fn()
    render(<Onboarding onDone={onDone} />)
    await mintedKey()

    fill('onboarding_url_label', HUB)
    submit()

    await waitFor(() => expect(onDone).toHaveBeenCalledOnce())
    expect(await fakeBrowser.storage.sync.get(null)).toEqual({})
  })

  it('adopts the key a sibling browser already paired with', async () => {
    // Minting a second key here would pair this browser with a hub that has
    // never heard of it, which is the whole failure the sync is there to stop.
    await fakeBrowser.storage.sync.set({
      workerUrl: HUB,
      pairingSecret: 'the-key-the-hub-knows',
    })
    render(<Onboarding onDone={() => undefined} />)

    expect(await mintedKey()).toBe('the-key-the-hub-knows')
    const address: HTMLInputElement = screen.getByLabelText(
      'onboarding_url_label',
    )
    expect(address.value).toBe(HUB)
  })

  it('refuses an address that is not https before asking for anything', async () => {
    // Cleared rather than merely created: spying on a module export keeps one
    // spy for the file, so its history outlives the test that made it.
    const probing = vi.spyOn(probe, 'probeWorker')
    probing.mockClear()
    render(<Onboarding onDone={() => undefined} />)
    await mintedKey()

    fill('onboarding_url_label', 'http://roost.example.workers.dev')
    submit()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'onboarding_error_url',
    )
    expect(probing).not.toHaveBeenCalled()
  })
})
