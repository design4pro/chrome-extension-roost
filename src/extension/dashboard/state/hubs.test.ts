import { describe, expect, it } from 'vitest'
import { hubCandidates } from './hubs'

const tabs = (...urls: Array<string | undefined>) =>
  urls.map((url) => ({ url }))

describe('hubCandidates', () => {
  it('finds a Worker among the open tabs', () => {
    expect(
      hubCandidates(
        tabs(
          'https://mail.example.com/inbox',
          'https://roost.someone.workers.dev/',
        ),
      ),
    ).toEqual(['https://roost.someone.workers.dev'])
  })

  it('offers each origin once, however many of its pages are open', () => {
    expect(
      hubCandidates(
        tabs(
          'https://roost.someone.workers.dev/',
          'https://roost.someone.workers.dev/api/health',
        ),
      ),
    ).toEqual(['https://roost.someone.workers.dev'])
  })

  it('keeps the Cloudflare dashboard out of it', () => {
    // The page the user deploys from is not the thing they deployed.
    expect(
      hubCandidates(tabs('https://dash.cloudflare.com/abc/workers/roost')),
    ).toEqual([])
  })

  it('refuses anything that is not https, and anything unreadable', () => {
    expect(
      hubCandidates(
        tabs(
          'http://roost.someone.workers.dev/',
          'not a url',
          undefined,
          'chrome://extensions',
        ),
      ),
    ).toEqual([])
  })

  it('is not fooled by a hostname that merely ends in the same letters', () => {
    expect(hubCandidates(tabs('https://notworkers.dev/'))).toEqual([])
  })
})
