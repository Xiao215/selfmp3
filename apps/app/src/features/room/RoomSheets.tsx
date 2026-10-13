import { createContext, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
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
import { iconSize, radius, space, type, useLibrary } from '@selfmp3/client'
import { useAccent } from '../../ui/accent'
import { usePlayer } from '../../player/PlayerProvider'
import { appAddress, shareLink } from '../../ports/shareLink'
import { library as cloudLibrary } from '../../replica'
import { label, rowTitle, lineSub, textColumn } from '../../ui/surfaces'
import { SectionHead } from '../../ui/components/SectionHead'
import { showToast } from '../../ui/toast'
import { Button } from '../../ui/components/Button'
import { TextField } from '../../ui/components/TextField'
import { LibrarySongPicker, PickMark } from '../../ui/components/LibrarySongPicker'
import { SongLine } from '../../ui/components/SongLine'
import { ConfirmDialog } from '../../ui/components/ConfirmDialog'
import { Segmented } from '../../ui/components/Segmented'
import { Sheet } from '../../ui/components/Sheet'
import { ToggleRow } from '../../ui/components/Toggle'
import { ChevronDown, ChevronRight } from '../../ui/components/Icons'
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
  roomLine,
  roomTitle,
  youMay,
} from './room.model'
import { closeRoomSheet, useRoomSheet } from './roomSheets.store'
import { sayRoomFailure } from './roomFailure'
import {
  keptAsOf,
  leaveRoom,
  noteKeptAs,
  roomAct,
  setRoomStartHint,
  startRoom,
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
 * Together, from the player's People button: out of a room, where it plays or
 * a code to join; in one, the room itself (E1, Xiao 2026-10-13) — the invite,
 * who is here, what friends may do, and ending it or leaving at the foot, the
 * same sheet from Now Playing's pill, the player bar's faces and Up next's ⋯.
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
        title={state ? roomTitle(state) : 'Listen together'}
        subtitle={state ? roomLine(state) : 'Up next becomes a room friends add songs to.'}
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

function Start(): ReactNode {
  const { data: me } = useCloudSession()
  const player = usePlayer()
  const [mode, setMode] = useState<'speaker' | 'everyone'>('speaker')
  const [busy, setBusy] = useState(false)

  const start = async (): Promise<void> => {
    if (!me) return
    setBusy(true)
    try {
      // What is here stays: the song playing and what comes after it go in
      // first, as yours, and carry on from where the song was.
      const from = Math.max(0, player.queue.index)
      const keep = player.queue.items
        .slice(from, from + 20)
        .flatMap(id => (id > 0 ? [cloudLibrary.cloudRoomSongNow(id)] : []))
        .filter((song): song is RoomSong => song !== null)
      const position = player.getPosition()
      const wasPlaying = player.isPlaying
      await startRoom({ name: firstName(me.name, me.email), mode })
      if (keep.length > 0) {
        setRoomStartHint({ position, autoplay: wasPlaying })
        if (wasPlaying) player.toggle()
        for (const song of keep) await roomAct({ type: 'add', song })
      }
      showToast('Your room is open. Invite friends with its code.', 'good')
    } catch (error) {
      sayRoomFailure(error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={styles.body}>
      {me ? (
        <>
          <Text style={styles.label}>Where it plays</Text>
          <Choice
            title="On this device"
            sub="One speaker. Everyone else adds from theirs."
            chosen={mode === 'speaker'}
            onPress={() => setMode('speaker')}
            testID="room-mode-speaker"
          />
          <Choice
            title="On everyone’s"
            sub="Each phone plays it, in step, wherever they are."
            chosen={mode === 'everyone'}
            onPress={() => setMode('everyone')}
            testID="room-mode-everyone"
          />
          <Button
            label="Open the room"
            variant="primary"
            busy={busy}
            onPress={() => void start()}
            testID="room-start"
          />
        </>
      ) : (
        <Text style={styles.text}>Sign in to open a room of your own.</Text>
      )}
      <JoinByCode />
    </View>
  )
}

function JoinByCode(): ReactNode {
  const go = useGo()
  const [code, setCode] = useState('')
  const valid = RoomCodeSchema.safeParse(code).success
  const join = (): void => {
    if (!valid) return
    closeRoomSheet()
    go({ pathname: '/join/[code]', params: { code: normalizeRoomCode(code) } })
  }
  return (
    <View style={styles.join}>
      <Text style={styles.label}>Or join one</Text>
      <TextField
        raised
        value={code}
        onChangeText={setCode}
        onSubmitEditing={join}
        placeholder="Room code"
        autoCapitalize="characters"
        // Six letters and digits, and the space or dash a code is written with.
        maxLength={9}
        testID="room-code-field"
        action={<Button label="Join" disabled={!valid} onPress={join} testID="room-code-join" />}
      />
    </View>
  )
}

function Invite({ state }: { state: RoomState }): ReactNode {
  const link = inviteLink(appAddress(), state.code)
  const share = async (): Promise<void> => {
    const how = await shareLink(`Listen with me in ${roomTitle(state)}:`, link)
    if (how === 'copied') showToast('Invite link copied', 'good')
  }
  return (
    <View style={styles.codeCard}>
      <RoomQr text={link} size={96} />
      <View style={styles.codeText}>
        <Text style={styles.label}>Room code</Text>
        <Text style={styles.code} selectable testID="room-code">
          {formatRoomCode(state.code)}
        </Text>
        <Text style={styles.link} selectable numberOfLines={2}>
          {link}
        </Text>
        <View style={styles.shareRow}>
          <Button
            label="Share invite"
            variant="primary"
            onPress={() => void share()}
            testID="room-share"
          />
        </View>
      </View>
    </View>
  )
}

function Choice({
  title,
  sub,
  chosen,
  onPress,
  testID,
}: {
  title: string
  sub: string
  chosen: boolean
  onPress: () => void
  testID: string
}): ReactNode {
  const accent = useAccent()
  return (
    <Press
      depth="row"
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: chosen }}
      testID={testID}
      style={[
        styles.choice,
        chosen && { borderColor: accent.accent, backgroundColor: accent.accentPill },
      ]}
    >
      <Text style={styles.choiceTitle}>{title}</Text>
      <Text style={styles.choiceSub}>{sub}</Text>
    </Press>
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

const RIGHTS: readonly { key: keyof RoomRights; label: string; hint?: string }[] = [
  { key: 'add', label: 'Add songs' },
  { key: 'skip', label: 'Skip' },
  { key: 'pause', label: 'Pause and play' },
  { key: 'links', label: 'Add links', hint: 'Plays straight from the link; nothing is kept' },
]

/** The room's sheet, in a room: the invite, its people, and ending it or leaving. */
function RoomOptions({ state, onLeave }: { state: RoomState; onLeave: () => void }): ReactNode {
  const { theme } = useUnistyles()
  const host = isHost(state)
  const [rightsOpen, setRightsOpen] = useState(false)
  const setRight = (key: keyof RoomRights, value: boolean): void => {
    void roomAct({ type: 'settings', rights: { ...state.rights, [key]: value } }).catch(
      sayRoomFailure,
    )
  }
  const allowed = RIGHTS.filter(right => state.rights[right.key]).map(right => right.label)
  return (
    <View style={styles.body}>
      <Invite state={state} />
      <View>
        {peopleHere(state).map(member => {
          const songs = state.entries.filter(entry => entry.addedBy === member.id).length
          const kind =
            member.kind === 'host'
              ? 'Host'
              : member.kind === 'guest'
                ? 'In a browser'
                : 'Brings their own songs'
          return (
            <View key={member.id} style={styles.person}>
              <RoomFace
                name={member.name}
                colour={member.colour}
                picture={member.picture}
                size={36}
              />
              <View style={styles.pickText}>
                <Text style={styles.pickTitle}>
                  {nameOf(state, member)}
                  {member.online ? '' : ' · away'}
                </Text>
                <Text style={styles.pickSub}>
                  {kind} · added {songs}
                </Text>
              </View>
              {host && member.kind !== 'host' ? (
                <Button
                  label="Remove"
                  variant="text"
                  onPress={() =>
                    void roomAct({ type: 'kick', member: member.id }).catch(sayRoomFailure)
                  }
                />
              ) : null}
            </View>
          )
        })}
      </View>
      {host ? (
        <View style={styles.rights}>
          <Press
            onPress={() => setRightsOpen(was => !was)}
            accessibilityRole="button"
            accessibilityState={{ expanded: rightsOpen }}
            testID="room-rights"
            style={styles.rightsHead}
          >
            <Text style={styles.rightsTitle}>Friends can</Text>
            <Text style={styles.rightsNow} numberOfLines={1}>
              {allowed.length > 0 ? allowed.join(', ') : 'Only listen'}
            </Text>
            {rightsOpen ? (
              <ChevronDown size={iconSize.small} color={theme.colors.textSecondary} />
            ) : (
              <ChevronRight size={iconSize.small} color={theme.colors.textSecondary} />
            )}
          </Press>
          {rightsOpen
            ? RIGHTS.map(right => (
                <Right
                  key={right.key}
                  label={right.label}
                  hint={right.hint}
                  value={state.rights[right.key]}
                  onChange={value => setRight(right.key, value)}
                />
              ))
            : null}
        </View>
      ) : null}
      {host ? <KeepAsShared state={state} /> : null}
      <Button
        label={host ? 'End the room' : 'Leave the room'}
        variant="danger"
        onPress={onLeave}
        testID="room-leave"
      />
      <Text style={styles.text}>
        {host
          ? 'Ends it for everyone. It stays in your Recently played.'
          : 'It stays in your Recently played.'}
      </Text>
    </View>
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
    <View style={styles.keep}>
      <Button
        label={kept ? 'Kept as a shared playlist' : 'Keep as a shared playlist'}
        busy={busy}
        disabled={kept !== null}
        onPress={() => void keep()}
        testID="room-keep"
      />
      <Text style={styles.text}>
        Everyone here who signed in gets it in their Playlists, and can keep adding to it.
      </Text>
    </View>
  )
}

/** One thing friends may do in the room, its switch at the end of the list's line. */
function Right(props: {
  label: string
  hint?: string
  value: boolean
  onChange: (value: boolean) => void
}): ReactNode {
  return <ToggleRow {...props} at="end" />
}

const styles = StyleSheet.create(theme => ({
  body: { gap: space.md, paddingBottom: space.sm },
  tab: { gap: space.md },
  label: label(theme.colors),
  text: lineSub(theme.colors),
  choice: {
    gap: 2,
    padding: space.md,
    borderRadius: radius.mini,
    borderWidth: 1.5,
    borderColor: 'transparent',
    backgroundColor: theme.colors.surface2,
  },
  choiceTitle: rowTitle(theme.colors),
  choiceSub: { color: theme.colors.textSecondary, fontSize: type.sub },
  join: { gap: space.sm, paddingTop: space.md },
  codeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
    padding: space.lg,
    borderRadius: radius.card,
    backgroundColor: theme.colors.surface2,
  },
  codeText: { flex: 1, minWidth: 0, gap: space.xs },
  code: {
    color: theme.colors.textPrimary,
    fontSize: type.page,
    fontWeight: '700',
    letterSpacing: 2,
  },
  link: { color: theme.colors.textSecondary, fontSize: type.small },
  scroll: { maxHeight: 380 },
  section: { gap: 2, paddingTop: space.sm },
  sectionHead: { paddingBottom: space.xs },
  shelfMine: { gap: space.sm, paddingBottom: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.tight },
  found: { gap: space.sm },
  pickText: textColumn,
  pickTitle: rowTitle(theme.colors),
  pickSub: { color: theme.colors.textSecondary, fontSize: type.sub },
  person: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 56 },
  rights: {
    gap: 2,
    paddingHorizontal: space.md,
    borderRadius: radius.mini,
    backgroundColor: theme.colors.surface2,
  },
  rightsHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 48 },
  rightsTitle: rowTitle(theme.colors),
  rightsNow: {
    flex: 1,
    textAlign: 'right',
    color: theme.colors.textSecondary,
    fontSize: type.sub,
  },
  shareRow: { flexDirection: 'row', paddingTop: space.xs },
  keep: { gap: space.xs },
}))
