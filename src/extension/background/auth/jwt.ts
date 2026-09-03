/**
 * Just enough JWT to know when the Access session runs out.
 *
 * The extension never trusts this token; only the Worker does, and it verifies
 * the signature properly. Here the payload is read for one reason - to schedule
 * the refresh before the cookie expires - so reading it unverified is safe: a
 * forged `exp` can only make the extension re-authenticate at the wrong moment.
 */
export function decodeExp(token: string): number | undefined {
  const payload = token.split('.')[1]
  if (payload === undefined) return undefined

  try {
    const json = atob(payload.replaceAll('-', '+').replaceAll('_', '/'))
    const claims = JSON.parse(json) as unknown
    if (
      typeof claims === 'object' &&
      claims !== null &&
      'exp' in claims &&
      typeof claims.exp === 'number'
    ) {
      return claims.exp * 1000
    }
  } catch {
    // A token we cannot read is a token we cannot schedule around.
  }
  return undefined
}
