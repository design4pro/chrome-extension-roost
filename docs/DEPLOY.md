# Deploying your own hub

Tab Sync has no server run by anyone else. You deploy one Worker and one Durable
Object to your own Cloudflare account, put Cloudflare Access in front of it, and
point the extension at it. Everything below fits in about half an hour on a
fresh account, and everything except steps 1 and 2 is done by one command.

Free plans are enough: Workers, Durable Objects and Zero Trust all have free
tiers that this comfortably fits inside.

## What you need first

- A Cloudflare account.
- A domain in that account's Cloudflare DNS, on an **Active** zone. A free
  registrar domain is fine; a subdomain of it is where the hub will live (this
  guide uses `sync.example.com`).
- Node 24 and pnpm 10. `nvm use` picks up the version this repo pins.

## 1. Create the Zero Trust team (manual, one minute)

In the dashboard: **Zero Trust** -> pick a team name -> choose the **Free** plan.

Cloudflare asks for a payment method even on the free plan and does not charge
it. There is no API for this step, which is why it is here and not in the
script.

Write down the team name. Your login domain is `<team>.cloudflareaccess.com`.

## 2. Make an API token (manual, two minutes)

**My Profile -> API Tokens -> Create Token -> Custom token**, with these
permissions:

| Scope   | Permission                                            | Access |
| ------- | ----------------------------------------------------- | ------ |
| Account | Workers Scripts                                       | Edit   |
| Account | Access: Apps and Policies                             | Edit   |
| Account | Access: Organizations, Identity Providers, and Groups | Edit   |
| Zone    | DNS                                                   | Edit   |
| Zone    | Workers Routes                                        | Edit   |

Restrict it to the account and zone you are using. Nothing else needs it.

## 3. Run the setup

```bash
pnpm install
export CLOUDFLARE_API_TOKEN=...        # from step 2
export CLOUDFLARE_ACCOUNT_ID=...       # dashboard -> Workers & Pages, right column
export SYNC_HOSTNAME=sync.example.com  # where the hub will live
export OWNER_EMAIL=you@example.com     # the only address allowed to sign in
pnpm setup:cloud
```

It deploys the Worker, attaches the custom domain (DNS and the certificate come
with it), sets the Access session to 30 days, makes sure a one-time PIN login
exists, creates the Access application with a policy allowing only your address,
stores `TEAM_DOMAIN` and `POLICY_AUD` as Worker secrets, and finally checks that
`https://sync.example.com/api/health` is answered by Access rather than by the
Worker.

It is safe to run again. Every step looks for what the last run made before it
makes anything, so a failure halfway through is fixed by re-running.

The last line prints the address to paste into the extension.

## 4. Build and load the extension

```bash
pnpm build
```

In **both** Chrome and Chrome Canary: `chrome://extensions` -> **Developer
mode** on -> **Load unpacked** -> select `.output/chrome-mv3`.

The extension id is pinned in the manifest, so both browsers get the same id and
the same origin.

For a build you can hand to someone else, `pnpm zip` writes a packaged
`.output/tab-sync-<version>-chrome.zip`.

## 5. Sign in, once per browser

Click the toolbar icon. On first run the dashboard asks for two things:

- **Worker address** - `https://sync.example.com`, from step 3.
- **Name for this browser** - "Chrome" and "Canary" are the useful answers; the
  browser cannot tell you which channel it is, which is why you are asked.

Then **Connect**. Chrome asks for permission to talk to that host, Access opens
its login page, and a one-time PIN arrives at `OWNER_EMAIL`. After the PIN, the
tab says you can close it and the dashboard shows itself connected.

Repeat in the other browser. **This is not a bug**: Access cookies belong to a
browser profile, so Chrome and Canary sign in separately. After the second login
each shows the other's windows.

## When something is wrong

| What you see                                            | What it means                                                                                                                                  |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `no zone for example.com on this account`               | The domain is not in this account's Cloudflare DNS, or the zone is not Active yet.                                                             |
| `answered 204 with no Access in front of it`            | The Access application did not attach to the hostname. Re-run `pnpm setup:cloud`; if it repeats, check the application's domain in Zero Trust. |
| `answered 522`, or nothing at all                       | DNS or the certificate is still settling. Wait a minute and re-run.                                                                            |
| The dashboard says "Nothing answered at that address"   | The address is wrong, or the Worker is not deployed. `curl -I https://sync.example.com/api/health` should redirect or return 401.              |
| The dashboard says "not protected by Cloudflare Access" | The Worker is reachable without a login. Do not use it in this state - re-run the setup.                                                       |
| "Your session expired"                                  | The 30-day Access session ran out. Click the banner's login, or the toolbar icon, and repeat the PIN.                                          |
| "Your hub has used its daily write allowance"           | The free-plan write budget for today is gone. Syncing resumes tomorrow; nothing is lost, the queue drains when it lifts.                       |

`npx wrangler tail` shows the Worker's own view while you are trying things.

## Removing it

`npx wrangler delete` removes the Worker and, with it, the Durable Object and
every row in it. Delete the Access application in Zero Trust, and remove the
extension in both browsers. Nothing else is left behind.
