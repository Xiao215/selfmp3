import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useQueryClient } from '@tanstack/react-query'
import {
  formatLongDuration,
  formatRoomCode,
  plural,
  RoomCodeSchema,
  RoomMemberNameSchema,
  type Song,
} from '@selfmp3/shared'
import { iconSize, queryKeys, space, useCreatePlaylist, yoursOf } from '@selfmp3/client'
import { useConnection } from '../../connection/ConnectionProvider'
import { prefs } from '../../ports/prefs'
import { label, pageFrame, pageTitle, lineSub } from '../../ui/surfaces'
import { showFailure, showToast } from '../../ui/toast'
import { BackButton } from '../../ui/components/BackButton'
import { MissingPage } from '../../ui/components/MissingPage'
import { EmptyState } from '../../ui/components/EmptyState'
import { openRoomSheet } from './roomSheets.store'
import { TextField } from '../../ui/components/TextField'
import { Button } from '../../ui/components/Button'
import { SafeAreaView } from '../../ui/components/SafeAreaView'
import { useCloudSession } from '../profile/useCloudSession'
import { nameToJoinWith } from '../shared/shared.model'
import { newPlaylist } from '../playlists/playlists.model'
import { forgetPastRoom, pastRoomFaces, usePastRooms } from './pastRooms.store'
import { usePastRoomCovers } from './usePastRoomCovers'
import { FacesCover } from './RoomFace'
import { GetIt } from './GetIt'
import { BadRoomCode } from './BadRoomCode'
import { RoomEntryLine } from './RoomEntryLine'
import { RoomHead, RoomList } from './RoomList'
import { sayRoomFailure } from './roomFailure'
import { useGetSongs } from './useGetSongs'
import { joinRoom, leaveRoom, useRoom } from './room.store'
import { GUEST_NAME_KEY } from './room.model'
import { ScrollView } from '../../ui/components/Scroll'
import { useArt } from '../../offline/useArt'
import { usePlayerCommands } from '../../player/PlayerProvider'
import { useLayoutFlags } from '../../shell/useLayout'
import { ChromeSpacer } from '../../shell/ChromeSpacer'
import { useFootInset } from '../../shell/bottomInset'
import { ListHead, listHeadText } from '../../ui/components/ListHead'
import { Download, ListMusic, People, Trash } from '../../ui/components/Icons'
import { MoreMenu } from '../../ui/components/MoreMenu'
import { PlayShuffle } from '../../ui/components/PlayShuffle'
import { useListActions } from '../../ui/components/useListActions'
import { useLibraryIndex, useSongsById } from '../../ui/songsById'
import { useSongColor } from '../../ui/useSongColor'
import type { ListSource } from '../lists/lists.model'
import { useFlyToUpNext } from '../queue/useFlyToUpNext'

// --- Join -------------------------------------------------------------------------

/**
 * `/join/<code>`: where an invite link lands (docs/features/listen-together.md,
 * mock R3). Signed in, you join as yourself and can bring your own songs;
 * otherwise a name is all it asks.
 */
export function JoinScreen(): ReactNode {
  const router = useRouter()
  const { code: given } = useLocalSearchParams<{ code: string }>()
  const code = RoomCodeSchema.safeParse(given ?? '')
  const { status } = useConnection()
  const { data: me } = useCloudSession()
  const room = useRoom()
  const signedIn = status === 'ready' && me !== null && me !== undefined
  // What you typed, or else the name you joined with last, or your own.
  const [typed, setName] = useState<string | null>(null)
  const suggested = prefs.get(GUEST_NAME_KEY) ?? (me ? nameToJoinWith(me) : '')
  const name = typed ?? suggested
  const [busy, setBusy] = useState(false)

  // Already in this room: straight to it.
  const already = code.success && room.pass?.code === code.data
  useEffect(() => {
    if (already) router.replace('/room')
  }, [already, router])

  const join = async (): Promise<void> => {
    if (!code.success || !name.trim()) return
    setBusy(true)
    try {
      // One room at a time: the one you are in hears you leave first.
      if (room.pass && room.pass.code !== code.data) await leaveRoom()
      await joinRoom(code.data, name.trim().slice(0, 40))
      if (!signedIn) prefs.set(GUEST_NAME_KEY, name.trim())
      router.replace('/room')
    } catch (error) {
      sayRoomFailure(error)
    } finally {
      setBusy(false)
    }
  }

  if (!code.success) {
    // A guest in a browser has nowhere in the app to go back to.
    return <BadRoomCode key={given} given={given ?? ''} back={status === 'ready'} />
  }

  // Connected to a library (cloud or a server address) there is somewhere to go back to,
  // and this page has no sidebar to go there by.
  const connected = status === 'ready'
  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      {connected ? (
        <View style={styles.joinBack}>
          <BackButton to="/" always testID="room-join-back" />
        </View>
      ) : null}
      <View style={styles.centre} testID="room-join">
        <Text style={styles.label}>Room {formatRoomCode(code.data)}</Text>
        <Text style={styles.big} accessibilityRole="header">
          Join the room
        </Text>
        <Text style={styles.text}>
          {signedIn
            ? 'You join as yourself, and can bring songs from your own library.'
            : connected
              ? 'You join with a name and can add songs that are in the room. Bringing your own needs a self.mp3 sign-in.'
              : 'No app or account needed. You can add songs that are in the room, or a link.'}
        </Text>
        {room.pass && !already ? (
          <Text style={styles.text}>Joining leaves the room you are in now.</Text>
        ) : null}
        <TextField
          value={name}
          onChangeText={setName}
          onSubmitEditing={() => void join()}
          placeholder="Your name"
          limit={RoomMemberNameSchema}
          autoFocus={!name}
          testID="room-join-name"
        />
        <Button
          label="Join"
          variant="primary"
          busy={busy}
          disabled={!name.trim()}
          onPress={() => void join()}
          testID="room-join-go"
        />
        {status === 'missing' ? (
          <Text style={styles.text}>
            Have self.mp3?{' '}
            <Text style={styles.link} onPress={() => router.push('/welcome')}>
              Sign in
            </Text>{' '}
            to bring your own songs.
          </Text>
        ) : null}
      </View>
    </SafeAreaView>
  )
}

// --- The room -----------------------------------------------------------------------

/**
 * `/room`: the room on a page of its own (mock R4, R5): all a friend in a
 * browser sees, and where anyone lands after joining.
 */
export function RoomScreen(): ReactNode {
  const { state, link } = useRoom()
  const { status } = useConnection()
  const { wide } = useLayoutFlags()
  // The room owns the display, so this is the home indicator's room on a phone.
  const foot = useFootInset()
  if (!state) {
    // Not in one: what a room is for, and the way into a friend's (L1).
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <View style={[styles.page, pageFrame(wide)]}>
          {status === 'ready' ? <BackButton to="/" /> : null}
          <EmptyState
            icon={<People size={iconSize.large} tone="textMuted" />}
            title="Listen together"
            line="Start a room from the player, or join a friend’s."
            testID="room-none"
          >
            {status === 'ready' ? (
              <Button
                label="Join with a code"
                active
                onPress={() => openRoomSheet()}
                testID="room-none-join"
              />
            ) : null}
          </EmptyState>
        </View>
      </SafeAreaView>
    )
  }
  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView
        contentContainerStyle={[styles.page, pageFrame(wide), { paddingBottom: space.xl + foot }]}
        testID="room-screen"
      >
        {status === 'ready' ? <BackButton to="/" /> : null}
        <RoomHead state={state} link={link} />
        <RoomList head={false} />
      </ScrollView>
    </SafeAreaView>
  )
}

// --- After ------------------------------------------------------------------------

/**
 * `/past-room/<code>`: a room that ended, from Recently played (mock R12), as
 * a list's page like any other — a tag's, a playlist's, an answer's (Xiao,
 * 2026-10-13: A1 B1 C1 D1). The head is lit by its covers, with its people's
 * faces big on them (`FacesCover`), Play and Shuffle, and the ⋯ every list
 * has. Nothing asks you to keep it: played, Up next is the room by its name
 * and Save is there, and Save as playlist is in the ⋯ for a room you already
 * want again.
 *
 * Every song that played stays in the order it played, with the face of
 * whoever brought it on its cover's corner and nothing more said. Yours play.
 * A friend's you do not have is faded, since the room that lent it has gone,
 * and has Get it (G1): your own server imports it from the link it came from,
 * its row following the import as Import's own do (`GetIt`).
 */
export function PastRoomScreen(): ReactNode {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { wide } = useLayoutFlags()
  const { code } = useLocalSearchParams<{ code: string }>()
  const past = usePastRooms().find(room => room.code === code)
  const index = useLibraryIndex()
  const byId = useSongsById()
  const covers = usePastRoomCovers(past)
  const artFor = useArt()
  const player = usePlayerCommands()
  const fly = useFlyToUpNext()
  const heroRef = useRef<View>(null)
  const { mutateAsync: createPlaylist } = useCreatePlaylist()
  const [saving, setSaving] = useState(false)

  // Each song's copy in your library, in the room's order.
  const yours = useMemo(
    () => (past?.songs ?? []).map(entry => yoursOf(entry.song, index)),
    [past, index],
  )
  // Yours, once each, in the order they played: what Play plays and Save keeps.
  const ids = useMemo(() => [...new Set(yours.filter((id): id is number => id !== null))], [yours])
  const gettable = (past?.songs ?? []).filter(
    (entry, at) => yours[at] === null && entry.song.sourceUrl !== null,
  )
  const { getting, get, jobFor, retry } = useGetSongs({ watch: gettable.length > 0 })
  const listActions = useListActions(ids, { heroRef })
  const lead = useMemo(
    () => ids.map(id => byId.get(id)).find((song): song is Song => song?.hasArt === true) ?? null,
    [ids, byId],
  )
  const light = useSongColor(lead, lead ? artFor(lead) : null)

  if (!past) {
    return (
      <MissingPage
        title="That room is no longer kept"
        line="Recently played keeps the last few rooms you were in."
        back="/"
      />
    )
  }

  const source: ListSource = { kind: 'room', code: past.code, name: past.title }
  const play = (id: number): void => {
    const at = Math.max(0, ids.indexOf(id))
    fly(heroRef.current, ids.slice(at))
    player.playFrom(ids, at, { source })
  }
  const seconds = past.songs.reduce((sum, entry) => sum + entry.song.duration, 0)
  const waiting = gettable.filter(
    entry => !getting.has(entry.song.sourceUrl ?? '') && !jobFor(entry.song.sourceUrl),
  )

  const save = async (): Promise<void> => {
    const input = newPlaylist('manual', past.title)
    if (!input || ids.length === 0 || saving) return
    setSaving(true)
    try {
      const created = await createPlaylist({ input, songIds: ids, refresh: 'wait' })
      void queryClient.invalidateQueries({ queryKey: queryKeys.library })
      showToast(`Saved “${created.name}”`, 'good', {
        actions: [
          {
            label: 'Open',
            onPress: () =>
              router.navigate({ pathname: '/playlists/[id]', params: { id: String(created.id) } }),
          },
        ],
      })
    } catch (error) {
      showFailure('Couldn’t save it', error)
    } finally {
      setSaving(false)
    }
  }

  const head = (
    <ListHead
      wide={wide}
      light={light.color}
      art={null}
      topBar={
        <>
          <BackButton to="/" always />
          <MoreMenu
            name={past.title}
            title={past.title}
            testID="past-room-more"
            menuTestID="past-room-menu"
            items={[
              ...listActions,
              {
                key: 'save',
                label: saving ? 'Saving…' : 'Save as playlist',
                icon: <ListMusic tone="textSecondary" />,
                disabled: ids.length === 0 || saving,
                apart: true,
                testID: 'past-room-save',
                onPress: () => void save(),
              },
              ...(waiting.length > 0
                ? [
                    {
                      key: 'get-all',
                      label: `Get ${plural(waiting.length, 'song', 'songs')} from friends`,
                      icon: <Download tone="textSecondary" />,
                      testID: 'past-room-get-all',
                      onPress: () => void get(waiting.map(entry => entry.song)),
                    },
                  ]
                : []),
              {
                key: 'forget',
                label: 'Forget this room',
                icon: <Trash tone="textSecondary" />,
                apart: true,
                testID: 'past-room-forget',
                onPress: () => {
                  forgetPastRoom(past.code)
                  router.replace('/')
                },
              },
            ]}
          />
        </>
      }
      heroRef={heroRef}
      cover={
        <FacesCover
          people={pastRoomFaces(past)}
          size={wide ? 176 : 196}
          covers={past.songs.map((entry, at) => ({
            uri: covers[at],
            title: entry.song.album || entry.song.title,
          }))}
        />
      }
      titles={
        <>
          <View style={listHeadText.kind}>
            <People size={iconSize.tiny} />
            <Text style={listHeadText.kindText}>
              Together ·{' '}
              {new Date(past.endedAt).toLocaleDateString(undefined, {
                weekday: 'long',
                month: 'short',
                day: 'numeric',
              })}
            </Text>
          </View>
          <Text style={listHeadText.name} numberOfLines={2} accessibilityRole="header">
            {past.title}
          </Text>
          <Text style={listHeadText.summary}>
            {plural(past.songs.length, 'song', 'songs')}
            {seconds > 0 ? ` · ${formatLongDuration(seconds)}` : ''}
          </Text>
        </>
      }
      actions={
        <>
          <PlayShuffle
            name={past.title}
            songIds={ids}
            empty={false}
            heroRef={heroRef}
            onPlay={() => player.playFrom(ids, 0, { source, whole: true })}
            onShuffle={() => player.playShuffled(ids, source)}
            testPrefix="past-room"
          />
          {past.shared ? (
            <Button
              label="Shared playlist"
              onPress={() =>
                router.push({ pathname: '/shared/[id]', params: { id: past.shared ?? '' } })
              }
              testID="past-room-shared"
            />
          ) : null}
        </>
      }
    />
  )

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.pastList} testID="past-room">
        {head}
        <View style={[styles.rows, wide && styles.rowsWide]}>
          {past.songs.map((entry, at) => {
            const id = yours[at] ?? null
            const sourceUrl = entry.song.sourceUrl
            return (
              <RoomEntryLine
                key={`${at}-${entry.song.title}`}
                song={entry.song}
                uri={covers[at]}
                face={{ name: entry.by, colour: entry.colour, picture: entry.picture }}
                // The room that lent a friend's song has gone: it can only be got.
                faded={id === null}
                onPress={id !== null ? () => play(id) : undefined}
                testID={`past-room-row-${at}`}
                trailing={
                  id === null && sourceUrl ? (
                    <GetIt
                      title={entry.song.title}
                      asked={getting.has(sourceUrl)}
                      job={jobFor(sourceUrl)}
                      onGet={() => void get([entry.song])}
                      onRetry={job => void retry(job)}
                      testID={`past-room-get-${at}`}
                    />
                  ) : null
                }
              />
            )
          })}
        </View>
        <ChromeSpacer />
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  screen: { flex: 1, backgroundColor: theme.colors.surface0 },
  joinBack: { paddingHorizontal: space.gutter },
  centre: {
    flex: 1,
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
    justifyContent: 'center',
    gap: space.md,
    padding: space.xl,
  },
  page: { width: '100%', maxWidth: 640, alignSelf: 'center', gap: space.lg },
  big: pageTitle(theme.colors),
  label: label(theme.colors),
  text: lineSub(theme.colors),
  link: { color: theme.colors.textPrimary, fontWeight: '600', textDecorationLine: 'underline' },
  pastList: { paddingBottom: space.xl },
  rows: { paddingHorizontal: space.gutter, gap: space.sm },
  rowsWide: { paddingHorizontal: space.gutterWide },
}))
