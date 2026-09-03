import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  apexOf,
  buildAppPayload,
  buildDomainPayload,
  buildOrgPayload,
  findExisting,
  healthVerdict,
} from './cloudflare-api'

/**
 * Put the hub on the user's own Cloudflare account.
 *
 * Idempotent from end to end: every step looks for what a previous run made
 * before making anything, so a failure halfway through is fixed by running it
 * again. What it cannot do is create the Zero Trust team or add a payment
 * method - those need a human in the dashboard, and `docs/DEPLOY.md` says so.
 */

const API = 'https://api.cloudflare.com/client/v4'
const run = promisify(execFile)

interface Env {
  token: string
  accountId: string
  hostname: string
  ownerEmail: string
}

function readEnv(): Env {
  const required = {
    token: process.env.CLOUDFLARE_API_TOKEN,
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    hostname: process.env.SYNC_HOSTNAME,
    ownerEmail: process.env.OWNER_EMAIL,
  }

  const missing = Object.entries(required)
    .filter(([, value]) => value === undefined || value === '')
    .map(([key]) => key)

  if (missing.length > 0) {
    throw new Error(
      `missing environment: ${missing.join(', ')} - see docs/DEPLOY.md`,
    )
  }
  return required as Env
}

interface CloudflareResponse<T> {
  success: boolean
  result: T
  errors?: Array<{ code: number; message: string }>
}

async function api<T>(
  env: Env,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${env.token}`,
      'content-type': 'application/json',
      ...init.headers,
    },
  })

  const body: CloudflareResponse<T> = await response.json()
  if (!body.success) {
    const detail = (body.errors ?? [])
      .map((error) => `${error.code} ${error.message}`)
      .join('; ')
    throw new Error(`${init.method ?? 'GET'} ${path} failed: ${detail}`)
  }
  return body.result
}

const say = (line: string) => process.stdout.write(`${line}\n`)

async function main(): Promise<void> {
  const env = readEnv()
  const account = `/accounts/${env.accountId}`

  say('deploying the Worker')
  await run('pnpm', ['exec', 'wrangler', 'deploy'])

  say(`attaching ${env.hostname}`)
  const zones = await api<Array<{ id: string; name: string }>>(
    env,
    `/zones?name=${apexOf(env.hostname)}`,
  )
  const zone = zones[0]
  if (zone === undefined) {
    throw new Error(
      `no zone for ${apexOf(env.hostname)} on this account - add the domain to Cloudflare first`,
    )
  }
  await api(env, `${account}/workers/domains`, {
    method: 'PUT',
    body: JSON.stringify(
      buildDomainPayload({
        hostname: env.hostname,
        service: 'roost',
        zoneId: zone.id,
      }),
    ),
  })

  say('setting the Access session length')
  const org = await api<Record<string, unknown>>(
    env,
    `${account}/access/organizations`,
  )
  await api(env, `${account}/access/organizations`, {
    method: 'PUT',
    body: JSON.stringify(buildOrgPayload(org)),
  })

  say('making sure a one-time PIN login exists')
  const idps = await api<Array<{ id: string; type: string }>>(
    env,
    `${account}/access/identity_providers`,
  )
  const otp =
    findExisting(idps, (idp) => idp.type === 'onetimepin') ??
    (await api<{ id: string }>(env, `${account}/access/identity_providers`, {
      method: 'POST',
      body: JSON.stringify({ name: 'One-time PIN', type: 'onetimepin' }),
    }))

  say('putting Access in front of the hub')
  const apps = await api<Array<{ id: string; domain?: string; aud: string }>>(
    env,
    `${account}/access/apps`,
  )
  const existing = findExisting(apps, (app) => app.domain === env.hostname)
  const payload = JSON.stringify(
    buildAppPayload({
      hostname: env.hostname,
      ownerEmail: env.ownerEmail,
      idpIds: [otp.id],
    }),
  )
  const app =
    existing === undefined
      ? await api<{ aud: string }>(env, `${account}/access/apps`, {
          method: 'POST',
          body: payload,
        })
      : await api<{ aud: string }>(
          env,
          `${account}/access/apps/${existing.id}`,
          {
            method: 'PUT',
            body: payload,
          },
        )

  say('telling the Worker which tokens to trust')
  const teamDomain = `https://${String(org.auth_domain)}`
  await putSecret('TEAM_DOMAIN', teamDomain)
  await putSecret('POLICY_AUD', app.aud)

  say('checking that Access really answers first')
  const health = await fetch(`https://${env.hostname}/api/health`, {
    redirect: 'manual',
  })
  const verdict = healthVerdict(health.status)
  if (verdict !== 'protected') {
    throw new Error(
      verdict === 'unprotected'
        ? `${env.hostname} answered ${health.status} with no Access in front of it`
        : `${env.hostname} answered ${health.status}; DNS or the deploy may still be settling`,
    )
  }

  say('')
  say(`done. Paste this into the extension: https://${env.hostname}`)
}

/** `wrangler secret put` reads the value from stdin, never from a flag. */
async function putSecret(name: string, value: string): Promise<void> {
  const child = run('pnpm', ['exec', 'wrangler', 'secret', 'put', name])
  child.child.stdin?.end(`${value}\n`)
  await child
}

await main()
