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

  device.send({ type: 'ops', clientSeq: 1, ops })
  await device.next('ack')
}
