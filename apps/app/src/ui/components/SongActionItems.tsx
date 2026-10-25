import { Fragment, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { useRouter, type Href } from 'expo-router'
import { plural, type Song } from '@selfmp3/shared'
import {
  isDownloaded,
  isRoomTrackId,
  space,
  uniqueName,
  useAddToPlaylist,
  useBulkLoved,
  useCreatePlaylist,
  useLibrary,
  iconSize,
} from '@selfmp3/client'
import { addedToPlaylist, playlistsToAddTo } from '../../features/playlists/playlists.model'
import { askForGuide } from '../../features/guide/guideMemory'
import { usePlaylistRemoval } from '../../features/playlists/usePlaylistRemoval'
import { useFlyToUpNext } from '../../features/queue/useFlyToUpNext'
import { playSimilar } from '../../features/song/playSimilar'
import { openShareSheet } from '../../features/share/shareSheet.store'
import { useConnection } from '../../connection/ConnectionProvider'
import { songLink } from '../../features/song/song.model'
import { useDownloads } from '../../offline/DownloadsProvider'
import { useDownloadRemoval } from '../../offline/useDownloadRemoval'
import { usePlayerCommands } from '../../player/PlayerProvider'
import type { PopoverAnchor } from '../rightClick'
import { songActions, type SongAction, type SongActionId } from '../songActions.model'
import { showFailure, showToast } from '../toast'
import {
  CloudDownload,
  CloudRemove,
  Heart,
  Info,
  ListMusic,
  Plus,
  QueueAdd,
  ShareOut,
  Sparkles,
  Tag as TagIcon,
  Trash,
  X,
} from './Icons'
import { SheetItem } from './Sheet'
import { thisPlace } from '../../ports/place'

/** Each action's mark, beside its name. */
const ICON: Record<SongActionId, ReactNode> = {
  like: <Heart size={iconSize.item} tone="textSecondary" />,
  unlike: <Heart size={iconSize.item} filled tone="danger" />,
  tags: <TagIcon size={iconSize.item} tone="textSecondary" />,
  addToPlaylist: <ListMusic size={iconSize.item} tone="textSecondary" />,
  addToUpNext: <QueueAdd size={iconSize.item} tone="textSecondary" />,
  playSimilar: <Sparkles size={iconSize.item} tone="textSecondary" />,
  share: <ShareOut size={iconSize.item} tone="textSecondary" />,
  download: <CloudDownload size={iconSize.item} tone="textSecondary" />,
  removeDownload: <CloudRemove size={iconSize.item} tone="textSecondary" />,
  details: <Info size={iconSize.item} tone="textSecondary" />,
  removeFromPlaylist: <X size={iconSize.item} tone="textSecondary" />,
  delete: <Trash size={iconSize.item} tone="danger" />,
}

/**
 * What can be done to songs, as a menu's items (`songActions`): the song's ⋯
 * menu draws them for one song, and the selection bar's More for every song
 * ticked, so the two offer the same things by the same names and do them the
 * same way — a download by hand, so a song removed by hand comes back and
 * mobile data is asked about; Up next's covers flying from where it was
 * pressed; "Added to …" once the server has taken it.
 *
 * Tags and Delete open something of the menu's own (the tag window, the
 * question), so those it hands back. Each item closes the menu as it acts.
 */
export function SongActionItems({
  songs,
  playlist,
  nowPlaying = false,
  leave = [],
  flyFrom,
  onClose,
  onTags,
  onDelete,
  onOpen,
  onNewPlaylist,
  beforeRemove,
}: {
  /** The songs, in the order the list has them. */
  songs: readonly Song[]
  /** Opened from a playlist you made: they can be taken out of it. */
  playlist?: { readonly id: number; readonly name: string }
  /** Opened on Now Playing (`songActions`). */
  nowPlaying?: boolean
  /** What the surface already offers itself: the selection bar's own buttons. */
  leave?: readonly SongActionId[]
  /** Where Up next's covers fly from: the ⋯ that opened the menu. */
  flyFrom?: RefObject<PopoverAnchor | null>
  onClose: () => void
  onTags: () => void
  onDelete: () => void
  /** Going to the song's page. Left out, the router goes there. */
  onOpen?: (href: Href) => void
  /** A new playlist was made of the songs, and is opening. */
  onNewPlaylist?: () => void
  /** Drawn before removing, set apart: the phone's Now Playing's own doors. */
  beforeRemove?: ReactNode
}): ReactNode {
  const router = useRouter()
  const { data: library } = useLibrary()
  const player = usePlayerCommands()
  const fly = useFlyToUpNext()
  const bulkLoved = useBulkLoved()
  const addToPlaylist = useAddToPlaylist()
  const { mutateAsync: createPlaylist } = useCreatePlaylist()
  const removeFromPlaylist = usePlaylistRemoval()
  const removeDownloads = useDownloadRemoval()
  const { state: downloads, installed, requestDownload } = useDownloads()
  const [playlistsOpen, setPlaylistsOpen] = useState(false)
  const { fromCloud, needsStorage } = useConnection()

  const ids = songs.map(song => song.id)
  const held = songs.filter(song => isDownloaded(downloads.index, song.id))
  const loved = songs.filter(song => song.loved).length
  const count = songs.length
  const actions = songActions({
    count,
    loved,
    held: held.length,
    installed,
    roomSong: songs.some(song => isRoomTrackId(song.id)),
    inPlaylist: playlist !== undefined,
    nowPlaying,
    place: thisPlace(),
    shareable: fromCloud && !needsStorage,
  }).filter(action => !leave.includes(action.id))
  // The one played last first; not the playlist this is, and never a live one.
  const manualPlaylists = playlistsToAddTo(library?.playlists ?? [], playlist?.id)

  /**
   * Said once the server has taken the edit, not as it is sent: a failure is
   * said by the app's own error toast (`meta.failure`), and a "Liked 3 songs"
   * ahead of it would contradict it.
   */
  const saidOnSuccess = (message: string) => ({
    onSuccess: () => showToast(message, 'good'),
  })

  /** A playlist of exactly these songs, opened with its name ready to type. */
  const newPlaylist = async (): Promise<void> => {
    const name = uniqueName(
      'New playlist',
      (library?.playlists ?? []).map(list => list.name),
    )
    try {
      const created = await createPlaylist({
        input: { name, description: '', kind: 'manual', rules: null },
        songIds: ids,
      })
      onNewPlaylist?.()
      router.push({ pathname: '/playlists/[id]', params: { id: String(created.id), rename: '1' } })
    } catch (caught) {
      showFailure('Couldn’t make the playlist', caught)
    }
  }

  const run: Record<SongActionId, () => void> = {
    like: () =>
      bulkLoved.mutate(
        { songIds: ids, loved: true },
        saidOnSuccess(`Liked ${plural(count - loved, 'song', 'songs')}`),
      ),
    unlike: () =>
      bulkLoved.mutate(
        { songIds: ids, loved: false },
        saidOnSuccess(`Unliked ${plural(loved, 'song', 'songs')}`),
      ),
    tags: onTags,
    addToPlaylist: () => undefined,
    addToUpNext: () => {
      fly(flyFrom?.current ?? null, ids)
      player.addToQueue(ids)
    },
    playSimilar: () => {
      if (songs[0]) playSimilar(player, songs[0])
    },
    share: () =>
      openShareSheet({
        songIds: ids,
        name:
          count === 1
            ? (songs[0]?.title ?? '')
            : `${songs[0]?.title ?? ''} and ${plural(count - 1, 'more', 'more')}`,
        kind: count === 1 ? 'song' : 'list',
      }),
    // By hand: picked songs stay, a song removed by hand comes back, and
    // mobile data or a large total is asked about first.
    download: () => requestDownload(ids),
    removeDownload: () => removeDownloads(held.map(song => song.id)),
    details: () => {
      const href = songLink(ids[0] ?? 0)
      if (onOpen) onOpen(href)
      else router.navigate(href)
    },
    removeFromPlaylist: () => {
      if (playlist) removeFromPlaylist(playlist, songs)
    },
    delete: onDelete,
  }

  const draw = (action: SongAction, apart: boolean): ReactNode => (
    <Fragment key={action.id}>
      {apart ? <View style={styles.gap} /> : null}
      {action.id === 'addToPlaylist' ? (
        // Opens in place rather than over the menu, so the songs stay named above it.
        <SheetItem
          icon={ICON.addToPlaylist}
          label={action.label}
          detail={playlistsOpen ? '⌄' : '›'}
          active={playlistsOpen}
          onPress={() => setPlaylistsOpen(open => !open)}
        />
      ) : (
        <SheetItem
          icon={ICON[action.id]}
          label={action.label}
          danger={action.id === 'delete'}
          onPress={() => {
            run[action.id]()
            onClose()
          }}
        />
      )}
      {action.id === 'addToPlaylist' && playlistsOpen ? (
        <View style={styles.nested}>
          <SheetItem
            icon={<Plus tone="textSecondary" />}
            label={`New playlist with ${count === 1 ? 'this song' : `these ${count}`}`}
            onPress={() => {
              onClose()
              void newPlaylist()
            }}
          />
          {manualPlaylists.map(list => (
            <SheetItem
              key={list.id}
              label={list.name}
              onPress={() => {
                // Counting only the songs that were not in it already.
                addToPlaylist.mutate(
                  { playlistId: list.id, songIds: ids },
                  {
                    onSuccess: after =>
                      showToast(
                        addedToPlaylist(list.name, count, list.songCount, after.songCount),
                        'good',
                      ),
                  },
                )
                // A computer can drop songs on the sidebar's playlists instead,
                // which this is the moment to show (`sidebar-drop`).
                askForGuide('sidebar-drop')
                onClose()
              }}
            />
          ))}
        </View>
      ) : null}
    </Fragment>
  )

  // Removing comes last, after whatever the surface adds of its own.
  const kept = actions.filter(action => action.group !== 'remove')
  const removing = actions.filter(action => action.group === 'remove')
  return (
    <>
      {kept.map((action, index) =>
        draw(action, index > 0 && kept[index - 1]?.group !== action.group),
      )}
      {beforeRemove}
      {removing.map(action => draw(action, kept.length > 0 || beforeRemove !== undefined))}
    </>
  )
}

const styles = StyleSheet.create({
  // The groups are told apart by the room between them, not a line.
  gap: { height: space.sm },
  nested: { paddingLeft: space.lg },
})
