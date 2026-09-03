import type { Mirror } from '#/shared/mirror/types'
import type { Op } from '#/shared/protocol/ops'

/**
 * What the dashboard and the service worker say to each other.
 *
 * The dashboard is a page that comes and goes while the model lives in the
 * worker, so a connection starts with the whole state and continues as the same
 * ops the hub sends. One shape of update, one `applyOps` on the other end.
 */

export const PORT_NAME = 'dashboard'

/** What to tell the user about the connection, if anything. */
export type ConnectionStatus =
  | 'connecting'
  | 'online'
  | 'offline'
  | 'auth_required'
  | 'paused_quota'
  | 'incompatible'

export interface StateMessage {
  type: 'state'
  mirror: Mirror
  /** Which device this browser is, so its own rows can be marked as local. */
  deviceId: string
  connection: ConnectionStatus
}

export interface PatchMessage {
  type: 'patch'
  ops: Op[]
  connection: ConnectionStatus
}

export type PortMessage = StateMessage | PatchMessage
