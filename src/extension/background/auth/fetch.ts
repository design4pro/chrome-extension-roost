/**
 * Talking to the Worker as the signed-in user.
 *
 * Access authenticates by cookie, and the cookie only travels because the
 * extension holds a host permission for the Worker's origin - that is what
 * makes these requests same-site. Everything here is about keeping that path
 * working and telling the difference between "not signed in" and "no network".
 */

export type ProbeResult = 'ok' | 'no_auth' | 'unreachable'

/**
 * Without this header Access answers an unauthenticated request with a redirect
 * to its login page, which a fetch cannot follow usefully. With it, the answer
 * is a plain 401 that the caller can act on.
 */
const AJAX_HEADER = { 'X-Requested-With': 'XMLHttpRequest' }

export type Fetch = typeof globalThis.fetch

/**
 * Why the socket closed: an expired session, or a hub that is simply not
 * reachable. The two look identical from a WebSocket, which is refused during
 * the upgrade and reports nothing but 1006.
 */
export async function probeAuth(
  workerUrl: string,
  doFetch: Fetch = fetch,
): Promise<ProbeResult> {
  try {
    const response = await doFetch(new URL('/api/health', workerUrl), {
      credentials: 'include',
      redirect: 'manual',
      headers: AJAX_HEADER,
    })
    if (response.status === 401 || response.status === 403) return 'no_auth'
    // An opaque redirect is Access sending us to its login page.
    if (response.type === 'opaqueredirect') return 'no_auth'
    return response.ok || response.status === 204 ? 'ok' : 'unreachable'
  } catch {
    return 'unreachable'
  }
}

/**
 * A request that carries the Access session.
 *
 * If the browser is set to block third-party cookies the cookie may not be
 * attached, so a refused request is tried once more with the token in a header
 * instead - which Access accepts, and which is the only reason the extension
 * ever reads the cookie's value.
 */
export async function authedFetch(
  input: URL | string,
  init: RequestInit,
  token: string | undefined,
  doFetch: Fetch = fetch,
): Promise<Response> {
  const request = {
    ...init,
    credentials: 'include' as const,
    headers: { ...AJAX_HEADER, ...init.headers },
  }

  const response = await doFetch(input, request)
  if (response.status !== 401 || token === undefined) return response

  return doFetch(input, {
    ...request,
    headers: { ...request.headers, 'cf-access-token': token },
  })
}
