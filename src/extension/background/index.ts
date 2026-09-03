import type { browser as Chrome } from 'wxt/browser'
import type { Op } from '#/shared/protocol/ops'
import { PROTOCOL_VERSION } from '#/shared/protocol/ops'
import type { Hello } from '#/shared/protocol/messages'
import type { Clock, Random, Store, Uuid } from './deps'
import { createStore } from './storage'
import { createIdMap } from './ids/id-map'
import { createMirrorStore } from './mirror/store'
import { createWatcher, REFRESH_ALARM, TIMEOUT_ALARM } from './auth/watcher'
import type { OpenSocket } from './ws/client'
import { createClient, RETRY_ALARM, WATCHDOG_ALARM } from './ws/client'
import type { CaptureContext, DirtyKey } from './capture/dirty'
import { eventToDirty } from './capture/dirty'
import { subscribe } from './capture/events'
import { flush } from './capture/flush'
import type { ConnectionStatus } from '../port/protocol'
import { createPortHub } from './port'
import { openDashboard } from './open-dashboard'
import type { WsState } from './ws/state-machine'
import type { Coalescer } from './coalescer'
import { emptyCoalescer, mark, tick } from './coalescer'

/**
 * Wiring, and only wiring.
 *
 * Every decision this file appears to make has already been made by a pure
 * function somewhere below it. What is left is the order things happen in, the
 * timers, and which storage area each piece of state belongs to.
 */

const DIRTY_KEY = 'dirtyKeys'

export interface BackgroundDeps {
  browser: typeof Chrome
  openSocket: OpenSocket
  clock: Clock
  uuid: Uuid
  random: Random
}

export interface Background {
  /** The device this browser is, minted on first run. */
  deviceId: string
  /** Read the browser for everything outstanding and tell the hub. */
  flushNow: () => Promise<void>
  client: ReturnType<typeof createClient>
}

export async function startBackground(
  deps: BackgroundDeps,
): Promise<Background | undefined> {
  const local = createStore(deps.browser.storage.local)
  const session = createStore(deps.browser.storage.session)

  const workerUrl = await local.get<string>('workerUrl')
  // Until onboarding has run there is no hub to talk to, and capturing changes
  // nobody will ever read would only waste the user's storage.
  if (workerUrl === undefined) return undefined

  const deviceId = await identify(local, deps.uuid)
  const ids = createIdMap(session, deps.uuid)
  const mirror = createMirrorStore(local)

  const client = createClient({
    browser: deps.browser,
    store: local,
    mirror,
    openSocket: deps.openSocket,
    clock: deps.clock,
    random: deps.random,
    workerUrl,
    deviceId,
    hello: () => hello(deviceId, local, mirror, deps),
    snapshotAll: () => snapshotAll(deps, ids, deviceId),
    onCommands: () => {
      // Executing commands is the next layer up; delivery already works.
    },
    onApplied: (ops) => hub.broadcast(ops),
    requestLogin: () => void watcher.requestLogin(true),
  })

  const hub = createPortHub({
    browser: deps.browser,
    mirror,
    deviceId,
    connection: () => statusOf(client.state()),
  })

  const watcher = createWatcher({
    browser: deps.browser,
    workerUrl,
    clock: deps.clock,
    onAuthenticated: () => void client.authenticated(),
  })

  let coalescer: Coalescer = emptyCoalescer()
  let timer: ReturnType<typeof setTimeout> | undefined
  let context: CaptureContext = { restoreActive: [], bookmarksPaused: false }

  const flushNow = async () => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined

    const keys = (await session.get<DirtyKey[]>(DIRTY_KEY)) ?? []
    if (keys.length === 0) return

    // Cleared before the read, not after: a key that produces no op is a key
    // whose event has already been overtaken, and re-reading it would only ever
    // produce the same nothing.
    await session.set(DIRTY_KEY, [])
    const ops = await flush(keys, { browser: deps.browser, ids, deviceId })
    if (ops.length === 0) return

    // Our own changes are applied here as well: the hub does not send a device
    // its own ops back, so this is what keeps the local mirror complete.
    await mirror.apply(ops)
    hub.broadcast(ops)
    await client.send(ops)
  }

  const schedule = (at: number) => {
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(() => void onTick(), Math.max(0, at - deps.clock()))
  }

  const onTick = async () => {
    const [next, result] = tick(coalescer, deps.clock())
    coalescer = next
    if (result.flush) await flushNow()
    else if (result.nextDeadline !== undefined) schedule(result.nextDeadline)
  }

  subscribe(deps.browser, (event) => {
    if (event.type === 'bookmarks.import.began') {
      context = { ...context, bookmarksPaused: true }
    }
    if (event.type === 'bookmarks.import.ended') {
      context = { ...context, bookmarksPaused: false }
    }
    if (event.type === 'tab.replaced') {
      void ids.remap('tab', event.removedTabId, event.addedTabId)
    }

    const keys = eventToDirty(event, context)
    if (keys.length === 0) return
    void remember(session, keys).then(() => {
      const now = deps.clock()
      for (const key of keys) coalescer = mark(coalescer, key, now)
      return onTick()
    })
  })

  deps.browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === WATCHDOG_ALARM || alarm.name === RETRY_ALARM) {
      void client.handleAlarm(alarm.name).then(() => hub.announce())
    }
    if (alarm.name === REFRESH_ALARM || alarm.name === TIMEOUT_ALARM) {
      void watcher.handleAlarm(alarm.name)
    }
  })

  deps.browser.action.onClicked.addListener(
    () => void openDashboard(deps.browser),
  )

  deps.browser.cookies.onChanged.addListener((change) => {
    if (!change.removed) void watcher.handleCookieChange(change.cookie.name)
  })

  // Whatever the worker was killed in the middle of is still written down.
  await flushNow()
  await watcher.check()
  await client.start()
  hub.announce()

  return { deviceId, flushNow, client }
}

/** The connection as the dashboard needs to describe it. */
function statusOf(state: WsState): ConnectionStatus {
  switch (state.kind) {
    case 'open':
      return 'online'
    case 'auth_required':
      return 'auth_required'
    case 'paused_quota':
      return 'paused_quota'
    case 'incompatible':
      return 'incompatible'
    case 'connecting':
    case 'handshaking':
      return 'connecting'
    default:
      return 'offline'
  }
}

async function identify(local: Store, uuid: Uuid): Promise<string> {
  const existing = await local.get<string>('deviceId')
  if (existing !== undefined) return existing

  const minted = uuid()
  await local.set('deviceId', minted)
  return minted
}

async function remember(session: Store, keys: DirtyKey[]): Promise<void> {
  const current = (await session.get<DirtyKey[]>(DIRTY_KEY)) ?? []
  // Written down before anything is done about them: the service worker can be
  // stopped between the event and the flush, and an event is not repeated.
  await session.set(DIRTY_KEY, [...new Set([...current, ...keys])])
}

async function hello(
  deviceId: string,
  local: Store,
  mirror: ReturnType<typeof createMirrorStore>,
  deps: BackgroundDeps,
): Promise<Hello> {
  const { lastSeq } = await mirror.read()
  return {
    type: 'hello',
    protocol: PROTOCOL_VERSION,
    deviceId,
    name: (await local.get<string>('deviceName')) ?? 'This browser',
    os: navigator.platform,
    browserVersion: navigator.userAgent,
    extensionVersion: deps.browser.runtime.getManifest().version,
    lastSeq,
    lastClientSeq: 0,
  }
}

/** Every window this browser has open, as the ops that would produce them. */
async function snapshotAll(
  deps: BackgroundDeps,
  ids: ReturnType<typeof createIdMap>,
  deviceId: string,
): Promise<Op[]> {
  const windows = await deps.browser.windows.getAll()
  const keys = windows
    .filter((window) => window.id !== undefined)
    .map((window) => `window:${window.id}`)
  return flush(keys, { browser: deps.browser, ids, deviceId })
}
