import { useRef, useState } from 'react'
import { formatDuration } from '@selfmp3/shared'
import { usePlayer } from '../player/PlayerProvider.js'
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
type Panel = 'none' | 'queue' | 'practice' | 'sync'

/**
 * The full-screen phone player.
 *
 * Large artwork, thumb-reachable controls, and a scrubber with a hit area big
 * enough to actually grab while walking. Lyrics take the artwork's place —
 * tap the artwork, or Lyrics below — so the title, scrubber and buttons never
 * move and you can read along and still skip. A song with no words shows its
 * visual there instead. Queue and practice slide over the stage, so getting
 * back is always one tap.
 *
 * The screen has a fixed head and foot with one flexible stage between them —
 * the artwork is the part that gives way on a short phone, so nothing below it
 * can ever be pushed off the bottom.
 */
export function NowPlaying({ onClose }: { onClose: () => void }) {
  const player = usePlayer()
  const transport = useTransport()
  const toggleLoved = useToggleLoved()
  const [panel, setPanel] = useState<Panel>('none')
  const [showWords, setShowWords] = useState(false)
  const [scrubbing, setScrubbing] = useState<number | null>(null)
  const [sleepOpen, setSleepOpen] = useState(false)
  const sleepRef = useRef<HTMLButtonElement>(null)
  const [tagsOpen, setTagsOpen] = useState(false)
  const tagsRef = useRef<HTMLButtonElement>(null)
  const { data: library } = useLibrary()

  const song = transport.song
  const similar = useSimilar(song?.id ?? null, 10)
  const lyrics = useSongLyrics(song, { enabled: showWords || panel === 'sync' })
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
    <div className="now-playing">
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
        <div className="now-playing-stage">
          <div className="now-playing-art">
            {showWords ? (
              <div className="np-phone-words">
                <SongWords
                  song={song}
                  lyrics={lyrics}
                  mode="phone"
                  syncing={false}
                  onSyncingChange={on => on && setPanel('sync')}
                />
                {lyrics.words.status === 'lyrics' && (
                  <>
                    {lyrics.language !== 'none' && (
                      <button
                        type="button"
                        className={`np-phone-roman ${lyrics.romanizationOn ? 'is-on' : ''}`}
                        onClick={() => lyrics.setRomanization(!lyrics.romanizationOn)}
                        aria-pressed={lyrics.romanizationOn}
                        aria-label={lyrics.language === 'ja' ? 'Romaji' : 'Pinyin'}
                      >
                        <Romanize size={15} />
                      </button>
                    )}
                    <button
                      type="button"
                      className="np-phone-thumb"
                      onClick={() => setShowWords(false)}
                      aria-label="Show the artwork"
                    >
                      <Cover song={song} size={38} />
                    </button>
                  </>
                )}
              </div>
            ) : (
              <button
                type="button"
                className="now-playing-art-button"
                onClick={() => setShowWords(true)}
                aria-label="Show the lyrics"
              >
                <Cover song={song} size={340} className="now-playing-cover" />
              </button>
            )}
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

          {similar.data && similar.data.songs.length > 0 && (
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
                    title={`${item.title} — ${item.artist || 'Unknown artist'}`}
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

      {panel === 'sync' && (
        <SongWords
          song={song}
          lyrics={lyrics}
          mode="phone"
          syncing
          onSyncingChange={on => !on && setPanel('none')}
        />
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
            setShowWords(show => panel !== 'none' || !show)
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
