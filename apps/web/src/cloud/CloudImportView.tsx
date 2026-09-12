import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { formatRelative } from '@selfmp3/shared'
import { Download, X } from '../components/Icons.js'
import type { ImportRequestView } from '@selfmp3/cloud'
import { queryKeys, useCloudImportActions, useCloudImports } from '../lib/queries.js'
import { sharedLinksFromQuery } from '../lib/shareTarget.js'

/**
 * Importing from a device that cannot download (docs/SYNC.md).
 *
 * A phone cannot run yt-dlp, so a link pasted here is a request in this
 * device's change log. The Mac picks it up the next time it is on, downloads
 * the song — or every song of a playlist — and adds it to the library, and
 * every device sees how it went. A link shared into the app from another one
 * (Android's share sheet) arrives in the box, ready to send.
 */
export function CloudImportView() {
  const location = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [shared] = useState(() => sharedLinksFromQuery(location.search))
  const [url, setUrl] = useState(shared ?? '')
  const { data, error } = useCloudImports()
  const { request, cancel } = useCloudImportActions()
  const imports = data?.imports ?? []

  // The shared link is in the box now; the address need not keep it.
  useEffect(() => {
    if (shared) void navigate(location.pathname, { replace: true })
    // Once, on arrival.
  }, [])

  // A request that finishes brings songs: show them in the library too.
  const done = imports.filter(item => item.state === 'done').length
  const seenDone = useRef(done)
  useEffect(() => {
    if (done > seenDone.current) void queryClient.invalidateQueries({ queryKey: queryKeys.library })
    seenDone.current = done
  }, [done, queryClient])

  return (
    <section className="view">
      <header className="view-head">
        <div className="view-titles">
          <h1>Import</h1>
          <p className="view-sub">
            Paste a YouTube or YouTube Music link — a song, or a whole playlist. Your Mac downloads
            it the next time it is on, and it appears on every device.
          </p>
        </div>
      </header>

      <form
        className="cloud-import-form"
        onSubmit={event => {
          event.preventDefault()
          const link = url.trim()
          if (!link) return
          request.mutate(
            { url: link, tagIds: [], playlistId: null },
            { onSuccess: () => setUrl('') },
          )
        }}
      >
        <input
          className="input"
          aria-label="Link to import"
          placeholder="https://music.youtube.com/watch?v=…"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          value={url}
          onChange={event => setUrl(event.target.value)}
        />
        <button
          type="submit"
          className="button button-primary"
          disabled={!url.trim() || request.isPending}
        >
          <Download size={15} /> Import
        </button>
      </form>

      {request.error && (
        <p className="notice notice-error" role="alert">
          <span>{request.error.message}</span>
        </p>
      )}
      {error && (
        <p className="notice notice-warn">
          <span>Couldn’t check on your imports just now: {error.message}</span>
        </p>
      )}

      {imports.length === 0 ? (
        <p className="panel-lead">Nothing asked for yet.</p>
      ) : (
        <ul className="cloud-imports">
          {imports.map(item => (
            <li key={item.uid} className={`cloud-import is-${item.state}`}>
              <div className="cloud-import-titles">
                <strong>{item.title ?? item.url}</strong>
                <span>{describe(item)}</span>
              </div>
              {(item.state === 'waiting' || item.state === 'working') && (
                <button
                  type="button"
                  className="button button-small"
                  onClick={() => cancel.mutate(item.uid)}
                  disabled={cancel.isPending}
                >
                  <X size={13} /> Cancel
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function describe(item: ImportRequestView): string {
  switch (item.state) {
    case 'waiting':
      return `Waiting for your Mac · asked ${formatRelative(item.requestedAt)}`
    case 'working':
      return 'Downloading on your Mac…'
    case 'done':
      return item.songIds.length === 0
        ? 'Already in your library'
        : `Added ${item.songIds.length} song${item.songIds.length === 1 ? '' : 's'}`
    case 'failed':
      return `Couldn’t import it: ${item.error ?? 'something went wrong'}`
    case 'cancelled':
      return 'Cancelled'
  }
}
