import { createVerifier } from './auth/verify'
import type { Verifier, VerifierEnv } from './auth/verify'
import { route } from './router'
import type { RouterEnv } from './router'

export { UserHub } from './user-hub/UserHub'

export interface Env extends VerifierEnv, RouterEnv {}

// Built on first use and kept for the isolate's life: creating it fetches the
// team's JWKS, and doing that per request would add a round trip to every call.
let verifier: Verifier | undefined

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    verifier ??= createVerifier(env)
    return route(request, env, verifier)
  },
} satisfies ExportedHandler<Env>
