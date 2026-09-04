import { useEffect, useId, useState } from 'react'
import { browser } from 'wxt/browser'
import { probeWorker } from '../state/probe'
import { hubCandidates } from '../state/hubs'
import { DEPLOY_URL, generateSecret } from '../pairing'
import { t } from '../i18n'

/**
 * First run: deploy a hub, then say where it is.
 *
 * Both steps are on one page and in one form, because they are one decision -
 * splitting them would leave the user holding a key with nowhere to put it.
 * The host permission is requested here rather than declared in the manifest,
 * since the address is the user's own and unknown at build time, and it has to
 * happen inside the click: Chrome refuses `permissions.request` without a user
 * gesture. That gesture is also why a hub found among the open tabs is offered
 * as a button rather than adopted quietly - the check that proves the hub is
 * theirs is a network call, and the call needs the permission first.
 */

/** Kept across a reload, so the key on screen stays the one already deployed. */
const DRAFT_KEY = 'pairingDraft'

export function Onboarding({ onDone }: { onDone: () => void }) {
  const urlId = useId()
  const nameId = useId()
  const secretId = useId()
  const errorId = useId()
  const copiedId = useId()
  const shareId = useId()
  const shareNoteId = useId()

  const [url, setUrl] = useState('')
  const [secret, setSecret] = useState('')
  const [name, setName] = useState(defaultName())
  const [candidates, setCandidates] = useState<string[]>([])
  const [share, setShare] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void (async () => {
      // Re-pairing keeps the address and the name: only the key is in doubt.
      const saved = await browser.storage.local.get(['workerUrl', 'deviceName'])
      // What another browser of the user's paired with, if they asked for that
      // to travel. Prefilled here, never applied on its own.
      const synced = await browser.storage.sync.get([
        'workerUrl',
        'pairingSecret',
      ])

      const address = saved.workerUrl ?? synced.workerUrl
      if (typeof address === 'string') setUrl(address)
      if (typeof saved.deviceName === 'string') setName(saved.deviceName)
      if (typeof synced.pairingSecret === 'string') setShare(true)

      // The hub already knows the synced key, and a freshly minted one would
      // not be the key the user pasted into Cloudflare either, so the first
      // key wins and is written down.
      const draft = await browser.storage.session.get(DRAFT_KEY)
      const existing = synced.pairingSecret ?? draft[DRAFT_KEY]
      if (typeof existing === 'string') return setSecret(existing)

      const minted = generateSecret()
      await browser.storage.session.set({ [DRAFT_KEY]: minted })
      setSecret(minted)
    })()
  }, [])

  // A hub the user has just deployed is usually a tab they have just opened,
  // so the list follows the tabs rather than asking once and going stale.
  useEffect(() => {
    const refresh = () =>
      void browser.tabs
        .query({})
        .then((tabs) => setCandidates(hubCandidates(tabs)))

    refresh()
    browser.tabs.onUpdated.addListener(refresh)
    browser.tabs.onRemoved.addListener(refresh)
    return () => {
      browser.tabs.onUpdated.removeListener(refresh)
      browser.tabs.onRemoved.removeListener(refresh)
    }
  }, [])

  const copy = async () => {
    await navigator.clipboard.writeText(secret)
    setCopied(true)
  }

  const connect = async (address: string) => {
    setError(null)

    let origin: string
    try {
      const parsed = new URL(address)
      if (parsed.protocol !== 'https:') throw new Error('not https')
      origin = parsed.origin
    } catch {
      setError(t('onboarding_error_url'))
      return
    }

    const granted = await browser.permissions.request({
      origins: [`${origin}/*`],
    })
    if (!granted) {
      setError(t('onboarding_error_url'))
      return
    }

    setBusy(true)
    const result = await probeWorker(origin, secret)
    setBusy(false)

    if (result !== 'ok') {
      setError(
        t(
          result === 'wrong_key'
            ? 'onboarding_error_wrong_key'
            : 'onboarding_error_unreachable',
        ),
      )
      return
    }

    await browser.storage.local.set({
      workerUrl: origin,
      pairingSecret: secret,
      deviceName: name,
    })
    // Written on every pairing, so clearing the box in one browser is what
    // takes the key back out of the account it was travelling through.
    if (share) {
      await browser.storage.sync.set({
        workerUrl: origin,
        pairingSecret: secret,
      })
    } else {
      await browser.storage.sync.remove(['workerUrl', 'pairingSecret'])
    }

    await browser.storage.session.remove(DRAFT_KEY)
    onDone()
  }

  return (
    <main className="mx-auto mt-16 max-w-[480px] rounded-card bg-surface p-6 shadow-elevation-2">
      <h1 className="mt-0 text-[15px] font-medium">{t('onboarding_title')}</h1>
      <p className="text-on-surface-variant">{t('onboarding_body')}</p>

      <form
        onSubmit={(event) => {
          event.preventDefault()
          void connect(url)
        }}
      >
        <h2 className="mt-6 text-[13px] font-medium">
          {t('onboarding_step_deploy')}
        </h2>
        <p className="text-on-surface-variant">
          {t('onboarding_step_deploy_body')}
        </p>

        <label className="mt-4 block" htmlFor={secretId}>
          {t('onboarding_secret_label')}
        </label>
        <div className="mt-1 flex gap-2">
          <input
            id={secretId}
            value={secret}
            required
            spellCheck={false}
            aria-describedby={copied ? copiedId : undefined}
            onChange={(event) => {
              setSecret(event.target.value)
              setCopied(false)
            }}
            className="h-9 min-w-0 flex-1 rounded-menu border border-outline bg-surface px-3 font-mono text-on-surface"
          />
          <button
            type="button"
            onClick={() => void copy()}
            className="h-9 rounded-pill border border-outline bg-surface px-4 text-on-surface"
          >
            {t('onboarding_copy')}
          </button>
        </div>
        <p id={copiedId} role="status" className="text-on-surface-variant">
          {copied ? t('onboarding_copied') : ''}
        </p>

        {/*
          Cloudflare's own badge, served from the extension rather than from
          their CDN: an extension page that fetches a remote image tells
          Cloudflare whenever someone opens this screen, and shows nothing at
          all when the deploy page is the one thing the user cannot reach.
          The wording is baked into the artwork, so the localised string is
          the accessible name.
        */}
        <a
          href={DEPLOY_URL}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-block rounded-menu focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <img
            src="/deploy-button.svg"
            alt={t('onboarding_deploy_link')}
            width={184}
            height={39}
          />
        </a>

        <h2 className="mt-6 text-[13px] font-medium">
          {t('onboarding_step_connect')}
        </h2>

        {candidates.length === 0 ? null : (
          <>
            <p className="text-on-surface-variant">{t('onboarding_found')}</p>
            <ul className="m-0 mt-2 flex list-none flex-col items-start gap-2 p-0">
              {candidates.map((candidate) => (
                <li key={candidate}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void connect(candidate)}
                    className="h-9 rounded-pill border-0 bg-primary px-4 font-mono text-on-primary"
                  >
                    {new URL(candidate).host}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        <label className="mt-4 block" htmlFor={urlId}>
          {t('onboarding_url_label')}
        </label>
        <input
          id={urlId}
          type="url"
          value={url}
          required
          aria-describedby={error === null ? undefined : errorId}
          aria-invalid={error !== null}
          onChange={(event) => setUrl(event.target.value)}
          className="mt-1 h-9 w-full rounded-menu border border-outline bg-surface px-3 text-on-surface"
        />

        {/*
          Folded away rather than shouted: changing the address is a legitimate
          thing to do - a custom domain, or a hub redeployed under another name
          - and the reader about to do it is the one who opens this.
        */}
        <details className="mt-2">
          <summary className="cursor-pointer text-on-surface-variant">
            {t('onboarding_url_warning')}
          </summary>
          <ul className="mt-2 mb-0 pl-5 text-on-surface-variant">
            <li>{t('onboarding_url_warning_data')}</li>
            <li>{t('onboarding_url_warning_devices')}</li>
            <li>{t('onboarding_url_warning_permission')}</li>
            <li>{t('onboarding_url_warning_rename')}</li>
          </ul>
        </details>

        <label className="mt-4 block" htmlFor={nameId}>
          {t('onboarding_name_label')}
        </label>
        <input
          id={nameId}
          value={name}
          required
          onChange={(event) => setName(event.target.value)}
          className="mt-1 h-9 w-full rounded-menu border border-outline bg-surface px-3 text-on-surface"
        />

        <div className="mt-4 flex items-start gap-2">
          <input
            id={shareId}
            type="checkbox"
            checked={share}
            aria-describedby={shareNoteId}
            onChange={(event) => setShare(event.target.checked)}
            className="mt-1 size-4"
          />
          <div>
            <label htmlFor={shareId}>{t('onboarding_sync_label')}</label>
            <p id={shareNoteId} className="m-0 text-on-surface-variant">
              {t('onboarding_sync_note')}
            </p>
          </div>
        </div>

        {error === null ? null : (
          <p id={errorId} role="alert" className="text-error">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="mt-6 h-9 rounded-pill border-0 bg-primary px-6 text-on-primary"
        >
          {t('onboarding_connect')}
        </button>
      </form>
    </main>
  )
}

/**
 * Chrome does not say which channel it is, so the version is the best guess.
 *
 * `userAgentData` is Chromium-only and not in the DOM types, which is why it is
 * described here rather than imported from anywhere.
 */
interface UserAgentData {
  brands: Array<{ brand: string; version: string }>
  platform: string
}

function defaultName(): string {
  const data = (navigator as Navigator & { userAgentData?: UserAgentData })
    .userAgentData
  const brand = data?.brands.find((entry) => !entry.brand.includes('Not'))

  return brand === undefined
    ? 'This browser'
    : `${brand.brand} ${brand.version} on ${data?.platform ?? ''}`.trim()
}
