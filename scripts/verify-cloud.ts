import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  exposureVerdict,
  healthVerdict,
  workersDevOrigin,
} from './cloudflare-api'

/**
 * The parts of the phase 0 proof that a machine can decide.
 *
 * Whether the Access cookie survives a WebSocket upgrade, and whether a host
 * permission granted at runtime makes requests same-site, can only be answered
 * by a real browser with a real login - `docs/POC.md` walks a human through
 * those. What is left is three questions about hostnames, and leaving those to
 * a human means leaving them to a human who has already read six paragraphs.
 */

const run = promisify(execFile)
const SERVICE = 'roost'

interface SubdomainResponse {
  success: boolean
  result?: { subdomain?: string }
}

type Outcome = 'pass' | 'fail' | 'skip'
interface Check {
  id: string
  question: string
  outcome: Outcome
  detail: string
}

const checks: Check[] = []
const record = (check: Check) => {
  checks.push(check)
  const mark = { pass: 'PASS', fail: 'FAIL', skip: 'SKIP' }[check.outcome]
  process.stdout.write(`${mark}  ${check.id}  ${check.question}\n`)
  process.stdout.write(`      ${check.detail}\n`)
}

/** A hostname that does not resolve is an answer, not an error. */
async function statusOf(url: string): Promise<number | null> {
  try {
    const response = await fetch(url, { redirect: 'manual' })
    return response.status
  } catch {
    return null
  }
}

async function checkHealth(hostname: string, id: string): Promise<void> {
  const status = await statusOf(`https://${hostname}/api/health`)
  const verdict = status === null ? 'unreachable' : healthVerdict(status)
  record({
    id,
    question: `Access answers for ${hostname} before the Worker does`,
    outcome: verdict === 'protected' ? 'pass' : 'fail',
    detail:
      verdict === 'protected'
        ? `/api/health answered ${String(status)}, which is Access`
        : verdict === 'unprotected'
          ? `/api/health answered ${String(status)} - the Worker is reachable without a login`
          : `/api/health answered ${status === null ? 'nothing' : String(status)} - DNS or the deploy may still be settling`,
  })
}

async function checkWorkersDev(): Promise<void> {
  const token = process.env.CLOUDFLARE_API_TOKEN
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
  const question = 'the workers.dev hostname serves nothing'

  if (!token || !accountId) {
    record({
      id: '(e)',
      question,
      outcome: 'skip',
      detail:
        'set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID to look the subdomain up',
    })
    return
  }

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`,
    { headers: { authorization: `Bearer ${token}` } },
  )
  const body: SubdomainResponse = await response.json()
  const subdomain = body.result?.subdomain

  if (!body.success || subdomain === undefined) {
    record({
      id: '(e)',
      question,
      outcome: 'skip',
      detail: 'the account has no workers.dev subdomain to reach',
    })
    return
  }

  const origin = workersDevOrigin(SERVICE, subdomain)
  const status = await statusOf(`${origin}/api/health`)
  const verdict = exposureVerdict(status)
  record({
    id: '(e)',
    question,
    outcome: verdict === 'closed' ? 'pass' : 'fail',
    detail:
      verdict === 'closed'
        ? `${origin} answered ${status === null ? 'nothing' : String(status)}`
        : `${origin} answered ${String(status)} - set workers_dev to false and deploy again`,
  })
}

async function main(): Promise<void> {
  const hostname = process.env.SYNC_HOSTNAME
  if (!hostname) throw new Error('missing environment: SYNC_HOSTNAME')

  await checkHealth(hostname, '(a)')
  await checkWorkersDev()

  // (g) is the same question as (a) asked again on the other side of a deploy:
  // the custom domain is attached by the API, and nothing guarantees that
  // wrangler leaves it alone.
  if (process.argv.includes('--redeploy')) {
    process.stdout.write('\ndeploying again to see whether the domain holds\n')
    await run('pnpm', ['exec', 'wrangler', 'deploy'])
    await checkHealth(hostname, '(g)')
  }

  const failed = checks.filter((check) => check.outcome === 'fail')
  process.stdout.write(
    `\n${checks.length - failed.length} of ${checks.length} checks did not fail\n`,
  )
  if (failed.length > 0) process.exitCode = 1
}

await main()
