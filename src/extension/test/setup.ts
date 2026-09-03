import { afterEach, beforeEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import { installMissingEvents } from './fake-events'

// The fake browser keeps its state between tests unless it is told not to, and
// resetting it puts back the listeners it does not implement.
beforeEach(() => {
  fakeBrowser.reset()
  installMissingEvents(fakeBrowser as never)
})

// Vitest runs without globals here, so Testing Library's own auto-cleanup never
// registers itself and a rendered tree would outlive its test.
afterEach(cleanup)
