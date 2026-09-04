# Privacy policy

_Last updated: 2026-09-04_

Roost is a Chrome extension and a Cloudflare Worker. The Worker runs on the
Cloudflare account of the person using it. There is no service operated by the
author of this extension, and no account to create anywhere else.

## What the extension reads

To do its job the extension reads, from the browser it is installed in:

- open tabs: url, title, favicon url, pinned and audible state, and which
  window and tab group each belongs to;
- tab groups: title, colour, collapsed state;
- windows: type, state, and screen position;
- bookmarks: title, url, and folder structure;
- a name for the browser, which the user types during setup.

The extension does not read page contents, form data, cookies, browsing
history, or anything from a page it did not itself open.

## Where it goes

Only to the address the user pasted in during setup: their own Cloudflare
Worker, over TLS, authenticated with a pairing key their browser generated.
The Worker stores that data in a SQLite Durable Object in the user's own
Cloudflare account, and hands it back to the user's other browsers.

The data reaches nobody else. There is no analytics, no telemetry, no crash
reporting, no advertising identifier, and no third-party endpoint of any kind.

Favicons are fetched by Chrome from its own cache (the `favicon` permission);
the extension does not request them from the sites themselves.

## What is stored where

- **In the browser** (`chrome.storage.local` / `session`): the hub address, the
  browser name, the pairing key, and a mirror of the synced data, so the
  dashboard opens instantly and a queued change survives a restart.
- **In the user's Cloudflare account**: the same data, for every paired
  browser, plus up to ten recently closed windows per browser so they can be
  reopened.
- **Optionally, in the Google account**: if - and only if - the user ticks the
  box during setup, the hub address and pairing key are put in
  `chrome.storage.sync`, so their other Chrome browsers pick them up. The box
  is off by default.

## Deleting it

Removing the extension deletes everything it kept in the browser. The data in
the Worker is deleted by deleting the Worker in the Cloudflare dashboard;
nobody else can do it, because nobody else has access to it.

## Contact

Issues and questions:
https://github.com/design4pro/chrome-extension-roost/issues
