import { WebSocket } from 'ws'
import { decodeServerFrame, encode } from '#/shared/protocol/codec'
import type { ClientFrame, ServerFrame } from '#/shared/protocol/messages'
import { PROTOCOL_VERSION } from '#/shared/protocol/ops'
import { devToken } from '../../scripts/dev-token'

/**
 * Another browser, without another browser.
 *
 * What the tests need from a second device is a second connection to the hub -
 * not a second Chrome. This is that connection: it says hello, it sends ops,
 * and it can be asked to wait for a frame.
 */
export interface SecondDevice {
  deviceId: string
  send: (frame: ClientFrame) => void
  next: (
    type: ServerFrame['type'],
    predicate?: (frame: ServerFrame) => boolean,
    timeoutMs?: number,
  ) => Promise<ServerFrame>
  close: () => void
}

const WORKER = 'http://localhost:3011'

export async function connectSecondDevice(
  deviceId = '22222222-2222-4222-8222-222222222222',
  name = 'Second device',
): Promise<SecondDevice> {
  const token = await devToken()
  const socket = new WebSocket(`ws://localhost:3011/ws?device=${deviceId}`, {
    headers: { Cookie: `CF_Authorization=${token}` },
  })

  const received: ServerFrame[] = []
  const waiting: Array<() => void> = []

  socket.on('message', (data: Buffer) => {
    const decoded = decodeServerFrame(data.toString())
    if (!decoded.ok) return
    received.push(decoded.frame)
    waiting.splice(0).forEach((wake) => wake())
  })

  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve())
    socket.once('error', reject)
  })

  const device: SecondDevice = {
    deviceId,
    send: (frame) => socket.send(encode(frame)),

    async next(type, predicate, timeoutMs = 5000) {
      const deadline = Date.now() + timeoutMs
      for (;;) {
        const found = received.find(
          (frame) => frame.type === type && (predicate?.(frame) ?? true),
        )
        if (found) return found
        if (Date.now() > deadline) {
          throw new Error(`no ${type} frame within ${timeoutMs}ms`)
        }
        await new Promise<void>((resolve) => {
          waiting.push(resolve)
          setTimeout(resolve, 50)
        })
      }
    },

    close: () => socket.close(),
  }

  device.send({
    type: 'hello',
    protocol: PROTOCOL_VERSION,
    deviceId,
    name,
    os: 'test',
    browserVersion: 'test',
    extensionVersion: '0.1.0',
    lastSeq: 0,
    lastClientSeq: 0,
  })
  await device.next('welcome')

  return device
}

export { WORKER }
