import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Pressable, Text } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { artistOr, formatDuration, fuzzyRank, type Song } from '@selfmp3/shared'
import { space, type, useLibrary } from '@selfmp3/client'
import { ROW_COVER_SIZE } from '../../offline/coverStore'
import { useArt } from '../../offline/useArt'
import { useAccent } from '../accent'
import { EmptyState } from './EmptyState'
import { IconButton } from './IconButton'
import { Check, Plus } from './Icons'
import { ScrollView } from './Scroll'
import { SearchField } from './SearchField'
import { SongLine } from './SongLine'
import { OPACITY } from '../motion.model'

/** Enough to scroll through; a search narrows past it. */
const SHOWN = 60

/** Where a song stands with what is being filled: one + away, just added, or there already. */
type PickState = 'add' | 'added' | 'has'

/**
 * Songs of your library, found by name, each one + away from what is being
 * filled: a playlist, a tag, a room, a shared playlist. One picker, so a
 * search finds the same songs in the same order wherever you add them.
 *
 * With nothing typed it lists `SHOWN` songs, newest first or played last
 * (`order`); typing ranks the whole library by how well each matches. A song
 * just added says so with a tick and "Added", and when `onUnpick` is given
 * pressing that takes it back; one already there says `labels.has`, faded.
 */
export function LibrarySongPicker({
  stateOf,
  onAdd,
  onUnpick,
  order = 'added',
  labels = {},
  autoFocus = false,
  testID,
}: {
  stateOf: (song: Song) => PickState
  onAdd: (song: Song) => void
  onUnpick?: (song: Song) => void
  /** With nothing typed: the newest songs, or the ones played last. */
  order?: 'added' | 'played'
  labels?: {
    /** "Added", or "Tagged" on a tag's page. */
    readonly added?: string
    /** "In this list", "Has it". */
    readonly has?: string
    /** What a screen reader hears for the +: "Add <title>". */
    readonly add?: (song: Song) => string
    /** And for the tick, when it takes the song back. */
    readonly unpick?: (song: Song) => string
  }
  autoFocus?: boolean
  /** The search field's. */
  testID?: string
}): ReactNode {
  const artFor = useArt(ROW_COVER_SIZE)
  const { data: library } = useLibrary()
  const [query, setQuery] = useState('')

  const results = useMemo(() => {
    const songs = library?.songs ?? []
    if (!query.trim()) {
      const sorted =
        order === 'added'
          ? [...songs].sort((a, b) => b.addedAt.localeCompare(a.addedAt))
          : [...songs].sort((a, b) => (b.lastPlayedAt ?? '').localeCompare(a.lastPlayedAt ?? ''))
      return sorted.slice(0, SHOWN)
    }
    return fuzzyRank(query, songs, song => `${song.title} ${song.artist} ${song.album}`)
      .slice(0, SHOWN)
      .map(match => match.item)
  }, [library?.songs, query, order])

  return (
    <>
      <SearchField
        raised
        value={query}
        onChangeText={setQuery}
        placeholder="Search your library"
        autoCorrect={false}
        autoCapitalize="none"
        autoFocus={autoFocus}
        testID={testID}
      />
      <ScrollView style={styles.list}>
        {results.length === 0 ? (
          <EmptyState
            compact
            title={query.trim() ? `Nothing matches “${query.trim()}”` : 'No songs yet'}
          />
        ) : (
          results.map(song => {
            const state = stateOf(song)
            return (
              <SongLine
                key={song.id}
                style={[styles.row, state === 'has' && styles.has]}
                artUri={artFor(song)}
                coverTitle={song.album || song.title}
                title={song.title}
                sub={`${artistOr(song.artist)} · ${formatDuration(song.duration)}`}
                trailing={
                  <PickMark
                    state={state}
                    title={song.title}
                    onAdd={() => onAdd(song)}
                    onUnpick={onUnpick ? () => onUnpick(song) : undefined}
                    labels={{
                      added: labels.added,
                      has: labels.has,
                      add: labels.add?.(song),
                      unpick: labels.unpick?.(song),
                    }}
                  />
                }
              />
            )
          })
        )}
      </ScrollView>
    </>
  )
}

/**
 * The end of a song being picked: a + to add it, a tick and "Added" once it
 * is (pressed again it comes back out, where it can), or a quiet word for a
 * song there already. The library picker's rows and a room's shelves and
 * links alike.
 */
export function PickMark({
  state,
  title,
  onAdd,
  onUnpick,
  disabled = false,
  labels = {},
}: {
  state: PickState
  title: string
  onAdd: () => void
  onUnpick?: () => void
  /** Not yours to add: the + is left out. */
  disabled?: boolean
  labels?: {
    readonly added?: string
    readonly has?: string
    readonly add?: string
    readonly unpick?: string
  }
}): ReactNode {
  const accent = useAccent()
  const added = labels.added ?? 'Added'
  if (state === 'has') return <Text style={styles.state}>{labels.has ?? 'Already in'}</Text>
  if (state === 'added') {
    return (
      <Pressable
        onPress={onUnpick}
        disabled={!onUnpick}
        accessibilityRole={onUnpick ? 'button' : undefined}
        accessibilityLabel={
          onUnpick ? (labels.unpick ?? `Take ${title} back out`) : `${title} ${added.toLowerCase()}`
        }
        style={styles.addedMark}
      >
        <Check size={14} color={accent.accent} />
        <Text style={[styles.state, { color: accent.accent }]}>{added}</Text>
      </Pressable>
    )
  }
  if (disabled) return null
  return (
    <IconButton label={labels.add ?? `Add ${title}`} caption="Add" filled size={32} onPress={onAdd}>
      <Plus size={15} tone="textPrimary" />
    </IconButton>
  )
}

const styles = StyleSheet.create(theme => ({
  list: { maxHeight: 380 },
  row: { paddingHorizontal: space.xs },
  has: { opacity: OPACITY.dim },
  state: { color: theme.colors.textMuted, fontSize: type.small, fontWeight: '600' },
  addedMark: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    minWidth: 64,
    justifyContent: 'flex-end',
  },
}))
