import { describe, expect, it } from 'vitest'
import type { Op } from '#/shared/protocol/ops'
import type { Store } from '../deps'
import { createMirrorStore } from './store'

const memoryStore = () => {
  const data = new Map<string, unknown>()
  const store: Store = {
    get: <T>(key: string) => Promise.resolve(data.get(key) as T | undefined),
    set: (key, value) => {
      data.set(key, value)
      return Promise.resolve()
    },
    remove: (key) => {
      data.delete(key)
      return Promise.resolve()
    },
  }
  return { store, data }
}

const tab = (id: string): Op => ({
  op: 'upsert',
  entity: 'tab',
  id,
  data: {
    deviceId: 'device-a',
    windowId: 'w1',
    groupId: null,
    url: `https://example.test/${id}`,
    title: id,
    favIconUrl: null,
    pinned: false,
    discarded: false,
    active: false,
    lastAccessed: 1,
  },
})

const device = (id: string): Op => ({
  op: 'upsert',
  entity: 'device',
  id,
  data: {
    name: id,
    os: 'test',
    browserVersion: 'test',
    extensionVersion: '0.1.0',
    online: true,
    lastSeen: 1,
  },
})

describe('the local mirror', () => {
  it('starts empty', async () => {
    const { store } = memoryStore()
    expect(await createMirrorStore(store).read()).toEqual({
      mirror: {
        devices: {},
        windows: {},
        tabs: {},
        tabGroups: {},
        bookmarks: {},
      },
      lastSeq: 0,
    })
  })

  it('remembers what it applied across a restart', async () => {
    const { store } = memoryStore()
    await createMirrorStore(store).apply([tab('t1')], 4)

    const reopened = await createMirrorStore(store).read()
    expect(Object.keys(reopened.mirror.tabs)).toEqual(['t1'])
    expect(reopened.lastSeq).toBe(4)
  })

  it('keeps its place when applying its own changes', async () => {
    // A device's own ops are not echoed back by the hub, so they are applied
    // here without a sequence number - which must not move the hub's position.
    const { store } = memoryStore()
    const mirror = createMirrorStore(store)
    await mirror.apply([tab('t1')], 4)

    expect((await mirror.apply([tab('t2')])).lastSeq).toBe(4)
  })

  it('loses nothing when two frames arrive in the same tick', async () => {
    // Frames are handled as they land, without waiting for the one before, and
    // on connect they land in a burst: what the hub had missed, then the row it
    // broadcasts for the device that just said hello. Both read the mirror
    // before either has written it, so without a queue the second write is the
    // whole state and the first frame's ops are gone.
    const { store } = memoryStore()
    const mirror = createMirrorStore(store)

    await Promise.all([
      mirror.apply([tab('t1')], 1),
      mirror.apply([device('d1')], 2),
    ])

    const reopened = await createMirrorStore(store).read()
    expect(Object.keys(reopened.mirror.tabs)).toEqual(['t1'])
    expect(Object.keys(reopened.mirror.devices)).toEqual(['d1'])
    expect(reopened.lastSeq).toBe(2)
  })

  it('forgets everything when told to start over', async () => {
    const { store, data } = memoryStore()
    const mirror = createMirrorStore(store)
    await mirror.apply([tab('t1')], 4)
    await mirror.reset()

    expect(await mirror.read()).toEqual({
      mirror: {
        devices: {},
        windows: {},
        tabs: {},
        tabGroups: {},
        bookmarks: {},
      },
      lastSeq: 0,
    })
    expect(data.size).toBe(0)
  })
})
