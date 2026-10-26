import { createContext, useCallback, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { artistOr, plural, type RoomSong, type RoomState, type Song } from '@selfmp3/shared'
import { space, useLibrary } from '@selfmp3/client'
import { ROW_COVER_SIZE } from '../../offline/coverStore'
import { useArt } from '../../offline/useArt'
import { library as cloudLibrary } from '../../replica'
import { label, lineSub } from '../../ui/surfaces'
import { showToast } from '../../ui/toast'
import { Button } from '../../ui/components/Button'
import { LibrarySongPicker, PickMark } from '../../ui/components/LibrarySongPicker'
import { SectionHead } from '../../ui/components/SectionHead'
import { SongLine } from '../../ui/components/SongLine'
import { lookUpLink } from './linkSong'
import { RoomFace } from './RoomFace'
import { nameOf, playedRows, youMay } from './room.model'
import { roomAct } from './room.store'
import { sayRoomFailure } from './roomFailure'

/*
 * Songs going into a room, one + each (docs/features/listen-together.md):
 * your own as Search finds them, what friends brought, and a link. Search
 * draws them while it is adding to the room (A2, Xiao 2026-10-14); a shared
 * playlist uses the library picker.
 */

/**
 * Your own songs, found by name, each added with `onAdd` as a song a room or a
 * shared playlist carries — lent from your bucket. `onAdd` says whether it
 * went in, so the row can say so.
 */
export function MyLibraryPicker({
  onAdd,
  has,
}: {
  onAdd: (song: RoomSong) => Promise<boolean>
  /** Songs already where they would go, by id: marked as there, not offered. */
  has?: ReadonlySet<number>
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
        stateOf={song => (added.has(song.id) ? 'added' : has?.has(song.id) ? 'has' : 'add')}
        onAdd={song => void add(song)}
        testID="room-add-search"
      />
    </View>
  )
}

/**
 * What is already in the room, for Search's adding (A2): friends' shelves and
 * songs that played, each one + away, and putting up a shelf of your own.
 * Drawn in the page's own scroll.
 */
export function RoomShelves({ state }: { state: RoomState }): ReactNode {
  const [added, setAdded] = useState<ReadonlySet<string>>(new Set())
  const mayAdd = youMay(state, 'again')
  const played = playedRows(state)
  const act = (key: string, action: Parameters<typeof roomAct>[0]): void => {
    void roomAct(action).then(() => setAdded(before => new Set([...before, key])), sayRoomFailure)
  }
  return (
    <View style={styles.shelves}>
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
          <SectionHead look="label" title="Played tonight" style={styles.sectionHead} />
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
    </View>
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

/**
 * A YouTube or 网易云 link typed into Search while adding (A2): looked up,
 * then one + away. It plays straight from the link, through the host's
 * server, and is kept by nobody.
 */
export function LinkPick({ state, url }: { state: RoomState; url: string }): ReactNode {
  const [found, setFound] = useState<{ url: string; song: RoomSong | null } | null>(null)
  const [added, setAdded] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const song = found?.url === url ? found.song : undefined

  const look = async (): Promise<void> => {
    setBusy(true)
    const next = await lookUpLink(url)
    setFound({ url, song: next })
    setBusy(false)
  }
  const add = async (): Promise<void> => {
    if (!song) return
    try {
      await roomAct({ type: 'addLink', song })
      setAdded(url)
    } catch (error) {
      sayRoomFailure(error)
    }
  }

  return (
    <View style={styles.link}>
      {song ? (
        <SongPick
          title={song.title}
          sub={song.artist || 'From a link'}
          art={song.artwork}
          done={added === url}
          onAdd={() => void add()}
        />
      ) : (
        <Button
          label={song === null ? 'Nothing plays at that link' : 'Look up this link'}
          disabled={song === null}
          busy={busy}
          onPress={() => void look()}
          testID="room-link-look"
        />
      )}
      <Text style={styles.text}>
        {state.mode === 'everyone' && !state.linkRelay
          ? 'Everyone else hears a link when the host’s library’s computer can be reached from the internet; otherwise it plays on the host’s device alone.'
          : 'Plays straight from the link. Nothing is saved to anyone’s library.'}
      </Text>
    </View>
  )
}

/**
 * Search adding to the room (A2): the room's name for its bar, and for an
 * Ask answer's "Add to …" in place of Play. Null everywhere else.
 */
export const AddingToRoom = createContext<{ readonly title: string } | null>(null)

/** Your songs put in the room from Search, so each row can show its tick, whichever section it is in. */
export interface RoomAdds {
  readonly added: ReadonlySet<number>
  readonly add: (song: Song) => void
}

export function useRoomAdds(): RoomAdds {
  const [added, setAdded] = useState<ReadonlySet<number>>(new Set())
  const add = useCallback((song: Song): void => {
    const roomSong = cloudLibrary.cloudRoomSongNow(song.id)
    if (!roomSong) {
      showToast('That song isn’t in your storage yet', 'warn')
      return
    }
    void roomAct({ type: 'add', song: roomSong }).then(
      () => setAdded(before => new Set([...before, song.id])),
      sayRoomFailure,
    )
  }, [])
  return useMemo(() => ({ added, add }), [added, add])
}

/** A song of yours as Search shows it while adding (A2): a + that puts it in the room, a tick once it is in. */
export function MySongPick({
  song,
  adds,
  testID,
}: {
  song: Song
  adds: RoomAdds
  testID?: string
}): ReactNode {
  const artFor = useArt(ROW_COVER_SIZE)
  return (
    <View testID={testID}>
      <SongPick
        title={song.title}
        sub={artistOr(song.artist)}
        art={artFor(song)}
        done={adds.added.has(song.id)}
        onAdd={() => adds.add(song)}
      />
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
      // The whole line adds it, as a row plays its song everywhere else.
      onPress={done || disabled ? undefined : onAdd}
      accessibilityLabel={`Add ${title}`}
      trailing={
        <PickMark state={done ? 'added' : 'add'} title={title} onAdd={onAdd} disabled={disabled} />
      }
    />
  )
}

const styles = StyleSheet.create(theme => ({
  tab: { gap: space.md },
  label: label(theme.colors),
  text: lineSub(theme.colors),
  shelves: { gap: space.sm },
  section: { gap: 2, paddingTop: space.sm },
  sectionHead: { paddingBottom: space.xs },
  shelfMine: { gap: space.sm, paddingBottom: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.tight },
  link: { gap: space.sm },
}))
