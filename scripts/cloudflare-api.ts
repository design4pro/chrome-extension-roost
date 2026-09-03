/**
 * The payloads `pnpm setup:cloud` sends to Cloudflare, as pure functions.
 *
 * The script that sends them cannot be tested without an account; the shape of
 * what it sends can, and that is where the mistakes live - a policy without a
 * name, an organisation update that drops half the object it is patching, a
 * health check read the wrong way round.
 */

/** Access sessions last as long as the platform allows, so logins are rare. */
export const SESSION_DURATION = '720h'

export interface AccessAppInput {
  hostname: string
  ownerEmail: string
  /** The identity providers a login may use; one-time PIN by default. */
  idpIds: string[]
}

export function buildAppPayload(
  input: AccessAppInput,
): Record<string, unknown> {
  return {
    type: 'self_hosted',
    name: 'tab-sync',
    destinations: [{ type: 'public', uri: input.hostname }],
    session_duration: SESSION_DURATION,
    auto_redirect_to_identity: true,
    allowed_idps: input.idpIds,
    // The binding cookie ties a session to one browser fingerprint, which is
    // exactly what this extension does not want: the same account is signed in
    // from Chrome and from Canary.
    enable_binding_cookie: false,
    // The extension's requests are same-site to the Worker's origin, but the
    // WebSocket upgrade is not always treated that way; 'none' is what keeps
    // the cookie attached to it.
    same_site_cookie_attribute: 'none',
    policies: [
      {
        // The API rejects a policy without a name, and says nothing useful
        // about which field it meant.
        name: 'tab-sync owner',
        decision: 'allow',
        include: [{ email: { email: input.ownerEmail } }],
        precedence: 1,
      },
    ],
  }
}

/**
 * The organisation update. `PUT access/organizations` replaces the object, so
 * this is the one it already has with the session duration changed - anything
 * dropped here is a setting the user silently loses.
 */
export function buildOrgPayload(
  existing: Record<string, unknown>,
): Record<string, unknown> {
  return { ...existing, session_duration: SESSION_DURATION }
}

export function buildDomainPayload(input: {
  hostname: string
  service: string
  zoneId: string
}): Record<string, unknown> {
  return {
    hostname: input.hostname,
    service: input.service,
    zone_id: input.zoneId,
    environment: 'production',
  }
}

/** The zone a hostname belongs to is its last two labels. */
export function apexOf(hostname: string): string {
  const labels = hostname.split('.')
  return labels.length <= 2 ? hostname : labels.slice(-2).join('.')
}

/** Every step is idempotent, which means every step looks first. */
export function findExisting<T>(
  items: readonly T[],
  match: (item: T) => boolean,
): T | undefined {
  return items.find(match)
}

export type HealthVerdict = 'protected' | 'unprotected' | 'unreachable'

/**
 * What `GET /api/health` says about whether Access is really in front.
 *
 * A redirect to the login page or a 401 means Access answered. A 204 means the
 * request reached the Worker without one, which is a misconfiguration and not
 * a success, however healthy it looks.
 */
export function healthVerdict(status: number): HealthVerdict {
  if (status === 401 || status === 403) return 'protected'
  if (status >= 300 && status < 400) return 'protected'
  if (status === 200 || status === 204) return 'unprotected'
  return 'unreachable'
}

export type ExposureVerdict = 'closed' | 'open'

/**
 * Whether a hostname that should not exist answers anyway.
 *
 * `workers_dev: false` is meant to leave nothing at `<service>.<team>.workers.dev`,
 * so a failed connection or Cloudflare's "nothing here" 404 is the pass. Any
 * other answer means the code is reachable on a hostname Access never sees;
 * the Worker would reject the request itself, but the point of the setting is
 * that there is no second door to try.
 */
export function exposureVerdict(status: number | null): ExposureVerdict {
  if (status === null || status === 404) return 'closed'
  return 'open'
}

/** Where a Worker would answer if `workers_dev` were left on. */
export function workersDevOrigin(service: string, subdomain: string): string {
  return `https://${service}.${subdomain}.workers.dev`
}
