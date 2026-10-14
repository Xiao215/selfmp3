import { createContext, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import Animated, { LayoutAnimationConfig } from 'react-native-reanimated'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { usePathname, useRouter, type Href } from 'expo-router'
import {
  artistOr,
  formatRoomCode,
  normalizeRoomCode,
  plural,
  RoomCodeSchema,
  type RoomRights,
  type RoomSong,
  type RoomState,
  type Song,
} from '@selfmp3/shared'
import { iconSize, radius, roomFace, space, type, useLibrary } from '@selfmp3/client'
import { usePlayer } from '../../player/PlayerProvider'
import { appAddress, shareLink } from '../../ports/shareLink'
import { library as cloudLibrary } from '../../replica'
import { label, lineSub } from '../../ui/surfaces'
import { SectionHead } from '../../ui/components/SectionHead'
import { showToast } from '../../ui/toast'
import { Button } from '../../ui/components/Button'
import { TextField } from '../../ui/components/TextField'
import { LibrarySongPicker, PickMark } from '../../ui/components/LibrarySongPicker'
import { SongLine } from '../../ui/components/SongLine'
import { ConfirmDialog } from '../../ui/components/ConfirmDialog'
import { Segmented } from '../../ui/components/Segmented'
import { Sheet } from '../../ui/components/Sheet'
import { Chip } from '../../ui/components/Chip'
import { Plus, ShareOut } from '../../ui/components/Icons'
import { useCloudSession } from '../profile/useCloudSession'
import { lookUpLink, playableLink } from './linkSong'
import { RoomFace } from './RoomFace'
import { RoomQr } from './RoomQr'
import {
  inviteLink,
  isHost,
  nameOf,
  namesOf,
  pastRoomOf,
  pastTitle,
  peopleHere,
  playedRows,
  roomTitle,
  startingSongs,
  youMay,
} from './room.model'
import { closeRoomSheet, useRoomSheet, useRoomStart } from './roomSheets.store'
import { ArrivalRing, useRoomMoves, type RoomMoves } from './roomMotion'
import { PlaylistCover } from '../playlists/PlaylistCover'
import { devicePlace } from '../settings/settings.model'
import { deviceKind } from '../../ports/device'
import { sayRoomFailure } from './roomFailure'
import {
  keptAsOf,
  leaveRoom,
  noteKeptAs,
  noteRoomOpened,
  roomAct,
  setRoomStartHint,
  startRoom,
  takeRoomOpened,
  useRoom,
} from './room.store'
import { sharedApi, sharedSession } from '../shared/sharedPlaylists'
import { ScrollView } from '../../ui/components/Scroll'
import { Press } from '../../ui/components/Press'

/**
 * How a sheet goes to a page: pushed, or — drawn inside the phone's Now
 * Playing, a native modal — by putting the modal down first (`leaveTo`),
 * since a page pushed from inside it lands out of sight under it.
 */
const RoomGo = createContext<((href: Href) => void) | null>(null)

function useGo(): (href: Href) => void {
  const router = useRouter()
  const go = useContext(RoomGo)
  return go ?? (href => router.push(href))
}

/**
 * A room's sheets (docs/features/listen-together.md): Together — opening a
 * room, or the room itself once you are in one — and adding songs. Drawn once by the shell, opened from wherever the room is shown, and
 * again inside the phone's Now Playing (with `go`), which covers the shell.
 */
export function RoomSheets({ go = null }: { go?: ((href: Href) => void) | null }): ReactNode {
  const open = useRoomSheet()
  const { state } = useRoom()
  return (
    <RoomGo.Provider value={go}>
      <TogetherSheet open={open === 'together'} state={state} />
      {state ? <AddSheet open={open === 'add'} state={state} /> : null}
    </RoomGo.Provider>
  )
}

// --- Together ----------------------------------------------------------------------

/**
 * Together, from the player's People button, Home or a list's ⋯: out of a
 * room, Start — what it starts with, where it plays, or a code to join; in
 * one, the room itself (E1, Xiao 2026-10-13) — the invite, who is here, what
 * friends may do, and ending it or leaving at the foot, the same sheet from
 * Now Playing's pill, the player bar's faces and Up next's ⋯.
 *
 * Starting it keeps the sheet up, and it grows into the room (M1).
 */
function TogetherSheet({ open, state }: { open: boolean; state: RoomState | null }): ReactNode {
  const leave = useLeave()
  // The room you asked to end, while the question is up.
  const [asking, setAsking] = useState<RoomState | null>(null)
  const others = asking ? peopleHere(asking).filter(member => member.id !== asking.you) : []
  return (
    <>
      <Sheet
        open={open}
        onClose={closeRoomSheet}
        // Start draws its own name, centred under the seats.
        title={state ? roomTitle(state) : undefined}
        testID="room-together"
        width={420}
      >
        {state ? (
          <RoomOptions
            state={state}
            onLeave={() => {
              // Asked only when it reaches someone else (C1): the host ending it
              // for friends still in it. Leaving, or ending it alone, just goes.
              if (isHost(state) && peopleHere(state).some(member => member.id !== state.you)) {
                setAsking(state)
              } else void leave(state)
            }}
          />
        ) : (
          <Start />
        )}
      </Sheet>
      <ConfirmDialog
        open={asking !== null}
        title={`End the room for ${namesOf(others.map(member => member.name))}?`}
        body="Their music stops, and their songs stop playing. It stays in your Recently played."
        confirmLabel="End it"
        danger
        onConfirm={() => {
          if (asking) void leave(asking)
          setAsking(null)
        }}
        onCancel={() => setAsking(null)}
      />
    </>
  )
}

/**
 * Out of a room: ended, if it was yours. A toast says so and, once a song has
 * played, offers the room as Recently played keeps it (C3). The room's own
 * page goes with it; anywhere else you stay where you were.
 */
function useLeave(): (state: RoomState) => Promise<void> {
  const router = useRouter()
  const pathname = usePathname()
  const go = useGo()
  const overNowPlaying = useContext(RoomGo) !== null
  return async state => {
    closeRoomSheet()
    const played = pastRoomOf(state, Date.now()) !== null
    await leaveRoom()
    if (!overNowPlaying && pathname === '/room') router.replace('/')
    showToast(isHost(state) ? 'Room ended' : `You left ${roomTitle(state)}`, 'info', {
      actions: played
        ? [
            {
              label: 'See what played',
              onPress: () => go({ pathname: '/past-room/[code]', params: { code: state.code } }),
            },
          ]
        : [],
    })
  }
}

/** Empty seats beside yours: what a room is, without a sentence saying it. */
const SEATS = 3
const SEAT_FACE = 44

function Start(): ReactNode {
  const { data: me } = useCloudSession()
  const player = usePlayer()
  const start = useRoomStart()
  const from = startingSongs(start, player.current)
  const [mode, setMode] = useState<'speaker' | 'everyone'>('speaker')
  const [busy, setBusy] = useState(false)
  const [joining, setJoining] = useState(!me)

  const begin = async (): Promise<void> => {
    if (!me) return
    setBusy(true)
    try {
      const songs = from.ids
        .map(id => cloudLibrary.cloudRoomSongNow(id))
        .filter((song): song is RoomSong => song !== null)
      const position = player.getPosition()
      const wasPlaying = player.isPlaying
      // Before the room exists: its sheet mounts the moment it does, and reads this.
      noteRoomOpened()
      await startRoom({ name: firstName(me.name, me.email), mode })
      if (start.kind === 'playing' && songs.length > 0) {
        // What is here stays: the song playing goes in first, as yours, and
        // carries on from where it was.
        setRoomStartHint({ position, autoplay: wasPlaying, takeOver: false })
        if (wasPlaying) player.toggle()
      } else {
        // A list's first song, or the first one added to an empty room, takes
        // over from whatever of yours was playing: that is what it was opened for.
        setRoomStartHint({ position: 0, autoplay: true, takeOver: true })
      }
      const [first, ...rest] = songs
      if (first) await roomAct({ type: 'add', song: first })
      // The rest go in behind it, in order, while the first already plays.
      void addInOrder(rest)
    } catch (error) {
      takeRoomOpened()
      sayRoomFailure(error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={styles.together}>
      <View style={styles.startHead}>
        <View style={styles.seats}>
          <RoomFace
            name={me ? firstName(me.name, me.email) : 'You'}
            colour={0}
            picture={me?.picture ?? null}
            size={SEAT_FACE}
          />
          {Array.from({ length: SEATS }, (_, seat) => (
            <EmptySeat key={seat} />
          ))}
        </View>
        <Text style={styles.startTitle} accessibilityRole="header">
          Listen together
        </Text>
      </View>
      {me ? (
        <>
          <View style={styles.fact}>
            <Text style={styles.factKey}>Starts with</Text>
            <View style={styles.factValue}>
              {from.ids.length > 0 ? <PlaylistCover songIds={from.ids} size={24} /> : null}
              <Text style={styles.factText} numberOfLines={1} testID="room-starts-with">
                {from.title}
              </Text>
            </View>
          </View>
          <View style={styles.fact}>
            <Text style={styles.factKey}>Plays on</Text>
            <Segmented
              size="small"
              value={mode}
              options={[
                { value: 'speaker', label: `This ${devicePlace(deviceKind())}` },
                { value: 'everyone', label: 'Everyone’s' },
              ]}
              onChange={setMode}
              label="Where it plays"
              style={styles.factSegments}
            />
          </View>
          <Button
            label="Start"
            variant="primary"
            busy={busy}
            onPress={() => void begin()}
            testID="room-start"
          />
        </>
      ) : (
        <Text style={styles.centred}>Sign in to start a room of your own.</Text>
      )}
      {joining ? (
        <JoinByCode autoFocus={me !== null && me !== undefined} />
      ) : (
        <Press
          feedback="dim"
          onPress={() => setJoining(true)}
          accessibilityRole="button"
          accessibilityLabel="Have a code? Join a room"
          testID="room-join-open"
          style={styles.joinLink}
        >
          <Text style={styles.centred}>
            Have a code? <Text style={styles.joinWord}>Join</Text>
          </Text>
        </Press>
      )}
    </View>
  )
}

/** Adds songs to the room one after another, so they keep their order; stops at the first refusal. */
async function addInOrder(songs: readonly RoomSong[]): Promise<void> {
  for (const song of songs) {
    try {
      await roomAct({ type: 'add', song })
    } catch (error) {
      sayRoomFailure(error)
      return
    }
  }
}

function EmptySeat(): ReactNode {
  const { theme } = useUnistyles()
  return (
    <View style={styles.seat}>
      <Plus size={iconSize.small} color={theme.colors.textMuted} />
    </View>
  )
}

function JoinByCode({ autoFocus = false }: { autoFocus?: boolean }): ReactNode {
  const go = useGo()
  const [code, setCode] = useState('')
  const valid = RoomCodeSchema.safeParse(code).success
  const join = (): void => {
    if (!valid) return
    closeRoomSheet()
    go({ pathname: '/join/[code]', params: { code: normalizeRoomCode(code) } })
  }
  return (
    <TextField
      raised
      autoFocus={autoFocus}
      value={code}
      onChangeText={setCode}
      onSubmitEditing={join}
      placeholder="Room code"
      accessibilityLabel="Room code"
      autoCapitalize="characters"
      // Six letters and digits, and the space or dash a code is written with.
      maxLength={9}
      testID="room-code-field"
      action={<Button label="Join" disabled={!valid} onPress={join} testID="room-code-join" />}
    />
  )
}

function firstName(name: string | null, email: string): string {
  const given = name?.trim().split(/\s+/)[0]
  return (given || email.split('@')[0] || 'Me').slice(0, 40)
}

// --- Add songs -------------------------------------------------------------------

type AddTab = 'mine' | 'room' | 'link'

function AddSheet({ open, state }: { open: boolean; state: RoomState }): ReactNode {
  const tabs = useMemo(() => {
    const shown: { value: AddTab; label: string }[] = []
    if (youMay(state, 'add')) shown.push({ value: 'mine', label: 'Mine' })
    shown.push({ value: 'room', label: 'In the room' })
    if (youMay(state, 'addLink')) shown.push({ value: 'link', label: 'A link' })
    return shown
  }, [state])
  const [tab, setTab] = useState<AddTab>(tabs[0]?.value ?? 'room')
  const shownTab = tabs.some(option => option.value === tab) ? tab : (tabs[0]?.value ?? 'room')
  return (
    <Sheet
      open={open}
      onClose={closeRoomSheet}
      title={`Add to ${roomTitle(state)}`}
      testID="room-add-sheet"
      width={480}
    >
      <View style={styles.body}>
        {tabs.length > 1 ? (
          <Segmented
            value={shownTab}
            options={tabs}
            onChange={setTab}
            label="Where songs come from"
          />
        ) : null}
        {shownTab === 'mine' ? (
          <MyLibraryPicker
            onAdd={song =>
              roomAct({ type: 'add', song }).then(
                () => true,
                (error: unknown) => {
                  sayRoomFailure(error)
                  return false
                },
              )
            }
          />
        ) : null}
        {shownTab === 'room' ? <InTheRoom state={state} /> : null}
        {shownTab === 'link' ? <ALink state={state} /> : null}
      </View>
    </Sheet>
  )
}

/** Your own songs: found by name, added from your bucket. */
/**
 * Your own songs, found by name, each added with `onAdd` as a song a room or a
 * shared playlist carries — lent from your bucket. `onAdd` says whether it
 * went in, so the row can say so.
 */
export function MyLibraryPicker({
  onAdd,
}: {
  onAdd: (song: RoomSong) => Promise<boolean>
}): ReactNode {
  const [added, setAdded] = useState<ReadonlySet<number>>(new Set())

  const add = async (song: Song): Promise<void> => {
    const roomSong = cloudLibrary.cloudRoomSongNow(song.id)
    if (!roomSong) {
      showToast('That song isn’t in your storage yet', 'warn')
      return
    }
    if (await onAdd(roomSong)) setAdded(before => new Set([...before, song.id]))
  }

  return (
    <View style={styles.tab}>
      <LibrarySongPicker
        order="played"
        stateOf={song => (added.has(song.id) ? 'added' : 'add')}
        onAdd={song => void add(song)}
        testID="room-add-search"
      />
    </View>
  )
}

/** What is already in the room: friends' shelves, and songs that played. */
function InTheRoom({ state }: { state: RoomState }): ReactNode {
  const [added, setAdded] = useState<ReadonlySet<string>>(new Set())
  const mayAdd = youMay(state, 'again')
  const played = playedRows(state)
  const act = (key: string, action: Parameters<typeof roomAct>[0]): void => {
    void roomAct(action).then(() => setAdded(before => new Set([...before, key])), sayRoomFailure)
  }
  const sections = state.shelves.length + (played.length > 0 ? 1 : 0)
  return (
    <ScrollView style={styles.scroll}>
      {youMay(state, 'shelf') ? <ShelfPicker state={state} /> : null}
      {state.shelves.map(shelf => {
        const owner = state.members.find(member => member.id === shelf.member)
        return (
          <View key={shelf.member} style={styles.section}>
            <SectionHead
              look="label"
              lead={
                owner ? (
                  <RoomFace
                    name={owner.name}
                    colour={owner.colour}
                    picture={owner.picture}
                    size={20}
                  />
                ) : null
              }
              title={`${nameOf(state, owner)}’s shelf · ${shelf.name}`}
              style={styles.sectionHead}
            />
            {shelf.songs.map((song, index) => (
              <SongPick
                key={`${shelf.member}-${index}`}
                title={song.title}
                sub={artistOr(song.artist)}
                art={null}
                done={added.has(`${shelf.member}-${index}`)}
                disabled={!mayAdd}
                onAdd={() =>
                  act(`${shelf.member}-${index}`, {
                    type: 'fromShelf',
                    member: shelf.member,
                    index,
                  })
                }
              />
            ))}
          </View>
        )
      })}
      {played.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.label}>Played tonight</Text>
          {played.map(row => (
            <SongPick
              key={row.entry.id}
              title={row.entry.song.title}
              sub={`${artistOr(row.entry.song.artist)} · ${nameOf(state, row.by)}`}
              art={null}
              done={added.has(row.entry.id)}
              disabled={!mayAdd}
              onAdd={() => act(row.entry.id, { type: 'again', entryId: row.entry.id })}
            />
          ))}
        </View>
      ) : null}
      {sections === 0 ? (
        <Text style={styles.text}>
          Nothing here yet. When friends put up a shelf, or songs have played, they are here to add.
        </Text>
      ) : null}
    </ScrollView>
  )
}

/** Put up one tag or playlist of yours for the room to add from, or take it down. */
function ShelfPicker({ state }: { state: RoomState }): ReactNode {
  const { data: library } = useLibrary()
  const mine = state.shelves.find(shelf => shelf.member === state.you)
  const [picking, setPicking] = useState(false)
  const put = async (name: string, songIds: readonly number[]): Promise<void> => {
    const songs = songIds
      .slice(0, 300)
      .map(id => cloudLibrary.cloudRoomSongNow(id))
      .filter((song): song is RoomSong => song !== null)
    if (songs.length === 0) {
      showToast('None of those songs are in your storage yet', 'warn')
      return
    }
    setPicking(false)
    await roomAct({ type: 'shelf', shelf: { name: name.slice(0, 300), songs } }).catch(
      sayRoomFailure,
    )
  }
  if (mine) {
    return (
      <View style={styles.shelfMine}>
        <Text style={styles.text}>
          Your shelf: {mine.name}, {plural(mine.songs.length, 'song', 'songs')}.
        </Text>
        <Button
          label="Take it down"
          variant="text"
          onPress={() => void roomAct({ type: 'shelf', shelf: null }).catch(sayRoomFailure)}
        />
      </View>
    )
  }
  if (!picking) {
    return (
      <View style={styles.shelfMine}>
        <Text style={styles.text}>Let the room add from one tag or playlist of yours.</Text>
        <Button label="Put up a shelf" onPress={() => setPicking(true)} testID="room-shelf" />
      </View>
    )
  }
  const songs = library?.songs ?? []
  return (
    <View style={styles.section}>
      <Text style={styles.label}>Tags</Text>
      <View style={styles.chips}>
        {(library?.tags ?? []).map(tag => (
          <Button
            key={`tag-${tag.id}`}
            label={tag.name}
            onPress={() =>
              void put(
                tag.name,
                songs.filter(song => song.tagIds.includes(tag.id)).map(song => song.id),
              )
            }
          />
        ))}
      </View>
      <Text style={styles.label}>Playlists</Text>
      <View style={styles.chips}>
        {(library?.playlists ?? []).map(playlist => (
          <Button
            key={`playlist-${playlist.id}`}
            label={playlist.name}
            onPress={() =>
              void cloudLibrary.cloudPlaylistSongs(playlist.id).then(ids => put(playlist.name, ids))
            }
          />
        ))}
      </View>
    </View>
  )
}

/** A link from YouTube or 网易云: played through the host's server, kept by nobody. */
function ALink({ state }: { state: RoomState }): ReactNode {
  const [text, setText] = useState('')
  const [found, setFound] = useState<RoomSong | null>(null)
  const [busy, setBusy] = useState(false)
  const url = playableLink(text)

  const look = async (): Promise<void> => {
    if (!url) return
    setBusy(true)
    setFound(await lookUpLink(url))
    setBusy(false)
  }
  const add = async (): Promise<void> => {
    if (!found) return
    try {
      await roomAct({ type: 'addLink', song: found })
      setFound(null)
      setText('')
      showToast('Added to the room', 'good')
    } catch (error) {
      sayRoomFailure(error)
    }
  }

  return (
    <View style={styles.tab}>
      <TextField
        raised
        value={text}
        onChangeText={next => {
          setText(next)
          setFound(null)
        }}
        onSubmitEditing={() => void look()}
        placeholder="A YouTube or 网易云 link"
        accessibilityLabel="A link to a song"
        autoCapitalize="none"
        inputMode="url"
        testID="room-link-field"
      />
      {found ? (
        <View style={styles.found}>
          <SongPick
            title={found.title}
            sub={found.artist || 'From a link'}
            art={found.artwork}
            done={false}
            onAdd={() => void add()}
          />
          <Text style={styles.text}>
            Plays straight from the link. Nothing is saved to anyone’s library.
          </Text>
        </View>
      ) : (
        <Button
          label="Look it up"
          disabled={!url}
          busy={busy}
          onPress={() => void look()}
          testID="room-link-look"
        />
      )}
      {state.mode === 'everyone' && !state.linkRelay ? (
        <Text style={styles.text}>
          Everyone else hears a link when the host’s library’s computer can be reached from the
          internet; otherwise it plays on the host’s device alone.
        </Text>
      ) : null}
    </View>
  )
}

/** A song not in your library — on a friend's shelf, played tonight, behind a link — one + away. */
function SongPick({
  title,
  sub,
  art,
  done,
  disabled = false,
  onAdd,
}: {
  title: string
  sub: string
  art: string | null | undefined
  done: boolean
  disabled?: boolean
  onAdd: () => void
}): ReactNode {
  return (
    <SongLine
      artUri={art}
      title={title}
      sub={sub}
      trailing={
        <PickMark state={done ? 'added' : 'add'} title={title} onAdd={onAdd} disabled={disabled} />
      }
    />
  )
}

// --- The room ----------------------------------------------------------------------

const RIGHTS: readonly { key: keyof RoomRights; label: string; says: string }[] = [
  { key: 'add', label: 'Add', says: 'Add songs' },
  { key: 'skip', label: 'Skip', says: 'Skip' },
  { key: 'pause', label: 'Pause', says: 'Pause and play' },
  { key: 'links', label: 'Links', says: 'Add links, which play straight from the link' },
]

/** A face in the room's sheet: big enough to tap, with the name under it. */
const PERSON_FACE = 44

/**
 * The room's sheet, in a room (D1, Xiao 2026-10-14): the code with its QR and
 * Share, who is here as faces, what friends may do as chips, and keeping it
 * or ending it at the foot. Nothing that needs a sentence to explain it.
 *
 * Just opened, it arrives (M1): your face springs into its seat, the code rolls
 * in and the rest rises after. A friend who joins later springs in with a ring
 * of their colour (M2).
 */
function RoomOptions({ state, onLeave }: { state: RoomState; onLeave: () => void }): ReactNode {
  const host = isHost(state)
  const moves = useRoomMoves()
  // Read once: the room this sheet grew into, rather than one opened later.
  const [arriving] = useState(takeRoomOpened)
  const arrive = arriving ? moves : null
  // The friend you asked to remove, while the question is up.
  const [removing, setRemoving] = useState<RoomState['members'][number] | null>(null)
  const setRight = (key: keyof RoomRights, value: boolean): void => {
    void roomAct({ type: 'settings', rights: { ...state.rights, [key]: value } }).catch(
      sayRoomFailure,
    )
  }
  return (
    // Faces already here are simply there when the sheet opens; one who joins
    // while it is up springs in. The room just opened arrives whole.
    <LayoutAnimationConfig skipEntering={!arriving}>
      <View style={styles.together}>
        <Invite state={state} moves={arrive} />
        <People
          state={state}
          moves={moves}
          onPick={host ? member => setRemoving(member) : undefined}
        />
        {host ? (
          <Animated.View entering={arrive?.rise(1)} style={styles.rights}>
            <Text style={styles.label}>Friends can</Text>
            <View style={styles.chips} testID="room-rights">
              {RIGHTS.map(right => (
                <Chip
                  key={right.key}
                  label={right.label}
                  accessibilityLabel={right.says}
                  selected={state.rights[right.key]}
                  compact
                  onPress={() => setRight(right.key, !state.rights[right.key])}
                  testID={`room-right-${right.key}`}
                />
              ))}
            </View>
          </Animated.View>
        ) : null}
        <Animated.View entering={arrive?.rise(2)} style={styles.foot}>
          {host ? <KeepAsShared state={state} /> : null}
          <Button
            label={host ? 'End the room' : 'Leave the room'}
            variant="danger"
            onPress={onLeave}
            grow
            testID="room-leave"
          />
        </Animated.View>
      </View>
      <ConfirmDialog
        open={removing !== null}
        title={removing ? `Remove ${removing.name} from the room?` : ''}
        body="Their songs that haven’t played come out with them."
        confirmLabel="Remove"
        danger
        onConfirm={() => {
          if (removing) {
            void roomAct({ type: 'kick', member: removing.id }).catch(sayRoomFailure)
          }
          setRemoving(null)
        }}
        onCancel={() => setRemoving(null)}
      />
    </LayoutAnimationConfig>
  )
}

/** The code, its QR for a friend across the table, and Share. */
function Invite({ state, moves }: { state: RoomState; moves: RoomMoves | null }): ReactNode {
  const { theme } = useUnistyles()
  const link = inviteLink(appAddress(), state.code)
  const code = formatRoomCode(state.code)
  const share = async (): Promise<void> => {
    const how = await shareLink(`Listen with me in ${roomTitle(state)}:`, link)
    if (how === 'copied') showToast('Invite link copied', 'good')
  }
  return (
    <View style={styles.codeCard}>
      <RoomQr text={link} size={88} />
      <View style={styles.codeText}>
        <View
          style={styles.codeLetters}
          accessible
          accessibilityLabel={`Room code ${code}`}
          testID="room-code"
        >
          {[...code].map((letter, order) => (
            <Animated.Text key={order} entering={moves?.letter(order)} style={styles.code}>
              {letter}
            </Animated.Text>
          ))}
        </View>
        <View style={styles.shareRow}>
          <Button
            label="Share"
            variant="primary"
            icon={<ShareOut color={theme.colors.onPrimary} />}
            onPress={() => void share()}
            testID="room-share"
          />
        </View>
      </View>
    </View>
  )
}

/**
 * Who is here, as faces with their names under them, and an empty seat that
 * shares the invite. Someone away is drawn faded. The host taps a friend's
 * face to remove them.
 */
function People({
  state,
  moves,
  onPick,
}: {
  state: RoomState
  moves: RoomMoves | null
  onPick?: (member: RoomState['members'][number]) => void
}): ReactNode {
  const { theme } = useUnistyles()
  const link = inviteLink(appAddress(), state.code)
  const people = peopleHere(state)
  // Who was here as the sheet opened: anyone else came in while it was up.
  const [here] = useState(() => new Set(people.map(member => member.id)))
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View style={styles.people}>
        {people.map((member, order) => {
          const yours = member.id === state.you
          const face = (
            <>
              <View style={[styles.personFace, !member.online && styles.away]}>
                {!here.has(member.id) ? (
                  <ArrivalRing
                    style={[styles.ring, { borderColor: roomFace(member.colour).fill }]}
                  />
                ) : null}
                <Animated.View entering={moves?.face(order)}>
                  <RoomFace
                    name={member.name}
                    colour={member.colour}
                    picture={member.picture}
                    size={PERSON_FACE}
                  />
                </Animated.View>
              </View>
              <Text style={styles.personName} numberOfLines={1}>
                {yours ? 'You' : member.name}
              </Text>
            </>
          )
          return onPick && member.kind !== 'host' ? (
            <Press
              key={member.id}
              feedback="dim"
              onPress={() => onPick(member)}
              accessibilityRole="button"
              accessibilityLabel={`${member.name}${member.online ? '' : ', away'}. Remove from the room`}
              style={styles.person}
            >
              {face}
            </Press>
          ) : (
            <View
              key={member.id}
              accessible
              accessibilityLabel={`${yours ? 'You' : member.name}${member.online ? '' : ', away'}`}
              style={styles.person}
            >
              {face}
            </View>
          )
        })}
        <Press
          feedback="dim"
          onPress={() =>
            void shareLink(`Listen with me in ${roomTitle(state)}:`, link).then(how => {
              if (how === 'copied') showToast('Invite link copied', 'good')
            })
          }
          accessibilityRole="button"
          accessibilityLabel="Invite someone"
          style={styles.person}
          testID="room-invite-seat"
        >
          <View style={[styles.seat, styles.personSeat]}>
            <Plus size={iconSize.small} color={theme.colors.textMuted} />
          </View>
          <Text style={styles.personName}>Invite</Text>
        </Press>
      </View>
    </ScrollView>
  )
}

/**
 * The room, kept as a shared playlist (features/shared): everyone in it who
 * signed in finds it in their Playlists, and can go on adding to it.
 */
function KeepAsShared({ state }: { state: RoomState }): ReactNode {
  const go = useGo()
  const { pass } = useRoom()
  const [busy, setBusy] = useState(false)
  const [kept, setKept] = useState<string | null>(() => keptAsOf(state.code))
  const keep = async (): Promise<void> => {
    if (!pass) return
    setBusy(true)
    try {
      const session = await sharedSession()
      const playlist = await sharedApi.keepRoom(pass, session, pastTitle(state).slice(0, 120))
      noteKeptAs(state.code, playlist.id)
      setKept(playlist.id)
      showToast(`Kept as “${playlist.name}”, for everyone here who signed in`, 'good', {
        actions: [
          {
            label: 'Open',
            onPress: () => {
              closeRoomSheet()
              go({ pathname: '/shared/[id]', params: { id: playlist.id } })
            },
          },
        ],
      })
    } catch (error) {
      sayRoomFailure(error)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Button
      label={kept ? 'Kept as a playlist' : 'Keep as a playlist'}
      accessibilityLabel={
        kept
          ? 'Kept as a shared playlist'
          : 'Keep as a shared playlist, for everyone here who signed in'
      }
      busy={busy}
      disabled={kept !== null}
      onPress={() => void keep()}
      grow
      testID="room-keep"
    />
  )
}

const styles = StyleSheet.create(theme => ({
  body: { gap: space.md, paddingBottom: space.sm },
  // In line with the sheet's title, which the panel's own edge leaves short of it.
  together: { gap: space.md, paddingBottom: space.sm, paddingHorizontal: space.md },
  tab: { gap: space.md },
  label: label(theme.colors),
  text: lineSub(theme.colors),
  centred: { ...lineSub(theme.colors), textAlign: 'center' },
  // Start
  startHead: { alignItems: 'center', gap: space.sm, paddingTop: space.sm, paddingBottom: space.xs },
  seats: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  seat: {
    width: SEAT_FACE,
    height: SEAT_FACE,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: theme.colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  startTitle: { color: theme.colors.textPrimary, fontSize: type.body, fontWeight: '700' },
  fact: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 40 },
  factKey: { color: theme.colors.textSecondary, fontSize: type.sub },
  factValue: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: space.sm,
  },
  factText: {
    flexShrink: 1,
    color: theme.colors.textPrimary,
    fontSize: type.sub,
    fontWeight: '600',
  },
  factSegments: { flex: 1, marginLeft: space.lg },
  joinLink: { alignSelf: 'center', paddingVertical: space.xs },
  joinWord: { color: theme.colors.textPrimary, fontWeight: '700' },
  // The room
  codeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
    padding: space.md,
    borderRadius: radius.card,
    backgroundColor: theme.colors.surface2,
  },
  codeText: { flex: 1, minWidth: 0, gap: space.sm },
  codeLetters: { flexDirection: 'row' },
  code: {
    color: theme.colors.textPrimary,
    fontSize: type.page,
    fontWeight: '700',
    letterSpacing: 2,
  },
  shareRow: { flexDirection: 'row' },
  people: { flexDirection: 'row', gap: space.md, paddingVertical: space.xs },
  person: { width: PERSON_FACE + space.md, alignItems: 'center', gap: space.xs },
  personFace: { width: PERSON_FACE, height: PERSON_FACE },
  personSeat: { width: PERSON_FACE, height: PERSON_FACE },
  personName: { maxWidth: '100%', color: theme.colors.textSecondary, fontSize: type.small },
  away: { opacity: 0.45 },
  ring: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: radius.pill,
    borderWidth: 2,
  },
  rights: { gap: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.tight },
  foot: { flexDirection: 'row', gap: space.sm, paddingTop: space.xs },
  // Add songs
  scroll: { maxHeight: 380 },
  section: { gap: 2, paddingTop: space.sm },
  sectionHead: { paddingBottom: space.xs },
  shelfMine: { gap: space.sm, paddingBottom: space.sm },
  found: { gap: space.sm },
}))
