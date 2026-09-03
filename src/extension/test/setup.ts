import { beforeEach } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import { installMissingEvents } from './fake-events'

// The fake browser keeps its state between tests unless it is told not to, and
// resetting it puts back the listeners it does not implement.
beforeEach(() => {
  fakeBrowser.reset()
  installMissingEvents(fakeBrowser as never)
})
