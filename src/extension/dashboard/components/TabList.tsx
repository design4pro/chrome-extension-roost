import { useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { Row } from '../state/select'
import { Favicon } from './Favicon'
import { t } from '../i18n'

/**
 * The right-hand panel: one window's tabs, or whatever a search matched.
 *
 * Virtualised because a single window here can hold several hundred tabs, and
 * flat because a virtualiser needs rows of a known height - a group is a
 * header row rather than a wrapper. Rows carry `scroll-margin-top` so that
 * moving focus with the keyboard never parks a row under the sticky header.
 */
const ROW_HEIGHT = 48
const HEADER_HEIGHT = 48

export function TabList({ rows, title }: { rows: Row[]; title: string }) {
  const viewport = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => viewport.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  })

  return (
    <div ref={viewport} className="flex-1 overflow-y-auto">
      <h2
        data-testid="panel-header"
        className="sticky top-0 z-10 m-0 flex h-12 items-center bg-surface1 px-6 text-[14px] font-medium"
      >
        {title}
      </h2>

      {rows.length === 0 ? (
        <p className="px-6 py-4 text-on-surface-variant">{t('no_results')}</p>
      ) : (
        <ul
          role="listbox"
          aria-label={title}
          className="relative m-0 list-none p-0"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index]
            if (row === undefined) return null

            return (
              <li
                key={row.kind === 'group' ? `group:${row.id}` : row.id}
                role="option"
                aria-selected={false}
                className="absolute inset-x-0 top-0"
                style={{
                  height: item.size,
                  transform: `translateY(${item.start}px)`,
                  scrollMarginTop: `${HEADER_HEIGHT}px`,
                }}
              >
                {row.kind === 'group' ? (
                  <div className="flex h-full items-center gap-2 px-6 text-on-surface-variant">
                    <span
                      aria-hidden="true"
                      className="size-2 rounded-full"
                      style={{ background: `var(--cr-group-${row.color})` }}
                    />
                    {row.title}
                  </div>
                ) : (
                  <button
                    type="button"
                    className="flex h-full w-full items-center gap-3 border-0 bg-transparent px-6 text-left hover:bg-hover"
                    style={{ scrollMarginTop: `${HEADER_HEIGHT}px` }}
                  >
                    <Favicon url={row.data.url} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-on-surface">
                        {row.data.title}
                      </span>
                      <span className="block truncate text-[12px] text-on-surface-variant">
                        {row.context === undefined
                          ? hostOf(row.data.url)
                          : `${row.context.deviceLabel} · ${hostOf(row.data.url)}`}
                      </span>
                    </span>
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}
