import { useId, useState } from 'react'
import { browser } from 'wxt/browser'
import { probeWorker } from '../state/probe'
import { t } from '../i18n'

/**
 * First run: where the hub is, and what to call this browser.
 *
 * The host permission is requested here rather than declared in the manifest,
 * because the address is the user's own and unknown at build time. It has to
 * happen inside the click: Chrome refuses `permissions.request` without a
 * user gesture.
 */
export function Onboarding({ onDone }: { onDone: () => void }) {
  const urlId = useId()
  const nameId = useId()
  const errorId = useId()

  const [url, setUrl] = useState('')
  const [name, setName] = useState(defaultName())
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const connect = async () => {
    setError(null)

    let origin: string
    try {
      const parsed = new URL(url)
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
    const result = await probeWorker(origin)
    setBusy(false)

    if (result !== 'ok') {
      setError(
        t(
          result === 'no_access'
            ? 'onboarding_error_no_access'
            : 'onboarding_error_unreachable',
        ),
      )
      return
    }

    await browser.storage.local.set({ workerUrl: origin, deviceName: name })
    // The sign-in page is the hub's own; Access answers it with its login form
    // and the cookie it leaves behind is what the worker connects with.
    await browser.tabs.create({ url: `${origin}/auth/done` })
    onDone()
  }

  return (
    <main className="mx-auto mt-16 max-w-[480px] rounded-card bg-surface p-6 shadow-elevation-2">
      <h1 className="mt-0 text-[15px] font-medium">{t('onboarding_title')}</h1>
      <p className="text-on-surface-variant">{t('onboarding_body')}</p>

      <form
        onSubmit={(event) => {
          event.preventDefault()
          void connect()
        }}
      >
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
