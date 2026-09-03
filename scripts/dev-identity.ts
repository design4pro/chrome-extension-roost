/**
 * The issuer and audience the local Access stand-in uses.
 *
 * They live in their own module because both `dev-keys` (which writes them into
 * .dev.vars) and `dev-token` (which signs with them) need them, and neither
 * should have to import the other's side effects to get at a constant.
 */
export const DEV_ISSUER = 'https://localhost-team.cloudflareaccess.com'
export const DEV_AUDIENCE = 'local-development-audience'
export const DEV_KEY_FILE = 'e2e/.dev-key.json'
export const DEV_KID = 'roost-dev'
