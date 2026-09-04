import { beforeEach, describe, expect, it, vi } from 'vitest'
import { browser } from 'wxt/browser'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import { decodeClientFrame, encode } from '#/shared/protocol/codec'
import type { ClientFrame, ServerFrame } from '#/shared/protocol/messages'
import { WS_SUBPROTOCOL } from '#/shared/protocol/ws'
import type { PortMessage } from '../port/protocol'
import { PORT_NAME } from '../port/protocol'
import type { Background } from './index'
import { startBackground } from './index'
import type { SocketHandlers } from './ws/client'

const WORKER = 'https://sync.test'
const SECRET = 'pairing-key-under-test'

/** A socket the test drives from the hub's side. */
const fakeSocket = () => {
  const sent: ClientFrame[] = []
  let handlers: SocketHandlers | undefined
  let url = ''
  let protocols: string[] = []

  return {
    sent,
    url: () => url,
    protocols: () => protocols,
    openSocket: (
      socketUrl: string,
      socketProtocols: string[],
      socketHandlers: SocketHandlers,
    ) => {
      url = socketUrl
      protocols = socketProtocols
      handlers = socketHandlers
      queueMicrotask(() => socketHandlers.onOpen())
      return {
        send: (data: string) => {
          if (data === 'ping') return
          const decoded = decodeClientFrame(data)
          // The hub would close the connection over a frame it cannot read, so
          // the test refuses to let one pass quietly.
          if (!decoded.ok)
            throw new Error(`unreadable frame: ${decoded.reason}`)
          sent.push(decoded.frame)
        },
        close: () => undefined,
      }
    },
    deliver: (frame: ServerFrame) => handlers?.onMessage(encode(frame)),
    hangUp: (code: number) => handlers?.onClose(code),
  }
}

/** The fake browser's events can be fired; its types do not say so. */
type FakeEvent = { trigger: (...args: unknown[]) => Promise<unknown> }

/** A dashboard's end of the port, as much of one as the worker touches. */
const fakePort = (received: PortMessage[]) => ({
  name: PORT_NAME,
  postMessage: (message: PortMessage) => received.push(message),
  onMessage: { addListener: () => undefined },
  onDisconnect: { addListener: () => undefined },
})

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

const RESTORED = 'https://restored.test/'
const GONE = 'https://gone.test/'

/** Every op this browser sent, in order. */
const opsOf = (frames: ClientFrame[]) =>
  frames.flatMap((frame) => (frame.type === 'ops' ? frame.ops : []))

/** The id of the window described as showing this page, if one was. */
const windowShowing = (frames: ClientFrame[], url: string) =>
  opsOf(frames).find(
    (op) =>
      op.op === 'window_snapshot' &&
      op.tabs.some((tab) => tab.data.url === url),
  )?.id

/** A window with one page open in it, and the number Chrome gave it. */
const windowShowingPage = async (url: string): Promise<number> => {
  const created = await fakeBrowser.windows.create({})
  const id = created?.id
  if (id === undefined) throw new Error('a window with no id')
  await fakeBrowser.tabs.create({ windowId: id, url })
  return id
}

/**
 * Tell the worker the hub took everything it has sent.
 *
 * The send queue is written to storage before the frame goes out and survives a
 * restart, so a run that was never acked replays into the next one - which
 * would make the run after a restart look like it described what the run before
 * it did.
 */
const ackAll = async () => {
  let seq = 0
  for (const frame of socket.sent) {
    if (frame.type !== 'ops') continue
    socket.deliver({ type: 'ack', clientSeq: frame.clientSeq, seq: ++seq })
  }
  await settle()
}

/**
 * A run of the worker, with ids that say which run minted them - two runs
 * counting from one would make "the id it already had" true by accident.
 */
const startRun = async (run: string): Promise<Background> => {
  socket = fakeSocket()
  let n = 0
  const background = await startBackground({
    browser,
    openSocket: socket.openSocket,
    clock: () => Date.now(),
    uuid: () => `${run}-${++n}`,
    random: () => 0.5,
  })
  await settle()
  socket.deliver({ type: 'welcome', seq: 0, mode: 'snapshot' })
  await settle()
  return background as Background
}

/** Started with whatever storage the test left, and without a live hub. */
const startBare = () =>
  startBackground({
    browser,
    openSocket: fakeSocket().openSocket,
    clock: () => Date.now(),
    uuid: () => 'id',
    random: () => 0.5,
  })

let socket: ReturnType<typeof fakeSocket>

const start = async (): Promise<Background> => {
  socket = fakeSocket()
  let n = 0
  const background = await startBackground({
    browser,
    openSocket: socket.openSocket,
    clock: () => Date.now(),
    uuid: () => `id-${++n}`,
    random: () => 0.5,
  })
  await settle()
  socket.deliver({ type: 'welcome', seq: 0, mode: 'snapshot' })
  await settle()
  return background as Background
}

beforeEach(async () => {
  vi.spyOn(browser.runtime, 'getManifest').mockReturnValue({
    version: '0.1.0',
  } as never)
  vi.spyOn(browser.cookies, 'get').mockResolvedValue(null as never)
  vi.spyOn(browser.action, 'setBadgeText').mockResolvedValue(undefined)
  await fakeBrowser.storage.local.set({
    workerUrl: WORKER,
    pairingSecret: SECRET,
  })
})

describe('the background worker end to end', () => {
  it('syncs nothing at all before onboarding', async () => {
    await fakeBrowser.storage.local.remove('workerUrl')
    expect(await startBare()).toBeUndefined()
  })

  it('connects as soon as onboarding writes down where the hub is', async () => {
    // What the dashboard does at the end of onboarding is a storage write. If
    // the worker only noticed it on the next restart, a browser that had just
    // been paired would sit there doing nothing.
    await fakeBrowser.storage.local.remove('workerUrl')
    socket = fakeSocket()
    await startBackground({
      browser,
      openSocket: socket.openSocket,
      clock: () => Date.now(),
      uuid: () => 'id',
      random: () => 0.5,
    })

    await fakeBrowser.storage.local.set({ workerUrl: WORKER })
    await settle()

    expect(socket.url()).toContain('wss://sync.test/ws')
  })

  it('still opens the dashboard from the toolbar before onboarding', async () => {
    // The only way in: with no hub there is nothing to sync, but the toolbar
    // button is what the user reaches for to set one up.
    await fakeBrowser.storage.local.remove('workerUrl')
    await startBare()

    await fakeBrowser.action.onClicked.trigger({ id: 1 } as never)
    await settle()

    const tabs = await fakeBrowser.tabs.query({})
    expect(tabs.map((tab) => tab.url)).toContain(
      browser.runtime.getURL('/dashboard.html'),
    )
  })

  it('connects as the device it minted on first run', async () => {
    const background = await start()
    expect(socket.url()).toBe(
      `wss://sync.test/ws?device=${background.deviceId}`,
    )

    const hello = socket.sent[0]
    expect(hello).toMatchObject({
      type: 'hello',
      deviceId: background.deviceId,
    })
  })

  it('carries the pairing key in the subprotocol list, never in the URL', async () => {
    await start()

    expect(socket.protocols()).toEqual([WS_SUBPROTOCOL, SECRET])
    // The Worker's invocation logs record the URL of every request, so a key
    // that leaks into it is a key published to whoever can read them.
    expect(socket.url()).not.toContain(SECRET)
  })

  it('still offers the protocol when this browser has no key yet', async () => {
    await fakeBrowser.storage.local.remove('pairingSecret')
    await start()

    expect(socket.protocols()).toEqual([WS_SUBPROTOCOL])
  })

  it('tells the hub about a tab the user opened', async () => {
    const background = await start()
    const window = await fakeBrowser.windows.create({})
    await fakeBrowser.tabs.create({
      windowId: window?.id,
      url: 'https://a.test/',
    })
    await settle()

    await background.flushNow()

    const ops = socket.sent.flatMap((frame) =>
      frame.type === 'ops' ? frame.ops : [],
    )
    expect(ops).toContainEqual(
      expect.objectContaining({ op: 'window_snapshot' }),
    )
  })

  it('answers a dashboard that connected while it was still starting', async () => {
    // Chrome wakes the worker for the port and then hands the event only to
    // listeners that were there at the end of the top-level evaluation. This
    // worker reads storage before it has anything to hand the page, so the port
    // arrives in the middle of that - and a port nobody answers is a dashboard
    // that shows nothing at all.
    socket = fakeSocket()
    const listening = vi.spyOn(browser.runtime.onConnect, 'addListener')
    const starting = startBackground({
      browser,
      openSocket: socket.openSocket,
      clock: () => Date.now(),
      uuid: () => 'id',
      random: () => 0.5,
    })

    // Asserted before anything is awaited, because that is the whole rule:
    // by the time this function yields, the listener has to exist.
    expect(listening).toHaveBeenCalled()

    const received: PortMessage[] = []
    void (fakeBrowser.runtime.onConnect as never as FakeEvent).trigger(
      fakePort(received),
    )

    await starting
    await settle()

    expect(received.map((message) => message.type)).toContain('state')
  })

  it('describes the windows that were already open when it was paired', async () => {
    // Nothing about a window that is simply open produces an event, so a
    // browser paired mid-session would stay invisible in every other browser's
    // panel until the user happened to open or close a tab.
    const window = await fakeBrowser.windows.create({})
    await fakeBrowser.tabs.create({
      windowId: window?.id,
      url: 'https://already-open.test/',
    })

    const background = await start()
    await background.flushNow()

    const ops = socket.sent.flatMap((frame) =>
      frame.type === 'ops' ? frame.ops : [],
    )
    expect(ops).toContainEqual(
      expect.objectContaining({ op: 'window_snapshot' }),
    )
  })

  it('keeps a restored window as one row instead of two', async () => {
    // Chrome numbers windows per session and the id map lives beside them in
    // session storage, so after a restart every restored window looks new while
    // the hub still holds the row it replaces. Without matching them the panel
    // grows a fresh set of ghosts per browser start.
    await windowShowingPage(RESTORED)
    const closed = await windowShowingPage(GONE)

    const before = await startRun('before')
    await before.flushNow()
    const keptId = windowShowing(socket.sent, RESTORED)
    const goneId = windowShowing(socket.sent, GONE)
    expect(keptId).toBeDefined()
    await ackAll()

    // The browser restarts: session storage goes, the mirror does not, and one
    // of the two windows does not come back.
    await fakeBrowser.windows.remove(closed)
    await fakeBrowser.storage.session.clear()

    const after = await startRun('after')
    await after.flushNow()

    // Described under the id it already had - a new one would be the ghost -
    // and the window Chrome did not bring back is closed rather than deleted,
    // which is what leaves it in the history with its tabs still on it.
    expect(windowShowing(socket.sent, RESTORED)).toBe(keptId)
    const closing = opsOf(socket.sent).find(
      (op) => op.op === 'upsert' && op.entity === 'window' && op.id === goneId,
    )
    expect(closing).toBeDefined()
    expect(closing).toMatchObject({ data: { closedAt: expect.any(Number) } })

    // A delete would have taken the tabs with it through the cascade, and a
    // window whose tabs are gone is a row nobody can reopen.
    expect(opsOf(socket.sent)).not.toContainEqual({
      op: 'delete',
      entity: 'window',
      id: goneId,
    })
  })

  it('loses nothing when two events land in the same tick', async () => {
    const background = await start()

    // Not awaited one after the other on purpose. Every event is written down
    // before it is acted on, and that write is a read followed by a write - so
    // two events that overlap are exactly the case where one can overwrite the
    // other's key. A copied bookmark subtree is the real version of this: its
    // folders are created in one burst.
    await Promise.all([
      fakeBrowser.windows.create({}),
      fakeBrowser.windows.create({}),
    ])
    await settle()

    await background.flushNow()

    const snapshots = socket.sent
      .flatMap((frame) => (frame.type === 'ops' ? frame.ops : []))
      .filter((op) => op.op === 'window_snapshot')
    expect(new Set(snapshots.map((op) => op.id)).size).toBe(2)
  })

  it('applies what another device did', async () => {
    await start()
    socket.deliver({
      type: 'changes',
      seqFrom: 0,
      seqTo: 3,
      ops: [
        {
          op: 'upsert',
          entity: 'device',
          id: 'device-b',
          data: {
            name: 'Canary',
            os: 'macOS',
            browserVersion: '141',
            extensionVersion: '0.1.0',
            online: true,
            lastSeen: 1,
          },
        },
      ],
    })
    await settle()

    const stored = await fakeBrowser.storage.local.get(['mirror', 'lastSeq'])
    expect(Object.keys((stored.mirror as { devices: object }).devices)).toEqual(
      ['device-b'],
    )
    expect(stored.lastSeq).toBe(3)
  })

  it('keeps what it could not send and sends it on reconnect', async () => {
    // The queue is written before the frame goes out, so a socket that dies
    // mid-flush costs a repeat the hub refuses, never a lost change.
    const background = await start()
    socket.hangUp(1006)

    const window = await fakeBrowser.windows.create({})
    await fakeBrowser.tabs.create({
      windowId: window?.id,
      url: 'https://a.test/',
    })
    await settle()
    await background.flushNow()

    const queue = (await fakeBrowser.storage.local.get('queue')).queue as {
      batches: unknown[]
    }
    expect(queue.batches.length).toBeGreaterThan(0)
  })
})
