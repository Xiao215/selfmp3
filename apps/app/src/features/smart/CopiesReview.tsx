import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import {
  artistOr,
  formatDuration,
  plural,
  type CopiesResult,
  type Library,
  type Song,
} from '@selfmp3/shared'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys, space, useMergeSongs } from '@selfmp3/client'
import { useDownloads } from '../../offline/DownloadsProvider'
import { usePlayerCommands } from '../../player/PlayerProvider'
import { Button } from '../../ui/components/Button'
import { Dialog, DialogHead } from '../../ui/components/Dialog'
import { useSongsById } from '../../ui/songsById'
import { dialogPanel, lineSub } from '../../ui/surfaces'
import { showPendingToast } from '../../ui/toast'
import type { AnswerKeys } from './answerKeys'
import { AnswerLine, AnswerNote } from './AnswerParts'
import { Review, reviewText } from './Review'
import { copiesHere, keptSongs, type CopyHere } from './smart.model'
import { useSmartServer } from './useSmartServer'

/**
 * A4 · songs in the library more than once (docs/features/ai.md, "Copies"):
 * each song with the copy that stays, open to the extra copies to delete, in
 * the review's two bands — copies with nothing between them, ticked, and the
 * model's, waiting.
 *
 * Deleting an extra copy loses nothing of it: each is folded into the copy
 * kept first (`POST /api/songs/merge`, `songMerged` in docs/SYNC.md) — its
 * tags, love, places in playlists and plays go there, and what the kept copy
 * lacks is filled in from it — and only its file goes. The button still asks
 * once, since the file does go, without the warning a plain delete carries,
 * and the fold waits out its Undo before it is sent (`FoldCopies`).
 */
export function CopiesReview({
  result,
  height,
  onClose,
  onKeys,
}: {
  result: CopiesResult
  height: number
  onClose?: () => void
  onKeys?: (keys: AnswerKeys | null) => void
}): ReactNode {
  const server = useSmartServer()
  const songsById = useSongsById()
  const here = useMemo(
    () => copiesHere(result.copies, server.onDevice, songsById),
    [result.copies, server.onDevice, songsById],
  )
  /** The fold waiting for its yes, and what to tell the review when it is answered. */
  const [folding, setFolding] = useState<{
    copies: readonly { keep: Song; extra: Song[] }[]
    answer: (done: boolean) => void
  } | null>(null)

  if (here.length === 0) {
    return (
      <View style={{ gap: space.sm }}>
        <AnswerLine testID="copies-nothing">No song is in your library twice.</AnswerLine>
        {result.note ? <AnswerNote>{result.note}</AnswerNote> : null}
      </View>
    )
  }

  const extraOf = (each: CopyHere, leftOut: ReadonlySet<string>): Song[] =>
    keptSongs(each, leftOut).flatMap(id => songsById.get(id) ?? [])
  const extra = (approved: readonly CopyHere[], leftOut: ReadonlySet<string>): Song[] =>
    approved.flatMap(each => extraOf(each, leftOut))

  return (
    <>
      <Review
        changes={here}
        sectionOf={each => each.change.why}
        head={`${plural(here.length, 'song is', 'songs are')} in your library twice`}
        tickedText={(approved, leftOut) =>
          `${approved.length} ticked, ${plural(extra(approved, leftOut).length, 'copy', 'copies')} to delete.`
        }
        notes={result.note ? [result.note] : []}
        bandText={{
          rule: {
            title: 'Exact copies',
            note: 'The same names, album and length, so they start ticked.',
          },
          model: {
            title: 'Worth a look',
            note: 'The model thinks these are one recording. Nothing is deleted unless you tick it.',
          },
        }}
        drawChange={each => (
          <>
            <Text style={reviewText.name} numberOfLines={2}>
              {each.keep.title}
              <Text style={reviewText.meta}>{`  ${artistOr(each.keep.artist)}`}</Text>
            </Text>
            <Text style={reviewText.meta} numberOfLines={1}>
              {`Keeps one · ${copyWords(each.keep)}`}
            </Text>
          </>
        )}
        labelOf={each =>
          `${each.keep.title}: delete ${plural(each.songIds.length, 'extra copy', 'extra copies')}`
        }
        songLine={copyWords}
        applyLabel={(approved, leftOut) => {
          const count = extra(approved, leftOut).length
          return count === 0 ? 'Delete' : `Delete ${plural(count, 'copy', 'copies')}`
        }}
        keyWord="delete"
        onApply={(approved, leftOut) =>
          new Promise<boolean>(answer => {
            const copies = approved
              .map(each => ({ keep: each.keep, extra: extraOf(each, leftOut) }))
              .filter(each => each.extra.length > 0)
            if (copies.length === 0) answer(false)
            else setFolding({ copies, answer })
          })
        }
        height={height}
        onClose={onClose}
        onKeys={onKeys}
        testID="copies"
        openAtFirst={here.map(each => each.change.key)}
      />
      {folding ? (
        <FoldCopies
          copies={folding.copies}
          onCancel={() => {
            folding.answer(false)
            setFolding(null)
          }}
          onDone={() => {
            folding.answer(true)
            setFolding(null)
          }}
        />
      ) : null}
    </>
  )
}

/**
 * The one question before the extra copies go: what happens to them, in
 * words. Nothing of theirs is lost, so there is no warning; the files do go.
 *
 * Delete is not sent at once (`showPendingToast`): the copies leave the
 * library here at once and the message says they are deleted, with Undo, but
 * the fold is sent only once Undo has gone — or the app is leaving — since a
 * fold made cannot be taken back. Undo brings them back with nothing written.
 * As a delete does, the copies' downloads and their place in the player are
 * let go when it is sent.
 */
function FoldCopies({
  copies,
  onCancel,
  onDone,
}: {
  copies: readonly { keep: Song; extra: Song[] }[]
  onCancel: () => void
  onDone: () => void
}): ReactNode {
  const merge = useMergeSongs()
  const player = usePlayerCommands()
  const { dropDownloads } = useDownloads()
  const client = useQueryClient()
  const count = copies.reduce((sum, each) => sum + each.extra.length, 0)
  const one = count === 1

  const confirm = (): void => {
    const ids = copies.flatMap(each => each.extra.map(song => song.id))
    const gone = new Set(ids)
    onDone()
    // Out of the library drawn here at once. Asking for the library again
    // brings them back: after an Undo, and after a fold that failed.
    client.setQueryData<Library>(
      queryKeys.library,
      library => library && { ...library, songs: library.songs.filter(song => !gone.has(song.id)) },
      { updatedAt: client.getQueryState(queryKeys.library)?.dataUpdatedAt },
    )
    const back = (): void => void client.invalidateQueries({ queryKey: queryKeys.library })
    showPendingToast(
      one
        ? {
            say: 'Deleted the extra copy',
            under: 'Its plays and tags are on the one kept.',
          }
        : {
            say: `Deleted ${count} extra copies`,
            under: 'Their plays and tags are on the ones kept.',
          },
      async () => {
        void dropDownloads(ids)
        player.forgetSongs(ids)
        try {
          for (const each of copies) {
            await merge.mutateAsync({
              keep: each.keep.id,
              songIds: each.extra.map(song => song.id),
            })
          }
        } catch (caught) {
          back()
          throw caught
        }
      },
      {
        tone: 'good',
        failed: one ? 'Couldn’t delete it' : 'Couldn’t delete them',
        undone: back,
        songs: copies.map(each => each.keep).slice(-3),
      },
    )
  }

  return (
    <Dialog onDismiss={onCancel} dismissLabel="Cancel" testID="fold-copies" style={styles.dialog}>
      <DialogHead
        title={one ? 'Delete the extra copy?' : `Delete ${count} extra copies?`}
        onClose={onCancel}
        closeLabel="Cancel"
        style={styles.head}
      />
      <View style={styles.body}>
        <Text style={styles.lede}>
          {one
            ? 'Its tags, plays, love and places in playlists move to the copy you keep, and anything that copy lacks is filled in from it. Then its file is deleted.'
            : 'Their tags, plays, love and places in playlists move to the copies you keep, and anything those lack is filled in from them. Then their files are deleted.'}
        </Text>
      </View>
      <View style={styles.actions}>
        <Button label="Cancel" onPress={onCancel} />
        <Button
          label={one ? 'Delete copy' : `Delete ${count} copies`}
          variant="primary"
          onPress={confirm}
          testID="fold-copies-confirm"
        />
      </View>
    </Dialog>
  )
}

const styles = StyleSheet.create(theme => ({
  dialog: dialogPanel(theme.colors, 'form'),
  head: { paddingTop: space.lg, paddingRight: space.md, paddingLeft: 18 },
  body: { paddingVertical: space.md, paddingHorizontal: 18, gap: space.md },
  lede: lineSub(theme.colors),
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: space.sm,
    paddingHorizontal: 18,
    paddingBottom: space.lg,
  },
}))

/** A copy in words, the kept one and each extra alike, so they can be told apart. */
function copyWords(song: Song): string {
  const plays = song.playCount > 0 ? ` · ${plural(song.playCount, 'play', 'plays')}` : ''
  return `${song.album || 'No album'} · ${formatDuration(song.duration)}${plays}`
}
