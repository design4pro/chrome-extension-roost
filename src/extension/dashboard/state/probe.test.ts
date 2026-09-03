import { describe, expect, it } from 'vitest'
import { probeWorker } from './probe'

const answering = (init: { status: number; type?: ResponseType }) =>
  (() =>
    Promise.resolve({
      status: init.status,
      type: init.type ?? 'basic',
    } as Response)) as unknown as typeof fetch

describe('probeWorker', () => {
  it.each([
    [
      'an opaque redirect',
      { status: 0, type: 'opaqueredirect' as ResponseType },
      'ok',
    ],
    ['a redirect', { status: 302 }, 'ok'],
    ['a rejected request', { status: 401 }, 'ok'],
    ['a forbidden request', { status: 403 }, 'ok'],
    ['an unprotected worker', { status: 204 }, 'no_access'],
    ['an unprotected page', { status: 200 }, 'no_access'],
    ['something else entirely', { status: 500 }, 'unreachable'],
  ])('reads %s', async (_name, init, expected) => {
    await expect(
      probeWorker('https://sync.example.com', answering(init)),
    ).resolves.toBe(expected)
  })

  it('treats a network failure as unreachable', async () => {
    const failing = (() =>
      Promise.reject(new Error('nope'))) as unknown as typeof fetch
    await expect(
      probeWorker('https://sync.example.com', failing),
    ).resolves.toBe('unreachable')
  })

  it('asks the health route, whatever path the address carries', async () => {
    const seen: string[] = []
    const recording = ((input: string) => {
      seen.push(input)
      return Promise.resolve({ status: 401, type: 'basic' } as Response)
    }) as unknown as typeof fetch

    await probeWorker('https://sync.example.com/', recording)
    expect(seen).toEqual(['https://sync.example.com/api/health'])
  })
})
