import { useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import type { View as RNView } from 'react-native'
import { useRouter } from 'expo-router'
import { artistOr, formatDuration, type Song } from '@selfmp3/shared'
import {
  isDownloaded,
  space,
  type,
  useAddToPlaylist,
  useLibrary,
  useRemoveFromPlaylist,
  useToggleLoved,
} from '@selfmp3/client'
import { playlistsToAddTo } from '../../features/playlists/playlists.model'
import { playSimilar } from '../../features/song/playSimilar'
import { songLink } from '../../features/song/song.model'
import { tagLink } from '../../features/tag/placeLinks'
import { useArt } from '../../offline/useArt'
import { useDownloads } from '../../offline/DownloadsProvider'
import { useFlyToUpNext } from '../../features/queue/useFlyToUpNext'
import { usePlayerCommands } from '../../player/PlayerProvider'
import { Button } from './Button'
import { Chip } from './Chip'
import { RemoveSongs } from './ConfirmRemoveSongs'
import { Cover } from './Cover'
import { IconButton } from './IconButton'
import {
  CloudDownload,
  CloudRemove,
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
import { SheetItem } from './Sheet'
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
 * Removing has one meaning on every device — the song leaves the library
 * everywhere, and the download here goes with it — so it asks once and does
 * that. The question is the selection bar's dialog, not a second state of the
 * menu: the menu closes, and one press in a dialog answers it. Asked inside
 * the menu, the same popup took two presses, and the second landed where the
 * first had been (Xiao, 2026-10-02).
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
  const [tagging, setTagging] = useState<number | null>(null)
  const [removing, setRemoving] = useState<Song | null>(null)
  // The song as the library has it now, so the picker shows the tags after a change.
  const taggingSong =
    tagging === null ? null : (library?.songs.find(item => item.id === tagging) ?? null)

  const items = song ? (
    <Items
      song={song}
      onClose={onClose}
      playlist={playlist}
      anchorRef={anchorRef}
      onTags={() => {
        setTagging(song.id)
        onClose()
      }}
      onRemove={() => {
        setRemoving(song)
        onClose()
      }}
    />
  ) : null

  return (
    <>
      <Popover
        open={song !== null}
        onClose={onClose}
        anchorRef={anchorRef}
        width={300}
        testID="song-menu"
      >
        {items}
      </Popover>

      {/* Where the menu was: over the same ⋯, not in the middle of the window. */}
      <TagPicker song={taggingSong} onClose={() => setTagging(null)} anchorRef={anchorRef} />
      {removing ? (
        <RemoveSongs
          songs={[removing]}
          onCancel={() => setRemoving(null)}
          onDone={() => setRemoving(null)}
        />
      ) : null}
    </>
  )
}

function Items({
  song: given,
  onClose,
  onTags,
  onRemove,
  playlist,
  anchorRef,
}: {
  song: Song
  onClose: () => void
  onTags: () => void
  /** Removing asks in a dialog of its own, which outlives the menu. */
  onRemove: () => void
  playlist?: { readonly id: number; readonly name: string }
  /** The ⋯ that opened the menu, where a song sent to Up next flies from. */
  anchorRef?: RefObject<RNView | null>
}): ReactNode {
  const { theme } = useUnistyles()
  const router = useRouter()
  const player = usePlayerCommands()
  const fly = useFlyToUpNext()
  const artFor = useArt()
  const { data: library } = useLibrary()
  const addToPlaylist = useAddToPlaylist()
  const removeFromPlaylist = useRemoveFromPlaylist()
  const toggleLoved = useToggleLoved()
  const { state: downloads, installed, downloadByHand, removeByHand } = useDownloads()
  const [playlistsOpen, setPlaylistsOpen] = useState(false)

  // The heart and the tags as they are now, not as they were when the menu opened.
  const song = library?.songs.find(item => item.id === given.id) ?? given
  const tags = (library?.tags ?? []).filter(tag => song.tagIds.includes(tag.id))
  const held = isDownloaded(downloads.index, song.id)
  // A live playlist's rules decide its songs, so it is not offered.
  const manualPlaylists = playlistsToAddTo(library?.playlists ?? []).filter(
    list => list.id !== playlist?.id,
  )
  const byline = [artistOr(song.artist), song.duration > 0 ? formatDuration(song.duration) : '']
    .filter(Boolean)
    .join(' · ')

  const then = (run: () => void) => (): void => {
    run()
    onClose()
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
            icon={<CloudRemove size={16} tone="textPrimary" />}
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
        label="Add to Up next"
        onPress={() => {
          fly(anchorRef?.current ?? null, [song.id])
          player.addToQueue([song.id])
          onClose()
        }}
      />
      <SheetItem
        icon={icon(Sparkles)}
        label="Play similar songs"
        onPress={then(() => playSimilar(player, song))}
      />

      {/* The groups are told apart by the room between them, not a line. */}
      <View style={styles.gap} />

      <SheetItem
        icon={icon(Info)}
        label="Song details"
        onPress={then(() => router.navigate(songLink(song.id)))}
      />
      <SheetItem
        icon={<Trash size={16} color={theme.colors.danger} />}
        label="Remove from library…"
        danger
        onPress={onRemove}
      />
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
