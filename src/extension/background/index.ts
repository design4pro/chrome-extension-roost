import type { Browser, browser as Chrome } from 'wxt/browser'
import type { Mirror } from '#/shared/mirror/types'
import type { Op } from '#/shared/protocol/ops'
import { PROTOCOL_VERSION } from '#/shared/protocol/ops'
import type { Hello } from '#/shared/protocol/messages'
import type { Clock, Random, Store, Uuid } from './deps'
import { createStore } from './storage'
import type { IdMap } from './ids/id-map'
import { createIdMap } from './ids/id-map'
import type { LocalWindow, RemoteWindow } from './ids/reconcile'
import { matchWindows } from './ids/reconcile'
import { closeWindows } from './history/close'
import { createMirrorStore } from './mirror/store'
import type { OpenSocket } from './ws/client'
import { createClient, RETRY_ALARM, WATCHDOG_ALARM } from './ws/client'
import type { CaptureContext, DirtyKey } from './capture/dirty'
import { eventToDirty } from './capture/dirty'
import { subscribe } from './capture/events'
import { flush } from './capture/flush'
import type { ConnectionStatus, DashboardMessage } from '../port/protocol'
import { createPortHub } from './port'
import { createAppliedRing } from './commands/applied-ring'
import { createRouter } from './commands/router'
import { executeTabCommand } from './commands/tab-executor'
import { executeBookmarkCommand } from './bookmarks/executor'
import { subtreeToCopy } from './bookmarks/mirror'
import { flushBookmarks } from './bookmarks/flush'
import { planRestore } from './restore/plan'
import { activeWindows, resumePending, runRestore } from './restore/run'
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
/** Set once the windows Chrome has now have been matched to the ones held. */
const RECONCILED_KEY = 'windowsReconciled'

/** Set once, the first time windows are found already gone. See `adoptHistory`. */
const HISTORY_ADOPTED_KEY = 'historyAdopted'

/** How far back the made-up dates of those first windows are scattered. */
const SPREAD = 14 * 24 * 60 * 60 * 1000

/**
 * A listener that exists from the first line and delivers once there is
 * somewhere to deliver to.
 *
 * Chrome hands the event that woke the service worker only to the listeners
 * registered by the end of the top-level evaluation, and everything this file
 * builds needs storage read first. So the listeners go up straight away and
 * what they catch waits here until the rest of the worker is standing.
 */
interface Deferred<T extends unknown[]> {
  emit: (...args: T) => void
  settle: (handler: (...args: T) => void) => void
}

function deferred<T extends unknown[]>(): Deferred<T> {
  const waiting: T[] = []
  let handler: ((...args: T) => void) | undefined

  return {
    emit: (...args) => {
      if (handler === undefined) waiting.push(args)
      else handler(...args)
    },
    settle: (next) => {
      handler = next
      for (const args of waiting.splice(0)) next(...args)
    },
  }
}

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
  // Both listeners go up before the first await. Chrome only hands the event
  // that woke the service worker to listeners that exist by the end of the
  // top-level evaluation, and the pairing write is the one event this worker
  // cannot afford to miss: onboarding writes it while the worker is already
  // running, and nothing else would wake it afterwards.
  deps.browser.action.onClicked.addListener(
    () => void openDashboard(deps.browser),
  )

  // The dashboard's port is the clearest case: opening the panel is often what
  // wakes the worker, and a port that arrives before its listener leaves the
  // page with nothing to render and Chrome saying the receiving end does not
  // exist. The alarms are the other one - they are what reconnects a worker
  // that was stopped, so missing them means staying offline.
  const ports: Deferred<[Browser.runtime.Port]> = deferred()
  deps.browser.runtime.onConnect.addListener((port) => ports.emit(port))

  const alarms: Deferred<[{ name: string }]> = deferred()
  deps.browser.alarms.onAlarm.addListener((alarm) => alarms.emit(alarm))

  const messages: Deferred<[unknown]> = deferred()
  deps.browser.runtime.onMessage.addListener((message) =>
    messages.emit(message),
  )

  const local = createStore(deps.browser.storage.local)

  // One attempt at a time, in a chain: the listener below can fire while the
  // read is still in flight, and two overlapping starts would mean two
  // connections and two capture subscriptions.
  let connected = false
  let chain: Promise<Background | undefined> = Promise.resolve(undefined)
  const attempt = (): Promise<Background | undefined> => {
    chain = chain.then(async (previous) => {
      if (connected) return previous
      const workerUrl = await local.get<string>('workerUrl')
      // Until onboarding has run there is no hub to talk to, and capturing
      // changes nobody will ever read would only waste the user's storage.
      if (workerUrl === undefined) return undefined
      connected = true
      return connect(deps, local, workerUrl, { ports, alarms, messages })
    })
    return chain
  }

  deps.browser.storage.local.onChanged.addListener((changes) => {
    if ('workerUrl' in changes) void attempt()
  })

  return attempt()
}

/**
 * Everything that needs a hub to talk to, once there is one.
 */
interface Waiting {
  ports: Deferred<[Browser.runtime.Port]>
  alarms: Deferred<[{ name: string }]>
  messages: Deferred<[unknown]>
}

async function connect(
  deps: BackgroundDeps,
  local: Store,
  workerUrl: string,
  waiting: Waiting,
): Promise<Background | undefined> {
  const session = createStore(deps.browser.storage.session)

  /**
   * The dirty keys, written one caller at a time.
   *
   * Remembering is a read followed by a write, and events arrive in bursts - a
   * copied bookmark subtree creates its folders one after another without
   * pausing. Two overlapping calls would both read the same list and the later
   * write would drop the earlier one's keys, which is a change nobody ever asks
   * about again: an event is not repeated. Taking the keys for a flush goes
   * through the same queue, so an event that lands mid-flush is kept for the
   * next one instead of being cleared along with the rest.
   */
  let writes: Promise<unknown> = Promise.resolve()

  const enqueue = <T>(step: () => Promise<T>): Promise<T> => {
    const run = writes.then(step)
    // A step that fails must not take the queue with it: the next event still
    // has to be written down, and it is the caller that hears about this one.
    writes = run.catch(() => undefined)
    return run
  }

  const remember = (keys: DirtyKey[]): Promise<void> =>
    enqueue(async () => {
      const current = (await session.get<DirtyKey[]>(DIRTY_KEY)) ?? []
      // Written down before anything is done about them: the service worker can
      // be stopped between the event and the flush, and an event is not
      // repeated.
      await session.set(DIRTY_KEY, [...new Set([...current, ...keys])])
    })

  const takeDirty = (): Promise<DirtyKey[]> =>
    enqueue(async () => {
      const keys = (await session.get<DirtyKey[]>(DIRTY_KEY)) ?? []
      if (keys.length > 0) await session.set(DIRTY_KEY, [])
      return keys
    })

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
    secret: () => local.get<string>('pairingSecret'),
    hello: () => hello(deviceId, local, mirror, deps),
    snapshotAll: () => snapshotAll(deps, ids, deviceId),
    onCommands: (items) => void router.onIncoming(items),
    onApplied: (ops) => hub.broadcast(ops),
    requestLogin: () => void badge(true),
  })

  const router = createRouter({
    deviceId,
    uuid: deps.uuid,
    ring: createAppliedRing(local),
    execute: async (body) =>
      (await executeTabCommand(body, { browser: deps.browser, ids })) ||
      (await executeBookmarkCommand(body, { browser: deps.browser })),
    send: (ops) => client.send(ops),
  })

  const restore = {
    browser: deps.browser,
    session,
    onStarted: async () => {
      // Read back from storage rather than appended in memory: a resume after
      // the worker was stopped starts from what is written down.
      context = { ...context, restoreActive: await activeWindows(session) }
    },
    onFinished: async (windowId: number) => {
      // The restored window is this browser's own from here on, so it is
      // captured the same way any other window would be.
      context = { ...context, restoreActive: await activeWindows(session) }
      await remember([`window:${windowId}`])
      await flushNow()
    },
  }

  const hub = createPortHub({
    browser: deps.browser,
    mirror,
    deviceId,
    connection: () => statusOf(client.state()),
    onMessage: (message) => onDashboardMessage(message),
  })

  const onDashboardMessage = async (message: DashboardMessage) => {
    if (message.type === 'command') {
      await router.dispatch(message.target, message.body)
      return
    }

    const { mirror: current } = await mirror.read()

    if (message.type === 'copy') {
      const parentId = barOf(current, deviceId)
      const nodes = subtreeToCopy(current, message.bookmarkId)
      if (parentId === undefined || nodes.length === 0) return
      await router.dispatch(deviceId, {
        kind: 'bookmark.copy',
        parentId,
        nodes,
      })
      return
    }

    if (message.type === 'forget') {
      await emit([{ op: 'delete', entity: 'window', id: message.windowId }])
      return
    }

    const window = current.windows[message.windowId]
    if (window === undefined) return

    const plan = planRestore(
      window,
      window.tabOrder.flatMap((id) => {
        const tab = current.tabs[id]
        return tab === undefined ? [] : [tab]
      }),
      current.tabGroups,
      deps.browser.runtime.getURL('/lazy.html'),
    )
    if (plan === null) return

    await runRestore(message.windowId, plan, restore)
  }

  /**
   * The toolbar's only job here: say that the hub is refusing this browser's
   * key. What to do about it is the dashboard's banner, and re-pairing there
   * is what clears this again.
   */
  const badge = (shown: boolean) =>
    deps.browser.action.setBadgeText({ text: shown ? '!' : '' })

  let coalescer: Coalescer = emptyCoalescer()
  let timer: ReturnType<typeof setTimeout> | undefined
  let context: CaptureContext = { restoreActive: [], bookmarksPaused: false }

  const flushNow = async () => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined

    // Taken rather than read: a key that produces no op is a key whose event
    // has already been overtaken, and re-reading it would only ever produce the
    // same nothing. Taking goes through the same queue as remembering, so an
    // event that arrives mid-flush is kept for the next one instead of being
    // cleared along with the keys this flush is about to read.
    const keys = await takeDirty()
    if (keys.length === 0) return
    const ops = [
      ...(await flush(keys, { browser: deps.browser, ids, deviceId })),
      ...(await flushBookmarks(keys, {
        browser: deps.browser,
        deviceId,
        // Positions already reported are what a folder is diffed against, so
        // a bookmark nobody moved keeps the key it has and writes no row.
        positions: positionsOf(await mirror.read(), deviceId),
      })),
    ]
    if (ops.length === 0) return

    await emit(ops)
  }

  /**
   * Everything this browser decides, on its way out.
   *
   * Our own changes are applied here as well: the hub does not send a device
   * its own ops back, so this is what keeps the local mirror complete.
   */
  const emit = async (ops: Op[]) => {
    // Read before applied, so that a window still counts as open at the moment
    // it is being closed. Reading the mirror twice at once is harmless here:
    // closing a window that is already closed only moves its date by the
    // milliseconds between the two reads, and forgetting one twice is a delete
    // either way.
    const { mirror: held } = await mirror.read()
    const all = closeWindows(ops, held, deviceId, deps.clock())

    await mirror.apply(all)
    hub.broadcast(all)
    await client.send(all)
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
    void remember(keys).then(() => {
      const now = deps.clock()
      for (const key of keys) coalescer = mark(coalescer, key, now)
      return onTick()
    })
  })

  waiting.ports.settle((port) => hub.accept(port))

  waiting.alarms.settle((alarm) => {
    if (alarm.name === WATCHDOG_ALARM || alarm.name === RETRY_ALARM) {
      void client.handleAlarm(alarm.name).then(() => hub.announce())
    }
  })

  // A key pasted into the dashboard lands in storage, not here: this is what
  // turns that write into another connection attempt without a restart.
  deps.browser.storage.local.onChanged.addListener((changes) => {
    if (!('pairingSecret' in changes)) return
    void badge(false).then(() => client.authenticated())
  })

  waiting.messages.settle((message: unknown) => {
    // The placeholder page cannot navigate itself to a `file:` URL.
    const request = message as { type?: string; url?: string }
    if (request.type !== 'lazy.open-file' || request.url === undefined) return
    void openLocalFile(deps.browser, request.url)
  })

  // The bookmark tree is sent whole once and then only in the parts that
  // change; an import replaces so much of it that it is sent whole again.
  if ((await local.get<number>('bookmarksSyncedAt')) === undefined) {
    await remember(['bookmarks'])
    await local.set('bookmarksSyncedAt', deps.clock())
  }

  // The windows this browser already has open, once per browser session.
  //
  // Nothing about a window that is merely open produces an event, so without
  // this a browser would show up in the panel with no tabs at all until the
  // user happened to open or close one. The marker lives in session storage
  // beside the id map, because the two are only ever right together: a restart
  // clears both, and it is the restart that leaves the hub holding windows
  // whose numbers nobody can match to anything any more.
  if ((await session.get<boolean>(RECONCILED_KEY)) !== true) {
    await session.set(RECONCILED_KEY, true)
    const { mirror: held } = await mirror.read()
    const stale = await reconcileWindows(deps.browser, ids, held, deviceId)

    // The windows that stayed keep their id and are re-described, which the hub
    // diffs - a window nobody touched writes no rows. The ones Chrome did not
    // bring back are closed rather than deleted, which `emit` does on the way
    // past, and which is what puts them in the history.
    await remember(await openWindowKeys(deps.browser))
    if (stale.length > 0) {
      await emit(
        stale.map((id) => ({ op: 'delete', entity: 'window', id }) as const),
      )
      await adoptHistory(stale)
    }
  }

  /**
   * Dates for the windows that were already lost when history was invented.
   *
   * Every window the hub is holding from before this feature existed goes
   * stale at the same moment - the first start after the update - and would
   * otherwise arrive as ten windows all closed in the same second, which is
   * both useless and untrue. These dates are made up, deliberately and once:
   * the marker lives in local storage rather than session storage so that it
   * survives the restart that would otherwise let this run again on windows
   * that really did close today.
   */
  async function adoptHistory(stale: string[]): Promise<void> {
    if ((await local.get<boolean>(HISTORY_ADOPTED_KEY)) === true) return
    await local.set(HISTORY_ADOPTED_KEY, true)

    const now = deps.clock()
    const { mirror: held } = await mirror.read()
    const ops = stale.flatMap((id) => {
      const window = held.windows[id]
      if (window === undefined) return []
      return [
        {
          op: 'upsert' as const,
          entity: 'window' as const,
          id,
          data: {
            ...window,
            closedAt: now - Math.floor(deps.random() * SPREAD),
          },
        },
      ]
    })

    if (ops.length > 0) await emit(ops)
  }

  // Whatever the worker was killed in the middle of is still written down.
  context = { ...context, restoreActive: await activeWindows(session) }
  await resumePending(restore)
  await flushNow()
  await client.start()
  hub.announce()

  return { deviceId, flushNow, client }
}

/**
 * A restored tab whose address is a local file. Chrome refuses this from the
 * page itself, and refuses it here too unless the user has ticked "Allow access
 * to file URLs" for the extension.
 */
async function openLocalFile(
  browser: typeof Chrome,
  url: string,
): Promise<void> {
  if (!(await browser.extension.isAllowedFileSchemeAccess())) return

  const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
  if (tab?.id !== undefined) await browser.tabs.update(tab.id, { url })
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

/** Where a copy lands: this browser's own bookmarks bar. */
function barOf(mirror: Mirror, deviceId: string): string | undefined {
  const found = Object.entries(mirror.bookmarks).find(
    ([, bookmark]) =>
      bookmark.deviceId === deviceId && bookmark.rootKind === 'bookmarks-bar',
  )
  return found?.[0]
}

/** What this device has told the hub about where its bookmarks sit. */
function positionsOf(
  snapshot: { mirror: Mirror },
  deviceId: string,
): Record<string, string> {
  const positions: Record<string, string> = {}
  for (const [id, bookmark] of Object.entries(snapshot.mirror.bookmarks)) {
    if (bookmark.deviceId === deviceId) positions[id] = bookmark.position
  }
  return positions
}

async function identify(local: Store, uuid: Uuid): Promise<string> {
  const existing = await local.get<string>('deviceId')
  if (existing !== undefined) return existing

  const minted = uuid()
  await local.set('deviceId', minted)
  return minted
}

/**
 * One write at a time, because this is a read followed by a write.
 *
 * Events arrive in bursts - a copied bookmark subtree creates its folders one
 * after another without pausing - and two overlapping calls would both read the
 * same list and the later write would drop the earlier one's keys. What is lost
 * that way is a change nobody ever asks about again, since an event is not
 * repeated.
 */
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

/** A dirty key per window this browser has open. */
async function openWindowKeys(browser: typeof Chrome): Promise<DirtyKey[]> {
  const windows = await browser.windows.getAll()
  return windows
    .filter((window) => window.id !== undefined)
    .map((window) => `window:${window.id}`)
}

/**
 * Match the windows Chrome has now to the ones the hub still holds, and adopt
 * the ids of those that came back. Returns the ones that did not.
 *
 * Chrome numbers windows per session and the id map lives in session storage,
 * so after a restart every restored window looks new while the hub still holds
 * the row it replaces. Matching is by content, because content is all that
 * survives a restart - see `ids/reconcile.ts` for how much has to agree.
 */
async function reconcileWindows(
  browser: typeof Chrome,
  ids: IdMap,
  held: Mirror,
  deviceId: string,
): Promise<string[]> {
  const windows = await browser.windows.getAll({ populate: true })
  const local: LocalWindow[] = windows.flatMap((window) =>
    window.id === undefined
      ? []
      : [
          {
            chromeId: window.id,
            tabs: (window.tabs ?? []).map((tab) => ({
              url: tab.url ?? '',
              pinned: tab.pinned,
            })),
          },
        ],
  )

  const remote: RemoteWindow[] = Object.entries(held.windows)
    .filter(([, window]) => window.deviceId === deviceId)
    .map(([id, window]) => ({
      id,
      tabs: window.tabOrder.flatMap((tabId) => {
        const tab = held.tabs[tabId]
        return tab === undefined ? [] : [{ url: tab.url, pinned: tab.pinned }]
      }),
    }))

  const { pairs, staleRemote } = matchWindows(local, remote)
  for (const pair of pairs) await ids.adopt('window', pair.chromeId, pair.id)
  return staleRemote
}

/** Every window this browser has open, as the ops that would produce them. */
async function snapshotAll(
  deps: BackgroundDeps,
  ids: ReturnType<typeof createIdMap>,
  deviceId: string,
): Promise<Op[]> {
  return flush(await openWindowKeys(deps.browser), {
    browser: deps.browser,
    ids,
    deviceId,
  })
}
