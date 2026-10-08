import { useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useRouter, type Href } from 'expo-router'
import { artistOr, formatDuration, type Song } from '@selfmp3/shared'
import {
  clientApi,
  failureText,
  isDownloaded,
  space,
  type,
  useAddToPlaylist,
  useLibrary,
  useRemoveFromPlaylist,
  useToggleLoved,
} from '@selfmp3/client'
import { playlistsToAddTo } from '../../features/playlists/playlists.model'
import { songLink } from '../../features/song/song.model'
import { tagLink } from '../../features/tag/placeLinks'
import { useArt } from '../../offline/useArt'
import { useDownloads } from '../../offline/DownloadsProvider'
import { useFlyToUpNext } from '../../features/queue/useFlyToUpNext'
import { usePlayerCommands } from '../../player/PlayerProvider'
import { showToast } from '../toast'
import { Chip } from './Chip'
import { RemoveSongs } from './ConfirmRemoveSongs'
import { Cover } from './Cover'
import { IconButton } from './IconButton'
import {
  CloudDownload,
  CloudRemove,
  Devices,
  Heart,
  Info,
  ListMusic,
  QueueAdd,
  Sparkles,
  Tag as TagIcon,
  Trash,
  X,
} from './Icons'
import { Popover } from './Popover'
import { SheetItem } from './Sheet'
import { TagPicker } from './TagPicker'
import type { PopoverAnchor } from '../rightClick'

/**
 * The ⋯ menu for a song (docs/ui-mock `P14`): the one song menu, the same
 * items in the same order wherever a song is — a row's ⋯, a held row, a
 * right-click, Now Playing's ⋯ on a phone or a computer (proposal B1,
 * 2026-10-08). People learn one menu and find it everywhere.
 *
 * At phone width this is a row's only set of actions, so everything a row can
 * do has to be reachable from here, tagging included. The song heads it —
 * cover, title, its tags and its heart — so a menu opened by holding a row
 * still says which row it came from. Then what is done to the song, what it
 * is, what it is to the list it was opened from (a playlist you made), and
 * last, removing it.
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
 * Dropping the download on its own is "Remove download", beside Download:
 * keeping the song and freeing the room is a different wish.
 */
export function SongMenu({
  song,
  onClose,
  anchorRef,
  playlist,
  onDevices,
  onRemove,
  onOpen,
}: {
  song: Song | null
  onClose: () => void
  /**
   * Opened from a playlist you made: the menu offers taking the song out of
   * it, which on a phone is the only way to — its rows have no ✕.
   */
  playlist?: { readonly id: number; readonly name: string }
  /**
   * The ⋯ that opened it, or the point a right-click landed on. At desktop
   * width the menu hangs off it; without one it is a sheet.
   */
  anchorRef?: RefObject<PopoverAnchor | null>
  /**
   * Opened from the phone's Now Playing, which has no other door to the
   * devices: the menu ends with a short "This player" group for them. Sleep
   * is not in it, since the page has its own Sleep button.
   */
  onDevices?: () => void
  /**
   * Who asks about removing, when the question has to outlive the page the
   * menu is on: removing the song playing takes the phone's Now Playing away
   * with it. Left out, the menu asks itself.
   */
  onRemove?: (song: Song) => void
  /**
   * Going to a page from the menu — a tag's, the song's own. Left out, the
   * router goes there; the phone's Now Playing is a modal over the app, and
   * puts itself away first (`leaveTo`).
   */
  onOpen?: (href: Href) => void
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
      onDevices={onDevices}
      onOpen={onOpen}
      onTags={() => {
        setTagging(song.id)
        onClose()
      }}
      onRemove={() => {
        if (onRemove) onRemove(song)
        else setRemoving(song)
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
  onDevices,
  onOpen,
}: {
  song: Song
  onClose: () => void
  onTags: () => void
  /** Removing asks in a dialog of its own, which outlives the menu. */
  onRemove: () => void
  playlist?: { readonly id: number; readonly name: string }
  /** The ⋯ that opened the menu, where a song sent to Up next flies from. */
  anchorRef?: RefObject<PopoverAnchor | null>
  onDevices?: () => void
  onOpen?: (href: Href) => void
}): ReactNode {
  const { theme } = useUnistyles()
  const router = useRouter()
  const open = onOpen ?? ((href: Href) => router.navigate(href))
  const player = usePlayerCommands()
  const fly = useFlyToUpNext()
  const artFor = useArt()
  const { data: library } = useLibrary()
  const addToPlaylist = useAddToPlaylist()
  const removeFromPlaylist = useRemoveFromPlaylist()
  const toggleLoved = useToggleLoved()
  const { state: downloads, installed, requestDownload, removeByHand } = useDownloads()
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

  /** Nearest neighbours from the server; the seed song leads the list. */
  const playSimilar = (): void => {
    void clientApi()
      .similar(song.id, 20)
      .then(result =>
        player.playFrom([song.id, ...result.songs.map(item => item.id)], 0, {
          source: { kind: 'songs', origin: 'similar', name: `Similar to ${song.title}` },
        }),
      )
      .catch((caught: unknown) =>
        showToast(failureText('Couldn’t find similar songs', caught), 'error'),
      )
  }

  const icon = (Glyph: typeof QueueAdd) => <Glyph size={16} color={theme.colors.textSecondary} />

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
                  onPress={then(() => open(tagLink(tag.name)))}
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

      <SheetItem icon={icon(TagIcon)} label="Tags" onPress={onTags} />
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
        icon={icon(QueueAdd)}
        label="Add to Up next"
        onPress={() => {
          fly(anchorRef?.current ?? null, [song.id])
          player.addToQueue([song.id])
          onClose()
        }}
      />
      <SheetItem icon={icon(Sparkles)} label="Play similar songs" onPress={then(playSimilar)} />
      {/* A browser streams; only an installed app keeps songs. */}
      {!installed ? null : held ? (
        <SheetItem
          icon={icon(CloudRemove)}
          label="Remove download"
          onPress={then(() => void removeByHand([song.id]))}
        />
      ) : (
        <SheetItem
          icon={icon(CloudDownload)}
          label="Download"
          // By hand, so a song removed by hand comes back, and mobile data is asked about.
          onPress={then(() => requestDownload([song.id]))}
        />
      )}
      <SheetItem
        icon={icon(Info)}
        label="Song details"
        onPress={then(() => open(songLink(song.id)))}
      />

      {/* What the song is to where the menu was opened. The groups are told
          apart by the room between them, not a line. */}
      {playlist ? (
        <>
          <View style={styles.gap} />
          <SheetItem
            icon={icon(X)}
            label="Remove from this playlist"
            onPress={then(() =>
              removeFromPlaylist.mutate({ playlistId: playlist.id, songId: song.id }),
            )}
          />
        </>
      ) : null}
      {onDevices ? (
        <>
          <Text style={styles.group}>This player</Text>
          <SheetItem icon={icon(Devices)} label="Devices" onPress={then(onDevices)} />
        </>
      ) : null}

      <View style={styles.gap} />
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
  gap: { height: space.sm },
  /* A group's name, quiet, as a sheet's label title is. */
  group: {
    color: theme.colors.textMuted,
    fontSize: type.small,
    paddingHorizontal: space.md,
    paddingTop: space.md,
    paddingBottom: space.xs,
  },
  nested: { paddingLeft: space.lg },
  hint: {
    color: theme.colors.textMuted,
    fontSize: 12,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
}))
