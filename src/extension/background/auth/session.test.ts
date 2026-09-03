import { describe, expect, it } from 'vitest'
import { decodeExp } from './jwt'
import { evaluate } from './session'

const token = (claims: unknown) =>
  `header.${btoa(JSON.stringify(claims)).replaceAll('+', '-').replaceAll('/', '_')}.signature`

describe('reading the Access cookie', () => {
  it('reports when there is no cookie at all', () => {
    expect(evaluate(undefined, 1000)).toEqual({ state: 'missing' })
    expect(evaluate('', 1000)).toEqual({ state: 'missing' })
  })

  it('reads the expiry in milliseconds', () => {
    expect(decodeExp(token({ exp: 1700000000 }))).toBe(1700000000000)
  })

  it('separates a live session from a dead one', () => {
    const cookie = token({ exp: 100 })
    expect(evaluate(cookie, 99_000)).toEqual({ state: 'valid', exp: 100_000 })
    expect(evaluate(cookie, 100_000)).toEqual({
      state: 'expired',
      exp: 100_000,
    })
  })

  it('trusts a cookie it cannot read', () => {
    // The Worker verifies the token for real. Refusing to connect because the
    // extension could not parse a claim would break the app over nothing.
    expect(evaluate('not-a-jwt', 1000)).toEqual({ state: 'valid' })
    expect(evaluate(token({ sub: 'someone' }), 1000)).toEqual({
      state: 'valid',
    })
  })
})
