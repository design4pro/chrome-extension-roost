import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { MenuKey } from '../a11y/menu'
import { reduceMenu } from '../a11y/menu'
import { placeMenu } from '../state/place'

/**
 * The row menu: right click, the kebab button, or Shift+F10.
 *
 * A real `role="menu"` rather than a list of buttons, because that is what
 * tells a screen reader the rest of the page is out of play while it is open.
 * The focus goes to the first item on open and back to whatever opened it on
 * close, which is the part users notice when it is missing.
 */
export interface MenuItem {
  label: string
  onSelect: () => void
  /**
   * Asked for, not yet answered. Only the panel header shows this: a row menu
   * closes on the way out, so there is nothing left to put it on.
   */
  pending?: boolean
}

const KEYS: readonly string[] = [
  'ArrowDown',
  'ArrowUp',
  'Home',
  'End',
  'Escape',
  'Enter',
  ' ',
]

export function ContextMenu({
  items,
  at,
  onClose,
}: {
  items: MenuItem[]
  at: { x: number; y: number }
  onClose: () => void
}) {
  const [index, setIndex] = useState(0)
  const [placed, setPlaced] = useState<{ left: number; top: number } | null>(
    null,
  )
  const list = useRef<HTMLDivElement>(null)

  // Measured before the browser paints, so the menu is never seen at the point
  // it was asked for and then again where it fits. How big it is depends on
  // the longest label, which is why this cannot be worked out in advance.
  useLayoutEffect(() => {
    const box = list.current?.getBoundingClientRect()
    if (box === undefined) return
    setPlaced(
      placeMenu(
        at,
        { width: box.width, height: box.height },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    )
  }, [at.x, at.y, items.length])

  useEffect(() => {
    list.current
      ?.querySelectorAll<HTMLElement>('[role="menuitem"]')
      [index]?.focus()
  }, [index])

  useEffect(() => {
    const dismiss = () => onClose()
    // A click anywhere else closes the menu, as it does everywhere in Chrome.
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [onClose])

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!KEYS.includes(event.key)) return
    event.preventDefault()

    const action = reduceMenu(items.length, index, event.key as MenuKey)
    if (action === null) return
    if (action.kind === 'focus') setIndex(action.index)
    if (action.kind === 'close') onClose()
    if (action.kind === 'activate') {
      items[action.index]?.onSelect()
      onClose()
    }
  }

  return (
    <div
      ref={list}
      role="menu"
      className="fixed z-20 min-w-40 rounded-menu bg-menu py-1 shadow-elevation-2"
      style={{ left: placed?.left ?? at.x, top: placed?.top ?? at.y }}
      onKeyDown={onKeyDown}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {items.map((item, position) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          tabIndex={position === index ? 0 : -1}
          onClick={() => {
            item.onSelect()
            onClose()
          }}
          className="block h-8 w-full border-0 bg-transparent px-4 text-left text-on-surface hover:bg-hover"
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
