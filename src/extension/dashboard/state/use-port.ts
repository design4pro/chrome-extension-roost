import { useEffect, useState } from 'react'
import { browser } from 'wxt/browser'
import { applyOps } from '#/shared/mirror/apply'
import type { Mirror } from '#/shared/mirror/types'
import { emptyMirror } from '#/shared/mirror/types'
import type { ConnectionStatus, PortMessage } from '#/extension/port/protocol'
import { PORT_NAME } from '#/extension/port/protocol'

/**
 * The page's copy of the model, kept in step with the worker's.
 *
 * The port is also the liveness signal: Chrome tears it down when the service
 * worker is stopped, so a disconnect is not an error but the cue to connect
 * again, which is what wakes the worker back up.
 */
export interface PortState {
  mirror: Mirror
  deviceId: string
  connection: ConnectionStatus
}

const initial: PortState = {
  mirror: emptyMirror(),
  deviceId: '',
  connection: 'connecting',
}

export function usePort(): PortState {
  const [state, setState] = useState<PortState>(initial)

  useEffect(() => {
    let closed = false
    let port: ReturnType<typeof browser.runtime.connect> | undefined

    const connect = () => {
      if (closed) return
      port = browser.runtime.connect({ name: PORT_NAME })

      port.onMessage.addListener((message) => {
        const update = message as PortMessage
        setState((previous) =>
          update.type === 'state'
            ? {
                mirror: update.mirror,
                deviceId: update.deviceId,
                connection: update.connection,
              }
            : {
                ...previous,
                mirror: applyOps(previous.mirror, update.ops),
                connection: update.connection,
              },
        )
      })

      port.onDisconnect.addListener(() => {
        setState((previous) => ({ ...previous, connection: 'connecting' }))
        connect()
      })
    }

    connect()
    return () => {
      closed = true
      port?.disconnect()
    }
  }, [])

  return state
}
