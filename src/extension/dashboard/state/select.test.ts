import { describe, expect, it } from 'vitest'
import type { Mirror } from '#/shared/mirror/types'
import { emptyMirror } from '#/shared/mirror/types'
import { buildRows, buildTree } from './select'

const tab = (
  windowId: string,
  title: string,
  groupId: string | null = null,
) => ({
  deviceId: 'device-a',
  windowId,
  groupId,
  url: `https://${title.toLowerCase()}.test/`,
  title,
  favIconUrl: null,
  pinned: false,
  discarded: false,
  active: false,
  lastAccessed: 1,
})

const mirror = (): Mirror => ({
  ...emptyMirror(),
  devices: {
    'device-a': {
      name: 'Chrome',
      os: 'macOS',
      browserVersion: '140',
      extensionVersion: '0.1.0',
      online: true,
      lastSeen: 1,
    },
    'device-b': {
      name: 'Canary',
      os: 'macOS',
      browserVersion: '141',
      extensionVersion: '0.1.0',
      online: false,
      lastSeen: 1,
    },
  },
  windows: {
    w1: {
      deviceId: 'device-a',
      state: 'normal',
      bounds: null,
      focused: true,
      tabOrder: ['t1', 't2', 't3'],
    },
  },
  tabGroups: {
    g1: {
      deviceId: 'device-a',
      windowId: 'w1',
      title: 'Reading',
      color: 'blue',
      collapsed: false,
    },
  },
  tabs: {
    t1: tab('w1', 'Alpha'),
    t2: tab('w1', 'Beta', 'g1'),
    t3: tab('w1', 'Gamma', 'g1'),
  },
})

const selection = { deviceId: 'device-a', kind: 'window' as const, id: 'w1' }

describe('the sidebar tree', () => {
  it('lists devices and marks which one is this browser', () => {
    const nodes = buildTree(mirror(), 'device-a', new Set())
    expect(nodes.map((node) => [node.label, node.kind])).toEqual([
      ['Canary', 'device'],
      ['Chrome', 'device'],
    ])
    expect(nodes.find((node) => node.label === 'Chrome')).toMatchObject({
      local: true,
      online: true,
    })
  })

  it('shows the windows of a device only when it is expanded', () => {
    expect(buildTree(mirror(), 'device-a', new Set(['device-a']))).toHaveLength(
      3,
    )
  })

  it('names a window after the tab it is showing', () => {
    const nodes = buildTree(mirror(), 'device-a', new Set(['device-a']))
    expect(nodes.at(-1)).toMatchObject({ label: 'Alpha', tabCount: 3 })
  })
})

describe('the tab list', () => {
  it('follows the order the window itself keeps', () => {
    const rows = buildRows(mirror(), selection, '')
    expect(
      rows.filter((row) => row.kind === 'tab').map((row) => row.id),
    ).toEqual(['t1', 't2', 't3'])
  })

  it('puts a header before the first tab of a group and not before the rest', () => {
    const rows = buildRows(mirror(), selection, '')
    expect(rows.map((row) => row.kind)).toEqual(['tab', 'group', 'tab', 'tab'])
  })

  it('filters within the selected window', () => {
    const rows = buildRows(mirror(), selection, 'bet')
    expect(
      rows.filter((row) => row.kind === 'tab').map((row) => row.id),
    ).toEqual(['t2'])
  })

  it('matches the address as well as the title', () => {
    expect(buildRows(mirror(), selection, 'gamma.test')).toHaveLength(2)
  })

  it('searches every device when nothing is selected', () => {
    const rows = buildRows(mirror(), null, 'alpha')
    expect(rows).toEqual([
      expect.objectContaining({ id: 't1', context: { deviceLabel: 'Chrome' } }),
    ])
  })

  it('shows nothing at all until something is selected or typed', () => {
    // Every tab of every device in one list is not a view anyone reads.
    expect(buildRows(mirror(), null, '')).toEqual([])
  })

  it('survives a window that has just been closed', () => {
    expect(buildRows(mirror(), { ...selection, id: 'gone' }, '')).toEqual([])
  })

  it('skips tabs the mirror has not caught up with', () => {
    const stale = mirror()
    delete stale.tabs.t2
    expect(buildRows(stale, selection, '').map((row) => row.id)).toEqual([
      't1',
      'g1',
      't3',
    ])
  })
})
