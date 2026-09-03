import { describe, expect, it, vi } from 'vitest'
import type { Fetch } from './fetch'
import { authedFetch, probeAuth } from './fetch'

const responding = (...responses: Array<Response | Error>) => {
  const calls: Array<[URL | string, RequestInit | undefined]> = []
  const doFetch = vi.fn((input: unknown, init?: RequestInit) => {
    calls.push([input as URL | string, init])
    const next = responses.shift()
    return next instanceof Error
      ? Promise.reject(next)
      : Promise.resolve(next ?? new Response(null, { status: 204 }))
  }) as unknown as Fetch
  return { doFetch, calls }
}

describe('asking the hub whether we are signed in', () => {
  it('reads a healthy answer as signed in', async () => {
    const { doFetch } = responding(new Response(null, { status: 204 }))
    expect(await probeAuth('https://sync.test', doFetch)).toBe('ok')
  })

  it('reads a refusal as signed out', async () => {
    const { doFetch } = responding(new Response(null, { status: 401 }))
    expect(await probeAuth('https://sync.test', doFetch)).toBe('no_auth')
  })

  it('reads being sent to a login page as signed out', async () => {
    // Access answers an unauthenticated browser with a redirect it will not let
    // us read; that opacity is itself the answer.
    const opaque = { status: 0, ok: false, type: 'opaqueredirect' } as Response
    const { doFetch } = responding(opaque)

    expect(await probeAuth('https://sync.test', doFetch)).toBe('no_auth')
  })

  it('reads a failed request as a network problem, not a login problem', async () => {
    const { doFetch } = responding(new Error('offline'))
    expect(await probeAuth('https://sync.test', doFetch)).toBe('unreachable')
  })

  it('asks for a plain answer instead of a redirect', async () => {
    const { doFetch, calls } = responding()
    await probeAuth('https://sync.test', doFetch)

    expect(calls[0]?.[1]).toMatchObject({
      credentials: 'include',
      redirect: 'manual',
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    })
  })
})

describe('requests that carry the session', () => {
  it('sends the cookie and nothing else when that works', async () => {
    const { doFetch, calls } = responding(new Response('{}', { status: 200 }))
    await authedFetch('https://sync.test/api/snapshot', {}, 'token', doFetch)

    expect(calls).toHaveLength(1)
    expect(calls[0]?.[1]?.headers).not.toHaveProperty('cf-access-token')
  })

  it('falls back to the token in a header when the cookie did not travel', async () => {
    // A browser set to block third-party cookies will not attach it. Access
    // accepts the same token as a header, which is the only reason we read it.
    const { doFetch, calls } = responding(
      new Response(null, { status: 401 }),
      new Response('{}', { status: 200 }),
    )
    const response = await authedFetch(
      'https://sync.test/api/snapshot',
      {},
      'token',
      doFetch,
    )

    expect(response.status).toBe(200)
    expect(calls[1]?.[1]?.headers).toMatchObject({ 'cf-access-token': 'token' })
  })

  it('gives up when there is no token to fall back to', async () => {
    const { doFetch, calls } = responding(new Response(null, { status: 401 }))
    const response = await authedFetch(
      'https://sync.test/api/snapshot',
      {},
      undefined,
      doFetch,
    )

    expect(response.status).toBe(401)
    expect(calls).toHaveLength(1)
  })
})
