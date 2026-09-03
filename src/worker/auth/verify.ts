import { createLocalJWKSet, createRemoteJWKSet, jwtVerify } from 'jose'
import type { JWTVerifyGetKey } from 'jose'

/** Who Cloudflare Access says is calling. `sub` names the Durable Object. */
export interface AccessIdentity {
  sub: string
  email: string
}

export interface VerifierEnv {
  /** `https://<team>.cloudflareaccess.com` - the JWKS issuer. */
  TEAM_DOMAIN: string
  /** The Access application's `aud` tag. */
  POLICY_AUD: string
  /**
   * A local JWKS, set only in `.dev.vars`. It replaces the remote key set when
   * the request is to localhost, so `wrangler dev` and the e2e suite can sign
   * their own tokens - but signature, issuer and audience are still checked.
   * There is no path here that accepts an unverified token.
   */
  DEV_JWKS?: string
}

/**
 * Access puts the token in a header on requests it proxies. The other two are
 * for requests the extension makes itself: `cf-access-token` when the browser
 * refuses to attach the cookie (third-party cookie blocking), and the cookie
 * itself for the WebSocket upgrade, which cannot carry custom headers.
 */
function readToken(request: Request): string | null {
  const header =
    request.headers.get('Cf-Access-Jwt-Assertion') ??
    request.headers.get('cf-access-token')
  if (header) return header

  const cookie = request.headers.get('Cookie')
  if (!cookie) return null
  for (const pair of cookie.split(';')) {
    const [name, ...rest] = pair.trim().split('=')
    if (name === 'CF_Authorization') return rest.join('=')
  }
  return null
}

// The remote key set caches keys and refetches on rotation, so it is built once
// per isolate rather than per request.
const remoteKeySets = new Map<string, JWTVerifyGetKey>()

function keySetFor(env: VerifierEnv, isLocal: boolean): JWTVerifyGetKey {
  if (isLocal && env.DEV_JWKS) {
    return createLocalJWKSet(JSON.parse(env.DEV_JWKS))
  }
  const url = `${env.TEAM_DOMAIN}/cdn-cgi/access/certs`
  let keySet = remoteKeySets.get(url)
  if (!keySet) {
    keySet = createRemoteJWKSet(new URL(url))
    remoteKeySets.set(url, keySet)
  }
  return keySet
}

export type Verifier = (request: Request) => Promise<AccessIdentity | null>

export function createVerifier(env: VerifierEnv): Verifier {
  return async (request) => {
    const token = readToken(request)
    if (!token) return null

    const isLocal = new URL(request.url).hostname === 'localhost'
    try {
      const { payload } = await jwtVerify(token, keySetFor(env, isLocal), {
        issuer: env.TEAM_DOMAIN,
        audience: env.POLICY_AUD,
      })
      // `email` is informational - it is shown nowhere and used for nothing but
      // logs. `sub` is the identity that matters: it picks the Durable Object.
      if (typeof payload.sub !== 'string' || payload.sub === '') return null
      return {
        sub: payload.sub,
        email: typeof payload.email === 'string' ? payload.email : '',
      }
    } catch {
      return null
    }
  }
}
