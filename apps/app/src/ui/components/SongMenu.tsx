import { useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import type { View as RNView } from 'react-native'
import { useRouter } from 'expo-router'
import { formatDuration, type Song } from '@selfmp3/shared'
import {
  clientApi,
  isDownloaded,
  space,
  type,
  useAddToPlaylist,
  useDeleteSong,
  useLibrary,
  useRemoveFromPlaylist,
  useToggleLoved,
} from '@selfmp3/client'
import { playlistsToAddTo } from '../../features/playlists/playlists.model'
import { songLink } from '../../features/song/song.model'
import { tagLink } from '../../features/tag/placeLinks'
import { useArt } from '../../offline/useArt'
import { useDownloads } from '../../offline/DownloadsProvider'
import { removingTakesTheCopy } from '../../ports/device'
import { usePlayer } from '../../player/PlayerProvider'
import { useLayout } from '../../shell/useLayout'
import { Button } from './Button'
import { Chip } from './Chip'
import { Cover } from './Cover'
import { IconButton } from './IconButton'
import {
  CloudDownload,
  Heart,
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
import { TagPicker } from './TagPicker'

/**
 * The ⋯ menu for a song (docs/ui-mock `P14`).
 *
 * At phone width this is a row's only set of actions, so everything a row can
 * do has to be reachable from here, tagging included. The song heads it —
 * cover, title, its tags and its heart — so a menu opened by holding a row
 * still says which row it came from, and the two things done to a song most
 * often, tagging and keeping it, are the two buttons under that head.
 *
 * Kept short on purpose. Play next lives on the song's own page, which "Song
 * details" opens; selecting starts from a held row on a phone and from the
 * row's checkbox on a computer, so the menu does not offer it either. Fixing
 * the metadata is a button on the song's page, beside the facts it changes.
 *
 * Destructive actions sit last and apart, and removing always asks first.
 * What it then offers depends on the device (`removingTakesTheCopy`): a
 * computer separates "remove from my list" from "delete the actual file",
 * which are never one mis-tap apart, because that second file is the server's
 * and a rescan would find it again. A phone has no such file and one meaning —
 * remove it, and take the download with it — so it asks once and does that.
 *
 * Dropping the download on its own stays up by the head, as "Remove
 * download": keeping the song and freeing the room is a different wish.
 */
export function SongMenu({
  song,
  onClose,
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
  /** The ⋯ that opened it. At desktop width the menu hangs off it; without one it is a sheet. */
  anchorRef?: RefObject<RNView | null>
}): ReactNode {
  const { data: library } = useLibrary()
  const { wide } = useLayout()
  const [tagging, setTagging] = useState<number | null>(null)
  // The song as the library has it now, so the picker shows the tags after a change.
  const taggingSong =
    tagging === null ? null : (library?.songs.find(item => item.id === tagging) ?? null)

  const items = song ? (
    <Items
      song={song}
      onClose={onClose}
      playlist={playlist}
      onTags={() => {
        setTagging(song.id)
        onClose()
      }}
    />
  ) : null

  return (
    <>
      {wide && anchorRef ? (
        <Popover
          open={song !== null}
          onClose={onClose}
          anchorRef={anchorRef}
          width={300}
          testID="song-menu"
        >
          {items}
        </Popover>
      ) : (
        <Sheet testID="song-menu" open={song !== null} onClose={onClose}>
          {items}
        </Sheet>
      )}

      {/* Where the menu was: over the same ⋯, not in the middle of the window. */}
      <TagPicker song={taggingSong} onClose={() => setTagging(null)} anchorRef={anchorRef} />
    </>
  )
}

function Items({
  song: given,
  onClose,
  onTags,
  playlist,
}: {
  song: Song
  onClose: () => void
  onTags: () => void
  playlist?: { readonly id: number; readonly name: string }
}): ReactNode {
  const { theme } = useUnistyles()
  const router = useRouter()
  const player = usePlayer()
  const artFor = useArt()
  const { data: library } = useLibrary()
  const addToPlaylist = useAddToPlaylist()
  const removeFromPlaylist = useRemoveFromPlaylist()
  const deleteSong = useDeleteSong()
  const toggleLoved = useToggleLoved()
  const {
    state: downloads,
    installed,
    downloadByHand,
    removeByHand,
    dropDownloads,
  } = useDownloads()
  const [playlistsOpen, setPlaylistsOpen] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  // The heart and the tags as they are now, not as they were when the menu opened.
  const song = library?.songs.find(item => item.id === given.id) ?? given
  const tags = (library?.tags ?? []).filter(tag => song.tagIds.includes(tag.id))
  const held = isDownloaded(downloads.index, song.id)
  // A live playlist's rules decide its songs, so it is not offered.
  const manualPlaylists = playlistsToAddTo(library?.playlists ?? []).filter(
    list => list.id !== playlist?.id,
  )
  const byline = [
    song.artist || 'Unknown artist',
    song.duration > 0 ? formatDuration(song.duration) : '',
  ]
    .filter(Boolean)
    .join(' · ')

  const then = (run: () => void) => (): void => {
    run()
    onClose()
  }

  /** Nearest neighbours from the server; the seed song leads the list. */
  const playSimilar = (): void => {
    void clientApi()
      .similar(song.id, 20)
      .then(result => player.playFrom([song.id, ...result.songs.map(item => item.id)], 0))
      .catch(() => undefined)
  }

  const icon = (Glyph: typeof Queue) => <Glyph size={16} color={theme.colors.textSecondary} />

  return (
    <>
      <View style={styles.head}>
        <Cover uri={artFor(song)} title={song.album || song.title} size={56} />
        <View style={styles.titles}>
          <Text style={styles.title} numberOfLines={1}>
            {song.title}
          </Text>
          <Text style={styles.byline} numberOfLines={1}>
            {byline}
          </Text>
          {tags.length > 0 ? (
            <View style={styles.tags}>
              {tags.map(tag => (
                <Chip
                  key={tag.id}
                  label={tag.name}
                  hue={tag.hue}
                  selected={false}
                  compact
                  onPress={then(() => router.navigate(tagLink(tag.name)))}
                />
              ))}
            </View>
          ) : null}
        </View>
        <IconButton
          label={song.loved ? 'Unlike' : 'Like'}
          active={song.loved}
          filled
          size={44}
          onPress={() => toggleLoved.mutate({ id: song.id, loved: !song.loved })}
        >
          <Heart
            size={20}
            filled={song.loved}
            color={song.loved ? theme.colors.danger : theme.colors.textPrimary}
          />
        </IconButton>
      </View>

      <View style={styles.buttons}>
        <Button label="Tags" icon={<TagIcon size={16} tone="textPrimary" />} onPress={onTags} />
        {/* A browser streams; only an installed app keeps songs. */}
        {!installed ? null : held ? (
          <Button
            label="Remove download"
            icon={<X size={16} tone="textPrimary" />}
            onPress={then(() => void removeByHand([song.id]))}
          />
        ) : (
          <Button
            label="Download"
            icon={<CloudDownload size={16} tone="textPrimary" />}
            onPress={then(() => downloadByHand([song.id]))}
          />
        )}
      </View>

      {playlist ? (
        <SheetItem
          icon={icon(X)}
          label="Remove from this playlist"
          onPress={then(() =>
            removeFromPlaylist.mutate({ playlistId: playlist.id, songId: song.id }),
          )}
        />
      ) : null}
      {/* Opens in place rather than over the menu, so the song stays named above it. */}
      <SheetItem
        icon={icon(ListMusic)}
        label="Add to playlist"
        detail={playlistsOpen ? '⌄' : '›'}
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
      <SheetItem
        icon={icon(Queue)}
        label="Add to queue"
        onPress={then(() => player.addToQueue([song.id]))}
      />
      <SheetItem icon={icon(Sparkles)} label="Play similar songs" onPress={then(playSimilar)} />

      {/* The groups are told apart by the room between them, not a line. */}
      <View style={styles.gap} />

      <SheetItem
        icon={icon(Info)}
        label="Song details"
        onPress={then(() => router.navigate(songLink(song.id)))}
      />
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
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: space.xs,
    paddingTop: space.xs,
    paddingBottom: space.md,
  },
  titles: { flex: 1, minWidth: 0, gap: 3 },
  title: { color: theme.colors.textPrimary, fontSize: type.title, fontWeight: '600' },
  byline: { color: theme.colors.textSecondary, fontSize: type.rowSub },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: space.xs },
  /*
   * Two abreast while both labels fit, and one under the other when they do
   * not: side by side, "Remove download" was clipped to "Remove dow…", which
   * names nothing. Each takes the whole row once it wraps.
   */
  buttons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
    paddingBottom: space.sm,
  },
  gap: { height: space.sm },
  nested: { paddingLeft: space.lg },
  hint: {
    color: theme.colors.textMuted,
    fontSize: 12,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
}))
