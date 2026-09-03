import { useEffect, useMemo, useState } from 'react'
import { browser } from 'wxt/browser'
import { Banner } from './components/Banner'
import { Onboarding } from './components/Onboarding'
import { Sidebar } from './components/Sidebar'
import { TabList } from './components/TabList'
import { Toolbar } from './components/Toolbar'
import type { Selection } from './state/select'
import { buildRows, buildTree } from './state/select'
import { usePort } from './state/use-port'
import { t } from './i18n'

/** The page: onboarding until there is a hub, the dashboard afterwards. */
export function App() {
  const [onboarded, setOnboarded] = useState<boolean | undefined>(undefined)

  useEffect(() => {
    void browser.storage.local
      .get('workerUrl')
      .then((stored) => setOnboarded(typeof stored.workerUrl === 'string'))
  }, [])

  if (onboarded === undefined) return null
  if (!onboarded) return <Onboarding onDone={() => setOnboarded(true)} />
  return <Dashboard />
}

function Dashboard() {
  const { mirror, deviceId, connection } = usePort()
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [selection, setSelection] = useState<Selection | null>(null)
  const [focusIndex, setFocusIndex] = useState(0)
  const [query, setQuery] = useState('')

  const nodes = useMemo(
    () => buildTree(mirror, deviceId, expanded),
    [mirror, deviceId, expanded],
  )
  const rows = useMemo(
    () => buildRows(mirror, selection, query),
    [mirror, selection, query],
  )

  const toggle = (id: string) =>
    setExpanded((previous) => {
      const next = new Set(previous)
      if (!next.delete(id)) next.add(id)
      return next
    })

  const empty = Object.keys(mirror.tabs).length === 0

  return (
    <div className="flex h-screen flex-col">
      <Banner connection={connection} />
      <Toolbar query={query} onQuery={setQuery} resultCount={rows.length} />

      <div className="flex min-h-0 flex-1">
        <Sidebar
          nodes={nodes}
          expanded={expanded}
          selection={selection}
          focusIndex={focusIndex}
          onFocusIndex={setFocusIndex}
          onToggle={toggle}
          onSelect={setSelection}
        />

        {empty ? (
          <main className="flex-1 px-6 py-8">
            <h2 className="mt-0 text-[14px] font-medium">{t('empty_title')}</h2>
            <p className="text-on-surface-variant">{t('empty_body')}</p>
          </main>
        ) : (
          <TabList rows={rows} title={panelTitle(query)} />
        )}
      </div>
    </div>
  )
}

const panelTitle = (query: string) =>
  query.trim() === '' ? t('windows_heading') : t('search_label')
