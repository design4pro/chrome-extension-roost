/**
 * Which of the open tabs might be this user's hub.
 *
 * The address cannot be predicted: the deploy screen lets the user rename the
 * Worker, and the `workers.dev` subdomain belongs to their account. So it is
 * recognised rather than guessed - and only proposed, never adopted, because
 * the pairing key is what actually decides whether a hub is theirs.
 */

/** Origins of the open tabs that look like a Worker, most recent first. */
export function hubCandidates(tabs: ReadonlyArray<{ url?: string }>): string[] {
  const found = new Set<string>()

  for (const tab of tabs) {
    if (tab.url === undefined) continue

    let origin: string
    try {
      const parsed = new URL(tab.url)
      if (parsed.protocol !== 'https:') continue
      if (!parsed.hostname.endsWith('.workers.dev')) continue
      origin = parsed.origin
    } catch {
      continue
    }

    found.add(origin)
  }

  return [...found]
}
