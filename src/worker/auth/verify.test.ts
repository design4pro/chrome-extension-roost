import { describe, expect, it } from 'vitest'
import { SignJWT, exportJWK, generateKeyPair } from 'jose'
import type { CryptoKey } from 'jose'
import { createVerifier } from './verify'
import type { VerifierEnv } from './verify'

const ISSUER = 'https://team.cloudflareaccess.com'
const AUDIENCE = 'audience-tag'

const keys = await generateKeyPair('RS256', { extractable: true })
const jwks = JSON.stringify({
  keys: [{ ...(await exportJWK(keys.publicKey)), kid: 'k1', alg: 'RS256' }],
})

const sign = (
  over: {
    issuer?: string
    audience?: string
    subject?: string
    expiresIn?: string
    key?: CryptoKey
  } = {},
) =>
  new SignJWT({ email: 'user@example.test' })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(over.issuer ?? ISSUER)
    .setAudience(over.audience ?? AUDIENCE)
    .setSubject(over.subject ?? 'user-1')
    .setIssuedAt()
    .setExpirationTime(over.expiresIn ?? '1h')
    .sign(over.key ?? keys.privateKey)

const env: VerifierEnv = {
  TEAM_DOMAIN: ISSUER,
  POLICY_AUD: AUDIENCE,
  DEV_JWKS: jwks,
}

const request = (headers: Record<string, string>, host = 'localhost') =>
  new Request(`http://${host}/api/health`, { headers })

describe('createVerifier', () => {
  it('accepts a valid token from the Access header', async () => {
    const token = await sign()
    const identity = await createVerifier(env)(
      request({ 'Cf-Access-Jwt-Assertion': token }),
    )
    expect(identity).toEqual({ sub: 'user-1', email: 'user@example.test' })
  })

  it('accepts the cookie, which is all a WebSocket upgrade can carry', async () => {
    const token = await sign()
    const identity = await createVerifier(env)(
      request({ Cookie: `other=1; CF_Authorization=${token}` }),
    )
    expect(identity?.sub).toBe('user-1')
  })

  it('accepts the cf-access-token header used when cookies are blocked', async () => {
    const token = await sign()
    const identity = await createVerifier(env)(
      request({ 'cf-access-token': token }),
    )
    expect(identity?.sub).toBe('user-1')
  })

  it.each([
    ['no token at all', {}],
    ['a token that is not a JWT', { 'cf-access-token': 'nonsense' }],
  ])('rejects %s', async (_name, headers) => {
    expect(await createVerifier(env)(request(headers))).toBeNull()
  })

  it('rejects an expired token', async () => {
    const token = await sign({ expiresIn: '-1s' })
    expect(
      await createVerifier(env)(request({ 'cf-access-token': token })),
    ).toBeNull()
  })

  it('rejects a token for another audience', async () => {
    const token = await sign({ audience: 'someone-elses-app' })
    expect(
      await createVerifier(env)(request({ 'cf-access-token': token })),
    ).toBeNull()
  })

  it('rejects a token from another issuer', async () => {
    const token = await sign({ issuer: 'https://evil.example' })
    expect(
      await createVerifier(env)(request({ 'cf-access-token': token })),
    ).toBeNull()
  })

  it('rejects a token signed by a key it does not know', async () => {
    const other = await generateKeyPair('RS256', { extractable: true })
    const token = await sign({ key: other.privateKey })
    expect(
      await createVerifier(env)(request({ 'cf-access-token': token })),
    ).toBeNull()
  })

  it('ignores DEV_JWKS off localhost', async () => {
    // The local key set exists so `wrangler dev` can sign its own cookies. If a
    // deployed Worker ever honoured it, a leaked .dev.vars would be a login.
    const token = await sign()
    const identity = await createVerifier(env)(
      request({ 'cf-access-token': token }, 'sync.example.test'),
    )
    expect(identity).toBeNull()
  })
})
