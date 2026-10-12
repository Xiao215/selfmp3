import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useLocalSearchParams, useRouter } from 'expo-router'
import {
  artistOr,
  plural,
  SharedIdSchema,
  SharedInviteSchema,
  type SharedSummary,
} from '@selfmp3/shared'
import { libraryIndex, radius, sharedInviteLink, space, type, useLibrary } from '@selfmp3/client'
import { useConnection } from '../../connection/ConnectionProvider'
import { ROW_COVER_SIZE } from '../../offline/coverStore'
import { useArt } from '../../offline/useArt'
import { usePlayerCommands } from '../../player/PlayerProvider'
import { roomTrack, setTrackSource } from '../../player/roomTracks'
import { prefs } from '../../ports/prefs'
import { appAddress, shareLink } from '../../ports/shareLink'
import { useAccent } from '../../ui/accent'
import { label, serif } from '../../ui/surfaces'
import { showToast } from '../../ui/toast'
import { BackButton } from '../../ui/components/BackButton'
import { Button } from '../../ui/components/Button'
import { ConfirmDialog } from '../../ui/components/ConfirmDialog'
import { Cover } from '../../ui/components/Cover'
import { People, Play, Plus, X } from '../../ui/components/Icons'
import { SafeAreaView } from '../../ui/components/SafeAreaView'
import { Sheet, SheetItem } from '../../ui/components/Sheet'
import { useCloudSession } from '../profile/useCloudSession'
import { openQueueSheet } from '../queue/queueSheet.store'
import { RoomFace, RoomFaces } from '../room/RoomFace'
import { RoomQr } from '../room/RoomQr'
import { MyLibraryPicker } from '../room/RoomSheets'
import { sayRoomFailure } from '../room/roomFailure'
import { currentRoom, startRoom, useRoom } from '../room/room.store'
import { isHost } from '../room/room.model'
import { nameToJoinWith, sharedLine, sharedRows, sharedTracks } from './shared.model'
import {
  sharedApi,
  sharedSession,
  useSharedAct,
  useSharedChanged,
  useSharedPlaylist,
} from './sharedPlaylists'

/** An invite opened before signing in, opened again once signed in (`useResumeSharedJoin`). */
const PENDING_JOIN_KEY = 'shared.join'

// --- A shared playlist ------------------------------------------------------------

/**
 * `/shared/<id>`: a shared playlist (mock R13). Its people as faces, its songs
 * with who brought each; Play here, Play together (a room filled with it),
 * Add songs from your library, Invite, and Rename or Leave.
 */
export function SharedPlaylistScreen(): ReactNode {
  const { theme } = useUnistyles()
  const router = useRouter()
  const { id: given } = useLocalSearchParams<{ id: string }>()
  const id = SharedIdSchema.safeParse(given ?? '').success ? (given ?? null) : null
  const { data: playlist, isLoading, error } = useSharedPlaylist(id)
  const act = useSharedAct(id ?? '')
  const player = usePlayerCommands()
  const room = useRoom()
  const { data: me } = useCloudSession()
  const artFor = useArt(ROW_COVER_SIZE)
  const { data: library } = useLibrary()
  const index = useMemo(() => libraryIndex(library?.songs ?? []), [library?.songs])
  const [sheet, setSheet] = useState<'add' | 'invite' | 'more' | null>(null)
  const [leaving, setLeaving] = useState(false)
  const [busy, setBusy] = useState(false)

  // Its songs as tracks, for their covers now and for playing them; kept
  // while anything plays them, so they are not taken from under the player.
  useEffect(() => {
    if (!playlist) return
    setTrackSource(
      `shared:${playlist.id}`,
      sharedTracks(playlist, (entryId, part) => sharedApi.fileUrl(playlist, entryId, part), index),
    )
  }, [playlist, index])

  if (!playlist) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <View style={styles.page}>
          <BackButton to="/playlists" />
          <Text style={styles.big}>
            {isLoading
              ? 'Loading…'
              : error
                ? 'This playlist is not one of yours'
                : 'No such playlist'}
          </Text>
        </View>
      </SafeAreaView>
    )
  }

  const rows = sharedRows(playlist)
  const ids = rows.map(row => row.trackId)
  const playHere = (start = 0): void => {
    if (ids.length > 0) player.playFrom(ids, start)
  }
  const playTogether = async (): Promise<void> => {
    setBusy(true)
    try {
      const already = currentRoom().state
      if (!already || !isHost(already)) {
        await startRoom({ name: nameToJoinWith(me), mode: 'speaker' })
      }
      const pass = currentRoom().pass
      if (!pass) return
      await sharedApi.fillRoom(pass, await sharedSession(), playlist.id)
      openQueueSheet()
      showToast(`“${playlist.name}” is in your room. Invite friends with its code.`, 'good')
    } catch (failure) {
      sayRoomFailure(failure)
    } finally {
      setBusy(false)
    }
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView contentContainerStyle={styles.page} testID="shared-playlist">
        <BackButton to="/playlists" />
        <View style={styles.head}>
          <Text style={styles.big} accessibilityRole="header" numberOfLines={3}>
            {playlist.name}
          </Text>
          <View style={styles.people}>
            <RoomFaces people={playlist.members} size={24} />
            <Text style={styles.text} numberOfLines={2}>
              {sharedLine(playlist, playlist.you)}
            </Text>
          </View>
        </View>
        <View style={styles.actions}>
          <Button
            label="Play"
            variant="primary"
            icon={<Play size={15} color={theme.colors.onPrimary} />}
            disabled={ids.length === 0}
            onPress={() => playHere()}
            testID="shared-play"
          />
          <Button
            label={room.state && isHost(room.state) ? 'Add to the room' : 'Play together'}
            icon={<People size={16} color={theme.colors.textPrimary} />}
            busy={busy}
            disabled={ids.length === 0}
            onPress={() => void playTogether()}
            testID="shared-together"
          />
          <Button
            label="Add songs"
            icon={<Plus size={15} color={theme.colors.textPrimary} />}
            onPress={() => setSheet('add')}
            testID="shared-add"
          />
          <Button label="Invite" onPress={() => setSheet('invite')} testID="shared-invite" />
          <Button
            label="More"
            variant="text"
            onPress={() => setSheet('more')}
            testID="shared-more"
          />
        </View>
        {rows.length === 0 ? (
          <Text style={styles.text}>
            Nothing in it yet. Add songs of yours; whoever you invite adds theirs.
          </Text>
        ) : null}
        {rows.map((row, at) => {
          const song = roomTrack(row.trackId)?.song
          return (
            <Pressable
              key={row.entry.id}
              onPress={() => playHere(at)}
              accessibilityRole="button"
              accessibilityLabel={`Play ${row.entry.song.title}`}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              testID={`shared-row-${row.entry.id}`}
            >
              <View>
                <Cover uri={song ? artFor(song) : null} title={row.entry.song.title} size={44} />
                {row.owner ? (
                  <View style={styles.badge}>
                    <RoomFace name={row.owner.name} colour={row.owner.colour} size={20} ring />
                  </View>
                ) : null}
              </View>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {row.entry.song.title}
                </Text>
                <Text style={styles.text} numberOfLines={1}>
                  {artistOr(row.entry.song.artist)} ·{' '}
                  {row.owner?.id === playlist.you ? 'You' : (row.owner?.name ?? 'Someone')}
                </Text>
              </View>
              {row.removable ? (
                <Pressable
                  onPress={() =>
                    void act({ type: 'remove', entryId: row.entry.id }).catch(sayRoomFailure)
                  }
                  accessibilityRole="button"
                  accessibilityLabel={`Take ${row.entry.song.title} out`}
                  hitSlop={6}
                  style={({ pressed }) => [styles.small, pressed && styles.pressed]}
                >
                  <X size={16} color={theme.colors.textSecondary} />
                </Pressable>
              ) : null}
            </Pressable>
          )
        })}
      </ScrollView>

      <Sheet
        open={sheet === 'add'}
        onClose={() => setSheet(null)}
        title={`Add to ${playlist.name}`}
        width={480}
      >
        <MyLibraryPicker
          onAdd={song =>
            act({ type: 'add', song }).then(
              () => true,
              (failure: unknown) => {
                sayRoomFailure(failure)
                return false
              },
            )
          }
        />
      </Sheet>
      <Sheet
        open={sheet === 'invite'}
        onClose={() => setSheet(null)}
        title="Invite to this playlist"
        subtitle="Anyone with the link who signs in can add their songs."
        width={420}
      >
        <SharedInvite id={playlist.id} invite={playlist.invite} name={playlist.name} />
      </Sheet>
      <Sheet open={sheet === 'more'} onClose={() => setSheet(null)} title={playlist.name}>
        {playlist.members.find(member => member.id === playlist.you)?.creator ? (
          <Rename
            name={playlist.name}
            onRename={name => {
              setSheet(null)
              void act({ type: 'rename', name }).catch(sayRoomFailure)
            }}
          />
        ) : null}
        <SheetItem
          label="Leave this playlist"
          detail="Your songs leave with you"
          danger
          onPress={() => {
            setSheet(null)
            setLeaving(true)
          }}
        />
      </Sheet>
      <ConfirmDialog
        open={leaving}
        title="Leave this playlist?"
        body="Your songs leave it with you, and it leaves your Playlists."
        confirmLabel="Leave"
        danger
        onConfirm={() => {
          setLeaving(false)
          void act({ type: 'leave' }).then(() => router.replace('/playlists'), sayRoomFailure)
        }}
        onCancel={() => setLeaving(false)}
      />
    </SafeAreaView>
  )
}

function SharedInvite({
  id,
  invite,
  name,
}: {
  id: string
  invite: string
  name: string
}): ReactNode {
  const link = sharedInviteLink(appAddress(), { id, invite })
  return (
    <View style={styles.sheetBody}>
      <View style={styles.inviteCard}>
        <RoomQr text={link} size={132} />
        <Text style={styles.link} selectable numberOfLines={4}>
          {link}
        </Text>
      </View>
      <Button
        label="Share invite"
        variant="primary"
        onPress={() =>
          void shareLink(`Add your songs to “${name}”:`, link).then(how => {
            if (how === 'copied') showToast('Invite link copied', 'good')
          })
        }
        testID="shared-share"
      />
    </View>
  )
}

function Rename({ name, onRename }: { name: string; onRename: (name: string) => void }): ReactNode {
  const { theme } = useUnistyles()
  const [text, setText] = useState(name)
  return (
    <View style={styles.rename}>
      <View style={styles.field}>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          onSubmitEditing={() => text.trim() && onRename(text.trim())}
          placeholderTextColor={theme.colors.textMuted}
          accessibilityLabel="Playlist name"
          maxLength={120}
        />
      </View>
      <Button label="Rename" disabled={!text.trim()} onPress={() => onRename(text.trim())} />
    </View>
  )
}

// --- Joining ------------------------------------------------------------------------

/**
 * `/shared/<id>/join/<invite>`: where a shared playlist's invite lands. A
 * shared playlist is kept by accounts, so joining needs one; an invite opened
 * before signing in is opened again after (`useResumeSharedJoin`).
 */
export function SharedJoinScreen(): ReactNode {
  const router = useRouter()
  const params = useLocalSearchParams<{ id: string; invite: string }>()
  const id = SharedIdSchema.safeParse(params.id ?? '')
  const invite = SharedInviteSchema.safeParse(params.invite ?? '')
  const { status } = useConnection()
  const { data: me } = useCloudSession()
  const changed = useSharedChanged()
  const [busy, setBusy] = useState(false)
  const valid = id.success && invite.success

  const join = async (): Promise<void> => {
    if (!id.success || !invite.success) return
    setBusy(true)
    try {
      const joined = await sharedApi.join(
        await sharedSession(),
        id.data,
        invite.data,
        nameToJoinWith(me),
      )
      changed(joined)
      router.replace({ pathname: '/shared/[id]', params: { id: joined.id } })
    } catch (failure) {
      sayRoomFailure(failure)
    } finally {
      setBusy(false)
    }
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.centre} testID="shared-join">
        <Text style={styles.label}>A shared playlist</Text>
        <Text style={styles.big} accessibilityRole="header">
          {valid ? 'Join the playlist' : 'That link is not a playlist’s'}
        </Text>
        {valid && status === 'ready' ? (
          <>
            <Text style={styles.text}>
              You can add your own songs, and play everyone’s. It stays in your Playlists.
            </Text>
            <Button
              label="Join"
              variant="primary"
              busy={busy}
              onPress={() => void join()}
              testID="shared-join-go"
            />
          </>
        ) : valid && status === 'missing' ? (
          <>
            <Text style={styles.text}>
              A shared playlist is kept with your self.mp3 account. Sign in, and the invite opens
              again.
            </Text>
            <Button
              label="Sign in"
              variant="primary"
              onPress={() => {
                prefs.set(
                  PENDING_JOIN_KEY,
                  `/shared/${params.id ?? ''}/join/${params.invite ?? ''}`,
                )
                router.replace('/welcome')
              }}
            />
          </>
        ) : null}
      </View>
    </SafeAreaView>
  )
}

/** An invite opened before signing in, opened again once there is a library. Home calls it. */
export function useResumeSharedJoin(): void {
  const router = useRouter()
  const { status } = useConnection()
  useEffect(() => {
    if (status !== 'ready') return
    const pending = prefs.get(PENDING_JOIN_KEY)
    if (!pending || !/^\/shared\/[0-9a-f]{16}\/join\/[0-9a-f]{16}$/.test(pending)) return
    prefs.set(PENDING_JOIN_KEY, '')
    router.push(pending as never)
  }, [status, router])
}

// --- In Playlists -------------------------------------------------------------------

/** A shared playlist among your playlists: its people's faces for a cover. */
export function SharedTile({
  playlist,
  width,
}: {
  playlist: SharedSummary
  width: number | undefined
}): ReactNode {
  const router = useRouter()
  const accent = useAccent()
  return (
    <View style={[styles.tile, width ? { width } : null]}>
      <Pressable
        onPress={() => router.push({ pathname: '/shared/[id]', params: { id: playlist.id } })}
        accessibilityRole="button"
        accessibilityLabel={`Open ${playlist.name}, shared`}
        testID={`shared-tile-${playlist.id}`}
        style={({ pressed }) => pressed && styles.pressed}
      >
        <View style={[styles.tileCover, { backgroundColor: accent.accentPill }]}>
          <RoomFaces people={playlist.people.slice(0, 4)} size={30} />
        </View>
        <Text style={styles.tileName} numberOfLines={1}>
          {playlist.name}
        </Text>
        <Text style={styles.tileSub} numberOfLines={1}>
          Shared · {plural(playlist.songs, 'song', 'songs')}
        </Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  screen: { flex: 1, backgroundColor: theme.colors.surface0 },
  page: {
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    gap: space.md,
    padding: space.gutter,
    paddingBottom: 140,
  },
  centre: {
    flex: 1,
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
    justifyContent: 'center',
    gap: space.md,
    padding: space.xl,
  },
  head: { gap: space.sm },
  big: { ...serif(theme.colors, type.page) },
  label: label(theme.colors),
  text: { color: theme.colors.textSecondary, fontSize: type.sub, lineHeight: 18 },
  people: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 60 },
  pressed: { opacity: 0.7 },
  badge: { position: 'absolute', right: -5, bottom: -5 },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  rowTitle: { color: theme.colors.textPrimary, fontSize: type.body, fontWeight: '600' },
  small: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface2,
  },
  sheetBody: { gap: space.md, paddingBottom: space.sm },
  inviteCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
    padding: space.lg,
    borderRadius: radius.card,
    backgroundColor: theme.colors.surface2,
  },
  link: { flex: 1, minWidth: 0, color: theme.colors.textSecondary, fontSize: type.small },
  rename: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingBottom: space.md },
  field: {
    flex: 1,
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: space.md,
    borderRadius: radius.field,
    backgroundColor: theme.colors.surface3,
  },
  input: { color: theme.colors.textPrimary, fontSize: type.body, minHeight: 28 },
  tile: { width: '100%' },
  tileCover: {
    aspectRatio: 1,
    borderRadius: radius.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileName: {
    color: theme.colors.textPrimary,
    fontSize: type.body,
    fontWeight: '600',
    marginTop: space.sm,
  },
  tileSub: { color: theme.colors.textMuted, fontSize: type.small, marginTop: 1 },
}))
