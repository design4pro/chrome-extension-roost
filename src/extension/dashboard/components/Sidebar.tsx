import { useEffect, useRef } from 'react'
import type { Selection, TreeNode } from '../state/select'
import type { TreeKey } from '../a11y/treegrid'
import { moveFocus } from '../a11y/treegrid'
import { Icon } from './Icon'
import { t } from '../i18n'

/**
 * Every device, and the windows and bookmark folders under the ones the user
 * has opened.
 *
 * An ARIA tree with roving tabindex: one stop for the whole widget, and the
 * arrow keys do the moving, which is what a screen reader user expects here
 * and what Chrome's own bookmarks manager does.
 */
const KEYS: readonly string[] = [
  'ArrowDown',
  'ArrowUp',
  'ArrowRight',
  'ArrowLeft',
  'Home',
  'End',
]

/**
 * A closed window's date, written the way the page's language writes it.
 *
 * Built once: the locale cannot change without the page reloading, and a
 * formatter per row is the expensive part of `Intl`.
 */
const CLOSED_ON = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
})

const closedOn = (at: number): string => CLOSED_ON.format(at)

/** What a device row says about itself, and nothing when it has nothing to say. */
function deviceStatus(node: Extract<TreeNode, { kind: 'device' }>): string {
  if (node.local) return t('device_this')
  return node.online ? '' : t('device_offline')
}

export function Sidebar({
  width,
  nodes,
  expanded,
  selection,
  focusIndex,
  onFocusIndex,
  onToggle,
  onSelect,
}: {
  width: number
  nodes: TreeNode[]
  expanded: ReadonlySet<string>
  selection: Selection | null
  focusIndex: number
  onFocusIndex: (index: number) => void
  onToggle: (id: string) => void
  onSelect: (selection: Selection) => void
}) {
  const list = useRef<HTMLUListElement>(null)
  const shouldFocus = useRef(false)

  useEffect(() => {
    if (!shouldFocus.current) return
    shouldFocus.current = false
    const item =
      list.current?.querySelectorAll<HTMLElement>('[role="treeitem"]')
    item?.[focusIndex]?.focus()
  }, [focusIndex])

  const activate = (node: TreeNode) => {
    if (node.kind === 'device') return onToggle(node.id)
    return onSelect({
      deviceId: node.deviceId,
      kind: node.kind === 'window' ? 'window' : 'folder',
      id: node.id,
    })
  }

  const expandable = (node: TreeNode) =>
    node.kind === 'device' || (node.kind === 'folder' && node.expandable)

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!KEYS.includes(event.key)) return

    const move = moveFocus(
      nodes.map((node) => ({
        id: node.id,
        level: node.level,
        expandable: expandable(node),
        expanded: expanded.has(node.id),
      })),
      focusIndex,
      event.key as TreeKey,
    )
    if (move === null) return

    event.preventDefault()
    if (move.kind === 'focus') {
      shouldFocus.current = true
      onFocusIndex(move.index)
    } else {
      onToggle(move.id)
    }
  }

  return (
    <nav
      // 256px by default, as in Chrome's own bookmark manager, and whatever the
      // user dragged it to after that. The divider is the resizer's, not this
      // panel's, so that the line the user grabs is the line they see.
      className="@container shrink-0 overflow-y-auto py-2"
      style={{ width }}
    >
      <h2 className="sr-only">{t('devices_heading')}</h2>
      <ul
        ref={list}
        role="tree"
        aria-label={t('devices_heading')}
        className="m-0 list-none p-0"
        onKeyDown={onKeyDown}
      >
        {nodes.map((node, index) => (
          <li
            key={`${node.kind}:${node.id}`}
            role="treeitem"
            aria-level={node.level}
            aria-expanded={expandable(node) ? expanded.has(node.id) : undefined}
            aria-selected={node.kind !== 'device' && selection?.id === node.id}
            // The focus lives on the tree item itself rather than on a button
            // inside it: a screen reader reads the item's own role and level,
            // and a nested control would be announced instead.
            tabIndex={index === focusIndex ? 0 : -1}
            onFocus={() => onFocusIndex(index)}
            onClick={() => activate(node)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return
              event.preventDefault()
              activate(node)
            }}
            // 40px and a right-rounded highlight, as Chrome draws a folder node:
            // the pill runs off the left edge of the panel rather than
            // being inset, and the selected row turns blue rather than
            // only being tinted behind unchanged text.
            className="group flex min-h-10 cursor-default items-center gap-2 rounded-e-[20px] px-3 hover:bg-hover aria-selected:bg-selected aria-selected:text-primary"
            style={{ paddingInlineStart: `${node.level * 15}px` }}
          >
            {node.kind === 'device' ? (
              <>
                <Icon
                  name="chevron"
                  className={`size-4 shrink-0 fill-on-surface-variant ${
                    expanded.has(node.id) ? 'rotate-90' : ''
                  }`}
                />
                {/* Side by side while there is room, stacked once there is
                    not: "This browser" is longer than the space a 256px panel
                    leaves beside a machine name, and squeezed onto two lines
                    it takes the name's width with it. */}
                <div className="flex min-w-0 flex-1 items-center gap-2 @max-[300px]:flex-col @max-[300px]:items-start @max-[300px]:gap-0">
                  <span className="max-w-full truncate">{node.label}</span>
                  {deviceStatus(node) === '' ? null : (
                    <span className="ml-auto whitespace-nowrap text-on-surface-variant @max-[300px]:ml-0">
                      {deviceStatus(node)}
                    </span>
                  )}
                </div>
              </>
            ) : node.kind === 'window' ? (
              <>
                <Icon
                  name={node.closedAt === null ? 'window' : 'history'}
                  className="size-4 shrink-0 fill-on-surface-variant group-aria-selected:fill-primary"
                />
                <span className="truncate">{node.label}</span>
                <span className="ml-auto whitespace-nowrap text-on-surface-variant">
                  {node.closedAt === null ? (
                    node.tabCount
                  ) : (
                    <>
                      {/* The bare date is all that fits beside a window title,
                          so the word that makes sense of it is read out rather
                          than shown - the icon carries it for everyone else. */}
                      <span className="sr-only">
                        {t('window_closed', closedOn(node.closedAt))}
                      </span>
                      <span aria-hidden="true">{closedOn(node.closedAt)}</span>
                    </>
                  )}
                </span>
              </>
            ) : (
              <>
                <Icon
                  name="folder"
                  className="size-4 shrink-0 fill-on-surface-variant group-aria-selected:fill-primary"
                />
                <span className="truncate">{node.label}</span>
              </>
            )}
          </li>
        ))}
      </ul>
    </nav>
  )
}
