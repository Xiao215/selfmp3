import { useEffect, useRef, useState } from 'react'
import type { Song } from '@selfmp3/shared'
import { usePlayer } from '../../player/PlayerProvider.js'
import { useTransport } from '../../devices/useTransport.js'
import { useLibrary } from '../../lib/queries.js'
import { rgba } from '../../lib/visuals.js'
import { Cover } from '../Cover.js'
import { FeatureBadges } from '../FeatureBadges.js'
import { ChevronDown, Collapse, Expand, Romanize, TagPlus } from '../Icons.js'
import { QueuePanel } from '../QueuePanel.js'
import { SongDetailsBody } from '../SongDetailsDialog.js'
import { TagChip } from '../TagChip.js'
import { TagPicker } from '../TagPicker.js'
import { SongWords } from './SongWords.js'
import { UpNextCard } from './UpNextCard.js'
import { useCoverArt } from './useCoverArt.js'
import { useSongLyrics } from './useSongLyrics.js'

export type PageMode = 'stage' | 'focus'
export type StageTab = 'lyrics' | 'queue' | 'about'

/** Focus hides its chrome after this long without the mouse or a key. */
const IDLE_MS = 3_000

/**
 * The page for the song that is playing, on a computer.
 *
 * One page with two modes. **Stage** is what the bar opens: the artwork and
 * what the app knows about the song on the left, the lyrics (or the queue, or
 * the song's details) on the right. **Focus** is the same page when only the
 * words matter: the cover glides into the header, the title goes with it, and
 * the lyrics widen and grow around the line being sung. Nothing is swapped
 * out — every piece has a Stage place and a Focus place in the stylesheet and
 * moves between them, so the line you are reading never leaves the screen.
 *
 * The page covers the library, not the player bar, so play and pause never
 * move under your hand; in Focus, the bar steps aside too once the mouse is
 * still, and comes back the moment it moves.
 */
export function NowPlayingPage({
  mode,
  tab,
  onModeChange,
  onTabChange,
  onClose,
  onIdleChange,
}: {
  mode: PageMode
  tab: StageTab
  onModeChange: (mode: PageMode) => void
  onTabChange: (tab: StageTab) => void
  onClose: () => void
  /** Focus with a still mouse: the shell hides the bar while this is true. */
  onIdleChange: (idle: boolean) => void
}) {
  const transport = useTransport()
  const song = transport.song

  if (!song) {
    return (
      <section className="np-page is-empty" aria-label="Now playing">
        <header className="np-head">
          <button
            type="button"
            className="icon-button np-close"
            onClick={onClose}
            aria-label="Close"
          >
            <ChevronDown size={22} />
          </button>
        </header>
        <div className="panel-empty">
          <span className="panel-empty-title">Nothing playing</span>
          <p>Start a song and it turns up here, with its lyrics.</p>
        </div>
      </section>
    )
  }

  return (
    <PageForSong
      song={song}
      mode={mode}
      tab={tab}
      onModeChange={onModeChange}
      onTabChange={onTabChange}
      onClose={onClose}
      onIdleChange={onIdleChange}
    />
  )
}

function PageForSong({
  song,
  mode,
  tab,
  onModeChange,
  onTabChange,
  onClose,
  onIdleChange,
}: {
  song: Song
  mode: PageMode
  tab: StageTab
  onModeChange: (mode: PageMode) => void
  onTabChange: (tab: StageTab) => void
  onClose: () => void
  onIdleChange: (idle: boolean) => void
}) {
  const player = usePlayer()
  const transport = useTransport()
  const { data: library } = useLibrary()
  const lyrics = useSongLyrics(song)
  const art = useCoverArt(song)
  const [tagsOpen, setTagsOpen] = useState(false)
  const tagsRef = useRef<HTMLButtonElement>(null)
  const idle = useIdle(mode === 'focus')

  useEffect(() => onIdleChange(idle), [idle, onIdleChange])
  useEffect(() => () => onIdleChange(false), [onIdleChange])

  const focus = mode === 'focus'
  const shownTab: StageTab = focus ? 'lyrics' : tab
  const hasLyrics = lyrics.words.status === 'lyrics'
  const hasVisual = lyrics.words.status === 'instrumental' || lyrics.words.status === 'missing'
  const toggleFocus = (): void => onModeChange(focus ? 'stage' : 'focus')

  const allTags = library?.tags ?? []
  const songTags = song.tagIds.flatMap(id => allTags.filter(tag => tag.id === id))
  const romanName = lyrics.language === 'ja' ? 'Romaji' : 'Pinyin'

  const classes = ['np-page', `is-${mode}`]
  if (idle) classes.push('is-idle')
  if (hasVisual && shownTab === 'lyrics') classes.push('has-visual')

  const [c1, c2, c3] = art.palette
  const style = {
    '--np-1': rgba(c1, 1),
    '--np-2': rgba(c2, 1),
    '--np-3': rgba(c3, 1),
  } as React.CSSProperties

  return (
    <section className={classes.join(' ')} style={style} aria-label={`Now playing: ${song.title}`}>
      <div className="np-glow" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>

      <header className="np-head">
        <button
          type="button"
          className="icon-button np-close"
          onClick={focus ? () => onModeChange('stage') : onClose}
          aria-label={focus ? 'Back to the full page' : 'Close now playing'}
          title={focus ? 'Back to the full page' : 'Close'}
        >
          <ChevronDown size={22} />
        </button>

        <div className="np-head-song" aria-hidden={!focus}>
          <strong>{song.title}</strong>
          <span>{song.artist || 'Unknown artist'}</span>
        </div>

        <span className="np-context">
          {transport.remote ? (
            <>Controlling {transport.remote.name}</>
          ) : (
            <>
              {player.queue.shuffle ? 'Shuffling' : 'Playing'} · {player.queue.index + 1} of{' '}
              {player.queue.items.length}
            </>
          )}
        </span>

        <div className="np-tabs" role="tablist" aria-label="Show">
          {(
            [
              ['lyrics', hasVisual ? 'Visual' : 'Lyrics'],
              ['queue', 'Up next'],
              ['about', 'About'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={shownTab === value}
              className={shownTab === value ? 'is-active' : ''}
              onClick={() => onTabChange(value)}
              tabIndex={focus ? -1 : 0}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      <Cover song={song} size={400} className="np-cover" />

      <div className="np-meta" aria-hidden={focus}>
        <h1 className="np-title">{song.title}</h1>
        <p className="np-byline">
          {[song.artist || 'Unknown artist', song.album, song.year].filter(Boolean).join(' · ')}
        </p>
        <div className="np-facts">
          <FeatureBadges features={song.features} size="large" showKey />
        </div>
        <div className="np-tags">
          {songTags.map(tag => (
            <TagChip key={tag.id} tag={tag} size="small" />
          ))}
          <button
            ref={tagsRef}
            type="button"
            className="np-tag-button"
            onClick={() => setTagsOpen(open => !open)}
            aria-haspopup="dialog"
            aria-expanded={tagsOpen}
            tabIndex={focus ? -1 : 0}
          >
            <TagPlus size={14} /> {songTags.length > 0 ? 'Edit tags' : 'Add tags'}
          </button>
          {tagsOpen && (
            <TagPicker
              anchorRef={tagsRef}
              song={song}
              allTags={allTags}
              onClose={() => setTagsOpen(false)}
            />
          )}
        </div>
      </div>

      <div className="np-words">
        {shownTab === 'lyrics' && (
          <SongWords song={song} lyrics={lyrics} mode={focus ? 'focus' : 'stage'} />
        )}
        {shownTab === 'queue' && <QueuePanel onClose={() => onTabChange('lyrics')} />}
        {shownTab === 'about' && (
          <div className="np-about">
            <SongDetailsBody song={song} />
          </div>
        )}
      </div>

      {shownTab === 'lyrics' && hasLyrics && lyrics.language !== 'none' && (
        <div className="np-tools">
          <button
            type="button"
            className={`np-tool ${lyrics.romanizationOn ? 'is-on' : ''}`}
            onClick={() => lyrics.setRomanization(!lyrics.romanizationOn)}
            aria-pressed={lyrics.romanizationOn}
            title={`${lyrics.romanizationOn ? 'Hide' : 'Show'} ${romanName.toLowerCase()} under each line`}
          >
            <Romanize size={14} /> {romanName}
          </button>
        </div>
      )}

      {/* On the words themselves, the way a video has its fullscreen button:
          where the eye already is, and clear of the lines a click jumps to. */}
      {shownTab === 'lyrics' && (
        <button
          type="button"
          className="np-expand"
          onClick={toggleFocus}
          aria-label={focus ? 'Back to the full page' : 'Show only the words'}
          title={focus ? 'Back to the full page' : 'Only the words, big'}
        >
          {focus ? <Collapse size={18} /> : <Expand size={18} />}
        </button>
      )}

      {!transport.remote && <UpNextCard />}
    </section>
  )
}

/**
 * True once the mouse and keyboard have been still for a while.
 *
 * Listens on the window rather than the page, so reaching for the player bar
 * or a key counts as moving.
 */
function useIdle(active: boolean): boolean {
  const [idle, setIdle] = useState(false)

  useEffect(() => {
    if (!active) {
      setIdle(false)
      return
    }
    let timer = setTimeout(() => setIdle(true), IDLE_MS)
    const wake = (): void => {
      setIdle(false)
      clearTimeout(timer)
      timer = setTimeout(() => setIdle(true), IDLE_MS)
    }
    window.addEventListener('pointermove', wake)
    window.addEventListener('pointerdown', wake)
    window.addEventListener('keydown', wake)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('pointermove', wake)
      window.removeEventListener('pointerdown', wake)
      window.removeEventListener('keydown', wake)
    }
  }, [active])

  return idle
}
