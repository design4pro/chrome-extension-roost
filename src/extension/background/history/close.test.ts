import { describe, expect, it } from 'vitest'
import type { Mirror } from '#/shared/mirror/types'
import type { Op, WindowData } from '#/shared/protocol/ops'
import { KEEP_CLOSED, closeWindows } from './close'

const DEVICE = 'this-browser'
const NOW = 1_700_000_000_000

const windowData = (over: Partial<WindowData> = {}): WindowData => ({
  deviceId: DEVICE,
  state: 'normal',
  bounds: null,
  focused: false,
  tabOrder: ['t1'],
  closedAt: null,
  ...over,
})

const mirror = (windows: Record<string, WindowData>): Mirror => ({
  devices: {},
  windows,
  tabs: {},
  tabGroups: {},
  bookmarks: {},
})

const remove = (id: string): Op => ({ op: 'delete', entity: 'window', id })

describe('closeWindows', () => {
  it('keeps a window that has gone, with the time it was missed', () => {
    const held = windowData({ focused: true, tabOrder: ['t1', 't2'] })
    const ops = closeWindows([remove('w1')], mirror({ w1: held }), DEVICE, NOW)

    // The tabs are what makes it restorable, so the row has to keep saying
    // which ones they were - a delete would take them with it.
    expect(ops).toEqual([
      {
        op: 'upsert',
        entity: 'window',
        id: 'w1',
        data: { ...held, focused: false, closedAt: NOW },
      },
    ])
  })

  it('lets a delete of an already closed window through', () => {
    // This is the dashboard forgetting one on purpose. Rewriting it would make
    // the row immortal: every attempt to remove it would put it back.
    const ops = closeWindows(
      [remove('w1')],
      mirror({ w1: windowData({ closedAt: NOW - 1000 }) }),
      DEVICE,
      NOW,
    )

    expect(ops).toEqual([remove('w1')])
  })

  it('lets a delete of a window it never knew through', () => {
    expect(closeWindows([remove('w1')], mirror({}), DEVICE, NOW)).toEqual([
      remove('w1'),
    ])
  })

  it('passes everything that is not a window delete through untouched', () => {
    const ops: Op[] = [
      { op: 'delete', entity: 'tab', id: 't1' },
      {
        op: 'upsert',
        entity: 'window',
        id: 'w1',
        data: windowData(),
      },
    ]

    expect(
      closeWindows(ops, mirror({ w1: windowData() }), DEVICE, NOW),
    ).toEqual(ops)
  })

  it(`forgets the oldest once there are more than ${KEEP_CLOSED} closed`, () => {
    const windows: Record<string, WindowData> = {}
    // Numbered so that a plain sort by id is not the same as a sort by time:
    // w0 is the oldest, and the ids are two digits so that string order does
    // not accidentally agree with it either.
    for (let index = 0; index < KEEP_CLOSED; index += 1) {
      windows[`w${String(index).padStart(2, '0')}`] = windowData({
        closedAt: NOW - (KEEP_CLOSED - index) * 1000,
      })
    }
    windows.live = windowData()

    const ops = closeWindows(
      [remove('live')],
      mirror(windows),
      DEVICE,
      NOW,
    ).filter((op) => op.op === 'delete')

    expect(ops).toEqual([remove('w00')])
  })

  it('never forgets another device to make room for this one', () => {
    const windows: Record<string, WindowData> = { live: windowData() }
    for (let index = 0; index < KEEP_CLOSED; index += 1) {
      windows[`other-${index}`] = windowData({
        deviceId: 'somewhere-else',
        closedAt: NOW - 100_000,
      })
    }

    const ops = closeWindows([remove('live')], mirror(windows), DEVICE, NOW)

    // Only this browser prunes its own history: the other device's rows are
    // its business, and it is the one that knows whether they are still there.
    expect(ops.filter((op) => op.op === 'delete')).toEqual([])
  })

  it('closes a whole browser at once and still keeps only ten', () => {
    // A browser that starts with everything gone closes every window in one
    // batch, all at the same millisecond - the case a per-window rule misses.
    const windows: Record<string, WindowData> = {}
    for (let index = 0; index < KEEP_CLOSED + 3; index += 1) {
      windows[`w${String(index).padStart(2, '0')}`] = windowData()
    }

    const ops = closeWindows(
      Object.keys(windows).map(remove),
      mirror(windows),
      DEVICE,
      NOW,
    )

    expect(ops.filter((op) => op.op === 'upsert')).toHaveLength(KEEP_CLOSED + 3)
    expect(ops.filter((op) => op.op === 'delete')).toHaveLength(3)
  })
})
