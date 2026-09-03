import type { Mirror } from '#/shared/mirror/types'
import type { TabData, TabGroupData } from '#/shared/protocol/ops'

/**
 * Turning the mirror into the two lists the page renders.
 *
 * Pure, and deliberately flat: the tab list is virtualised, so it has to be an
 * array of rows of known height rather than a nested structure, and a sticky
 * group header is a row like any other.
 */

export interface Selection {
  deviceId: string
  kind: 'window' | 'folder'
  id: string
}

export interface DeviceNode {
  kind: 'device'
  id: string
  label: string
  online: boolean
  /** This browser, as opposed to one of the user's others. */
  local: boolean
  level: 1
}

export interface WindowNode {
  kind: 'window'
  id: string
  deviceId: string
  label: string
  tabCount: number
  level: 2
}

export type TreeNode = DeviceNode | WindowNode

export interface GroupRow {
  kind: 'group'
  id: string
  title: string
  color: TabGroupData['color']
}

export interface TabRow {
  kind: 'tab'
  id: string
  data: TabData
  /** Where this tab lives, for the rows a search returns from everywhere. */
  context?: { deviceLabel: string }
}

export type Row = GroupRow | TabRow

/** The sidebar: every device, and under it every window it has open. */
export function buildTree(
  mirror: Mirror,
  thisDeviceId: string,
  expanded: ReadonlySet<string>,
): TreeNode[] {
  const nodes: TreeNode[] = []

  for (const [id, device] of sorted(mirror.devices, (a, b) =>
    a[1].name.localeCompare(b[1].name),
  )) {
    nodes.push({
      kind: 'device',
      id,
      label: device.name,
      online: device.online,
      local: id === thisDeviceId,
      level: 1,
    })
    if (!expanded.has(id)) continue

    for (const [windowId, window] of sorted(mirror.windows, () => 0)) {
      if (window.deviceId !== id) continue
      nodes.push({
        kind: 'window',
        id: windowId,
        deviceId: id,
        // A window has no name of its own; the tab it is showing is the closest
        // thing to one, and it is what the user recognises it by.
        label: mirror.tabs[window.tabOrder[0] ?? '']?.title ?? '',
        tabCount: window.tabOrder.length,
        level: 2,
      })
    }
  }

  return nodes
}

/** The right-hand panel: a window's tabs, or everything a search matched. */
export function buildRows(
  mirror: Mirror,
  selection: Selection | null,
  query: string,
): Row[] {
  const trimmed = query.trim().toLowerCase()

  if (selection === null) {
    // Nothing selected and nothing typed is an empty panel on purpose: showing
    // every tab of every device at once is a list nobody reads.
    return trimmed === '' ? [] : searchRows(mirror, trimmed)
  }

  const window = mirror.windows[selection.id]
  if (window === undefined) return []

  const rows: Row[] = []
  let currentGroup: string | null = null

  for (const tabId of window.tabOrder) {
    const tab = mirror.tabs[tabId]
    if (tab === undefined) continue
    if (trimmed !== '' && !matches(tab, trimmed)) continue

    if (tab.groupId !== currentGroup) {
      currentGroup = tab.groupId
      const group =
        currentGroup === null ? undefined : mirror.tabGroups[currentGroup]
      if (group !== undefined && currentGroup !== null) {
        rows.push({
          kind: 'group',
          id: currentGroup,
          title: group.title,
          color: group.color,
        })
      }
    }

    rows.push({ kind: 'tab', id: tabId, data: tab })
  }

  return rows
}

/** A search with nothing selected looks at every device the user has. */
function searchRows(mirror: Mirror, query: string): Row[] {
  return Object.entries(mirror.tabs)
    .filter(([, tab]) => matches(tab, query))
    .map(([id, tab]) => ({
      kind: 'tab' as const,
      id,
      data: tab,
      context: { deviceLabel: mirror.devices[tab.deviceId]?.name ?? '' },
    }))
}

const matches = (tab: TabData, query: string) =>
  tab.title.toLowerCase().includes(query) ||
  tab.url.toLowerCase().includes(query)

function sorted<T>(
  record: Record<string, T>,
  compare: (a: [string, T], b: [string, T]) => number,
): Array<[string, T]> {
  return Object.entries(record).sort(compare)
}
