import { readFile } from 'node:fs/promises'
import { SignJWT, importJWK } from 'jose'
import { DEV_AUDIENCE, DEV_ISSUER, DEV_KEY_FILE } from './dev-identity'

/**
 * Print a CF_Authorization value the local Worker will accept.
 *
 * The subject picks the Durable Object, so passing one is how a test gives
 * itself a fresh account: `pnpm dev-token some-user`.
 */
export async function devToken(
  sub = 'local-developer',
  ttlSeconds = 60 * 60,
): Promise<string> {
  const jwk = JSON.parse(await readFile(DEV_KEY_FILE, 'utf8')) as Record<
    string,
    unknown
  >
  const key = await importJWK(jwk, 'RS256')

  return new SignJWT({ email: `${sub}@example.test` })
    .setProtectedHeader({ alg: 'RS256', kid: String(jwk.kid) })
    .setIssuer(DEV_ISSUER)
    .setAudience(DEV_AUDIENCE)
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(key)
}

if (import.meta.filename === process.argv[1]) {
  process.stdout.write(`${await devToken(process.argv[2])}\n`)
}
