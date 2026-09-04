import type { Mirror } from '#/shared/mirror/types'
import type { Op } from '#/shared/protocol/ops'

/**
 * Turning "this window is gone" into "this window is closed", in one place.
 *
 * Two things notice that a window has disappeared - the `windows.onRemoved`
 * handler and the reconciliation that runs when the browser starts - and both
 * say so the same way, with a delete. Rewriting the delete here rather than at
 * each of them means neither has to know that closed windows are kept, and
 * that the rule for how long they are kept lives with the rule that makes
 * them.
 *
 * A delete of a window the mirror does not have open passes straight through:
 * that is how "forget this one" from the dashboard reaches the hub without
 * being turned back into the thing it is trying to remove.
 */

/** How many closed windows a device keeps. The oldest beyond this go for good. */
export const KEEP_CLOSED = 10

export function closeWindows(
  ops: readonly Op[],
  mirror: Mirror,
  deviceId: string,
  now: number,
): Op[] {
  const closing = new Set<string>()

  const rewritten = ops.map((op): Op => {
    if (op.op !== 'delete' || op.entity !== 'window') return op

    const held = mirror.windows[op.id]
    if (held === undefined || held.closedAt !== null) return op

    closing.add(op.id)
    return {
      op: 'upsert',
      entity: 'window',
      id: op.id,
      // Everything it last looked like, except that it is no longer anywhere
      // and so no longer the window the user is looking at.
      data: { ...held, focused: false, closedAt: now },
    }
  })

  if (closing.size === 0) return rewritten
  return [...rewritten, ...expired(mirror, deviceId, closing, now)]
}

/**
 * The closed windows this device has one too many of.
 *
 * Counted over the mirror plus what is closing in this very batch, because a
 * browser that starts with five windows missing closes all five at once.
 */
function expired(
  mirror: Mirror,
  deviceId: string,
  closing: ReadonlySet<string>,
  now: number,
): Op[] {
  const closed = Object.entries(mirror.windows)
    .filter(([, data]) => data.deviceId === deviceId)
    .map(([id, data]) => ({
      id,
      closedAt: closing.has(id) ? now : data.closedAt,
    }))
    .filter((window): window is { id: string; closedAt: number } =>
      Boolean(window.closedAt),
    )
    // Newest first, and ties broken by id so that two windows closed in the
    // same millisecond - which is every window of a browser that just started -
    // are dropped in an order that does not depend on object iteration.
    .sort((a, b) => b.closedAt - a.closedAt || a.id.localeCompare(b.id))

  return closed
    .slice(KEEP_CLOSED)
    .map((window) => ({ op: 'delete', entity: 'window', id: window.id }))
}
