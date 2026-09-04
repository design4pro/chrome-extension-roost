import { useEffect, useMemo, useState } from 'react'
import { browser } from 'wxt/browser'
import type { MenuItem } from './components/ContextMenu'
import { RestoreDialog } from './components/RestoreDialog'
import { Banner } from './components/Banner'
import { Onboarding } from './components/Onboarding'
import { Resizer } from './components/Resizer'
import { Sidebar } from './components/Sidebar'
import { TabList } from './components/TabList'
import { Toolbar } from './components/Toolbar'
import type { ItemRow, Selection, TabRow } from './state/select'
import { buildRows, buildTree } from './state/select'
import { usePort } from './state/use-port'
import { useSidebarWidth } from './state/use-sidebar-width'
import { t } from './i18n'

/** How long a command has to produce a visible change before the page gives up. */
const ANSWER_TIMEOUT_MS = 10_000

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
  return <Dashboard onRepair={() => setOnboarded(false)} />
}

function Dashboard({ onRepair }: { onRepair: () => void }) {
  const { mirror, deviceId, connection, send } = usePort()
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [selection, setSelection] = useState<Selection | null>(null)
  const [focusIndex, setFocusIndex] = useState(0)
  const [query, setQuery] = useState('')
  const [restoring, setRestoring] = useState<string | null>(null)
  const [closing, setClosing] = useState<string | null>(null)
  const [unanswered, setUnanswered] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useSidebarWidth()

  /**
   * Closing another browser's window is a request, not an action.
   *
   * It travels to the hub, to that browser, and comes back as a change to the
   * mirror - which is the only confirmation the page ever gets, since the hub
   * does not report a command's fate to anyone but its target. Until then the
   * button has to say that something is happening, and if nothing does, so
   * does the panel: silence is what the user reads as a broken button.
   */
  useEffect(() => {
    if (closing === null) return
    const timer = setTimeout(() => {
      setClosing(null)
      setUnanswered(true)
    }, ANSWER_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [closing])

  useEffect(() => {
    if (closing === null) return
    const window = mirror.windows[closing]
    if (window === undefined || window.closedAt !== null) setClosing(null)
  }, [closing, mirror])

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

  // A device that is not connected cannot be asked to do anything: the hub
  // would hold the command until it came back, which looks like nothing
  // happening at all.
  const reachable = (id: string) => mirror.devices[id]?.online ?? false

  /** Whether the window a tab belongs to is still open on its own browser. */
  const windowOpen = (id: string) => mirror.windows[id]?.closedAt === null

  const activate = (row: TabRow) =>
    send({
      type: 'command',
      target: row.data.deviceId,
      body: { kind: 'tab.activate', tabId: row.id },
    })

  const copyHere = (id: string): MenuItem => ({
    label: t('menu_copy_bookmark'),
    onSelect: () => send({ type: 'copy', bookmarkId: id }),
  })

  const actions = (row: ItemRow): MenuItem[] => {
    if (row.kind === 'bookmark') {
      // Copying is this browser's own work, so it does not need the other one
      // to be awake; removing is a request to whoever owns the bookmark.
      return [
        ...(row.data.deviceId === deviceId ? [] : [copyHere(row.id)]),
        ...(reachable(row.data.deviceId)
          ? [
              {
                label: t('menu_remove_bookmark'),
                onSelect: () =>
                  send({
                    type: 'command',
                    target: row.data.deviceId,
                    body: { kind: 'bookmark.remove', bookmarkId: row.id },
                  }),
              },
            ]
          : []),
      ]
    }

    // A tab in a window that has closed cannot be switched to or closed: the
    // browser that owns it no longer has anything under that id, and the
    // command would come back reporting success having done nothing. The way
    // back to it is reopening the window, which the sidebar offers.
    if (!reachable(row.data.deviceId) || !windowOpen(row.data.windowId)) {
      return []
    }
    const target = row.data.deviceId

    return [
      {
        label: t('menu_activate_tab'),
        onSelect: () => activate(row),
      },
      {
        label: t('menu_close_tab'),
        onSelect: () =>
          send({
            type: 'command',
            target,
            body: { kind: 'tab.close', tabId: row.id },
          }),
      },
    ]
  }

  const selectedWindow =
    selection === null || selection.kind === 'folder'
      ? undefined
      : mirror.windows[selection.id]

  const folderActions: MenuItem[] =
    selection === null ||
    selection.kind !== 'folder' ||
    selection.deviceId === deviceId
      ? []
      : [copyHere(selection.id)]

  const restoreWindow = (id: string): MenuItem => ({
    label: t('menu_restore_window'),
    onSelect: () => setRestoring(id),
  })

  const headerActions: MenuItem[] =
    selection === null || selectedWindow === undefined
      ? folderActions
      : // A closed window cannot be closed again, and asking its browser to do
        // it would be a request nobody can carry out. Reopening it here is the
        // only thing left that means anything - even for this browser's own,
        // which is the case the live-windows-only rule used to miss.
        selectedWindow.closedAt !== null
        ? [
            restoreWindow(selection.id),
            {
              label: t('menu_forget_window'),
              onSelect: () => send({ type: 'forget', windowId: selection.id }),
            },
          ]
        : [
            ...(selection.deviceId === deviceId
              ? []
              : [restoreWindow(selection.id)]),
            ...(reachable(selection.deviceId)
              ? [
                  {
                    label: t('menu_close_window'),
                    pending: closing === selection.id,
                    onSelect: () => {
                      setUnanswered(false)
                      setClosing(selection.id)
                      send({
                        type: 'command',
                        target: selection.deviceId,
                        body: { kind: 'window.close', windowId: selection.id },
                      })
                    },
                  },
                ]
              : []),
          ]

  const empty = Object.keys(mirror.tabs).length === 0

  return (
    <div className="flex h-screen flex-col">
      <Banner connection={connection} onRepair={onRepair} />
      <Toolbar query={query} onQuery={setQuery} resultCount={rows.length} />

      {/* Announced as well as shown: the button that was pressed has by now
          gone back to looking exactly as it did before. */}
      {unanswered ? (
        <p role="status" className="m-0 px-6 py-1 text-error">
          {t('command_no_answer')}
        </p>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <Sidebar
          width={sidebarWidth}
          nodes={nodes}
          expanded={expanded}
          selection={selection}
          focusIndex={focusIndex}
          onFocusIndex={setFocusIndex}
          onToggle={toggle}
          onSelect={setSelection}
        />
        <Resizer width={sidebarWidth} onWidth={setSidebarWidth} />

        {empty ? (
          <main className="flex-1 px-6 py-8">
            <h2 className="mt-0 text-[14px] font-medium">{t('empty_title')}</h2>
            <p className="text-on-surface-variant">{t('empty_body')}</p>
          </main>
        ) : (
          <TabList
            rows={rows}
            title={panelTitle(query, selection)}
            actions={actions}
            // The row's own click is the thing the menu's first item does:
            // switching to that tab is what a list of tabs is for, and a row
            // that does nothing at all is what made the menu look broken.
            onOpen={(row) => {
              if (row.kind !== 'tab') return
              if (!reachable(row.data.deviceId)) return
              if (!windowOpen(row.data.windowId)) return
              activate(row)
            }}
            headerActions={headerActions}
          />
        )}
      </div>

      {restoring === null ? null : (
        <RestoreDialog
          tabCount={mirror.windows[restoring]?.tabOrder.length ?? 0}
          onConfirm={() => send({ type: 'restore', windowId: restoring })}
          onClose={() => setRestoring(null)}
        />
      )}
    </div>
  )
}

function panelTitle(query: string, selection: Selection | null): string {
  if (query.trim() !== '') return t('search_label')
  return selection?.kind === 'folder'
    ? t('bookmarks_heading')
    : t('windows_heading')
}
