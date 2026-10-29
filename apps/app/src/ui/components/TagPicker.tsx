import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { fuzzyRank, plural, TAG_NAME_MAX, type Song, type Tag } from '@selfmp3/shared'
import {
  failureText,
  space,
  type,
  useBulkTag,
  useCreateTag,
  useLibrary,
  useChangeSongTags,
  iconSize,
} from '@selfmp3/client'
import { useArtistNudge } from '../../features/tag/useArtistNudge'
import { useLayoutValue } from '../../shell/useLayout'
import { useAccent } from '../accent'
import { CheckRow, TagCheck } from './Checkbox'
import { Plus } from './Icons'
import { usePanelDense } from './panel'
import { Popover } from './Popover'
import type { PopoverAnchor } from '../rightClick'
import { Press } from './Press'
import {
  offeredTags,
  settledTicks,
  songPickerTicks,
  songTagChange,
  tagChanges,
  tagsAcross,
  undoTagChange,
  withPendingTicks,
  type Offered,
  type PendingTick,
} from './tagPicker.model'
import { SearchField } from './SearchField'
import { ScrollView } from './Scroll'
import { useDrawnAhead } from '../useDrawnAhead'
import { menuItem } from '../surfaces'

/**
 * Attach tags to a song.
 *
 * Tagging should never interrupt listening. The list filters as you type,
 * submitting picks the best match, and creating a tag is always one step away.
 * A near-match is shown first, though, because free-form tagging usually goes
 * wrong as "chill", "Chill" and "chilled" becoming three tags.
 */
export function TagPicker({
  song,
  onClose,
  anchorRef,
}: {
  song: Song | null
  onClose: () => void
  /** The control that opened it, for a window attached to it at desktop width. */
  anchorRef?: RefObject<PopoverAnchor | null>
}): ReactNode {
  return (
    <PickerWindow
      open={song !== null}
      onClose={onClose}
      anchorRef={anchorRef}
      title={song ? `Tags for ${song.title}` : undefined}
    >
      {song ? <Picker key={song.id} song={song} onLeave={onClose} /> : null}
    </PickerWindow>
  )
}

/**
 * Tags on a selection of songs, from the selection bar's More: the same
 * picker as a song's, so a tag can be searched for, made on the spot, put on
 * every chosen song or taken off all of them. A tag on some of the songs but
 * not all is drawn mixed; ticking it puts it on the rest.
 */
export function SelectionTagPicker({
  songs,
  open,
  onClose,
  anchorRef,
}: {
  songs: readonly Song[]
  open: boolean
  onClose: () => void
  anchorRef?: RefObject<PopoverAnchor | null>
}): ReactNode {
  return (
    <PickerWindow
      open={open}
      onClose={onClose}
      anchorRef={anchorRef}
      title={`Tags for ${plural(songs.length, 'song', 'songs')}`}
    >
      {open ? <SelectionPicker songs={songs} onLeave={onClose} /> : null}
    </PickerWindow>
  )
}

/**
 * A small window: over the button that opened it when there is one (the
 * player bar's, the selection bar's More), and otherwise — opened from a
 * song's menu, which closes as it opens — a sheet, which on a computer is a
 * small centred window (`Popover` decides).
 */
function PickerWindow({
  open,
  onClose,
  anchorRef,
  title,
  children,
}: {
  open: boolean
  onClose: () => void
  anchorRef?: RefObject<PopoverAnchor | null>
  title?: string
  children: ReactNode
}): ReactNode {
  return (
    <Popover
      open={open}
      onClose={onClose}
      anchorRef={anchorRef}
      width={320}
      title={title}
      titleTone="label"
      scrolls
      testID="tag-picker"
    >
      {children}
    </Popover>
  )
}

function SelectionPicker({
  songs,
  onLeave,
}: {
  songs: readonly Song[]
  onLeave: () => void
}): ReactNode {
  // What is ticked and what is mixed: the songs' as the picker opened, then
  // the taps', as a song's picker keeps its own. The bulk edit waits for a
  // refetch, so the songs lag a tap; measured against them, a tag ticked and
  // unticked before the library answered would stay on.
  const [shown, setShown] = useState(() => tagsAcross(songs))
  const latest = useRef(shown)
  const bulkTag = useBulkTag()
  return (
    <TagSearchList
      selected={shown.all}
      mixed={shown.some}
      onChange={next => {
        const before = latest.current
        const { add, remove, after } = tagChanges(before, next)
        latest.current = after
        setShown(after)
        // A tag the library did not take goes back to what it was, and every
        // other tap stands. Each change's own promise, not `mutate`'s
        // callbacks, which are kept for the newest call only. The failure
        // itself is said by the app's toast.
        const songIds = songs.map(song => song.id)
        const send = (tagId: number, action: 'add' | 'remove'): void => {
          bulkTag.mutateAsync({ songIds, tagId, action }).catch(() => {
            latest.current = undoTagChange(latest.current, before, tagId, action)
            setShown(latest.current)
          })
        }
        for (const tagId of add) send(tagId, 'add')
        for (const tagId of remove) send(tagId, 'remove')
      }}
      onLeave={onLeave}
    />
  )
}

function Picker({ song, onLeave }: { song: Song; onLeave: () => void }): ReactNode {
  const { data: library } = useLibrary()
  const changeTags = useChangeSongTags()
  // The last answer, for a song the library held does not have yet: the box
  // shows what is true rather than what the picker opened with.
  const [answered, setAnswered] = useState<readonly number[] | null>(null)
  const held = library?.songs.find(each => each.id === song.id)?.tagIds ?? answered ?? song.tagIds
  const [pending, setPending] = useState<ReadonlyMap<number, PendingTick>>(() => new Map())
  const ticks = useRef(0)
  const selected = useMemo(() => songPickerTicks(held, pending), [held, pending])
  return (
    <TagSearchList
      selected={selected}
      onChange={next => {
        const change = songTagChange(selected, next)
        if (change.add.length + change.remove.length === 0) return
        const tick = ++ticks.current
        setPending(current => withPendingTicks(current, change, tick))
        // Each tick's own promise, not `mutate`'s callbacks: those are kept for
        // the newest call only. Answered or refused, its tags go back to what
        // the song says, unless a later tick has taken them since; the
        // failure itself is said by the app's toast.
        const settle = (): void =>
          setPending(current => settledTicks(current, [...change.add, ...change.remove], tick))
        changeTags
          .mutateAsync({ songId: song.id, add: change.add, remove: change.remove })
          .then(answer => {
            setAnswered(answer.tagIds)
            settle()
          }, settle)
      }}
      onLeave={onLeave}
    />
  )
}

/**
 * Where the tags on offer come from, for a picker that is not this device's.
 *
 * A cloud library's import screen talks to the server directly, and that
 * server numbers its tags its own way (importSource.ts): a tag ticked here
 * has to be the server's, or what is queued names a tag the server does not
 * have. So that screen hands the picker its own list and its own way to make
 * one; everywhere else this is left out and the picker is this device's.
 *
 * A tag made on this device reaches that server only when it next reads the
 * devices' logs, up to ten minutes later (cloudSync.ts), so it would be
 * missing from the list until then. It is offered anyway, and
 * ticking it makes it there by name — both ends take two tags made under
 * one name for one tag (`tagCreated`, sync.ts).
 */
interface TagSource {
  readonly tags: readonly Tag[]
  readonly create: (name: string) => Promise<Tag>
}

/**
 * The picker itself, for tags on a song or tags for songs not yet here (an
 * import, a migration): search as you type, tick, and make a tag on the spot.
 * It holds no choice of its own; whoever shows it keeps `selected`.
 */
export function TagSearchList({
  selected,
  mixed,
  onChange,
  onLeave,
  from,
}: {
  selected: ReadonlySet<number>
  /** Tags on some of the songs but not all, drawn as a mixed tick; a tap puts them on the rest. */
  mixed?: ReadonlySet<number>
  onChange: (next: ReadonlySet<number>) => void
  /** Close whatever this is drawn in, as the nudge's "Open the artist" leaves for the artist. */
  onLeave?: () => void
  /** Another library's tags, when the ticked ids are not this device's. */
  from?: TagSource
}): ReactNode {
  const accent = useAccent()
  // In a pop-up with a mouse the rows are a menu's, not a finger's.
  const dense = usePanelDense()
  // A computer types straight into the search. A phone opens on the list, and
  // its keyboard comes up only when the field is tapped: most picks are a tick.
  const wide = useLayoutValue(layout => layout.wide)
  const { data: library } = useLibrary()
  const tags = useMemo(() => offeredTags(library?.tags ?? [], from?.tags), [from, library?.tags])
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const createHere = useCreateTag()
  const makeThere = from?.create
  const [making, setMaking] = useState(false)
  const nudge = useArtistNudge(onLeave)
  // The set as it is now: a tag ticked while a create waited must survive it.
  const latest = useRef(selected)
  useEffect(() => {
    latest.current = selected
  }, [selected])

  /*
   * With nothing typed, the song's own tags come first, so the one to take off
   * is at the top rather than wherever the alphabet put it. Ordered by what was
   * ticked when the picker opened, so a row does not jump away from the finger
   * that has just ticked it.
   */
  const [openedWith] = useState(selected)
  /*
   * Ranked a beat behind the typing, and drawn a screenful at a time: with
   * five hundred tags every letter re-ranked and redrew every row before the
   * field could show it (bug bash F171). Enter ranks what is typed now.
   */
  const shownQuery = useDeferredValue(query)
  const rankFor = useCallback(
    (text: string) => {
      const matches = fuzzyRank(text, tags, each => each.tag.name, { scattered: true })
      if (text.trim()) return matches
      const first = (match: (typeof matches)[number]): number =>
        match.item.there && openedWith.has(match.item.tag.id) ? 0 : 1
      return [...matches].sort((a, b) => first(a) - first(b))
    },
    [tags, openedWith],
  )
  const ranked = useMemo(() => rankFor(shownQuery), [rankFor, shownQuery])
  const { drawn, ...ahead } = useDrawnAhead(ranked.length, shownQuery)
  const hasExact = ranked.some(match => match.exact)
  const trimmed = query.trim()

  const pick = ({ tag, there }: Offered): void => {
    if (there) toggle(tag.id)
    else if (!making) void make(tag.name)
  }

  const toggle = (tagId: number): void => {
    const next = new Set(latest.current)
    if (next.has(tagId)) next.delete(tagId)
    else next.add(tagId)
    latest.current = next
    onChange(next)
  }

  const make = async (name: string): Promise<void> => {
    setError(null)
    setMaking(true)
    try {
      const tag = await (makeThere ? makeThere(name) : createHere.mutateAsync({ name }))
      setQuery('')
      const next = new Set([...latest.current, tag.id])
      latest.current = next
      onChange(next)
    } catch (caught) {
      // The name stays in the box, so trying again is one tap.
      setError(failureText(`Couldn’t create “${name}”`, caught))
    } finally {
      setMaking(false)
    }
  }

  /** A name that is an artist's asks first (`P11`); any other is made at once. */
  const create = (): void => {
    if (!trimmed || making) return
    nudge.check(trimmed, () => void make(trimmed))
  }

  const submit = (): void => {
    // With nothing typed there is no best match: an empty query ranks the whole
    // list, and submitting would silently tick its first entry.
    if (!trimmed) return
    const best = (shownQuery === query ? ranked : rankFor(query))[0]
    if (best) {
      pick(best.item)
      setQuery('')
    } else {
      create()
    }
  }

  return (
    <View style={styles.root}>
      <SearchField
        raised
        style={[styles.input, dense && styles.inputDense]}
        value={query}
        onChangeText={setQuery}
        onSubmitEditing={submit}
        placeholder="Search or create a tag…"
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus={wide}
        // This field creates tags as well as searching them, so it stops where
        // a tag name stops.
        maxLength={TAG_NAME_MAX}
        accessibilityLabel="Search or create a tag"
      />

      <ScrollView
        style={styles.list}
        // A scroll through the list puts the keyboard away, so the rows it
        // covered are there to tap.
        {...ahead}
      >
        {ranked.slice(0, drawn).map(({ item: offered }) => {
          const { tag: item, there } = offered
          const on = there && selected.has(item.id)
          const partly = !on && there && mixed?.has(item.id) === true
          return (
            // A row the width of the panel, so it sinks to a row's depth rather
            // than a control's (`M1`, 1).
            <CheckRow
              key={there ? item.id : `here:${item.id}`}
              checked={on}
              mixed={partly}
              label={item.name}
              style={({ pressed }) => [
                styles.item,
                dense && styles.itemDense,
                pressed && styles.itemPressed,
              ]}
              onPress={() => {
                pick(offered)
                setQuery('')
              }}
            >
              <TagCheck hue={item.hue} checked={on} mixed={partly} />
              <Text style={[styles.itemLabel, on && styles.itemLabelOn]} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={styles.count}>{item.songCount}</Text>
            </CheckRow>
          )
        })}
        {ranked.length === 0 && !trimmed ? (
          <Text style={styles.hint}>No tags yet — type a name to create your first one.</Text>
        ) : null}
      </ScrollView>

      {/* Once the ranking has caught up with the typing, so it never offers a twin. */}
      {trimmed && shownQuery.trim() === trimmed && !hasExact ? (
        <Press
          depth="row"
          style={({ pressed }) => [styles.item, styles.create, pressed && styles.itemPressed]}
          onPress={create}
          accessibilityRole="button"
          accessibilityLabel={`Create ${trimmed}`}
        >
          <Plus size={iconSize.field} color={accent.accent} />
          <Text style={[styles.itemLabel, { color: accent.accent }]} numberOfLines={1}>
            Create <Text style={styles.createName}>{trimmed}</Text>
          </Text>
          {ranked[0] ? <Text style={styles.count}>similar: {ranked[0].item.tag.name}</Text> : null}
        </Press>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {nudge.nudge}
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  input: {
    marginHorizontal: space.md,
    // The same room at the top as at the sides: against the panel's own edge
    // the field read as something that had slipped out of the box.
    marginTop: space.md,
    marginBottom: space.xs,
  },
  /* In a pop-up: a menu's room around the box. */
  inputDense: { marginTop: space.sm, marginHorizontal: space.sm, marginBottom: space.sm },
  itemDense: {
    minHeight: 34,
    paddingHorizontal: space.sm + 2,
  },
  // Gives way, with the list, when a sheet is held above the keyboard.
  root: { flexShrink: 1 },
  list: { maxHeight: 320, flexShrink: 1 },
  item: menuItem,
  itemPressed: { backgroundColor: theme.colors.surface3 },
  itemLabel: { flex: 1, color: theme.colors.textPrimary, fontSize: type.body },
  itemLabelOn: { fontWeight: '600' },
  count: { color: theme.colors.textMuted, fontSize: type.tiny },
  // Set apart from the list by room, not a rule.
  create: {
    marginTop: space.xs,
  },
  createName: { fontWeight: '700' },
  hint: { color: theme.colors.textMuted, fontSize: type.small, padding: space.md },
  error: {
    color: theme.colors.danger,
    fontSize: type.small,
    paddingHorizontal: space.md,
    paddingTop: space.xs,
  },
}))
