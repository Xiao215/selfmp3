import { useEffect, useMemo, useRef, useState } from 'react'
import { activeLineIndex, parseLyrics, type ParsedLyrics } from '@selfmp3/shared'
import { useQuery } from '@tanstack/react-query'
import { api, ApiError } from '../lib/api.js'
import { usePlayer } from '../player/PlayerProvider.js'
import { Refresh, X } from './Icons.js'

/**
 * The lyrics panel.
 *
 * Lyrics are fetched from your own server, which resolves them from a sidecar
 * file next to the audio, an embedded tag, or lrclib.net — and caches whatever
 * it finds to disk, so the panel works offline afterwards.
 *
 * The two behaviours that make it feel right: the active line is centred
 * automatically, and auto-scroll backs off for a few seconds after you scroll
 * by hand, so reading ahead does not fight the playhead.
 */
export function LyricsPanel({ onClose }: { onClose: () => void }) {
  const player = usePlayer()
  const song = player.current
  const listRef = useRef<HTMLDivElement>(null)
  const lastManualScroll = useRef(0)
  const [refreshing, setRefreshing] = useState(false)

  const {
    data,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['lyrics', song?.id ?? 0],
    queryFn: () => (song ? api.lyrics(song.id) : Promise.reject(new Error('no song'))),
    enabled: song !== null,
    retry: false,
    staleTime: 10 * 60_000,
  })

  const parsed: ParsedLyrics | null = useMemo(
    () => (data ? parseLyrics(data.text) : null),
    [data],
  )

  const active =
    parsed?.synced === true ? activeLineIndex(parsed.lines, player.currentTime) : -1

  // Keep the current line centred, unless the user is scrolling themselves.
  useEffect(() => {
    if (active < 0 || !listRef.current) return
    if (Date.now() - lastManualScroll.current < 4_000) return
    const element = listRef.current.querySelector(`[data-line="${active}"]`)
    element?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [active])

  const onRefresh = async (): Promise<void> => {
    if (!song) return
    setRefreshing(true)
    try {
      await api.lyrics(song.id, true)
      await refetch()
    } catch {
      // The empty state below already explains what to do.
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <aside className="side-panel lyrics-panel">
      <header className="side-panel-head">
        <div className="side-panel-titles">
          <div className="side-panel-title">{song?.title ?? 'Lyrics'}</div>
          <div className="side-panel-sub">{song?.artist ?? ''}</div>
        </div>
        <div className="side-panel-actions">
          {song && (
            <button
              type="button"
              className="icon-button"
              onClick={() => void onRefresh()}
              disabled={refreshing}
              aria-label="Look up lyrics again"
              title="Look up lyrics again"
            >
              <Refresh size={16} />
            </button>
          )}
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close lyrics">
            <X size={16} />
          </button>
        </div>
      </header>

      <div
        className="lyrics-body"
        ref={listRef}
        onWheel={() => {
          lastManualScroll.current = Date.now()
        }}
        onTouchMove={() => {
          lastManualScroll.current = Date.now()
        }}
      >
        {!song && <p className="empty-hint">Play something first.</p>}

        {song && isLoading && <p className="empty-hint">Looking for lyrics…</p>}

        {song && error && (
          <div className="empty-hint">
            <p>
              {error instanceof ApiError && error.isOffline
                ? 'Lyrics need a connection to your library.'
                : 'No lyrics found for this track.'}
            </p>
            <p className="hint">
              You can drop a <code>.lrc</code> file next to the audio in your library folder, or
              try looking again.
            </p>
          </div>
        )}

        {parsed?.synced === false &&
          parsed.lines.map((line, index) => (
            <p key={index} className="lyric-line is-plain">
              {line || ' '}
            </p>
          ))}

        {parsed?.synced === true &&
          parsed.lines.map((line, index) => (
            <button
              key={`${line.time}-${index}`}
              type="button"
              data-line={index}
              className={[
                'lyric-line',
                'is-synced',
                index === active ? 'is-active' : '',
                index < active ? 'is-past' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => player.seek(line.time)}
              title="Jump to this line"
            >
              {line.text || '♪'}
            </button>
          ))}
      </div>

      {data && (
        <footer className="side-panel-foot">
          <span className="hint">
            {data.kind === 'synced' ? 'Synced' : 'Plain'} ·{' '}
            {data.source === 'sidecar'
              ? 'from your library folder'
              : data.source === 'embedded'
                ? 'from the file’s tags'
                : 'from lrclib.net'}
          </span>
        </footer>
      )}
    </aside>
  )
}
