import { beforeEach } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'

// The fake browser keeps its state between tests unless it is told not to.
beforeEach(() => {
  fakeBrowser.reset()
})
