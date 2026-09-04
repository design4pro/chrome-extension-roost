/**
 * Where a menu opened at a point actually fits.
 *
 * Pure, and separate from the component, because the interesting part is the
 * arithmetic at the edges and none of it needs a DOM to be checked.
 */

export interface Size {
  width: number
  height: number
}

export interface Point {
  x: number
  y: number
}

/** How close to the edge of the window a menu is allowed to sit. */
const EDGE = 8

export function placeMenu(
  at: Point,
  menu: Size,
  viewport: Size,
): { left: number; top: number } {
  // Flipped to the other side of the point rather than slid along the edge:
  // a menu that slides ends up underneath the thing that opened it, and the
  // pointer lands on an item the user did not aim for. Chrome flips too.
  const left =
    at.x + menu.width + EDGE > viewport.width ? at.x - menu.width : at.x
  const top =
    at.y + menu.height + EDGE > viewport.height ? at.y - menu.height : at.y

  return {
    left: within(left, menu.width, viewport.width),
    top: within(top, menu.height, viewport.height),
  }
}

/**
 * Keep one edge on screen even when both cannot be.
 *
 * A menu taller than the window has nowhere to fit; starting it at the top is
 * the version the user can still scroll to and read from the beginning.
 */
function within(value: number, size: number, available: number): number {
  return Math.max(EDGE, Math.min(value, available - size - EDGE))
}
