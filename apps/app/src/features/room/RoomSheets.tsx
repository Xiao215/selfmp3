import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useRouter } from 'expo-router'
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
import { radius, space, type, useLibrary } from '@selfmp3/client'
import { useAccent } from '../../ui/accent'
import { ROW_COVER_SIZE } from '../../offline/coverStore'
import { useArt } from '../../offline/useArt'
import { usePlayer } from '../../player/PlayerProvider'
import { appAddress, shareLink } from '../../ports/shareLink'
import { library as cloudLibrary } from '../../replica'
import { label } from '../../ui/surfaces'
import { showToast } from '../../ui/toast'
import { Button } from '../../ui/components/Button'
import { ConfirmDialog } from '../../ui/components/ConfirmDialog'
import { Cover } from '../../ui/components/Cover'
import { Check, Plus } from '../../ui/components/Icons'
import { Segmented } from '../../ui/components/Segmented'
import { Sheet } from '../../ui/components/Sheet'
import { Toggle } from '../../ui/components/Toggle'
import { useCloudSession } from '../profile/useCloudSession'
import { lookUpLink, playableLink } from './linkSong'
import { RoomFace } from './RoomFace'
import { inviteLink, isHost, nameOf, playedRows, roomTitle, youMay } from './room.model'
import { closeRoomSheet, useRoomSheet } from './roomSheets.store'
import { sayRoomFailure } from './roomFailure'
import { leaveRoom, roomAct, setRoomStartHint, startRoom, useRoom } from './room.store'

/**
 * A room's sheets (docs/features/listen-together.md): Together — opening a
 * room, or its invite once you are in one — adding songs, and the people in
 * it. Drawn once by the shell, opened from wherever the room is shown.
 */
export function RoomSheets(): ReactNode {
  const open = useRoomSheet()
  const { state } = useRoom()
  return (
    <>
      <TogetherSheet open={open === 'together'} state={state} />
      {state ? <AddSheet open={open === 'add'} state={state} /> : null}
      {state ? <PeopleSheet open={open === 'people'} state={state} /> : null}
    </>
  )
}

// --- Together ----------------------------------------------------------------------

function TogetherSheet({ open, state }: { open: boolean; state: RoomState | null }): ReactNode {
  return (
    <Sheet
      open={open}
      onClose={closeRoomSheet}
      title={state ? 'Invite friends' : 'Listen together'}
      subtitle={
        state
          ? 'They open the link, or type the code in Together.'
          : 'Up next becomes a room friends add songs to.'
      }
      testID="room-together"
      width={420}
    >
      {state ? <Invite state={state} /> : <Start />}
    </Sheet>
  )
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
  const { theme } = useUnistyles()
  const accent = useAccent()
  const router = useRouter()
  const [code, setCode] = useState('')
  const [focused, setFocused] = useState(false)
  const valid = RoomCodeSchema.safeParse(code).success
  const join = (): void => {
    if (!valid) return
    closeRoomSheet()
    router.push({ pathname: '/join/[code]', params: { code: normalizeRoomCode(code) } })
  }
  return (
    <View style={styles.join}>
      <Text style={styles.label}>Or join one</Text>
      <View style={styles.joinRow}>
        <View style={[styles.field, styles.grow, focused && { borderColor: accent.accent }]}>
          <TextInput
            style={styles.input}
            value={code}
            onChangeText={setCode}
            onSubmitEditing={join}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder="Room code"
            placeholderTextColor={theme.colors.textMuted}
            accessibilityLabel="Room code"
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={9}
            testID="room-code-field"
          />
        </View>
        <Button label="Join" disabled={!valid} onPress={join} testID="room-code-join" />
      </View>
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
    <View style={styles.body}>
      <View style={styles.codeCard}>
        <Text style={styles.label}>Room code</Text>
        <Text style={styles.code} selectable testID="room-code">
          {formatRoomCode(state.code)}
        </Text>
        <Text style={styles.link} selectable numberOfLines={2}>
          {link}
        </Text>
      </View>
      <Text style={styles.text}>
        {state.mode === 'speaker'
          ? 'It plays on the host’s device. Friends add songs from their phones.'
          : 'It plays on everyone’s phone, in step.'}{' '}
        Friends with self.mp3 bring their own songs; anyone else joins in a browser with just a
        name.
      </Text>
      <Button
        label="Share invite"
        variant="primary"
        onPress={() => void share()}
        testID="room-share"
      />
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
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: chosen }}
      testID={testID}
      style={({ pressed }) => [
        styles.choice,
        chosen && { borderColor: accent.accent, backgroundColor: accent.accentPill },
        pressed && styles.pressed,
      ]}
    >
      <Text style={styles.choiceTitle}>{title}</Text>
      <Text style={styles.choiceSub}>{sub}</Text>
    </Pressable>
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
        {shownTab === 'mine' ? <Mine /> : null}
        {shownTab === 'room' ? <InTheRoom state={state} /> : null}
        {shownTab === 'link' ? <ALink state={state} /> : null}
      </View>
    </Sheet>
  )
}

/** Your own songs: found by name, added from your bucket. */
function Mine(): ReactNode {
  const { theme } = useUnistyles()
  const accent = useAccent()
  const { data: library } = useLibrary()
  const artFor = useArt(ROW_COVER_SIZE)
  const [query, setQuery] = useState('')
  const [added, setAdded] = useState<ReadonlySet<number>>(new Set())
  const found = useMemo(() => {
    const words = query.trim().toLocaleLowerCase()
    const songs = library?.songs ?? []
    const matches = words
      ? songs.filter(song =>
          `${song.title} ${song.artist} ${song.album}`.toLocaleLowerCase().includes(words),
        )
      : [...songs].sort((a, b) => (b.lastPlayedAt ?? '').localeCompare(a.lastPlayedAt ?? ''))
    return matches.slice(0, 40)
  }, [library?.songs, query])

  const add = async (song: Song): Promise<void> => {
    const roomSong = cloudLibrary.cloudRoomSongNow(song.id)
    if (!roomSong) {
      showToast('That song is not in your bucket yet', 'warn')
      return
    }
    try {
      await roomAct({ type: 'add', song: roomSong })
      setAdded(before => new Set([...before, song.id]))
    } catch (error) {
      sayRoomFailure(error)
    }
  }

  return (
    <View style={styles.tab}>
      <View style={styles.field}>
        <TextInput
          style={styles.input}
          value={query}
          onChangeText={setQuery}
          placeholder="Search your songs"
          placeholderTextColor={theme.colors.textMuted}
          accessibilityLabel="Search your songs"
          autoCorrect={false}
          testID="room-add-search"
        />
      </View>
      <ScrollView style={styles.scroll}>
        {found.map(song => (
          <SongPick
            key={song.id}
            title={song.title}
            sub={artistOr(song.artist)}
            art={artFor(song)}
            done={added.has(song.id)}
            onAdd={() => void add(song)}
            accentColor={accent.accent}
          />
        ))}
        {found.length === 0 ? <Text style={styles.text}>Nothing by that name.</Text> : null}
      </ScrollView>
    </View>
  )
}

/** What is already in the room: friends' shelves, and songs that played. */
function InTheRoom({ state }: { state: RoomState }): ReactNode {
  const accent = useAccent()
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
            <View style={styles.sectionHead}>
              {owner ? <RoomFace name={owner.name} colour={owner.colour} size={20} /> : null}
              <Text style={styles.label}>
                {nameOf(state, owner)}’s shelf · {shelf.name}
              </Text>
            </View>
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
                accentColor={accent.accent}
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
              accentColor={accent.accent}
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
      showToast('None of those songs are in your bucket yet', 'warn')
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
  const { theme } = useUnistyles()
  const accent = useAccent()
  const [text, setText] = useState('')
  const [found, setFound] = useState<RoomSong | null>(null)
  const [busy, setBusy] = useState(false)
  const url = playableLink(text)
  const host = state.members.find(member => member.kind === 'host')

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
      <View style={styles.field}>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={next => {
            setText(next)
            setFound(null)
          }}
          onSubmitEditing={() => void look()}
          placeholder="A YouTube or 网易云 link"
          placeholderTextColor={theme.colors.textMuted}
          accessibilityLabel="A link to a song"
          autoCapitalize="none"
          autoCorrect={false}
          testID="room-link-field"
        />
      </View>
      {found ? (
        <View style={styles.found}>
          <SongPick
            title={found.title}
            sub={found.artist || 'From a link'}
            art={found.artwork}
            done={false}
            onAdd={() => void add()}
            accentColor={accent.accent}
          />
          <Text style={styles.text}>
            Plays through {host ? `${nameOf(state, host)}’s` : 'the host’s'} server, straight from
            the link. Nothing is saved to anyone’s library.
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
      {state.mode === 'everyone' ? (
        <Text style={styles.text}>
          A link plays only on the host’s device, so in this room the others will hear it skipped.
        </Text>
      ) : null}
    </View>
  )
}

function SongPick({
  title,
  sub,
  art,
  done,
  disabled = false,
  onAdd,
  accentColor,
}: {
  title: string
  sub: string
  art: string | null | undefined
  done: boolean
  disabled?: boolean
  onAdd: () => void
  accentColor: string
}): ReactNode {
  const { theme } = useUnistyles()
  return (
    <View style={styles.pick}>
      <Cover uri={art} title={title} size={40} />
      <View style={styles.pickText}>
        <Text style={styles.pickTitle} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.pickSub} numberOfLines={1}>
          {sub}
        </Text>
      </View>
      {done ? (
        <Check size={18} color={accentColor} />
      ) : disabled ? null : (
        <Pressable
          onPress={onAdd}
          accessibilityRole="button"
          accessibilityLabel={`Add ${title}`}
          hitSlop={6}
          style={({ pressed }) => [styles.add, pressed && styles.pressed]}
        >
          <Plus size={16} color={theme.colors.textPrimary} />
        </Pressable>
      )}
    </View>
  )
}

// --- People ----------------------------------------------------------------------

function PeopleSheet({ open, state }: { open: boolean; state: RoomState }): ReactNode {
  const router = useRouter()
  const host = isHost(state)
  const [confirming, setConfirming] = useState(false)
  const setRight = (key: keyof RoomRights, value: boolean): void => {
    void roomAct({ type: 'settings', rights: { ...state.rights, [key]: value } }).catch(
      sayRoomFailure,
    )
  }
  const leave = async (): Promise<void> => {
    setConfirming(false)
    closeRoomSheet()
    await leaveRoom()
    router.replace('/')
  }
  const people = state.members.filter(member => !member.left)
  return (
    <>
      <Sheet
        open={open}
        onClose={closeRoomSheet}
        title="People"
        testID="room-people-sheet"
        width={420}
      >
        <View style={styles.body}>
          {people.map(member => {
            const songs = state.entries.filter(entry => entry.addedBy === member.id).length
            const kind =
              member.kind === 'host'
                ? 'Host'
                : member.kind === 'guest'
                  ? 'In a browser'
                  : 'Brings their own songs'
            return (
              <View key={member.id} style={styles.person}>
                <RoomFace name={member.name} colour={member.colour} size={36} />
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
          {host ? (
            <View style={styles.rights}>
              <Text style={styles.label}>Friends can</Text>
              <Right
                label="Add songs"
                value={state.rights.add}
                onChange={v => setRight('add', v)}
              />
              <Right label="Skip" value={state.rights.skip} onChange={v => setRight('skip', v)} />
              <Right
                label="Pause and play"
                value={state.rights.pause}
                onChange={v => setRight('pause', v)}
              />
              <Right
                label="Add links"
                hint="Plays through your server; nothing is kept"
                value={state.rights.links}
                onChange={v => setRight('links', v)}
              />
            </View>
          ) : null}
          <Button
            label={host ? 'End the room' : 'Leave the room'}
            variant="danger"
            onPress={() => setConfirming(true)}
            testID="room-leave"
          />
          <Text style={styles.text}>
            {host
              ? 'Ends it for everyone. It stays in your Recently played.'
              : 'It stays in your Recently played.'}
          </Text>
        </View>
      </Sheet>
      <ConfirmDialog
        open={confirming}
        title={host ? 'End the room?' : 'Leave the room?'}
        body={
          host ? 'Everyone in it stops hearing it, and friends’ songs stop playing.' : undefined
        }
        confirmLabel={host ? 'End it' : 'Leave'}
        danger
        onConfirm={() => void leave()}
        onCancel={() => setConfirming(false)}
      />
    </>
  )
}

function Right({
  label: name,
  hint,
  value,
  onChange,
}: {
  label: string
  hint?: string
  value: boolean
  onChange: (value: boolean) => void
}): ReactNode {
  return (
    <View style={styles.right}>
      <View style={styles.pickText}>
        <Text style={styles.pickTitle}>{name}</Text>
        {hint ? <Text style={styles.pickSub}>{hint}</Text> : null}
      </View>
      <Toggle value={value} onChange={onChange} label={name} />
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  body: { gap: space.md, paddingBottom: space.sm },
  tab: { gap: space.md },
  label: label(theme.colors),
  text: { color: theme.colors.textSecondary, fontSize: type.sub, lineHeight: 18 },
  choice: {
    gap: 2,
    padding: space.md,
    borderRadius: radius.mini,
    borderWidth: 1.5,
    borderColor: 'transparent',
    backgroundColor: theme.colors.surface2,
  },
  choiceTitle: { color: theme.colors.textPrimary, fontSize: type.body, fontWeight: '600' },
  choiceSub: { color: theme.colors.textSecondary, fontSize: type.sub },
  pressed: { transform: [{ scale: 0.98 }] },
  join: { gap: space.sm, paddingTop: space.md },
  joinRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  grow: { flex: 1 },
  field: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: space.md,
    borderRadius: radius.field,
    backgroundColor: theme.colors.surface3,
    borderWidth: 1,
    borderColor: theme.colors.surface3,
  },
  input: { color: theme.colors.textPrimary, fontSize: type.body, minHeight: 28 },
  codeCard: {
    gap: space.xs,
    padding: space.lg,
    borderRadius: radius.card,
    backgroundColor: theme.colors.surface2,
  },
  code: {
    color: theme.colors.textPrimary,
    fontSize: type.page,
    fontWeight: '700',
    letterSpacing: 2,
  },
  link: { color: theme.colors.textSecondary, fontSize: type.small },
  scroll: { maxHeight: 380 },
  section: { gap: 2, paddingTop: space.sm },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingBottom: space.xs,
  },
  shelfMine: { gap: space.sm, paddingBottom: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  found: { gap: space.sm },
  pick: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 56 },
  pickText: { flex: 1, minWidth: 0, gap: 2 },
  pickTitle: { color: theme.colors.textPrimary, fontSize: type.body, fontWeight: '600' },
  pickSub: { color: theme.colors.textSecondary, fontSize: type.sub },
  add: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface3,
  },
  person: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 56 },
  rights: {
    gap: 2,
    padding: space.md,
    borderRadius: radius.mini,
    backgroundColor: theme.colors.surface2,
  },
  right: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 48 },
}))
