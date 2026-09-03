import { decodeExp } from './jwt'

export type SessionState = 'missing' | 'expired' | 'valid'

export interface Session {
  state: SessionState
  /** When the cookie stops being accepted, if it says so. */
  exp?: number
}

/**
 * What the Access cookie is worth right now.
 *
 * A cookie whose `exp` cannot be read counts as valid: the Worker is the only
 * authority on that, and refusing to connect over an unreadable claim would
 * turn a cosmetic problem into an outage.
 */
export function evaluate(cookie: string | undefined, now: number): Session {
  if (cookie === undefined || cookie === '') return { state: 'missing' }

  const exp = decodeExp(cookie)
  if (exp === undefined) return { state: 'valid' }
  return { state: exp <= now ? 'expired' : 'valid', exp }
}
