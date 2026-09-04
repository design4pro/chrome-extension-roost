import type { Op } from '#/shared/protocol/ops'
import type { SecondDevice } from './second-device'

/**
 * A window of tabs, as if another browser had it open.
 *
 * The dashboard tests need something to render and nothing to do with how it
 * got there, so the second device sends one window snapshot and the hub
 * forwards it like any other change.
 */
export async function seedWindow(
  device: SecondDevice,
  {
    tabs = 3,
    windowId = 'w-second',
  }: { tabs?: number; windowId?: string } = {},
): Promise<void> {
  const tabIds = Array.from({ length: tabs }, (_unused, index) => `t-${index}`)

  const ops: Op[] = [
    {
      op: 'window_snapshot',
      id: windowId,
      data: {
        deviceId: device.deviceId,
        state: 'normal',
        bounds: null,
        focused: false,
        tabOrder: tabIds,
        closedAt: null,
      },
      groups: [
        {
          id: 'g-1',
          data: {
            deviceId: device.deviceId,
            windowId,
            title: 'Research',
            color: 'blue',
            collapsed: false,
          },
        },
      ],
      tabs: tabIds.map((id, index) => ({
        id,
        data: {
          deviceId: device.deviceId,
          windowId,
          groupId: index === 0 ? 'g-1' : null,
          url: `https://example.com/page-${index}`,
          title: `Second device page ${index}`,
          favIconUrl: null,
          pinned: false,
          discarded: false,
          active: index === 0,
          lastAccessed: 0,
        },
      })),
    },
  ]

  device.send({ type: 'ops', clientSeq: device.nextClientSeq(), ops })
  await device.next('ack')
}

/**
 * A bookmarks bar with a folder in it, as if another browser had it.
 *
 * Bookmarks are mirrored per browser, so this is the only way a test gets a
 * second tree to copy from - there is no merging and no second Chrome.
 */
/** Every bookmark id `seedBookmarks` writes, and so every one it can take back. */
const BOOKMARK_IDS = ['b-bar', 'b-folder', 'b-link']

/**
 * Take back the bookmarks this device seeded, whenever it was.
 *
 * The hub outlives the run, and a window is replaced wholesale by the next
 * snapshot - bookmarks are not. Without this they pile up under the second
 * device and turn up in the sidebar of a test that never asked for them.
 */
export async function forgetBookmarks(device: SecondDevice): Promise<void> {
  device.send({
    type: 'ops',
    clientSeq: device.nextClientSeq(),
    ops: BOOKMARK_IDS.map((id) => ({
      op: 'delete' as const,
      entity: 'bookmark' as const,
      id,
    })),
  })
  await device.next('ack')
}

export async function seedBookmarks(device: SecondDevice): Promise<void> {
  const bookmark = (
    id: string,
    partial: Partial<Omit<BookmarkSeed, 'deviceId'>>,
  ): Op => ({
    op: 'upsert',
    entity: 'bookmark',
    id,
    data: {
      deviceId: device.deviceId,
      parentId: null,
      position: 'n',
      title: '',
      url: null,
      isFolder: false,
      rootKind: null,
      dateAdded: 0,
      ...partial,
    },
  })

  device.send({
    type: 'ops',
    clientSeq: device.nextClientSeq(),
    ops: [
      bookmark('b-bar', {
        title: 'Bookmarks bar',
        isFolder: true,
        rootKind: 'bookmarks-bar',
        position: 'b',
      }),
      bookmark('b-folder', {
        title: 'Second device folder',
        isFolder: true,
        parentId: 'b-bar',
        position: 'b',
      }),
      bookmark('b-link', {
        title: 'Second device bookmark',
        url: 'https://example.com/saved',
        parentId: 'b-folder',
        position: 'b',
      }),
    ],
  })
  await device.next('ack', (frame) => frame.type === 'ack')
}

type BookmarkSeed = Extract<Op, { op: 'upsert'; entity: 'bookmark' }>['data']
