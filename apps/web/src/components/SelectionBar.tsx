import { useMemo, useRef, useState } from 'react'
import type { Song, Tag } from '@selfmp3/shared'
import {
  useAddToPlaylist,
  useBulkDeleteSongs,
  useBulkLoved,
  useBulkTag,
  useLibrary,
  useRemoveManyFromPlaylist,
} from '../lib/queries.js'
import { usePlayer } from '../player/PlayerProvider.js'
import { useOffline } from '../offline/OfflineProvider.js'
import { Popover } from './Menu.js'
import { Select } from './Select.js'
import { showToast } from './Toast.js'
import { ConfirmRemoveSongs } from './ConfirmRemoveSongs.js'
import {
  Check,
  CloudDownload,
  Heart,
  ListMusic,
  Minus,
  More,
  Play,
  Queue,
  Tag as TagIcon,
  Trash,
  X,
} from './Icons.js'

/**
 * The bar that runs a multi-selection.
 *
 * It is anchored by the count, because the count is the thing you have to be
 * sure of before pressing anything else in it — and by a tri-state checkbox
 * that says, in words, what "all" currently means. Select-all while a search
 * or a tag filter is on selects *the filtered set*, and the bar says so: the
 * alternative, quietly acting on songs that are not on screen, is how people
 * lose music.
 *
 * Play and "add to queue" are in the bar because they are harmless and
 * frequent. Everything that edits the library sits behind ⋯, which is a bottom
 * sheet on a phone, with "remove from library" last, separated, and in red.
 *
 * The bar itself is a sticky row of the list rather than a floating overlay,
 * so it never covers a song and never fights the player bar.
 */
export function SelectionBar({
  songs,
  total,
  narrowed = false,
  scope,
  allSelected,
  onSelectAll,
  onDeselectAll,
  onDone,
  playlist,
}: {
  /** The selected songs, in the order the list has them. */
  songs: readonly Song[]
  /** How many rows the list is showing right now. */
  total: number
  /** True when a search or a tag filter is narrowing the list. */
  narrowed?: boolean
  /** What "all" means here, in words: "in this view", "in this playlist". */
  scope: string
  allSelected: boolean
  onSelectAll: () => void
  onDeselectAll: () => void
  onDone: () => void
  /** Set in a playlist, which enables removing from it without deleting. */
  playlist?: { readonly id: number; readonly name: string }
}) {
  const { data: library } = useLibrary()
  const player = usePlayer()
  const offline = useOffline()

  const bulkTag = useBulkTag()
  const bulkLoved = useBulkLoved()
  const bulkDelete = useBulkDeleteSongs()
  const addToPlaylist = useAddToPlaylist()
  const removeFromPlaylist = useRemoveManyFromPlaylist()

  const [menuOpen, setMenuOpen] = useState(false)
  const [nested, setNested] = useState<'playlists' | 'tag' | 'untag' | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const menuButton = useRef<HTMLButtonElement>(null)

  const count = songs.length
  const ids = useMemo(() => songs.map(song => song.id), [songs])
  const tags = library?.tags ?? []
  const manualPlaylists = (library?.playlists ?? []).filter(list => list.kind === 'manual')

  /** Only tags that are actually on the selection can be taken off it. */
  const tagsOnSelection = useMemo<Tag[]>(() => {
    const present = new Set<number>()
    for (const song of songs) for (const tagId of song.tagIds) present.add(tagId)
    return tags.filter(tag => present.has(tag.id))
  }, [songs, tags])

  const lovedCount = songs.filter(song => song.loved).length
  const cachedCount = songs.filter(song => offline.isCached(song.id)).length

  const closeMenu = (): void => {
    setMenuOpen(false)
    setNested(null)
  }

  /** Run a menu action, close the menu, and say what happened. */
  const act = (fn: () => void, message?: string): void => {
    fn()
    closeMenu()
    if (message) showToast(message, 'good')
  }

  const songWord = count === 1 ? 'song' : 'songs'

  const addTag = (tagId: number): void => {
    if (tagId <= 0) return
    bulkTag.mutate({ songIds: ids, tagId, action: 'add' })
    const name = tags.find(tag => tag.id === tagId)?.name ?? 'tag'
    showToast(`Tagged ${count} ${songWord} “${name}”`, 'good')
  }

  const downloadSelection = async (remove: boolean): Promise<void> => {
    closeMenu()
    setBusy(true)
    let done = 0
    try {
      for (const song of songs) {
        if (remove) await offline.removeOne(song.id)
        else if (!offline.isCached(song.id)) await offline.downloadOne(song.id)
        done++
      }
      showToast(
        remove
          ? `Removed ${done} ${done === 1 ? 'download' : 'downloads'}`
          : `${done} ${done === 1 ? 'song is' : 'songs are'} available offline`,
        'good',
      )
    } catch (error) {
      showToast(
        `Stopped after ${done}: ${error instanceof Error ? error.message : 'download failed'}`,
        'error',
      )
    } finally {
      setBusy(false)
    }
  }

  const confirmRemove = (deleteFile: boolean): void => {
    bulkDelete.mutate(
      { songIds: ids, deleteFile },
      {
        onSuccess: result => {
          setConfirming(false)
          onDone()
          const parts = [`Removed ${result.removed} ${result.removed === 1 ? 'song' : 'songs'}`]
          if (result.filesDeleted > 0) {
            parts.push(
              `deleted ${result.filesDeleted} ${result.filesDeleted === 1 ? 'file' : 'files'}`,
            )
          }
          const trouble = result.failed.length
          if (trouble > 0) parts.push(`${trouble} needed attention`)
          showToast(
            trouble > 0
              ? `${parts.join(', ')} — ${result.failed[0]?.reason ?? 'see the server log'}`
              : parts.join(', '),
            trouble > 0 ? 'warn' : 'good',
          )
        },
        onError: error => {
          setConfirming(false)
          showToast(error.message, 'error')
        },
      },
    )
  }

  return (
    <>
      <div className="selection-bar" role="toolbar" aria-label="Selection actions">
        <div className="selection-anchor">
          <button
            type="button"
            className="selection-all"
            role="checkbox"
            aria-checked={allSelected ? 'true' : count > 0 ? 'mixed' : 'false'}
            onClick={() => (allSelected ? onDeselectAll() : onSelectAll())}
            aria-label={
              allSelected
                ? `Deselect all ${total} ${total === 1 ? 'song' : 'songs'} ${scope}`
                : `Select all ${total} ${total === 1 ? 'song' : 'songs'} ${scope}`
            }
          >
            <span
              className={`checkbox ${allSelected ? 'is-on' : count > 0 ? 'is-mixed' : ''}`}
              aria-hidden="true"
            >
              {allSelected ? <Check size={12} /> : count > 0 ? <Minus size={12} /> : null}
            </span>
          </button>

          <div className="selection-counts">
            <span className="selection-count">
              {count === 0 ? 'None selected' : `${count} selected`}
            </span>
            {/* The scope, always spelled out — "all" while filtered is not
                the same "all" as on the unfiltered library. */}
            {allSelected ? (
              <span className="selection-scope">
                {narrowed ? `every song ${scope}` : `everything ${scope}`}
              </span>
            ) : (
              <button type="button" className="link-button selection-scope" onClick={onSelectAll}>
                Select all {total} {scope}
              </button>
            )}
          </div>
        </div>

        <div className="selection-actions">
          <button
            type="button"
            className="button button-small"
            onClick={() => count > 0 && player.playFrom(songs, 0)}
            disabled={count === 0}
          >
            <Play size={13} /> <span className="button-label">Play</span>
          </button>

          <button
            type="button"
            className="button button-small"
            onClick={() => player.addToQueue(songs)}
            disabled={count === 0}
            title="Add the selection to the queue"
          >
            <Queue size={13} /> <span className="button-label">Queue</span>
          </button>

          {/*
            The quick path on a desktop, where there is room for it. On a phone
            the bar has two lines to spend and tagging moves into the ⋯ sheet
            rather than making it three.
          */}
          {tags.length > 0 && (
            <Select<number>
              value={0}
              onChange={tagId => addTag(tagId)}
              options={tags.map(tag => ({ value: tag.id, label: tag.name }))}
              label={`Add a tag to the ${count} selected ${songWord}`}
              placeholder="Add tag…"
              size="small"
              disabled={count === 0}
              className="selection-tag-add"
            />
          )}

          {playlist && (
            <button
              type="button"
              className="button button-small selection-playlist-remove"
              onClick={() =>
                act(
                  () => removeFromPlaylist.mutate({ playlistId: playlist.id, songIds: ids }),
                  `Removed ${count} ${songWord} from ${playlist.name}`,
                )
              }
              disabled={count === 0}
            >
              <X size={13} />
              {/* Never an icon on its own: a bare ✕ beside the bar's own ✕
                  would be two different exits wearing the same glyph. */}
              <span className="button-label">Remove from playlist</span>
              <span className="button-label-short">Remove</span>
            </button>
          )}

          <button
            ref={menuButton}
            type="button"
            className="button button-small selection-more"
            onClick={() => (menuOpen ? closeMenu() : setMenuOpen(true))}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            disabled={count === 0 || busy}
          >
            <More size={13} /> <span className="button-label">More</span>
          </button>
        </div>

        <button
          type="button"
          className="icon-button selection-done"
          onClick={onDone}
          aria-label="Done selecting"
          title="Done (Esc)"
        >
          <X size={16} />
        </button>
      </div>

      {/* The count, for anyone who cannot see the bar. Polite, so it waits for
          a gap rather than interrupting a keyboard user mid-selection. */}
      <p className="visually-hidden" role="status" aria-live="polite">
        {count === 0 ? 'Nothing selected' : `${count} ${songWord} selected`}
      </p>

      {menuOpen && (
        <Popover
          anchorRef={menuButton}
          onClose={closeMenu}
          label={`Actions for ${count} selected ${songWord}`}
          className="song-menu"
          align="end"
          sheet
          roving
        >
          <div className="song-menu-head" aria-hidden="true">
            <span className="song-menu-head-title">
              {count} {songWord} selected
            </span>
            <span className="song-menu-head-artist">{summarise(songs)}</span>
          </div>

          {lovedCount < count && (
            <button
              type="button"
              role="menuitem"
              className="popover-item"
              onClick={() =>
                act(
                  () => bulkLoved.mutate({ songIds: ids, loved: true }),
                  `Loved ${count - lovedCount} ${count - lovedCount === 1 ? 'song' : 'songs'}`,
                )
              }
            >
              <Heart size={15} /> Love {count - lovedCount === count ? 'all' : 'the rest'}
            </button>
          )}

          {lovedCount > 0 && (
            <button
              type="button"
              role="menuitem"
              className="popover-item"
              onClick={() =>
                act(
                  () => bulkLoved.mutate({ songIds: ids, loved: false }),
                  `Removed ${lovedCount} from loved`,
                )
              }
            >
              <Heart size={15} filled /> Remove {lovedCount === count ? 'all' : lovedCount} from
              loved
            </button>
          )}

          <div className="popover-divider" />

          <button
            type="button"
            role="menuitem"
            className="popover-item"
            onClick={() => setNested(open => (open === 'playlists' ? null : 'playlists'))}
            aria-expanded={nested === 'playlists'}
          >
            <ListMusic size={15} /> Add to playlist…
          </button>

          {nested === 'playlists' && (
            <div className="popover-nested">
              {manualPlaylists.length === 0 && <p className="hint">No playlists yet.</p>}
              {manualPlaylists.map(list => (
                <button
                  key={list.id}
                  type="button"
                  role="menuitem"
                  className="popover-item"
                  onClick={() =>
                    act(
                      () => addToPlaylist.mutate({ playlistId: list.id, songIds: ids }),
                      `Added ${count} ${songWord} to ${list.name}`,
                    )
                  }
                >
                  {list.name}
                </button>
              ))}
            </div>
          )}

          {/* Tagging is in the sheet as well as in the bar, because the bar's
              dropdown is a desktop-width luxury and the sheet is all a phone
              in selection mode has. */}
          {tags.length > 0 && (
            <button
              type="button"
              role="menuitem"
              className="popover-item"
              onClick={() => setNested(open => (open === 'tag' ? null : 'tag'))}
              aria-expanded={nested === 'tag'}
            >
              <TagIcon size={15} /> Add tag…
            </button>
          )}

          {nested === 'tag' && (
            <div className="popover-nested">
              {tags.map(tag => (
                <button
                  key={tag.id}
                  type="button"
                  role="menuitem"
                  className="popover-item"
                  onClick={() => act(() => addTag(tag.id))}
                >
                  {tag.name}
                </button>
              ))}
            </div>
          )}

          {tagsOnSelection.length > 0 && (
            <button
              type="button"
              role="menuitem"
              className="popover-item"
              onClick={() => setNested(open => (open === 'untag' ? null : 'untag'))}
              aria-expanded={nested === 'untag'}
            >
              <TagIcon size={15} /> Remove tag…
            </button>
          )}

          {nested === 'untag' && (
            <div className="popover-nested">
              {tagsOnSelection.map(tag => (
                <button
                  key={tag.id}
                  type="button"
                  role="menuitem"
                  className="popover-item"
                  onClick={() =>
                    act(
                      () => bulkTag.mutate({ songIds: ids, tagId: tag.id, action: 'remove' }),
                      `Removed “${tag.name}” from ${count} ${songWord}`,
                    )
                  }
                >
                  {tag.name}
                </button>
              ))}
            </div>
          )}

          <div className="popover-divider" />

          {cachedCount < count && (
            <button
              type="button"
              role="menuitem"
              className="popover-item"
              onClick={() => void downloadSelection(false)}
            >
              <CloudDownload size={15} /> Download {cachedCount > 0 ? 'the rest' : 'all'} for
              offline
            </button>
          )}

          {cachedCount > 0 && (
            <button
              type="button"
              role="menuitem"
              className="popover-item"
              onClick={() => void downloadSelection(true)}
            >
              <X size={15} /> Remove {cachedCount === count ? '' : `${cachedCount} `}
              {cachedCount === 1 ? 'download' : 'downloads'}
            </button>
          )}

          <div className="popover-divider" />

          <button
            type="button"
            role="menuitem"
            className="popover-item is-danger"
            onClick={() => {
              closeMenu()
              setConfirming(true)
            }}
          >
            <Trash size={15} /> Remove {count} {songWord} from library…
          </button>
        </Popover>
      )}

      {confirming && (
        <ConfirmRemoveSongs
          songs={songs}
          pending={bulkDelete.isPending}
          onCancel={() => setConfirming(false)}
          onConfirm={confirmRemove}
        />
      )}
    </>
  )
}

/** "Aurora Lane, Klara Feld and 2 more" — enough to recognise the selection. */
function summarise(songs: readonly Song[]): string {
  const artists = [...new Set(songs.map(song => song.artist || 'Unknown artist'))]
  if (artists.length <= 2) return artists.join(' · ')
  return `${artists.slice(0, 2).join(' · ')} and ${artists.length - 2} more`
}
