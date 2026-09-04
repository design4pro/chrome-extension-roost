import { useCallback, useState } from 'react'
import { clampWidth, DEFAULT_WIDTH } from '../components/Resizer'

/**
 * How wide the user last left the sidebar.
 *
 * Kept in `localStorage` rather than in the mirror: it says nothing about what
 * this browser has open, it is nobody else's business, and it has to be there
 * before the first paint - reading it back from the worker would mean the panel
 * jumping to width once the port answered.
 */
const KEY = 'sidebarWidth'

export function useSidebarWidth(): [number, (width: number) => void] {
  const [width, setWidth] = useState(() => {
    const stored = Number(localStorage.getItem(KEY))
    return Number.isFinite(stored) && stored > 0
      ? clampWidth(stored)
      : DEFAULT_WIDTH
  })

  const remember = useCallback((next: number) => {
    setWidth(next)
    localStorage.setItem(KEY, String(next))
  }, [])

  return [width, remember]
}
