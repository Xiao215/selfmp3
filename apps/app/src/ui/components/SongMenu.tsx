import { useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import type { View as RNView } from 'react-native'
import { formatBytes, type Song } from '@selfmp3/shared'
import {
  clientApi,
  isDownloaded,
  space,
  useAddToPlaylist,
  useDeleteSong,
  useLibrary,
  useRemoveFromPlaylist,
} from '@selfmp3/client'
import { playlistsToAddTo } from '../../features/playlists/playlists.model'
import { useDownloads } from '../../offline/DownloadsProvider'
import { removingTakesTheCopy } from '../../ports/device'
import { usePlayer } from '../../player/PlayerProvider'
import { useLayout } from '../../shell/useLayout'
import {
  CheckSquare,
  CloudDownload,
  Info,
  ListMusic,
  Queue,
  Sparkles,
  Tag as TagIcon,
  Trash,
  X,
} from './Icons'
import { Popover } from './Popover'
import { Sheet, SheetItem } from './Sheet'
import { SongDetails } from './SongDetails'
import { TagPicker } from './TagPicker'

/**
 * The ⋯ menu for a song.
 *
 * At phone width this is a row's only set of actions, so everything a row can
 * do has to be reachable from here, tagging included. The song's name heads it,
 * so a menu opened by holding a row still says which row it came from.
 *
 * Destructive actions sit last and apart, and removing always asks first.
 * What it then offers depends on the device (`removingTakesTheCopy`): a
 * computer separates "remove from my list" from "delete the actual file",
 * which are never one mis-tap apart, because that second file is the server's
 * and a rescan would find it again. A phone has no such file and one meaning —
 * remove it, and take the download with it — so it asks once and does that.
 *
 * Dropping the download on its own stays where it is, above, as "Remove
 * download": keeping the song and freeing the room is a different wish.
 *
 * Editing tags and the song's details replace the menu rather than stacking on
 * it. Kept short on purpose: the similar-songs pair folds into one row, and
 * fixing the metadata is a button inside Song details, next to the facts it
 * changes, rather than a row of its own here.
 */
export function SongMenu({
  song,
  onClose,
  onStartSelecting,
  anchorRef,
  playlist,
}: {
  song: Song | null
  onClose: () => void
  /**
   * Opened from a playlist you made: the menu offers taking the song out of
   * it, which on a phone is the only way to — its rows have no ✕.
   */
  playlist?: { readonly id: number; readonly name: string }
  /**
   * The ⋯ that opened it. At desktop width the menu hangs off it, and does
   * not need to name the song; without one it is a sheet.
   */
  anchorRef?: RefObject<RNView | null>
  /**
   * Where the list supports it, "Select" starts selection mode with this song
   * ticked — the only way in a held finger has.
   */
  onStartSelecting?: (song: Song) => void
}): ReactNode {
  const { data: library } = useLibrary()
  const { wide } = useLayout()
  const [opened, setOpened] = useState<{
    kind: 'tags' | 'details'
    songId: number
  } | null>(null)
  // The song as the library has it now, so a dialog opened from the menu shows
  // the tags or the play count after a change rather than a snapshot.
  const openedSong =
    opened === null ? null : (library?.songs.find(item => item.id === opened.songId) ?? null)

  return (
    <>
      {wide && anchorRef ? (
        <Popover
          open={song !== null}
          onClose={onClose}
          anchorRef={anchorRef}
          width={240}
          testID="song-menu"
        >
          {song ? (
            <Items
              song={song}
              onClose={onClose}
              onStartSelecting={onStartSelecting}
              playlist={playlist}
              onOpen={kind => {
                setOpened({ kind, songId: song.id })
                onClose()
              }}
            />
          ) : null}
        </Popover>
      ) : (
        <Sheet
          testID="song-menu"
          open={song !== null}
          onClose={onClose}
          title={song?.title}
          subtitle={song ? song.artist || 'Unknown artist' : undefined}
        >
          {song ? (
            <Items
              song={song}
              onClose={onClose}
              onStartSelecting={onStartSelecting}
              playlist={playlist}
              onOpen={kind => {
                setOpened({ kind, songId: song.id })
                onClose()
              }}
            />
          ) : null}
        </Sheet>
      )}

      {/* Where the menu was: over the same ⋯, not in the middle of the window. */}
      <TagPicker
        song={opened?.kind === 'tags' ? openedSong : null}
        onClose={() => setOpened(null)}
        anchorRef={anchorRef}
      />
      {opened?.kind === 'details' && openedSong ? (
        <SongDetails song={openedSong} onClose={() => setOpened(null)} />
      ) : null}
    </>
  )
}

function Items({
  song,
  onClose,
  onStartSelecting,
  onOpen,
  playlist,
}: {
  song: Song
  onClose: () => void
  onStartSelecting?: (song: Song) => void
  playlist?: { readonly id: number; readonly name: string }
  onOpen: (kind: 'tags' | 'details') => void
}): ReactNode {
  const { theme } = useUnistyles()
  const player = usePlayer()
  const { data: library } = useLibrary()
  const addToPlaylist = useAddToPlaylist()
  const removeFromPlaylist = useRemoveFromPlaylist()
  const deleteSong = useDeleteSong()
  const {
    state: downloads,
    installed,
    downloadByHand,
    removeByHand,
    dropDownloads,
  } = useDownloads()
  const { wide } = useLayout()
  const [playlistsOpen, setPlaylistsOpen] = useState(false)
  const [similarOpen, setSimilarOpen] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const held = isDownloaded(downloads.index, song.id)
  // Pinned first; a live playlist's rules decide its songs, so it is not offered.
  const manualPlaylists = playlistsToAddTo(library?.playlists ?? []).filter(
    list => list.id !== playlist?.id,
  )

  const then = (run: () => void) => (): void => {
    run()
    onClose()
  }

  /** Nearest neighbours from the server; the seed song leads the list. */
  const withSimilar = (use: (songIds: number[]) => void): void => {
    void clientApi()
      .similar(song.id, 20)
      .then(result => use([song.id, ...result.songs.map(item => item.id)]))
      .catch(() => undefined)
  }

  const icon = (Glyph: typeof Queue) => <Glyph size={16} color={theme.colors.textSecondary} />

  return (
    <>
      {playlist ? (
        <>
          <SheetItem
            icon={icon(X)}
            label="Remove from this playlist"
            onPress={then(() =>
              removeFromPlaylist.mutate({ playlistId: playlist.id, songId: song.id }),
            )}
          />
          <View style={styles.divider} />
        </>
      ) : null}

      {/* Not in a phone's library, where holding a row already selects; a
          computer has no hold, and a playlist's rows are held to drag. */}
      {onStartSelecting && (wide || playlist) ? (
        <>
          <SheetItem
            icon={icon(CheckSquare)}
            label="Select"
            onPress={then(() => onStartSelecting(song))}
          />
          <View style={styles.divider} />
        </>
      ) : null}

      <SheetItem
        icon={icon(Queue)}
        label="Play next"
        onPress={then(() => player.playNext([song.id]))}
      />
      <SheetItem
        icon={icon(ListMusic)}
        label="Add to queue"
        onPress={then(() => player.addToQueue([song.id]))}
      />
      {/* Two ways to use the same neighbours, folded into one row so the menu
          stays short; they open in place, as Add to playlist does. */}
      <SheetItem
        icon={icon(Sparkles)}
        label="Similar songs"
        detail={similarOpen ? '⌄' : '›'}
        active={similarOpen}
        onPress={() => setSimilarOpen(open => !open)}
      />
      {similarOpen ? (
        <View style={styles.nested}>
          <SheetItem
            label="Play similar"
            onPress={then(() => withSimilar(songIds => player.playFrom(songIds, 0)))}
          />
          <SheetItem
            label="Add similar to queue"
            onPress={then(() => withSimilar(songIds => player.addToQueue(songIds.slice(1))))}
          />
        </View>
      ) : null}

      <View style={styles.divider} />

      <SheetItem
        icon={icon(ListMusic)}
        label="Add to playlist…"
        active={playlistsOpen}
        onPress={() => setPlaylistsOpen(open => !open)}
      />
      {playlistsOpen ? (
        <View style={styles.nested}>
          {manualPlaylists.length === 0 ? (
            <Text style={styles.hint}>No playlists yet.</Text>
          ) : (
            manualPlaylists.map(list => (
              <SheetItem
                key={list.id}
                label={list.name}
                onPress={then(() =>
                  addToPlaylist.mutate({ playlistId: list.id, songIds: [song.id] }),
                )}
              />
            ))
          )}
        </View>
      ) : null}
      <SheetItem icon={icon(TagIcon)} label="Edit tags…" onPress={() => onOpen('tags')} />

      <View style={styles.divider} />

      {/* Fixing the metadata lives inside the details, beside the facts it fixes. */}
      <SheetItem icon={icon(Info)} label="Song details…" onPress={() => onOpen('details')} />
      {/* A browser streams; only an installed app keeps songs. */}
      {!installed ? null : held ? (
        <SheetItem
          icon={icon(X)}
          label="Remove download"
          onPress={then(() => void removeByHand([song.id]))}
        />
      ) : (
        <SheetItem
          icon={icon(CloudDownload)}
          label="Download"
          detail={song.sizeBytes > 0 ? formatBytes(song.sizeBytes) : undefined}
          onPress={then(() => downloadByHand([song.id]))}
        />
      )}

      <View style={styles.divider} />

      {!confirmingDelete ? (
        <SheetItem
          icon={<Trash size={16} color={theme.colors.danger} />}
          label="Remove from library…"
          danger
          onPress={() => setConfirmingDelete(true)}
        />
      ) : removingTakesTheCopy ? (
        /*
         * One question, then one action. Removing a song here is removing it:
         * the row leaves the library and the download leaves the device with
         * it. The other choice a computer offers is about the file in the
         * server's library folder, which is not this device's to decide.
         */
        <View>
          <Text style={styles.hint}>
            Remove “{song.title}” from your library?
            {held ? ' The download on this device goes too.' : ''}
          </Text>
          <SheetItem
            icon={<Trash size={16} color={theme.colors.danger} />}
            label="Remove from library"
            danger
            onPress={then(() => {
              void dropDownloads([song.id])
              deleteSong.mutate({ id: song.id, deleteFile: false })
            })}
          />
          <SheetItem label="Cancel" onPress={() => setConfirmingDelete(false)} />
        </View>
      ) : (
        <View>
          <Text style={styles.hint}>Remove “{song.title}”?</Text>
          <SheetItem
            label="Remove from library, keep the file"
            onPress={then(() => deleteSong.mutate({ id: song.id, deleteFile: false }))}
          />
          <SheetItem
            icon={<Trash size={16} color={theme.colors.danger} />}
            label="Delete the file too"
            danger
            onPress={then(() => deleteSong.mutate({ id: song.id, deleteFile: true }))}
          />
          <SheetItem label="Cancel" onPress={() => setConfirmingDelete(false)} />
        </View>
      )}
    </>
  )
}

const styles = StyleSheet.create(theme => ({
  divider: { height: 1, backgroundColor: theme.colors.border, marginVertical: space.xs },
  nested: { paddingLeft: space.lg },
  hint: {
    color: theme.colors.textMuted,
    fontSize: 12,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
}))
