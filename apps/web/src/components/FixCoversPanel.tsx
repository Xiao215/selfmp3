import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys, useFixCovers, useFixCoversStatus } from '../lib/queries.js'
import { CheckCircle, Sparkles, X } from './Icons.js'

/**
 * "Find missing cover art" — one row of the Library settings panel, with the
 * same anatomy as every other setting: what it is, one quiet line saying what
 * it will do, and the control on the right. The pass runs on the server; this
 * only starts, stops and watches it, so closing the tab does not interrupt
 * anything.
 */
export function FixCoversPanel({ missingArt }: { missingArt: number }) {
  const { data: status } = useFixCoversStatus()
  const fixCovers = useFixCovers()
  const client = useQueryClient()

  const running = status?.status === 'running'

  // Covers land one at a time while the pass runs; refetch the library as
  // they do so the placeholders fill in rather than waiting for the end.
  const found = status?.found ?? 0
  const state = status?.status
  useEffect(() => {
    if (found > 0 || state === 'done' || state === 'cancelled') {
      void client.invalidateQueries({ queryKey: queryKeys.library })
    }
  }, [client, found, state])

  return (
    <>
      <div className="setting-row">
        <span className="setting-label">
          Cover art
          <span className="setting-hint">
            {missingArt === 0
              ? 'Every song has artwork.'
              : `${missingArt} ${missingArt === 1 ? 'song has' : 'songs have'} none. Looks each one up on iTunes and MusicBrainz and keeps confident matches only.`}
          </span>
        </span>
        <span className="setting-control">
          {running ? (
            <button
              type="button"
              className="button"
              onClick={() => fixCovers.mutate('cancel')}
              disabled={fixCovers.isPending}
            >
              <X size={15} /> Stop looking
            </button>
          ) : (
            <button
              type="button"
              className="button"
              onClick={() => fixCovers.mutate('start')}
              disabled={fixCovers.isPending || missingArt === 0}
            >
              <Sparkles size={15} /> Find missing art
            </button>
          )}
        </span>
      </div>

      {status && running && (
        <div className="sync-progress" aria-live="polite">
          <div className="sync-progress-head">
            <span className="spinner" />
            <span>
              Checking {Math.min(status.done + 1, status.total)} of {status.total}
              {status.currentTitle && ` — ${status.currentTitle}`}
              {status.found > 0 && ` · ${status.found} found`}
            </span>
          </div>
          <div className="offline-meter">
            <span
              style={{ width: `${status.total > 0 ? (status.done / status.total) * 100 : 0}%` }}
            />
          </div>
        </div>
      )}

      {status && (status.status === 'done' || status.status === 'cancelled') && (
        <p className="notice notice-good">
          <span>
            <CheckCircle size={15} /> {status.status === 'cancelled' ? 'Stopped. ' : ''}
            Found artwork for {status.found} of {status.done} {status.done === 1 ? 'song' : 'songs'}
            {status.done < status.total ? ` (${status.total - status.done} not checked)` : ''}.
          </span>
        </p>
      )}
    </>
  )
}
