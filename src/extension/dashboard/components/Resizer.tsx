import { useRef } from 'react'
import { t } from '../i18n'

/**
 * The line between the sidebar and the list, and the handle for moving it.
 *
 * Narrower than Chrome's own panel is unreadable and wider leaves no room for
 * a title, so the range is bounded rather than free.
 */
export const MIN_WIDTH = 180
export const MAX_WIDTH = 480
export const DEFAULT_WIDTH = 256

/** How far one arrow key press moves the divider. */
const STEP = 16

export const clampWidth = (width: number): number =>
  Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(width)))

export function Resizer({
  width,
  onWidth,
}: {
  width: number
  onWidth: (width: number) => void
}) {
  const from = useRef<{ x: number; width: number } | null>(null)

  const onKeyDown = (event: React.KeyboardEvent) => {
    const step =
      event.key === 'ArrowLeft' ? -STEP : event.key === 'ArrowRight' ? STEP : 0
    if (step === 0) return
    event.preventDefault()
    onWidth(clampWidth(width + step))
  }

  return (
    <div
      // A separator rather than a slider: it divides two regions, and that is
      // what a screen reader should say. The arrow keys are not a convenience -
      // WCAG 2.2 wants every dragging movement to have a single-pointer or
      // keyboard alternative, and this is it.
      role="separator"
      aria-orientation="vertical"
      aria-label={t('sidebar_resize')}
      aria-valuenow={width}
      aria-valuemin={MIN_WIDTH}
      aria-valuemax={MAX_WIDTH}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={(event) => {
        from.current = { x: event.clientX, width }
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={(event) => {
        const start = from.current
        if (start === null) return
        onWidth(clampWidth(start.width + event.clientX - start.x))
      }}
      onPointerUp={(event) => {
        from.current = null
        event.currentTarget.releasePointerCapture(event.pointerId)
      }}
      onDoubleClick={() => onWidth(DEFAULT_WIDTH)}
      // The line is one pixel; the grab area is eight, centred on it, because a
      // one-pixel target is a miss waiting to happen.
      className="relative w-2 shrink-0 cursor-col-resize touch-none after:absolute after:inset-y-0 after:left-1/2 after:w-px after:bg-divider hover:after:bg-on-surface-variant focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary"
    />
  )
}
