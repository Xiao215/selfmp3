import { useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import { View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { useRouter } from 'expo-router'
import { plural } from '@selfmp3/shared'
import { iconSize, radius, space, useLibrary } from '@selfmp3/client'
import { usePlayerCommands } from '../../player/PlayerProvider'
import { useContentWidthValue } from '../../shell/contentWidth'
import { Sparkle } from '../../ui/components/Icons'
import { SectionHead } from '../../ui/components/SectionHead'
import { Shelf, ShelfCard, SongCard } from '../../ui/components/Shelf'
import { Bone, Skeleton } from '../../ui/components/Skeleton'
import {
  describeSource,
  homeRecents,
  recentKind,
  recentSongIds,
  RECENTS_SOURCE,
  type HomeRecent,
} from '../lists/lists.model'
import { useRecentLists } from '../lists/recentLists.store'
import { PlaylistCover } from '../playlists/PlaylistCover'
import { useFlyToUpNext } from '../queue/useFlyToUpNext'
import { pastRoomFaces, useRecentRooms } from '../room/pastRooms.store'
import type { PastRoom } from '../room/room.model'
import { FacesCover } from '../room/RoomFace'
import { usePastRoomCovers } from '../room/usePastRoomCovers'
import { keepAnswer, reorderAnswer } from '../smart/answers.store'

/**
 * Home's Recently played (docs/features/lists.md, A1): the rooms listened in
 * together for a few days after they end (features/room), then the lists and
 * songs played on this device. "See all" opens Library in the order this row
 * is in, for that visit: the order Library keeps for itself stays as it was
 * (G1).
 */
export function RecentlyPlayed({ wide }: { wide: boolean }): ReactNode {
  const router = useRouter()
  const { data: library } = useLibrary()
  const recentLists = useRecentLists()
  const rooms = useRecentRooms()
  // As many as the row holds on a very wide page, rather than twelve and an
  // empty half of the row (P1 C); never fewer than the twelve it remembers.
  const recentsShown = useContentWidthValue(page =>
    page === null
      ? undefined
      : Math.max(
          RECENTS_LEAST,
          Math.floor((page - space.gutterWide * 2 + RECENT_GAP) / (RECENT_TILE + RECENT_GAP)),
        ),
  )
  const recents = useMemo(
    () => (library ? homeRecents(recentLists, library.songs, recentsShown) : []),
    [library, recentLists, recentsShown],
  )
  if (recents.length > 0 || rooms.length > 0) {
    return (
      <View style={styles.stack}>
        <SectionHead
          title="Recently played"
          action={{
            label: 'See all',
            onPress: () =>
              router.navigate({ pathname: '/library', params: { sort: 'lastPlayedAt' } }),
          }}
        />
        <Recents recents={recents} rooms={rooms} wide={wide} />
      </View>
    )
  }
  // Remembered on this device, so known to be coming before the songs they
  // name have arrived (AA1).
  if (library === undefined && recentLists.length > 0) {
    return (
      <View style={styles.stack}>
        <SectionHead title="Recently played" action={null} />
        <RecentsWaiting wide={wide} />
      </View>
    )
  }
  return null
}

/** Recently played's shapes: a row of covers, each with its name under it. */
function RecentsWaiting({ wide }: { wide: boolean }): ReactNode {
  const size = wide ? RECENT_TILE : 92
  return (
    <Skeleton label="Loading recently played" style={styles.recentsWaiting}>
      {Array.from({ length: RECENTS_LEAST }, (_, index) => (
        <View key={index} style={[styles.recentWaiting, { width: size }]}>
          <Bone width={size} height={size} radius={radius.cover} />
          <Bone width="70%" height={11} radius={radius.pill} />
        </View>
      ))}
    </Skeleton>
  )
}

/**
 * What you listened to, newest first, in a row that scrolls sideways — a list
 * as its covers and its kind, a song played on its own as that song. A tap
 * plays it again; a list that was never saved can be saved from Up next.
 */
function Recents({
  recents,
  rooms,
  wide,
}: {
  recents: readonly HomeRecent[]
  rooms: readonly PastRoom[]
  wide: boolean
}): ReactNode {
  const player = usePlayerCommands()
  const router = useRouter()
  const { data: library } = useLibrary()
  const size = wide ? RECENT_TILE : 92
  const songIds = useMemo(
    () => recents.flatMap(recent => (recent.kind === 'song' ? [recent.song.id] : [])),
    [recents],
  )
  const known = { tags: library?.tags ?? [], playlists: library?.playlists ?? [] }
  const fly = useFlyToUpNext()
  // Each list tile's covers, where a played list's covers fly from.
  const covers = useRef(new Map<string, View>())
  return (
    <Shelf testID="home-recents" contentStyle={styles.recents}>
      {rooms.map(room => (
        <PastRoomTile key={`room-${room.code}`} room={room} size={size} />
      ))}
      {recents.map((recent, index) => {
        if (recent.kind === 'song') {
          const song = recent.song
          return (
            <SongCard
              key={`song-${song.id}`}
              song={song}
              size={size}
              testID={`home-recent-${index}`}
              // The row's songs from this one, as Recently played: no list of their own.
              onPress={() =>
                player.playFrom(songIds, songIds.indexOf(song.id), { source: RECENTS_SOURCE })
              }
            />
          )
        }
        const { entry } = recent
        const line = describeSource(entry.source, known)
        return (
          <ShelfCard
            key={entry.key}
            width={size}
            testID={`home-recent-${index}`}
            onPress={() => {
              // A list opens, as any list's tile does; playing it is its page's Play.
              if (line.link) {
                router.push(line.link)
                return
              }
              if (entry.source.kind === 'answer' && entry.answer) {
                const id = keepAnswer(entry.source.text, entry.answer)
                reorderAnswer(id, entry.songIds)
                router.push({ pathname: '/answer', params: { id } })
                return
              }
              // Songs that are no place of their own (similar ones, ones you
              // picked): there is no page to open, so they play.
              if (!library) return
              const ids = recentSongIds(entry, library)
              if (ids.length === 0) return
              fly(covers.current.get(entry.key) ?? null, ids)
              player.playFrom(ids, 0, { source: entry.source, whole: true })
            }}
            label={line.link || entry.answer ? `Open ${line.label}` : `Play ${line.label}`}
            cover={
              <View
                collapsable={false}
                ref={node => {
                  if (node) covers.current.set(entry.key, node)
                  else covers.current.delete(entry.key)
                }}
              >
                <PlaylistCover songIds={entry.songIds} size={size} />
                {line.asked ? (
                  <View style={styles.recentBadge}>
                    <Sparkle size={iconSize.tiny} />
                  </View>
                ) : null}
              </View>
            }
            title={line.label}
            lines={[recentKind(entry.source)]}
          />
        )
      })}
    </Shelf>
  )
}

/**
 * A room listened in together, once it ended (docs/features/listen-together.md,
 * mock R11): who was there, as their faces, big in the middle of the covers of
 * what played. Opens the room's page, to save it or get a friend's song.
 */
function PastRoomTile({ room, size }: { room: PastRoom; size: number }): ReactNode {
  const router = useRouter()
  const faces = pastRoomFaces(room)
  // The songs that played behind them, as a playlist's cover is made.
  const pictures = usePastRoomCovers(room)
  const covers = room.songs.map((entry, at) => ({
    uri: pictures[at],
    title: entry.song.album || entry.song.title,
  }))
  return (
    <ShelfCard
      width={size}
      testID={`home-recent-room-${room.code}`}
      onPress={() => router.push({ pathname: '/past-room/[code]', params: { code: room.code } })}
      label={`Open ${room.title}`}
      cover={<FacesCover people={faces} size={size} covers={covers} />}
      title={room.title}
      lines={[`Together · ${plural(room.songs.length, 'song', 'songs')}`]}
    />
  )
}

/** A computer's Recently played tile, the gap after it, and the fewest the row asks for. */
const RECENT_TILE = 132
const RECENT_GAP = 10
const RECENTS_LEAST = 12

const styles = StyleSheet.create(theme => ({
  stack: { gap: space.snug },
  recentsWaiting: { flexDirection: 'row', gap: RECENT_GAP, overflow: 'hidden' },
  recentWaiting: { gap: space.sm },
  recents: { paddingRight: 20 },
  recentBadge: {
    position: 'absolute',
    left: 6,
    bottom: 6,
    width: 22,
    height: 22,
    borderRadius: radius.pill,
    backgroundColor: theme.colors.surface0,
    alignItems: 'center',
    justifyContent: 'center',
  },
}))
