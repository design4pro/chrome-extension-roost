# Tab Sync

One place to see and manage the open tabs, tab groups, windows and bookmarks of
every Chrome-family browser you use - and to reopen a 200-tab Canary window in
Chrome without waiting for 200 page loads.

Everything is stored in **your** Cloudflare account: one Worker, one SQLite
Durable Object per user, guarded by Cloudflare Access. There is no server run by
anyone else, and no account to create anywhere but Cloudflare.

- **Realtime** - a WebSocket to a Durable Object; a tab you open in Canary shows
  up in Chrome as fast as the round trip.
- **Native-looking** - the dashboard is a full page styled after
  `chrome://bookmarks` and Tab Search, light and dark, keyboard-complete.
- **Yours** - `pnpm setup:cloud` deploys the Worker and configures Access on
  your account and your domain.

## Getting started

Deploying takes about half an hour on a fresh Cloudflare account. The steps,
including the ones no script can do for you, are in [docs/DEPLOY.md](docs/DEPLOY.md).

## Working on it

```bash
pnpm install
pnpm dev          # the extension, rebuilt on save (.output/chrome-mv3)
pnpm dev:worker   # the Worker, on http://localhost:3011
pnpm test         # unit tests
pnpm e2e          # Playwright, against a real Chromium with the extension loaded
```

Load `.output/chrome-mv3` through **Load unpacked** in `chrome://extensions`, in
both Chrome and Canary. The extension id is pinned, so the same build gets the
same origin in both.

- [docs/SPEC.md](docs/SPEC.md) - what it does, and the rules it holds to
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) - how it is put together
- [docs/adr/](docs/adr/) - decisions and why they went that way
