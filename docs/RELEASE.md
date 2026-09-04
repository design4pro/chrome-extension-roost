# Releasing to the Chrome Web Store

What the store asks for, what this repo already has, and what still has to be
made by hand. The procedure itself is Google's; the parts that are specific to
Roost are marked.

## Before the first submission

Three things do not exist yet in this repo and every one of them blocks the
upload:

1. **Extension icons.** `src/extension/public/` has no `icon-*.png`, and
   `wxt.config.ts` declares no `icons` key, so the built manifest has none.
   The store requires a 128x128 PNG (96x96 of artwork inside 16px of
   transparent padding); Chrome itself wants 16, 32, 48 and 128.
2. **Listing images.** At least one screenshot at 1280x800 or 640x400 - square
   corners, full bleed - and a 440x280 small promotional tile. The marquee at
   1400x560 is optional. The dashboard screenshots in `e2e/__screenshots__`
   are the right subject but the wrong size, so they are a source, not the
   asset.
3. **A public URL for the privacy policy.** [docs/PRIVACY.md](PRIVACY.md) is
   the text; the store wants a link, so the GitHub URL of that file will do.

## The account

Register a Chrome Web Store developer account at the
[developer dashboard](https://chrome.google.com/webstore/devconsole) and pay
the one-time registration fee (the dashboard shows the current amount). The
developer email cannot be changed afterwards, so use one that will still be
read in two years. A new publisher may have **two** published extensions at a
time, which is not a constraint here but is worth knowing.

Publishing under an organisation rather than a person needs a verified domain
or a Google Workspace account; that decision has to be made before the first
upload, because moving an item between publishers later is a support ticket.

## The package

```bash
pnpm build:extension   # sanity check: the build has to be clean first
pnpm zip               # wxt zip -> a .zip next to build/
```

Package size limit is 2GB; the bundle is under a megabyte, so it is not a
consideration. What is:

- **The `key` field.** `wxt.config.ts` pins the extension id
  (`bioblgelppeliobebbanmlebifhallik`) so that Chrome, Canary and Playwright
  all get the same origin. The store assigns its own id on first upload.
  Google's documentation describes `key` only as a development tool and does
  not say what happens to a store package that carries one. **Unresolved**:
  upload a draft with the current build and see. If the store rejects it, `key`
  becomes conditional on the build mode, the way `host_permissions` already is
  for `--mode e2e`, and a `tooling` test asserts the store build has no `key`
  while the development build does.
- **The version.** `package.json`'s `version` is what ends up in the manifest.
  The store refuses an upload whose version is not higher than the published
  one, and versions cannot be reused even after a rollback.

## The listing

The dashboard asks for these, and the ones with a Roost answer already written
are quoted:

| Field              | Answer                                                                                                                                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Single purpose     | Show and manage the tabs, tab groups, windows and bookmarks of the user's browsers in one place.                                                                                                                   |
| Short description  | The `extension_description` message: "See and manage the tabs and bookmarks of all your browsers in one place."                                                                                                    |
| Category           | Workflow & Planning                                                                                                                                                                                                |
| Privacy policy URL | The raw URL of [docs/PRIVACY.md](PRIVACY.md)                                                                                                                                                                       |
| Data usage         | Declares personal communications: no. Web history: **yes** - tab URLs are what it syncs. Sold to third parties: no. Used for anything unrelated to the single purpose: no. Used to determine creditworthiness: no. |

### Permission justifications

Every permission needs one sentence in the dashboard, and a broad host
permission is what draws a manual review. These are the true ones:

- `tabs` - reading which tabs are open, and their titles and urls, is the
  feature itself.
- `tabGroups` - the same, for the groups those tabs belong to.
- `bookmarks` - reading and mirroring the bookmark tree between browsers.
- `storage` and `unlimitedStorage` - a local mirror of the synced data so the
  dashboard opens without a round trip and a change survives a restart; a
  bookmark tree with tens of thousands of entries exceeds the 10MB default.
- `alarms` - the service worker is killed between events, so reconnection and
  the daily write budget are driven by alarms rather than timers.
- `favicon` - showing each tab's icon from Chrome's own cache instead of
  fetching it from the site.
- `optional_host_permissions: ["https://*/*"]` - the extension talks to one
  host: the Cloudflare Worker the user deployed to their own account. Its
  address is not known at build time, so the permission is requested at
  runtime, during onboarding, for that one address. **Explain this in the
  submission notes as well**, because a wildcard host permission read on its
  own looks like access to every site.

Add test instructions: the reviewer cannot exercise the extension without a
hub. Give them a Worker address and a pairing key that you can rotate
afterwards, and say in the notes that the extension is unusable without one -
otherwise the review sees an onboarding screen and nothing else.

## Review and after

Submission goes to review; Google states only that the duration depends on the
item, and a broad host permission plus a first submission is the slow path
rather than the fast one. Publication can be set to happen automatically on
approval or to wait.

Updates are the same procedure with a higher `version`: build, zip, upload,
submit. Chrome rolls an approved update out to installed browsers within a few
hours.

Two things that are permanent once the first version is public and are
therefore worth a second look before pressing submit:

- **The repository address.** The deploy button in the README and the
  onboarding screen point at
  `github.com/design4pro/chrome-extension-roost`. Renaming or privatising the
  repository breaks onboarding for everyone who already installed the
  extension.
- **The pairing model.** The listing has to say plainly that the user deploys
  and owns the backend, or the first review question will be where the data
  goes.
