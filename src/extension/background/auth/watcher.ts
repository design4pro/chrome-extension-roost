import type { browser as Chrome } from 'wxt/browser'
import type { Clock } from '../deps'
import type { Session } from './session'
import { evaluate } from './session'

/**
 * Keeping the Access session alive across two browsers and a sleeping worker.
 *
 * Chrome and Canary have separate cookie jars, so each signs in for itself. A
 * session lasts a month, and Access only issues a fresh cookie once the old one
 * has expired - so the refresh is scheduled for the moment after expiry and,
 * while the global session is still valid, completes without the user noticing.
 */

/** Access names its cookie this on every account. */
const COOKIE = 'CF_Authorization'

export const REFRESH_ALARM = 'auth-refresh'
export const TIMEOUT_ALARM = 'auth-timeout'

/** How long a silent refresh may take before the user has to be told. */
const TIMEOUT_MS = 30_000

export interface WatcherDeps {
  browser: typeof Chrome
  workerUrl: string
  clock: Clock
  /** A usable session appeared: the connection can be attempted again. */
  onAuthenticated: () => void
}

export interface Watcher {
  /** What the session is worth now, scheduling the next refresh as a result. */
  check: () => Promise<Session>
  /** Open the Worker's login page; in the background for a silent refresh. */
  requestLogin: (active: boolean) => Promise<void>
  handleAlarm: (name: string) => Promise<void>
  /** The cookie changed under us - Access issued, or the user signed out. */
  handleCookieChange: (name: string) => Promise<void>
}

export function createWatcher(deps: WatcherDeps): Watcher {
  const readCookie = async () => {
    const cookie = await deps.browser.cookies.get({
      url: deps.workerUrl,
      name: COOKIE,
    })
    return cookie?.value
  }

  const badge = (shown: boolean) =>
    deps.browser.action.setBadgeText({ text: shown ? '!' : '' })

  const check = async (): Promise<Session> => {
    const session = evaluate(await readCookie(), deps.clock())

    if (session.state === 'valid') {
      await badge(false)
      if (session.exp !== undefined) {
        // A second past expiry, not before it: Access refuses to issue a new
        // cookie while the old one is still good, so an early refresh is a
        // login page the user has to click through for nothing.
        await deps.browser.alarms.create(REFRESH_ALARM, {
          when: session.exp + 1000,
        })
      }
    }
    return session
  }

  const requestLogin = async (active: boolean) => {
    await deps.browser.tabs.create({
      url: new URL('/auth/done', deps.workerUrl).toString(),
      active,
    })
    if (!active) {
      // A background refresh that goes nowhere leaves the user offline with no
      // idea why, so give it a deadline and then say so.
      await deps.browser.alarms.create(TIMEOUT_ALARM, {
        when: deps.clock() + TIMEOUT_MS,
      })
    }
  }

  return {
    check,
    requestLogin,

    async handleAlarm(name) {
      if (name === REFRESH_ALARM) await requestLogin(false)
      if (name === TIMEOUT_ALARM) await badge(true)
    },

    async handleCookieChange(name) {
      if (name !== COOKIE) return
      const session = await check()
      if (session.state === 'valid') {
        await deps.browser.alarms.clear(TIMEOUT_ALARM)
        deps.onAuthenticated()
      }
    },
  }
}
