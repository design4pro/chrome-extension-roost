/**
 * Is there a hub at this address, and is Access actually in front of it?
 *
 * Deliberately a bare `fetch`: no `X-Requested-With`, because the redirect
 * Access answers with is the evidence we are looking for. A 200 without a
 * cookie would mean the Worker is exposed, which is a misconfiguration the
 * onboarding has to report rather than accept.
 */
export type ProbeResult = 'ok' | 'no_access' | 'unreachable'

export async function probeWorker(
  url: string,
  fetcher: typeof fetch = fetch,
): Promise<ProbeResult> {
  let response: Response
  try {
    response = await fetcher(new URL('/api/health', url).toString(), {
      redirect: 'manual',
      credentials: 'omit',
    })
  } catch {
    return 'unreachable'
  }

  // A manual redirect surfaces as an opaque response, and Access answers an
  // unauthenticated browser request with exactly that.
  if (response.type === 'opaqueredirect' || response.status === 0) return 'ok'
  if (response.status === 401 || response.status === 403) return 'ok'
  if (response.status >= 300 && response.status < 400) return 'ok'
  if (response.status === 200 || response.status === 204) return 'no_access'
  return 'unreachable'
}
