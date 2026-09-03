import { beforeEach, describe, expect, it, vi } from 'vitest'
import { browser } from 'wxt/browser'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import { createWatcher, REFRESH_ALARM, TIMEOUT_ALARM } from './watcher'

const WORKER = 'https://sync.test'
const NOW = 1_000_000

const token = (exp: number) =>
  `header.${btoa(JSON.stringify({ exp: exp / 1000 }))
    .replaceAll('+', '-')
    .replaceAll('/', '_')}.signature`

const cookieIs = (value: string | undefined) => {
  vi.spyOn(browser.cookies, 'get').mockResolvedValue(
    (value === undefined ? null : { value }) as never,
  )
}

const watcher = (onAuthenticated = vi.fn()) => ({
  watcher: createWatcher({
    browser,
    workerUrl: WORKER,
    clock: () => NOW,
    onAuthenticated,
  }),
  onAuthenticated,
})

const alarm = async (name: string) =>
  (await fakeBrowser.alarms.getAll()).find((a) => a.name === name)

beforeEach(() => {
  vi.spyOn(browser.action, 'setBadgeText').mockResolvedValue(undefined)
})

describe('watching the Access session', () => {
  it('schedules the refresh for just after the cookie expires', async () => {
    // Access refuses to issue a new cookie while the old one is still valid, so
    // refreshing early only produces a login page the user has to click.
    cookieIs(token(NOW + 60_000))
    await watcher().watcher.check()

    expect((await alarm(REFRESH_ALARM))?.scheduledTime).toBe(NOW + 61_000)
  })

  it('reports a missing cookie without scheduling anything', async () => {
    cookieIs(undefined)
    expect(await watcher().watcher.check()).toEqual({ state: 'missing' })
    expect(await alarm(REFRESH_ALARM)).toBeUndefined()
  })

  it('refreshes in the background when the alarm fires', async () => {
    const create = vi
      .spyOn(browser.tabs, 'create')
      .mockResolvedValue({} as never)
    await watcher().watcher.handleAlarm(REFRESH_ALARM)

    expect(create).toHaveBeenCalledWith({
      url: 'https://sync.test/auth/done',
      active: false,
    })
    // A silent refresh that never completes has to become visible eventually.
    expect((await alarm(TIMEOUT_ALARM))?.scheduledTime).toBe(NOW + 30_000)
  })

  it('marks the extension when a silent refresh does not finish', async () => {
    const badge = vi
      .spyOn(browser.action, 'setBadgeText')
      .mockResolvedValue(undefined)
    await watcher().watcher.handleAlarm(TIMEOUT_ALARM)

    expect(badge).toHaveBeenCalledWith({ text: '!' })
  })

  it('reconnects as soon as Access issues a new cookie', async () => {
    cookieIs(token(NOW + 60_000))
    const { watcher: w, onAuthenticated } = watcher()
    await fakeBrowser.alarms.create(TIMEOUT_ALARM, { when: NOW + 30_000 })

    await w.handleCookieChange('CF_Authorization')

    expect(onAuthenticated).toHaveBeenCalledOnce()
    expect(await alarm(TIMEOUT_ALARM)).toBeUndefined()
  })

  it('ignores other cookies on the same host', async () => {
    const { watcher: w, onAuthenticated } = watcher()
    await w.handleCookieChange('some_other_cookie')
    expect(onAuthenticated).not.toHaveBeenCalled()
  })

  it('does not announce a session that has already expired', async () => {
    cookieIs(token(NOW - 1))
    const { watcher: w, onAuthenticated } = watcher()
    await w.handleCookieChange('CF_Authorization')

    expect(onAuthenticated).not.toHaveBeenCalled()
  })
})
