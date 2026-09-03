import type { Verifier } from './auth/verify'

export interface RouterEnv {
  USER_HUB: DurableObjectNamespace
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const unauthorized = () =>
  new Response(JSON.stringify({ error: 'unauthorized' }), {
    status: 401,
    headers: {
      'content-type': 'application/json',
      // Without this, Access's own redirect to the login page is what a fetch
      // sees, and the extension cannot tell "sign in again" from "the network
      // is down". Access honours it; this covers the case where the request
      // reached the Worker with a token that no longer verifies.
      'cache-control': 'no-store',
    },
  })

/**
 * Landing page for the login tab.
 *
 * The extension opens this URL, Access intercepts it, the user signs in, and
 * Access sets CF_Authorization for the host before letting the request through
 * to here. Reaching this handler at all is the signal that the cookie exists;
 * the page's only job is to be harmless while the extension closes the tab.
 */
const AUTH_DONE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Signed in</title>
<style>
  :root { color-scheme: light dark; font-family: system-ui, sans-serif }
  body { margin: 0; display: grid; place-items: center; min-height: 100vh }
  p { color: light-dark(#444746, #c4c7c5); font-size: 13px }
</style></head>
<body><main><h1>Signed in</h1><p>You can close this tab.</p></main></body></html>`

export async function route(
  request: Request,
  env: RouterEnv,
  verify: Verifier,
): Promise<Response> {
  const url = new URL(request.url)

  const identity = await verify(request)
  if (!identity) return unauthorized()

  switch (url.pathname) {
    case '/auth/done':
      return new Response(AUTH_DONE, {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      })

    // Used to tell "the token is stale" apart from "the network is down" after
    // a socket closes with 1006, which carries no reason of its own.
    case '/api/health':
      return new Response(null, { status: 204 })

    case '/ws': {
      const device = url.searchParams.get('device')
      if (!device || !UUID.test(device)) {
        return new Response('a valid ?device= is required', { status: 400 })
      }
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('expected a websocket upgrade', { status: 426 })
      }
      return hub(env, identity.sub).fetch(request)
    }

    case '/api/snapshot':
      return hub(env, identity.sub).fetch(request)

    default:
      return new Response('not found', { status: 404 })
  }
}

const hub = (env: RouterEnv, sub: string) =>
  env.USER_HUB.get(env.USER_HUB.idFromName(sub))
