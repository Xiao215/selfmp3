import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { formatDuration, type Song, type Tag } from '@selfmp3/shared'
import { usePlayer } from '../player/PlayerProvider.js'
import { useOffline } from '../offline/OfflineProvider.js'
import { useToggleLoved } from '../lib/queries.js'
import { Cover } from './Cover.js'
import { TagChip } from './TagChip.js'
import { TagPicker } from './TagPicker.js'
import { SongMenu } from './SongMenu.js'
import { FeatureBadges } from './FeatureBadges.js'
import { CheckCircle, Equalizer, Heart, More, Play, Plus } from './Icons.js'

/** How long a finger has to rest on a row before it opens the song menu. */
const LONG_PRESS_MS = 450
/** Past this much movement the press was a scroll, not a hold. */
const LONG_PRESS_SLOP = 10

/**
 * Stop the finger that opened the menu from also pressing the menu.
 *
 * A touch that ends still fires a compatibility mousedown/mouseup/click at the
 * same point — and by then the sheet has slid up under the finger, so lifting
 * it ran the sheet's first item. Cancelling the `touchend` cancels that whole
 * synthetic sequence, which is exactly what it is specified to do. The timeout
 * is for the press that never ends in a `touchend` at all (a cancel, or an
 * unmount mid-press): the listener must not be left armed for a later tap.
 */
function swallowCompatibilityClick(): void {
  const handler = (event: TouchEvent): void => event.preventDefault()
  document.addEventListener('touchend', handler, { capture: true, once: true, passive: false })
  window.setTimeout(() => document.removeEventListener('touchend', handler, true), 2000)
}

/**
 * One row in a song list.
 *
 * Memoised because a library of a few thousand songs re-renders this component
 * on every player tick otherwise — the equality check below is what keeps
 * scrolling smooth on a phone.
 *
 * The row speaks two input languages. With a mouse it is a table row: click to
 * select, double-click to play, and the controls that are not information —
 * the play overlay, the tag button, an unloved heart, the ⋯ — stay invisible
 * until the pointer is on the row, so a full screen of songs reads as titles
 * rather than as a wall of icons. With a finger there is no hover to reveal
 * anything, so a tap plays, the ⋯ is always visible at a finger-sized target,
 * and holding the row opens the same menu.
 */
export const SongRow = memo(function SongRow({
  song,
  index,
  tagById,
  isCurrent,
  isPlaying,
  selected,
  onPlay,
  onToggleTag,
  onSelect,
  showIndex = true,
}: {
  song: Song
  index: number
  tagById: ReadonlyMap<number, Tag>
  isCurrent: boolean
  isPlaying: boolean
  selected: boolean
  onPlay: () => void
  onToggleTag: (tagId: number) => void
  onSelect?: (event: React.MouseEvent) => void
  showIndex?: boolean
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [pressing, setPressing] = useState(false)
  const tagButtonRef = useRef<HTMLButtonElement>(null)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const player = usePlayer()
  const offline = useOffline()
  const toggleLoved = useToggleLoved()

  // Long press. The timer, the point the finger went down and the "that click
  // was the end of a hold" flag all live in refs: none of them should cost a
  // render, and a re-render mid-press would lose them.
  const pressTimer = useRef<number | null>(null)
  const pressOrigin = useRef<{ x: number; y: number } | null>(null)
  const pressWasLong = useRef(false)
  const pointerType = useRef<string>('mouse')

  const cancelPress = useCallback((): void => {
    if (pressTimer.current !== null) {
      window.clearTimeout(pressTimer.current)
      pressTimer.current = null
    }
    pressOrigin.current = null
    setPressing(false)
  }, [])

  useEffect(() => cancelPress, [cancelPress])

  const onPointerDown = (event: React.PointerEvent): void => {
    pointerType.current = event.pointerType
    pressWasLong.current = false
    if (event.pointerType !== 'touch') return
    // Not a hold if it started on a control — that has its own job.
    if ((event.target as HTMLElement).closest('button')) return

    pressOrigin.current = { x: event.clientX, y: event.clientY }
    setPressing(true)
    pressTimer.current = window.setTimeout(() => {
      pressTimer.current = null
      pressOrigin.current = null
      pressWasLong.current = true
      setPressing(false)
      navigator.vibrate?.(8)
      swallowCompatibilityClick()
      setMenuOpen(true)
    }, LONG_PRESS_MS)
  }

  const onPointerMove = (event: React.PointerEvent): void => {
    const origin = pressOrigin.current
    if (!origin) return
    if (
      Math.abs(event.clientX - origin.x) > LONG_PRESS_SLOP ||
      Math.abs(event.clientY - origin.y) > LONG_PRESS_SLOP
    ) {
      cancelPress()
    }
  }

  const onClick = (event: React.MouseEvent): void => {
    // The click that ends a long press must not also do the tap's job.
    if (pressWasLong.current) {
      pressWasLong.current = false
      return
    }
    const modified = event.metaKey || event.ctrlKey || event.shiftKey
    // A finger has no double-click and no hover: one tap plays.
    if (pointerType.current === 'touch' && !modified) {
      onPlay()
      return
    }
    onSelect?.(event)
  }

  const className = [
    'song-row',
    isCurrent ? 'is-current' : '',
    selected ? 'is-selected' : '',
    song.missing ? 'is-missing' : '',
    pressing ? 'is-pressing' : '',
    menuOpen || pickerOpen ? 'is-menu-open' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className={className}
      onDoubleClick={onPlay}
      onClick={onClick}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={cancelPress}
      onPointerCancel={cancelPress}
      onContextMenu={event => {
        // Suppress the OS callout on a hold; the menu is the callout here.
        if (pointerType.current === 'touch') event.preventDefault()
      }}
      role="row"
      tabIndex={0}
      onKeyDown={event => {
        if (event.key === 'Enter') onPlay()
      }}
    >
      {showIndex && (
        <div className="song-cell song-index" role="cell">
          {isCurrent && isPlaying ? (
            <Equalizer />
          ) : (
            <>
              <span className="song-index-number">{index + 1}</span>
              <button
                type="button"
                className="song-index-play"
                onClick={event => {
                  event.stopPropagation()
                  onPlay()
                }}
                aria-label={`Play ${song.title}`}
              >
                <Play size={16} />
              </button>
            </>
          )}
        </div>
      )}

      <div className="song-cell song-art" role="cell">
        <Cover song={song} size={40} />
      </div>

      <div className="song-cell song-main" role="cell">
        <div className="song-title">
          <span className="song-title-text">{song.title}</span>
          {song.missing && <span className="badge badge-warn">file missing</span>}
        </div>
        <div className="song-sub">
          <span className="song-artist">{song.artist || 'Unknown artist'}</span>
          {song.album && <span className="song-album">{song.album}</span>}
          <FeatureBadges features={song.features} />
        </div>
      </div>

      {/* The album gets its own column once there is room for one; below that
          width the copy above carries it after the artist. Only ever one of
          the two is displayed, so nothing is announced twice. */}
      <div className="song-cell song-album-cell" role="cell">
        {song.album}
      </div>

      <div
        className="song-cell song-tags"
        role="cell"
        onClick={event => event.stopPropagation()}
      >
        {song.tagIds.map(tagId => {
          const tag = tagById.get(tagId)
          return tag ? (
            <TagChip key={tagId} tag={tag} size="small" onClick={() => onToggleTag(tagId)} />
          ) : null
        })}
        <button
          ref={tagButtonRef}
          type="button"
          className="icon-button icon-button-ghost song-tag-add"
          onClick={() => setPickerOpen(open => !open)}
          aria-label={`Edit tags for ${song.title}`}
          aria-haspopup="dialog"
          aria-expanded={pickerOpen}
          title="Edit tags"
        >
          <Plus size={13} />
        </button>
        {pickerOpen && (
          <TagPicker
            anchorRef={tagButtonRef}
            song={song}
            allTags={[...tagById.values()]}
            onClose={() => setPickerOpen(false)}
          />
        )}
      </div>

      <div
        className="song-cell song-actions"
        role="cell"
        onClick={event => event.stopPropagation()}
      >
        {offline.isCached(song.id) && (
          <span className="offline-badge" title="Available offline">
            <CheckCircle size={14} />
          </span>
        )}

        <button
          type="button"
          className={`icon-button song-love ${song.loved ? 'is-loved' : ''}`}
          onClick={() => toggleLoved.mutate({ id: song.id, loved: !song.loved })}
          aria-label={song.loved ? `Remove ${song.title} from loved` : `Love ${song.title}`}
          aria-pressed={song.loved}
          title={song.loved ? 'Loved' : 'Love this song'}
        >
          <Heart size={16} filled={song.loved} />
        </button>

        <span className="song-duration">{formatDuration(song.duration)}</span>

        <button
          ref={menuButtonRef}
          type="button"
          className="icon-button song-more"
          onClick={() => setMenuOpen(open => !open)}
          aria-label={`More actions for ${song.title}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          title="More actions"
        >
          <More size={16} />
        </button>

        {menuOpen && (
          <SongMenu
            anchorRef={menuButtonRef}
            song={song}
            tagById={tagById}
            onClose={() => setMenuOpen(false)}
            onPlayNext={() => player.playNext([song])}
            onAddToQueue={() => player.addToQueue([song])}
          />
        )}
      </div>
    </div>
  )
})
