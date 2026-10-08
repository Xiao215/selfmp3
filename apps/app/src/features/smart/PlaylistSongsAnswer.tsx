import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { artistOr, plural, type AskAnswer } from '@selfmp3/shared'
import {
  space,
  useAddToPlaylist,
  useLibrary,
  usePlaylistSongIds,
  useRemoveManyFromPlaylist,
  useReorderPlaylist,
} from '@selfmp3/client'
import { Button } from '../../ui/components/Button'
import { useSongsById } from '../../ui/songsById'
import { showToast } from '../../ui/toast'
import type { AnswerKeys } from './answerKeys'
import { Review, reviewText } from './Review'
import { keptSongs, parts, playlistEditHere, sortWords, type Reviewed } from './smart.model'
import { useSmartServer } from './useSmartServer'

type Answer = Extract<AskAnswer, { kind: 'playlistSongs' }>

/**
 * Ask's answer to "add … to", "take … out of" and "sort" one playlist
 * (docs/features/ai.md, "Playlists from the box"). An add or a remove is a
 * review of one change, open to its songs so any can be left out; a sort shows
 * the new order's start. Each is the edit a press would make, against the
 * playlist as it is now, and the toast's Undo puts the songs and their order
 * back.
 */
export function PlaylistSongsAnswer({
  answer,
  height,
  onDone,
  onKeys,
}: {
  answer: Answer
  height: number
  onDone: () => void
  onKeys?: (keys: AnswerKeys | null) => void
}): ReactNode {
  const server = useSmartServer()
  const { data: library } = useLibrary()
  const playlist =
    library?.playlists.find(each => each.name === answer.playlist && each.kind === 'manual') ?? null
  const { data: members } = usePlaylistSongIds(playlist?.id ?? null)
  const add = useAddToPlaylist()
  const removeMany = useRemoveManyFromPlaylist()
  const reorder = useReorderPlaylist()
  const [sorting, setSorting] = useState(false)

  const current = useMemo(() => members?.songIds ?? [], [members])
  const here = useMemo(
    () => playlistEditHere(answer, server.onDevice, current),
    [answer, server.onDevice, current],
  )
  const songsById = useSongsById()

  if (!playlist) return <Text style={reviewText.line}>That playlist is gone.</Text>
  if (!members) return <Text style={reviewText.note}>Reading {playlist.name}…</Text>
  const playlistId = playlist.id
  const name = playlist.name

  const undoToast = (text: string, undo: () => Promise<unknown>): void => {
    showToast(text, 'good', {
      actions: [
        {
          label: 'Undo',
          onPress: () => {
            undo().then(
              () => showToast(`Put ${name} back`, 'info'),
              // The edit that failed said so.
              () => undefined,
            )
          },
        },
      ],
    })
  }

  if (answer.op === 'sort') {
    const before = [...current]
    const same = here.songIds.every((id, index) => id === before[index])
    const sort = async (): Promise<void> => {
      setSorting(true)
      try {
        await reorder.mutateAsync({ playlistId, songIds: here.songIds })
        undoToast(`Sorted ${name}`, () => reorder.mutateAsync({ playlistId, songIds: before }))
        onDone()
      } catch {
        // The edit says what failed itself.
        setSorting(false)
      }
    }
    return (
      <>
        <Text style={styles.head}>
          Sort {name} {answer.sortBy ? sortWords(answer.sortBy, answer.order) : ''}
        </Text>
        {same ? (
          <Text style={reviewText.note}>It is in that order already.</Text>
        ) : (
          <View style={styles.preview}>
            {here.songIds.slice(0, 6).map((id, index) => {
              const song = songsById.get(id)
              return song ? (
                <Text key={id} style={reviewText.name} numberOfLines={1}>
                  <Text style={reviewText.meta}>{index + 1}. </Text>
                  {song.title}
                  <Text style={reviewText.meta}> · {artistOr(song.artist)}</Text>
                </Text>
              ) : null
            })}
            {here.songIds.length > 6 ? (
              <Text style={reviewText.meta}>and {here.songIds.length - 6} more</Text>
            ) : null}
          </View>
        )}
        <View style={styles.actions}>
          <Button label="Close" onPress={onDone} />
          <Button
            label="Sort"
            variant="primary"
            disabled={same}
            busy={sorting}
            onPress={() => void sort()}
            testID="ask-playlist-sort"
          />
        </View>
      </>
    )
  }

  const adding = answer.op === 'add'
  const chosen = answer.understanding
    ? parts(answer.understanding, library?.tags ?? []).map(part => part.label)
    : []
  const unknown =
    answer.unknown.length > 0 ? `Your library has no ${answer.unknown.join(', ')}.` : null

  if (here.songIds.length === 0) {
    return (
      <View style={{ gap: 4 }}>
        <Text style={reviewText.line} testID="ask-playlist-nothing">
          {adding
            ? `Every song that fits is in ${name} already.`
            : `None of ${name}’s songs fit that.`}
        </Text>
        {unknown ? <Text style={reviewText.note}>{unknown}</Text> : null}
      </View>
    )
  }

  // The one change an add or a remove is, in a review's terms.
  const edit: Reviewed = { change: { key: 'edit', by: answer.by }, songIds: here.songIds }
  const apply = async (
    approved: readonly Reviewed[],
    leftOut: ReadonlySet<string>,
  ): Promise<boolean> => {
    const songIds = approved.flatMap(each => keptSongs(each, leftOut))
    if (songIds.length === 0) return false
    const before = [...current]
    try {
      if (adding) {
        await add.mutateAsync({ playlistId, songIds })
        undoToast(`Added ${plural(songIds.length, 'song', 'songs')} to ${name}`, () =>
          removeMany.mutateAsync({ playlistId, songIds }),
        )
      } else {
        await removeMany.mutateAsync({ playlistId, songIds })
        undoToast(`Took ${plural(songIds.length, 'song', 'songs')} out of ${name}`, async () => {
          await add.mutateAsync({ playlistId, songIds })
          await reorder.mutateAsync({ playlistId, songIds: before })
        })
      }
      return true
    } catch {
      // The edit says what failed itself.
      return false
    }
  }

  return (
    <Review
      changes={[edit]}
      sectionOf={() => 'Songs'}
      head={adding ? `Add to ${name}` : `Take out of ${name}`}
      tickedText={(approved, leftOut) => {
        const count = approved.flatMap(each => keptSongs(each, leftOut)).length
        return `${plural(count, 'song', 'songs')} ticked.`
      }}
      notes={unknown ? [unknown] : []}
      bandText={{
        rule: {
          title: 'Fit what you asked',
          note: 'Chosen by what you said, so they start ticked.',
        },
        model: {
          title: 'Worth a look',
          note: 'Suggested picks. Nothing here changes unless you tick it.',
        },
      }}
      drawChange={(each, state) => {
        const count = state.on ? state.kept.length : each.songIds.length
        return (
          <>
            <Text style={reviewText.name}>
              <Text style={adding ? reviewText.new : reviewText.gone}>
                {adding ? '+ ' : '− '}
                {plural(count, 'song', 'songs')}
              </Text>
            </Text>
            <Text style={reviewText.meta} numberOfLines={2}>
              {chosen.length > 0 ? chosen.join(' · ') : 'What you asked for'}
            </Text>
          </>
        )
      }}
      labelOf={each =>
        `${adding ? 'Add' : 'Take out'} ${plural(each.songIds.length, 'song', 'songs')}`
      }
      songLine={song => {
        const why = here.why.get(song.id)
        return `${artistOr(song.artist)}${why ? ` · ${why}` : ''}`
      }}
      applyLabel={(approved, leftOut) => {
        const count = approved.flatMap(each => keptSongs(each, leftOut)).length
        if (count === 0) return adding ? 'Add' : 'Take out'
        return `${adding ? 'Add' : 'Take out'} ${plural(count, 'song', 'songs')}`
      }}
      keyWord={adding ? 'add' : 'take out'}
      onApply={apply}
      height={height}
      onClose={onDone}
      onKeys={onKeys}
      testID="ask-playlist"
      openAtFirst={['edit']}
    />
  )
}

const styles = StyleSheet.create(theme => ({
  head: { color: theme.colors.textPrimary, fontSize: 15.5, fontWeight: '600' },
  preview: { gap: 3, paddingVertical: space.xs },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: space.sm, marginTop: space.xs },
}))
