# Proving the foundations (phase 0)

Everything in this repo rests on two facts that no amount of testing on this
machine can establish, because both are about what a real Cloudflare Access
session does to a real Chrome:

- **(b)** the `CF_Authorization` cookie is attached to a WebSocket upgrade, so
  `wss://sync.example.com/ws` gets through Access.
- **(d)** a host permission the user grants at runtime, in the onboarding
  screen, is enough to make that happen - as opposed to one baked into the
  manifest at build time.

If (b) fails, the hub needs a second transport and the design changes. If (d)
fails, every user has to run `pnpm build` with their own hostname compiled in,
and there is no packaged zip to hand anyone. Neither is a small edit, which is
why this comes before the release and not after it.

Three more questions are worth answering while you are set up; they change how
the thing is documented rather than how it is built.

Run this once, on your own account, in **both** Chrome and Chrome Canary.

## Before you start

`docs/DEPLOY.md` steps 1 to 4: the Zero Trust team, the API token, the domain,
`pnpm setup:cloud`, and `.output/chrome-mv3` loaded in both browsers. This
document assumes `sync.example.com` where you have your own hostname.

Keep `npx wrangler tail` running in a terminal. It is the Worker's own account
of what reached it, and it settles most arguments about what happened.

## The part that runs itself

```bash
export SYNC_HOSTNAME=sync.example.com
export CLOUDFLARE_API_TOKEN=...   # the same token as the setup, for check (e)
export CLOUDFLARE_ACCOUNT_ID=...
pnpm verify:cloud --redeploy
```

This answers **(a)** Access really is in front of the hostname, **(e)** the
`workers.dev` hostname serves nothing, and **(g)** a second `wrangler deploy`
leaves the custom domain attached. Every line says PASS, FAIL or SKIP and why.

`--redeploy` deploys the Worker again, so run it when you are not in the middle
of something.

## (b) The cookie and the socket

1. Click the toolbar icon. Fill in the Worker address and a name, press
   **Connect**, and let Chrome's permission prompt through.
2. Sign in with the one-time PIN. The tab says you can close it.
3. Open the service worker console: `chrome://extensions` -> Tab Sync ->
   **service worker**. Paste:

   ```js
   await chrome.cookies.get({
     url: 'https://sync.example.com',
     name: 'CF_Authorization',
   })
   ```

   **Expected:** an object, not `null`.

4. Open a few tabs. The dashboard should list them within a second or two, and
   `wrangler tail` should show the `sub` claim of your identity on the `/ws`
   request.

   **Expected:** the dashboard shows no banner at all. A banner reading
   "Connecting to your hub…" that never goes away is the failure this whole
   document exists to find.

5. Now take the cookie away, without touching the open socket:

   ```js
   await chrome.cookies.remove({
     url: 'https://sync.example.com',
     name: 'CF_Authorization',
   })
   ```

   Open another tab. **Expected:** it still appears in the dashboard. Access
   checks the cookie when the socket is opened, not while it is held.

6. Force a reconnect: on `chrome://extensions`, press **service worker** ->
   **Stop**, then click the toolbar icon.

   **Expected:** the dashboard shows "Your session expired. Sign in again to
   keep syncing.", and the toolbar icon carries a `!` badge. Signing in again
   restores it.

**(b) passes** when steps 3, 4 and 5 all match, and step 6 produces the
sign-in banner rather than an offline one.

## (d) The permission you granted, not the one we compiled

There is nothing extra to do here: the extension ships with
`optional_host_permissions`, and the prompt you accepted in step 1 of (b) is
the runtime grant. Confirm it was really that, in the service worker console:

```js
await chrome.permissions.contains({ origins: ['https://sync.example.com/*'] })
// true
chrome.runtime.getManifest().host_permissions
// undefined
```

**(d) passes** when the first is `true`, the second is `undefined`, and (b)
passed. That combination is the whole claim: a permission granted after
install was enough for the fetches, the cookie read and the socket.

## (f) The service worker dies constantly

1. With the dashboard connected, press **Stop** on the service worker.
2. Wait for the watchdog alarm - up to 30 seconds - without touching anything.

   **Expected:** the worker restarts by itself and the dashboard reconnects.
   `wrangler tail` shows a new `/ws`.

3. Leave both browsers alone for five minutes with the dashboard open.

   **Expected:** still connected. The socket pings every 20 seconds, which is
   what keeps Chrome from killing the worker as idle.

## (c) Third-party cookies blocked

`chrome://settings/cookies` -> **Block third-party cookies**. Reload the
dashboard.

This is a measurement, not a gate. Report what happens: still connected, or a
banner. If the socket dies here, the fallback described in `docs/SPEC.md` is
what v1 needs, and that is worth knowing before anyone else installs this.

## What to send back

| Check | Question                                           | Chrome | Canary |
| ----- | -------------------------------------------------- | ------ | ------ |
| (a)   | Access answers first                               |        |        |
| (b)   | cookie rides the WebSocket upgrade                 |        |        |
| (c)   | survives blocked third-party cookies               |        |        |
| (d)   | runtime host permission is enough                  |        |        |
| (e)   | workers.dev serves nothing                         |        |        |
| (f)   | reconnects after the worker is killed, idles 5 min |        |        |
| (g)   | custom domain survives a redeploy                  |        |        |

Anything that failed: the exact banner text, and the last few lines of
`wrangler tail`. Those two together are usually enough to say what happened.

The results become `docs/adr/0001-poc-access-ws.md`, and (b) and (d) are what
the release waits on.
