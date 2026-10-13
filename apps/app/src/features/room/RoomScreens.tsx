import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Text, TextInput, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useQueryClient } from '@tanstack/react-query'
import { artistOr, formatRoomCode, plural, RoomCodeSchema, type RoomSong } from '@selfmp3/shared'
import {
  failureText,
  libraryIndex,
  queryKeys,
  radius,
  space,
  type,
  useCreatePlaylist,
  useLibrary,
  yoursOf,
} from '@selfmp3/client'
import { apiFor } from '../../api/client'
import { useConnection } from '../../connection/ConnectionProvider'
import { useServerDirect } from '../../connection/useServerDirect'
import { prefs } from '../../ports/prefs'
import { useAccent } from '../../ui/accent'
import { label, serif } from '../../ui/surfaces'
import { showToast } from '../../ui/toast'
import { BackButton } from '../../ui/components/BackButton'
import { Button } from '../../ui/components/Button'
import { Cover } from '../../ui/components/Cover'
import { SafeAreaView } from '../../ui/components/SafeAreaView'
import { useCloudSession } from '../profile/useCloudSession'
import { newPlaylist } from '../playlists/playlists.model'
import { forgetPastRoom, usePastRooms } from './pastRooms.store'
import { RoomFace, RoomFaces } from './RoomFace'
import { RoomHead, RoomList } from './RoomList'
import { sayRoomFailure } from './roomFailure'
import { joinRoom, leaveRoom, useRoom } from './room.store'
import { ScrollView } from '../../ui/components/Scroll'

/** The name a guest last joined with, offered again. */
const GUEST_NAME_KEY = 'room.name'

// --- Join -------------------------------------------------------------------------

/**
 * `/join/<code>`: where an invite link lands (docs/features/listen-together.md,
 * mock R3). Signed in, you join as yourself and can bring your own songs;
 * otherwise a name is all it asks.
 */
export function JoinScreen(): ReactNode {
  const { theme } = useUnistyles()
  const accent = useAccent()
  const router = useRouter()
  const { code: given } = useLocalSearchParams<{ code: string }>()
  const code = RoomCodeSchema.safeParse(given ?? '')
  const { status } = useConnection()
  const { data: me } = useCloudSession()
  const room = useRoom()
  const signedIn = status === 'ready' && me !== null && me !== undefined
  // What you typed, or else the name you joined with last, or your own.
  const [typed, setName] = useState<string | null>(null)
  const suggested =
    prefs.get(GUEST_NAME_KEY) ?? (me ? ((me.name ?? me.email).trim().split(/\s+/)[0] ?? '') : '')
  const name = typed ?? suggested
  const [busy, setBusy] = useState(false)
  const [focused, setFocused] = useState(false)

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
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <View style={styles.centre}>
          <Text style={styles.big} accessibilityRole="header">
            That is not a room code
          </Text>
          <Text style={styles.text}>A code is six letters and digits, like KQ7 482.</Text>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.centre} testID="room-join">
        <Text style={styles.label}>Room {formatRoomCode(code.data)}</Text>
        <Text style={styles.big} accessibilityRole="header">
          Join the room
        </Text>
        <Text style={styles.text}>
          {signedIn
            ? 'You join as yourself, and can bring songs from your own library.'
            : 'No app or account needed. You can add songs that are in the room, or a link.'}
        </Text>
        {room.pass && !already ? (
          <Text style={styles.text}>Joining leaves the room you are in now.</Text>
        ) : null}
        <View style={[styles.field, focused && { borderColor: accent.accent }]}>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            onSubmitEditing={() => void join()}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder="Your name"
            placeholderTextColor={theme.colors.textMuted}
            accessibilityLabel="Your name"
            maxLength={40}
            autoFocus={!name}
            testID="room-join-name"
          />
        </View>
        <Button
          label="Join"
          variant="primary"
          busy={busy}
          disabled={!name.trim()}
          onPress={() => void join()}
          testID="room-join-go"
        />
        {!signedIn && status !== 'loading' ? (
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
  const router = useRouter()
  const { state, link } = useRoom()
  const { status } = useConnection()
  if (!state) {
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <View style={styles.centre}>
          <Text style={styles.big} accessibilityRole="header">
            You are not in a room
          </Text>
          <Text style={styles.text}>
            A room is Up next, shared: open one from Together in Up next, or join with a friend’s
            code.
          </Text>
          {status === 'ready' ? <Button label="Home" onPress={() => router.replace('/')} /> : null}
        </View>
      </SafeAreaView>
    )
  }
  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView contentContainerStyle={styles.page} testID="room-screen">
        {status === 'ready' ? <BackButton to="/" /> : null}
        <RoomHead state={state} link={link} />
        <RoomList head={false} />
      </ScrollView>
    </SafeAreaView>
  )
}

// --- After ------------------------------------------------------------------------

/**
 * `/past-room/<code>`: a room that ended, from Recently played (mock R12):
 * every song that played and who brought it. Save keeps the songs that are
 * yours as a playlist; Get it brings a friend's song home, imported by your
 * own server from the link it came from (G1).
 */
export function PastRoomScreen(): ReactNode {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { code } = useLocalSearchParams<{ code: string }>()
  const past = usePastRooms().find(room => room.code === code)
  const { data: library } = useLibrary()
  const index = useMemo(() => libraryIndex(library?.songs ?? []), [library?.songs])
  const server = useServerDirect()
  const { mutateAsync: createPlaylist } = useCreatePlaylist()
  const [getting, setGetting] = useState<ReadonlySet<string>>(new Set())
  const [saving, setSaving] = useState(false)

  if (!past) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <View style={styles.centre}>
          <BackButton to="/" />
          <Text style={styles.big}>That room is no longer kept</Text>
        </View>
      </SafeAreaView>
    )
  }

  const yours = past.songs.map(entry => yoursOf(entry.song, index))
  const yourIds = [...new Set(yours.filter((id): id is number => id !== null))]
  const gettable = past.songs.filter(
    (entry, at) => yours[at] === null && entry.song.sourceUrl !== null,
  )

  const get = async (songs: readonly RoomSong[]): Promise<void> => {
    if (server.state !== 'reachable') {
      showToast('Get it needs your library’s computer, and it can’t be reached from here', 'warn')
      return
    }
    const keys = songs.map(song => song.sourceUrl ?? '')
    setGetting(before => new Set([...before, ...keys]))
    try {
      await apiFor(server.connection).importEnqueue({
        items: songs.flatMap(song =>
          song.sourceUrl
            ? [
                {
                  url: song.sourceUrl,
                  title: song.title,
                  artist: song.artist,
                  album: song.album,
                  thumbnail: null,
                  duration: song.duration,
                },
              ]
            : [],
        ),
        tagIds: [],
        playlistId: null,
        createPlaylistName: null,
      })
      showToast(
        `Getting ${plural(songs.length, 'song', 'songs')}. They arrive in your library as they import.`,
        'good',
      )
    } catch (error) {
      setGetting(before => new Set([...before].filter(key => !keys.includes(key))))
      showToast(failureText('Couldn’t get that', error), 'error')
    }
  }

  const save = async (): Promise<void> => {
    const input = newPlaylist('manual', past.title)
    if (!input || yourIds.length === 0) return
    setSaving(true)
    try {
      const created = await createPlaylist({ input, songIds: yourIds, refresh: 'wait' })
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
      showToast(failureText('Couldn’t save it', error), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView contentContainerStyle={styles.page} testID="past-room">
        <BackButton to="/" />
        <View style={styles.pastHead}>
          <Text style={styles.big} accessibilityRole="header">
            {past.title}
          </Text>
          <View style={styles.people}>
            <RoomFaces people={past.people} size={22} />
            <Text style={styles.text}>
              {new Date(past.endedAt).toLocaleDateString(undefined, {
                weekday: 'long',
                month: 'short',
                day: 'numeric',
              })}{' '}
              · {plural(past.songs.length, 'song', 'songs')}
            </Text>
          </View>
        </View>
        <View style={styles.actions}>
          {past.shared ? (
            <Button
              label="Open the shared playlist"
              variant="primary"
              onPress={() =>
                router.push({ pathname: '/shared/[id]', params: { id: past.shared ?? '' } })
              }
              testID="past-room-shared"
            />
          ) : null}
          <Button
            label={`Save ${plural(yourIds.length, 'song', 'songs')} as a playlist`}
            variant={past.shared ? 'secondary' : 'primary'}
            busy={saving}
            disabled={yourIds.length === 0}
            onPress={() => void save()}
            testID="past-room-save"
          />
          {gettable.length > 0 ? (
            <Button
              label={`Get all ${gettable.length}`}
              onPress={() => void get(gettable.map(entry => entry.song))}
              testID="past-room-get-all"
            />
          ) : null}
          <Button
            label="Forget it"
            variant="text"
            onPress={() => {
              forgetPastRoom(past.code)
              router.replace('/')
            }}
          />
        </View>
        <Text style={styles.text}>
          Save keeps the songs that are yours. Get it imports a friend’s song from the link it came
          from, into your own library.
        </Text>
        {past.songs.map((entry, at) => {
          const mine = yours[at] !== null
          const source = entry.song.sourceUrl
          return (
            <View key={`${at}-${entry.song.title}`} style={styles.row}>
              <View>
                <Cover uri={entry.song.artwork} title={entry.song.title} size={44} />
                <View style={styles.badge}>
                  <RoomFace name={entry.by} colour={entry.colour} size={20} ring />
                </View>
              </View>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {entry.song.title}
                </Text>
                <Text style={styles.text} numberOfLines={1}>
                  {artistOr(entry.song.artist)} · {entry.by}
                  {mine ? ' · yours' : ''}
                </Text>
              </View>
              {mine ? null : source ? (
                getting.has(source) ? (
                  <Text style={styles.text}>Getting…</Text>
                ) : (
                  <Button label="Get it" onPress={() => void get([entry.song])} />
                )
              ) : (
                <Text style={styles.text}>{entry.by}’s only</Text>
              )}
            </View>
          )
        })}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create(theme => ({
  screen: { flex: 1, backgroundColor: theme.colors.surface0 },
  centre: {
    flex: 1,
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
    justifyContent: 'center',
    gap: space.md,
    padding: space.xl,
  },
  page: {
    width: '100%',
    maxWidth: 640,
    alignSelf: 'center',
    gap: space.lg,
    padding: space.gutter,
    paddingBottom: 120,
  },
  big: { ...serif(theme.colors, type.page) },
  label: label(theme.colors),
  text: { color: theme.colors.textSecondary, fontSize: type.sub, lineHeight: 18 },
  link: { color: theme.colors.textPrimary, fontWeight: '600', textDecorationLine: 'underline' },
  field: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: space.md,
    borderRadius: radius.field,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1.5,
    borderColor: theme.colors.surface2,
  },
  input: { color: theme.colors.textPrimary, fontSize: type.title, minHeight: 28 },
  pastHead: { gap: space.sm },
  people: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 60 },
  badge: { position: 'absolute', right: -5, bottom: -5 },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  rowTitle: { color: theme.colors.textPrimary, fontSize: type.body, fontWeight: '600' },
}))
