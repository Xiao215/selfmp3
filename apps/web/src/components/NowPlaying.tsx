import { useRef, useState } from 'react'
import { formatDuration } from '@selfmp3/shared'
import { usePlayer } from '../player/PlayerProvider.js'
import { exitProps } from '../lib/hooks.js'
import { useLibrary, useSimilar, useToggleLoved } from '../lib/queries.js'
import { TagChip } from './TagChip.js'
import { TagPicker } from './TagPicker.js'
import { DevicesButton } from '../devices/DevicesButton.js'
import { useTransport } from '../devices/useTransport.js'
import { loopRegionPercent } from '../player/practice.js'
import { Cover } from './Cover.js'
import { FeatureBadges } from './FeatureBadges.js'
import { QueuePanel } from './QueuePanel.js'
import { PracticePanel } from './PracticePanel.js'
import { SleepMenu } from './PlayerBar.js'
import { SongWords } from './nowplaying/SongWords.js'
import { useSongLyrics } from './nowplaying/useSongLyrics.js'
import {
  ChevronDown,
  Heart,
  Metronome,
  Mic,
  Moon,
  Next,
  Pause,
  Play,
  Prev,
  Queue,
  Repeat,
  RepeatOne,
  Romanize,
  Shuffle,
  TagPlus,
} from './Icons.js'

/** What covers the stage. Lyrics are not one of these: they sit where the artwork was. */
type Panel = 'none' | 'queue' | 'practice'

/** How far a finger has to go sideways to turn the page, in pixels. */
const SWIPE_PX = 48

/**
 * The full-screen phone player.
 *
 * Large artwork, thumb-reachable controls, and a scrubber with a hit area big
 * enough to actually grab while walking. The lyrics are the other page of the
 * same screen — swipe the artwork left, tap it, or Lyrics below; swipe right
 * or tap the little cover to go back. A phone has no room to spare, so they
 * take everything above the scrubber, with the song shrunk to one line over
 * them; the scrubber and buttons stay, so you can read along and still skip.
 * A song with no words shows its visual there instead. Queue and practice
 * slide over the stage, so getting back is always one tap.
 *
 * The screen has a fixed head and foot with one flexible stage between them —
 * the artwork is the part that gives way on a short phone, so nothing below it
 * can ever be pushed off the bottom.
 */
export function NowPlaying({
  leaving,
  onClose,
  onExited,
}: {
  /** Closed, and on its way out: it slides down, then calls `onExited`. */
  leaving: boolean
  onClose: () => void
  onExited: () => void
}) {
  const player = usePlayer()
  const transport = useTransport()
  const toggleLoved = useToggleLoved()
  const [panel, setPanel] = useState<Panel>('none')
  const [showWords, setShowWords] = useState(false)
  // True while the face that just came in is still sliding into place.
  const [sliding, setSliding] = useState(false)
  const [scrubbing, setScrubbing] = useState<number | null>(null)
  const [sleepOpen, setSleepOpen] = useState(false)
  const sleepRef = useRef<HTMLButtonElement>(null)
  const [tagsOpen, setTagsOpen] = useState(false)
  const tagsRef = useRef<HTMLButtonElement>(null)
  const { data: library } = useLibrary()

  const song = transport.song
  const similar = useSimilar(song?.id ?? null, 10)
  const lyrics = useSongLyrics(song, { enabled: showWords })

  const showFace = (words: boolean): void => {
    if (words === showWords) return
    setShowWords(words)
    setSliding(true)
  }
  const swipe = useSwipe(direction => showFace(direction === 'left'))
  const slideProps = {
    onAnimationEnd: (event: React.AnimationEvent) => {
      if (event.target === event.currentTarget) setSliding(false)
    },
  }

  if (!song) return null

  const allTags = library?.tags ?? []
  const songTags = song.tagIds.flatMap(id => allTags.filter(tag => tag.id === id))

  const displayTime = scrubbing ?? transport.currentTime
  const duration = transport.duration || song.duration || 0
  const percent = duration > 0 ? (displayTime / duration) * 100 : 0
  const loopRegion = loopRegionPercent(player.loopA, player.loopB, duration)
  const toggle = (which: Panel) => (): void =>
    setPanel(current => (current === which ? 'none' : which))

  return (
    <div className={`now-playing ${leaving ? 'is-leaving' : ''}`} {...exitProps(leaving, onExited)}>
      <header className="now-playing-head">
        <button
          type="button"
          className="icon-button np-head-button"
          onClick={onClose}
          aria-label="Close now playing"
        >
          <ChevronDown size={24} />
        </button>
        <span className="now-playing-context">
          {transport.remote ? (
            <>Controlling {transport.remote.name}</>
          ) : (
            <>
              {player.queue.shuffle ? 'Shuffling' : 'Playing'} · {player.queue.index + 1} of{' '}
              {player.queue.items.length}
            </>
          )}
        </span>
        <button
          type="button"
          className={`icon-button np-head-button ${song.loved ? 'is-loved' : ''}`}
          onClick={() => toggleLoved.mutate({ id: song.id, loved: !song.loved })}
          aria-label={song.loved ? 'Unlove' : 'Love'}
          aria-pressed={song.loved}
        >
          <Heart size={22} filled={song.loved} />
        </button>
      </header>

      {panel === 'none' && (
        <div className={`now-playing-stage ${showWords ? 'is-words' : ''}`}>
          {showWords ? (
            <div
              className={`np-phone-lyrics ${sliding ? 'is-sliding' : ''}`}
              {...swipe}
              {...slideProps}
            >
              <div className="np-phone-lyrics-head">
                <button
                  type="button"
                  className="np-phone-lyrics-song"
                  onClick={() => showFace(false)}
                  aria-label="Show the artwork"
                >
                  <Cover song={song} size={44} />
                  <span className="np-phone-lyrics-titles">
                    <strong>{song.title}</strong>
                    <span>{song.artist || 'Unknown artist'}</span>
                  </span>
                </button>
                {lyrics.words.status === 'lyrics' && lyrics.language !== 'none' && (
                  <button
                    type="button"
                    className={`np-tool ${lyrics.romanizationOn ? 'is-on' : ''}`}
                    onClick={() => lyrics.setRomanization(!lyrics.romanizationOn)}
                    aria-pressed={lyrics.romanizationOn}
                  >
                    <Romanize size={15} /> {lyrics.language === 'ja' ? 'Romaji' : 'Pinyin'}
                  </button>
                )}
              </div>
              <div className="np-phone-lyrics-words">
                <SongWords song={song} lyrics={lyrics} mode="phone" />
              </div>
            </div>
          ) : (
            <div
              className={`np-phone-front ${sliding ? 'is-sliding' : ''}`}
              {...swipe}
              {...slideProps}
            >
              <div className="now-playing-art">
                <button
                  type="button"
                  className="now-playing-art-button"
                  onClick={() => showFace(true)}
                  aria-label="Show the lyrics"
                >
                  <Cover song={song} size={340} className="now-playing-cover" />
                </button>
              </div>

              <div className="now-playing-meta">
                <h1 className="now-playing-title">{song.title}</h1>
                <p className="now-playing-artist">{song.artist || 'Unknown artist'}</p>
                {song.album && <p className="now-playing-album">{song.album}</p>}
                {song.features && (
                  <p className="now-playing-features">
                    <FeatureBadges features={song.features} size="large" />
                  </p>
                )}

                {/* The song's tags, and the way to change them without leaving
                the song: how it feels is clearest while it is playing. */}
                <div className="now-playing-tags">
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
            </div>
          )}

          <div className="now-playing-progress">
            <div className="scrubber-wrap">
              {loopRegion && (
                <div
                  className="loop-region loop-region-large"
                  style={{ left: `${loopRegion.left}%`, width: `${loopRegion.width}%` }}
                  aria-hidden="true"
                />
              )}
              <input
                className="scrubber scrubber-large"
                type="range"
                min={0}
                max={duration || 1}
                step={0.1}
                value={Math.min(displayTime, duration || 1)}
                style={{ '--progress': `${percent}%` } as React.CSSProperties}
                aria-label="Seek"
                onChange={event => setScrubbing(Number(event.target.value))}
                onPointerUp={() => {
                  if (scrubbing !== null) transport.seek(scrubbing)
                  setScrubbing(null)
                }}
              />
            </div>
            <div className="now-playing-times">
              <span>{formatDuration(displayTime)}</span>
              <span>-{formatDuration(Math.max(0, duration - displayTime))}</span>
            </div>
          </div>

          <div className="now-playing-controls">
            <button
              type="button"
              className={`icon-button np-mode ${player.queue.shuffle ? 'is-accent' : ''}`}
              onClick={player.toggleShuffle}
              aria-label="Shuffle"
              aria-pressed={player.queue.shuffle}
            >
              <Shuffle size={19} />
            </button>
            <button
              type="button"
              className="icon-button icon-button-large"
              onClick={transport.previous}
              aria-label="Previous"
            >
              <Prev size={30} />
            </button>
            <button
              type="button"
              className="play-button play-button-large"
              onClick={transport.toggle}
              aria-label={transport.playing ? 'Pause' : 'Play'}
            >
              {transport.playing ? <Pause size={30} /> : <Play size={30} />}
            </button>
            <button
              type="button"
              className="icon-button icon-button-large"
              onClick={transport.next}
              aria-label="Next"
            >
              <Next size={30} />
            </button>
            <button
              type="button"
              className={`icon-button np-mode ${player.queue.repeat !== 'off' ? 'is-accent' : ''}`}
              onClick={player.cycleRepeatMode}
              aria-label={
                player.queue.repeat === 'one'
                  ? 'Repeat this song'
                  : player.queue.repeat === 'all'
                    ? 'Repeat all'
                    : 'Repeat off'
              }
            >
              {player.queue.repeat === 'one' ? <RepeatOne size={19} /> : <Repeat size={19} />}
            </button>
          </div>

          {/* Under the lyrics the words have the room; the shelf is for the art. */}
          {!showWords && similar.data && similar.data.songs.length > 0 && (
            <section className="similar-strip" aria-labelledby="similar-heading">
              <div className="similar-strip-head">
                <h2 id="similar-heading">Similar songs</h2>
                <button
                  type="button"
                  className="button button-small"
                  onClick={() => player.addToQueue(similar.data.songs)}
                >
                  Queue all
                </button>
              </div>
              {/*
                The cards are sized so the next one always peeks past the right
                edge — that peek, plus the scrollbar under it, is what says the
                row keeps going. Titles get two lines rather than being cut
                mid-word at 64px.
              */}
              <div className="similar-strip-list">
                {similar.data.songs.map(item => (
                  <button
                    key={item.id}
                    type="button"
                    className="similar-card"
                    onClick={() =>
                      player.playFrom(
                        [item, ...similar.data.songs.filter(s => s.id !== item.id)],
                        0,
                      )
                    }
                    aria-label={`Play ${item.title} by ${item.artist || 'Unknown artist'}`}
                    data-tip={`${item.title} — ${item.artist || 'Unknown artist'}`}
                  >
                    <Cover song={item} size={104} />
                    <span className="similar-card-title">{item.title}</span>
                    <span className="similar-card-artist">{item.artist || 'Unknown artist'}</span>
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {panel === 'queue' && <QueuePanel onClose={() => setPanel('none')} />}
      {panel === 'practice' && <PracticePanel onClose={() => setPanel('none')} />}

      {/*
        Five bare glyphs said nothing about what they opened. Each is now a
        labelled, finger-sized target — the same trade the tab bar makes.
      */}
      <footer className="now-playing-foot">
        <button
          type="button"
          className={`np-action ${showWords && panel === 'none' ? 'is-active' : ''}`}
          onClick={() => {
            setPanel('none')
            showFace(panel !== 'none' || !showWords)
          }}
          aria-pressed={showWords && panel === 'none'}
        >
          <Mic size={19} />
          <span>Lyrics</span>
        </button>
        <button
          type="button"
          className={`np-action ${panel === 'practice' || player.loopB !== null ? 'is-active' : ''}`}
          onClick={toggle('practice')}
          aria-pressed={panel === 'practice'}
        >
          <Metronome size={19} />
          <span>Practice</span>
        </button>
        <button
          ref={sleepRef}
          type="button"
          className={`np-action ${player.sleepTimerEndsAt ? 'is-active' : ''}`}
          onClick={() => setSleepOpen(open => !open)}
          aria-haspopup="menu"
          aria-expanded={sleepOpen}
        >
          <Moon size={19} />
          <span>Sleep</span>
        </button>
        {sleepOpen && <SleepMenu anchorRef={sleepRef} onClose={() => setSleepOpen(false)} />}
        <DevicesButton showChip={false} actionLabel="Devices" />
        <button
          type="button"
          className={`np-action ${panel === 'queue' ? 'is-active' : ''}`}
          onClick={toggle('queue')}
          aria-pressed={panel === 'queue'}
        >
          <Queue size={19} />
          <span>Queue</span>
        </button>
      </footer>
    </div>
  )
}

/**
 * A sideways swipe, told apart from a tap and from scrolling the lyrics.
 *
 * Vertical movement is left to the browser (`touch-action: pan-y` on the
 * artwork), which cancels the pointer when it takes over to scroll — so only
 * a clearly sideways stroke gets as far as `pointerup` and counts.
 */
function useSwipe(onSwipe: (direction: 'left' | 'right') => void) {
  const start = useRef<{ id: number; x: number; y: number } | null>(null)
  const swiped = useRef(false)

  return {
    onPointerDown: (event: React.PointerEvent) => {
      start.current = { id: event.pointerId, x: event.clientX, y: event.clientY }
      swiped.current = false
    },
    onPointerUp: (event: React.PointerEvent) => {
      const from = start.current
      start.current = null
      if (!from || from.id !== event.pointerId) return
      const dx = event.clientX - from.x
      const dy = event.clientY - from.y
      if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return
      swiped.current = true
      onSwipe(dx < 0 ? 'left' : 'right')
    },
    onPointerCancel: () => {
      start.current = null
    },
    // A swipe that starts and ends on the artwork is not also a tap on it.
    onClickCapture: (event: React.MouseEvent) => {
      if (!swiped.current) return
      swiped.current = false
      event.preventDefault()
      event.stopPropagation()
    },
  }
}
