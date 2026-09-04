import { describe, expect, it } from 'vitest'
import { placeMenu } from './place'

const MENU = { width: 160, height: 80 }
const SCREEN = { width: 1000, height: 600 }

describe('placeMenu', () => {
  it('opens where it was asked to when there is room', () => {
    expect(placeMenu({ x: 100, y: 100 }, MENU, SCREEN)).toEqual({
      left: 100,
      top: 100,
    })
  })

  it('flips to the left of the point rather than off the screen', () => {
    // The kebab button lives at the right-hand end of a row, so this is the
    // ordinary case rather than the edge case.
    expect(placeMenu({ x: 980, y: 100 }, MENU, SCREEN)).toEqual({
      left: 820,
      top: 100,
    })
  })

  it('flips above the point when there is no room below', () => {
    expect(placeMenu({ x: 100, y: 580 }, MENU, SCREEN)).toEqual({
      left: 100,
      top: 500,
    })
  })

  it('flips both ways at once in the corner', () => {
    // Flipped to 835/515 and then pulled back to the margin: a menu opened
    // five pixels from the corner still owes the edge its eight.
    expect(placeMenu({ x: 995, y: 595 }, MENU, SCREEN)).toEqual({
      left: 832,
      top: 512,
    })
  })

  it('keeps the near edge on screen when the menu is bigger than the window', () => {
    // Nothing fits, so the choice is which end to lose. The top and the left
    // are where the first item and its label are.
    expect(
      placeMenu({ x: 10, y: 10 }, { width: 300, height: 900 }, SCREEN),
    ).toEqual({ left: 10, top: 8 })
  })
})
