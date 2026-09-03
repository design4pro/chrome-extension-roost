import type { ConnectionStatus } from '#/extension/port/protocol'
import { t } from '../i18n'

/**
 * One line about the connection, and only when there is something to say.
 *
 * `role="status"` rather than an alert: a connection that drops and returns is
 * ordinary, and interrupting a screen reader every time would be worse than
 * saying nothing.
 */
const MESSAGES: Partial<Record<ConnectionStatus, string>> = {
  connecting: 'banner_connecting',
  offline: 'banner_offline',
  auth_required: 'banner_auth',
  paused_quota: 'banner_quota',
  incompatible: 'banner_incompatible',
}

export function Banner({ connection }: { connection: ConnectionStatus }) {
  const key = MESSAGES[connection]

  return (
    <div role="status" aria-live="polite">
      {key === undefined ? null : (
        <p className="m-0 border-b border-divider bg-container px-6 py-2 text-on-surface-variant">
          {t(key)}
        </p>
      )}
    </div>
  )
}
