import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { activeLineIndex, parseLyrics, type ParsedLyrics } from '@selfmp3/shared'
import { useQuery } from '@tanstack/react-query'
import { api, ApiError } from '../lib/api.js'
import { useLocalStorage } from '../lib/hooks.js'
import { useSettings, useUpdateSettings } from '../lib/queries.js'
import { usePlayer } from '../player/PlayerProvider.js'
import { Clock, Mic, Refresh, Romanize, Translate, X } from './Icons.js'
import { LyricsSyncEditor } from './LyricsSyncEditor.js'

/**
 * The lyrics panel.
 *
 * Lyrics are fetched from your own server, which resolves them from a sidecar
 * file next to the audio, an embedded tag, or lrclib.net — and caches whatever
 * it finds to disk, so the panel works offline afterwards.
 *
 * Lyrics+ adds two optional lines under each original: a romanization
 * (pinyin or romaji, computed offline on the server) and a translation (via
 * an API key you add in Settings). Both come back aligned 1:1 with the lyric
 * lines, so rendering is just "line N, then its extras". A sync mode turns
 * plain or missing lyrics into a timed `.lrc`.
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
  const [syncing, setSyncing] = useState(false)

  const { data: settings } = useSettings()
  const updateSettings = useUpdateSettings()
  const romanizationOn = settings?.lyricsRomanization === 'on'
  const provider = settings?.lyricsTranslationProvider ?? 'none'
  const lang = settings?.lyricsTranslationLang ?? 'en'
  // Which extras are shown is a per-device preference; the romanization
  // switch is a synced setting because it is about the library, not the phone.
  const [translationOn, setTranslationOn] = useLocalStorage('lyrics.translation', false)

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

  const romanized = useQuery({
    queryKey: ['lyrics', song?.id ?? 0, 'romanized', data?.text ?? ''],
    queryFn: () => (song ? api.romanizedLyrics(song.id) : Promise.reject(new Error('no song'))),
    enabled: song !== null && romanizationOn && !!data,
    retry: false,
    staleTime: 60 * 60_000,
  })

  const translation = useQuery({
    queryKey: ['lyrics', song?.id ?? 0, 'translation', lang, data?.text ?? ''],
    queryFn: () =>
      song ? api.translatedLyrics(song.id, lang) : Promise.reject(new Error('no song')),
    enabled: song !== null && translationOn && provider !== 'none' && !!data,
    retry: false,
    staleTime: 60 * 60_000,
  })

  const lineCount = parsed?.lines.length ?? 0
  // Only trust extras that line up exactly; anything else is worse than nothing.
  const romanLines =
    romanizationOn && romanized.data && romanized.data.lines.length === lineCount
      ? romanized.data.lines
      : null
  const transLines =
    translationOn && translation.data && translation.data.lines.length === lineCount
      ? translation.data.lines
      : null

  const active =
    parsed?.synced === true ? activeLineIndex(parsed.lines, player.currentTime) : -1

  // Keep the current line centred, unless the user is scrolling themselves.
  useEffect(() => {
    if (active < 0 || !listRef.current) return
    if (Date.now() - lastManualScroll.current < 4_000) return
    const element = listRef.current.querySelector(`[data-line="${active}"]`)
    element?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [active])

  // Leave sync mode when the track changes; the editor is bound to one song.
  useEffect(() => {
    setSyncing(false)
  }, [song?.id])

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

  const extras = (index: number): React.ReactNode => {
    const roman = romanLines?.[index]?.romanized
    const trans = transLines?.[index]?.translation
    if (!roman && !trans) return null
    return (
      <>
        {roman && <span className="lyric-sub lyric-roman">{roman}</span>}
        {trans && <span className="lyric-sub lyric-trans">{trans}</span>}
      </>
    )
  }

  const translationHint = (): React.ReactNode => {
    if (!translationOn || !song || !data) return null
    if (provider === 'none') {
      return (
        <p className="lyrics-hint">
          Add an API key in <Link to="/settings#lyrics">Settings</Link> to enable translations.
        </p>
      )
    }
    if (translation.isLoading) return <p className="lyrics-hint">Translating…</p>
    if (translation.error) {
      const message =
        translation.error instanceof ApiError && translation.error.code === 'no_key'
          ? 'The translation provider has no API key yet — add one in Settings.'
          : 'Translation is unavailable right now.'
      return <p className="lyrics-hint">{message}</p>
    }
    return null
  }

  return (
    <aside className="side-panel lyrics-panel">
      <header className="side-panel-head">
        <div className="side-panel-titles">
          <div className="side-panel-title">{song?.title ?? 'Lyrics'}</div>
          <div className="side-panel-sub">{song?.artist ?? ''}</div>
        </div>
        <div className="side-panel-actions">
          {song && !syncing && (
            <>
              <button
                type="button"
                className={`icon-button ${romanizationOn ? 'is-accent' : ''}`}
                onClick={() =>
                  updateSettings.mutate({ lyricsRomanization: romanizationOn ? 'off' : 'on' })
                }
                aria-pressed={romanizationOn}
                aria-label="Romanization"
                title={romanizationOn ? 'Hide pinyin / romaji' : 'Show pinyin / romaji'}
              >
                <Romanize size={17} />
              </button>
              <button
                type="button"
                className={`icon-button ${translationOn ? 'is-accent' : ''}`}
                onClick={() => setTranslationOn(!translationOn)}
                aria-pressed={translationOn}
                aria-label="Translation"
                title={translationOn ? 'Hide translation' : `Translate to ${lang}`}
              >
                <Translate size={17} />
              </button>
              <button
                type="button"
                className="icon-button"
                onClick={() => setSyncing(true)}
                aria-label="Sync lyrics"
                title={
                  data?.kind === 'synced' ? 'Re-time these lyrics' : 'Sync lyrics to the music'
                }
              >
                <Clock size={16} />
              </button>
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
            </>
          )}
          <button
            type="button"
            className="icon-button side-panel-close"
            onClick={onClose}
            aria-label="Close lyrics"
            title="Close"
          >
            <X size={17} />
          </button>
        </div>
      </header>

      {song && syncing ? (
        <LyricsSyncEditor
          key={song.id}
          song={song}
          initialText={data?.text ?? ''}
          onDone={() => setSyncing(false)}
        />
      ) : (
        <div
          className={`lyrics-body ${romanLines || transLines ? 'has-extras' : ''}`}
          ref={listRef}
          onWheel={() => {
            lastManualScroll.current = Date.now()
          }}
          onTouchMove={() => {
            lastManualScroll.current = Date.now()
          }}
        >
          {!song && (
            <div className="panel-empty">
              <span className="panel-empty-icon">
                <Mic size={20} />
              </span>
              <span className="panel-empty-title">Nothing playing</span>
              <p>Start a song and its lyrics turn up here, timed to the music where they can be.</p>
            </div>
          )}

          {song && isLoading && (
            <p className="lyrics-loading">
              <span className="spinner" /> Looking for lyrics…
            </p>
          )}

          {song && error && (
            <div className="panel-empty">
              <span className="panel-empty-icon">
                <Mic size={20} />
              </span>
              <span className="panel-empty-title">
                {error instanceof ApiError && error.isOffline
                  ? 'Lyrics need your library'
                  : 'No lyrics for this song'}
              </span>
              <p>
                {error instanceof ApiError && error.isOffline
                  ? 'Reconnect and they will be looked up again.'
                  : 'Drop a .lrc file next to the audio in your library folder, look again, or write them yourself.'}
              </p>
              {!(error instanceof ApiError && error.isOffline) && (
                <button type="button" className="link-button" onClick={() => setSyncing(true)}>
                  Type and sync them yourself
                </button>
              )}
            </div>
          )}

          {translationHint()}

          {parsed?.synced === false &&
            parsed.lines.map((line, index) => (
              <p key={index} className="lyric-line is-plain">
                <span className="lyric-text">{line || ' '}</span>
                {extras(index)}
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
                <span className="lyric-text">{line.text || '♪'}</span>
                {extras(index)}
              </button>
            ))}
        </div>
      )}

      {data && !syncing && (
        <footer className="side-panel-foot">
          <span className="hint">
            {data.kind === 'synced' ? 'Synced' : 'Plain'} ·{' '}
            {data.source === 'sidecar'
              ? 'from your library folder'
              : data.source === 'embedded'
                ? 'from the file’s tags'
                : 'from lrclib.net'}
            {romanLines && romanized.data?.language !== 'none' && (
              <> · {romanized.data?.language === 'ja' ? 'romaji' : 'pinyin'}</>
            )}
            {transLines && <> · translated to {transLines.length > 0 ? lang : ''}</>}
          </span>
        </footer>
      )}
    </aside>
  )
}
