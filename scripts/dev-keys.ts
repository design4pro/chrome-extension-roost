import { writeFile } from 'node:fs/promises'
import { exportJWK, generateKeyPair } from 'jose'
import { DEV_AUDIENCE, DEV_ISSUER, DEV_KEY_FILE, DEV_KID } from './dev-identity'

/**
 * Generate the local stand-in for Cloudflare Access.
 *
 * `wrangler dev` and the e2e suite need a CF_Authorization cookie that the
 * Worker will accept, and the Worker accepts nothing it cannot verify. So they
 * get their own issuer: this writes the public half into `.dev.vars` as
 * DEV_JWKS and keeps the private half in `e2e/.dev-key.json`, where
 * `pnpm dev-token` signs with it.
 *
 * Generated rather than committed. A checked-in private key is a key that
 * eventually gets used somewhere it should not be, and there is no reason to
 * take that on for a value any developer can recreate in a second.
 */
async function main(): Promise<void> {
  const { privateKey, publicKey } = await generateKeyPair('RS256', {
    extractable: true,
  })
  const publicJwk = {
    ...(await exportJWK(publicKey)),
    kid: DEV_KID,
    alg: 'RS256',
  }
  const privateJwk = {
    ...(await exportJWK(privateKey)),
    kid: DEV_KID,
    alg: 'RS256',
  }

  await writeFile(
    '.dev.vars',
    [
      `TEAM_DOMAIN="${DEV_ISSUER}"`,
      `POLICY_AUD="${DEV_AUDIENCE}"`,
      `DEV_JWKS='${JSON.stringify({ keys: [publicJwk] })}'`,
      '',
    ].join('\n'),
  )
  await writeFile(DEV_KEY_FILE, `${JSON.stringify(privateJwk, null, 2)}\n`)

  process.stdout.write(`wrote .dev.vars and ${DEV_KEY_FILE}\n`)
}

await main()
