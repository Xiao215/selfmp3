import { memo, useState } from 'react'
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

/**
 * One row in a song list.
 *
 * Memoised because a library of a few thousand songs re-renders this component
 * on every player tick otherwise — the equality check below is what keeps
 * scrolling smooth on a phone.
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
  const player = usePlayer()
  const offline = useOffline()
  const toggleLoved = useToggleLoved()

  const cached = offline.isCached(song.id)

  const className = [
    'song-row',
    isCurrent ? 'is-current' : '',
    selected ? 'is-selected' : '',
    song.missing ? 'is-missing' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className={className}
      onDoubleClick={onPlay}
      onClick={onSelect}
      role="row"
      tabIndex={0}
      onKeyDown={event => {
        if (event.key === 'Enter') onPlay()
      }}
    >
      {showIndex && (
        <div className="song-cell song-index">
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

      <div className="song-cell">
        <Cover song={song} size={40} />
      </div>

      <div className="song-cell song-main">
        <div className="song-title">
          {song.title}
          {song.missing && <span className="badge badge-warn">file missing</span>}
        </div>
        <div className="song-sub">
          {song.artist || 'Unknown artist'}
          {song.album && <span className="song-album"> · {song.album}</span>}
          <FeatureBadges features={song.features} />
        </div>
      </div>

      <div className="song-cell song-tags" onClick={event => event.stopPropagation()}>
        {song.tagIds.map(tagId => {
          const tag = tagById.get(tagId)
          return tag ? (
            <TagChip key={tagId} tag={tag} size="small" onClick={() => onToggleTag(tagId)} />
          ) : null
        })}
        <button
          type="button"
          className="icon-button icon-button-ghost"
          onClick={() => setPickerOpen(open => !open)}
          aria-label="Edit tags"
          title="Edit tags"
        >
          <Plus size={13} />
        </button>
        {pickerOpen && (
          <TagPicker
            song={song}
            allTags={[...tagById.values()]}
            onClose={() => setPickerOpen(false)}
          />
        )}
      </div>

      <div className="song-cell song-actions" onClick={event => event.stopPropagation()}>
        {cached && (
          <span className="offline-badge" title="Available offline">
            <CheckCircle size={14} />
          </span>
        )}

        <button
          type="button"
          className={`icon-button ${song.loved ? 'is-loved' : ''}`}
          onClick={() => toggleLoved.mutate({ id: song.id, loved: !song.loved })}
          aria-label={song.loved ? 'Remove from loved' : 'Add to loved'}
          title={song.loved ? 'Loved' : 'Love this song'}
        >
          <Heart size={16} filled={song.loved} />
        </button>

        <span className="song-duration">{formatDuration(song.duration)}</span>

        <button
          type="button"
          className="icon-button"
          onClick={() => setMenuOpen(open => !open)}
          aria-label="More actions"
        >
          <More size={16} />
        </button>

        {menuOpen && (
          <SongMenu
            song={song}
            onClose={() => setMenuOpen(false)}
            onPlayNext={() => player.playNext([song])}
            onAddToQueue={() => player.addToQueue([song])}
          />
        )}
      </div>
    </div>
  )
})
