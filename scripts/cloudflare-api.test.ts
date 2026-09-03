import { describe, expect, it } from 'vitest'
import {
  SESSION_DURATION,
  apexOf,
  buildAppPayload,
  buildDomainPayload,
  buildOrgPayload,
  findExisting,
  healthVerdict,
} from './cloudflare-api'

const app = buildAppPayload({
  hostname: 'sync.example.com',
  ownerEmail: 'owner@example.com',
  idpIds: ['idp-1'],
})

describe('the Access application payload', () => {
  it('is a self-hosted application on the sync hostname', () => {
    expect(app).toMatchObject({
      type: 'self_hosted',
      destinations: [{ type: 'public', uri: 'sync.example.com' }],
    })
  })

  it('names its policy, which the API requires and does not explain', () => {
    expect(app.policies).toMatchObject([
      { name: expect.any(String), decision: 'allow', precedence: 1 },
    ])
  })

  it('allows the owner and nobody else', () => {
    expect(app.policies).toMatchObject([
      { include: [{ email: { email: 'owner@example.com' } }] },
    ])
  })

  it('leaves the cookie unbound and cross-site', () => {
    // One account, two browsers, and a WebSocket upgrade that has to carry it.
    expect(app).toMatchObject({
      enable_binding_cookie: false,
      same_site_cookie_attribute: 'none',
    })
  })
})

describe('the organisation payload', () => {
  it('keeps every field the account already had', () => {
    const existing = { name: 'team', auth_domain: 'team.cloudflareaccess.com' }
    expect(buildOrgPayload(existing)).toEqual({
      ...existing,
      session_duration: SESSION_DURATION,
    })
  })

  it('replaces a session duration that was already set', () => {
    expect(buildOrgPayload({ session_duration: '24h' })).toEqual({
      session_duration: SESSION_DURATION,
    })
  })
})

describe('the custom domain payload', () => {
  it('binds the hostname to the Worker in its zone', () => {
    expect(
      buildDomainPayload({
        hostname: 'sync.example.com',
        service: 'tab-sync',
        zoneId: 'zone-1',
      }),
    ).toEqual({
      hostname: 'sync.example.com',
      service: 'tab-sync',
      zone_id: 'zone-1',
      environment: 'production',
    })
  })
})

describe('apexOf', () => {
  it.each([
    ['sync.example.com', 'example.com'],
    ['example.com', 'example.com'],
    ['a.b.example.com', 'example.com'],
  ])('reads %s as the zone %s', (hostname, apex) => {
    expect(apexOf(hostname)).toBe(apex)
  })
})

describe('findExisting', () => {
  it('finds what a previous run already made', () => {
    const items = [
      { id: '1', name: 'other' },
      { id: '2', name: 'tab-sync' },
    ]
    expect(findExisting(items, (item) => item.name === 'tab-sync')).toEqual(
      items[1],
    )
  })

  it('is undefined on the first run', () => {
    expect(findExisting([], () => true)).toBeUndefined()
  })
})

describe('healthVerdict', () => {
  it.each([
    [302, 'protected'],
    [401, 'protected'],
    [403, 'protected'],
    // The Worker answered with no Access in front of it, which is the failure
    // this smoke test exists to catch.
    [204, 'unprotected'],
    [200, 'unprotected'],
    [500, 'unreachable'],
  ])('reads %i as %s', (status, verdict) => {
    expect(healthVerdict(status)).toBe(verdict)
  })
})
