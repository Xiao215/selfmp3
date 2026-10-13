import { useState } from 'react'
import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { useQueryClient } from '@tanstack/react-query'
import { plural, type AskAnswer, type Playlist } from '@selfmp3/shared'
import {
  clientApi,
  failureText,
  queryKeys,
  radius,
  space,
  type,
  useCreatePlaylist,
  useLibrary,
} from '@selfmp3/client'
import { Button } from '../../ui/components/Button'
import { Checkbox, CheckRow } from '../../ui/components/Checkbox'
import { showToast, showUndoToast } from '../../ui/toast'
import { PlaylistCover } from '../playlists/PlaylistCover'
import { FOLLOWS_LABEL, isLive, newPlaylist } from '../playlists/playlists.model'
import { StatusLine } from '../../ui/components/StatusLine'
import { AnswerActions, AnswerHead, AnswerLine, AnswerNote } from './AnswerParts'

/** A playlist as it was, so a delete can be undone: its songs in their order, its rules. */
interface Kept {
  readonly playlist: Playlist
  readonly songIds: readonly number[]
}

/**
 * Ask's answer to "delete…" or "rename…" playlists (docs/features/ai.md): a
 * proposal, like every answer. The playlists it found are listed by their real
 * names, each ticked; nothing changes until the button is pressed, which is
 * the confirmation, and the message after it has Undo — a deleted playlist
 * comes back with its name, its songs in their order and its tags to fill
 * from.
 */
export function PlaylistsAnswer({
  answer,
  onDone,
}: {
  answer: Extract<AskAnswer, { kind: 'playlists' }>
  onDone: () => void
}): ReactNode {
  const { data: library } = useLibrary()
  const queryClient = useQueryClient()
  const { mutateAsync: createPlaylist } = useCreatePlaylist()
  const found = answer.names.flatMap(
    name => library?.playlists.filter(playlist => playlist.name === name) ?? [],
  )
  const [ticked, setTicked] = useState<ReadonlySet<number>>(
    () => new Set(found.map(playlist => playlist.id)),
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const renaming = answer.op === 'rename'
  const chosen = found.filter(playlist => ticked.has(playlist.id))
  const refresh = (): Promise<void> =>
    queryClient.invalidateQueries({ queryKey: queryKeys.library })

  if (found.length === 0) {
    return <AnswerLine>Those playlists are gone already.</AnswerLine>
  }

  const remove = async (): Promise<void> => {
    if (chosen.length === 0 || busy) return
    setBusy(true)
    setError(null)
    try {
      const api = clientApi()
      const kept: Kept[] = []
      for (const playlist of chosen) {
        const songIds = isLive(playlist) ? [] : (await api.playlistSongs(playlist.id)).songIds
        kept.push({ playlist, songIds })
      }
      for (const { playlist } of kept) await api.deletePlaylist(playlist.id)
      await refresh()
      // `restore` says how it went itself.
      showUndoToast(
        kept.length === 1
          ? `Deleted “${kept[0]!.playlist.name}”`
          : `Deleted ${plural(kept.length, 'playlist', 'playlists')}`,
        () => restore(kept),
        { tone: 'good' },
      )
      onDone()
    } catch (caught) {
      setError(failureText('Couldn’t delete them', caught))
    } finally {
      setBusy(false)
    }
  }

  const restore = async (kept: readonly Kept[]): Promise<void> => {
    try {
      for (const { playlist, songIds } of kept) {
        const input = newPlaylist(playlist.kind, playlist.name, {
          description: playlist.description,
          rules: playlist.rules ?? undefined,
        })
        if (!input) continue
        // The library is asked once, below, for all of them.
        await createPlaylist({ input, songIds, refresh: 'none' })
      }
      await refresh()
      showToast(kept.length === 1 ? 'It’s back' : 'They’re back', 'good')
    } catch (caught) {
      showToast(failureText('Couldn’t bring them back', caught), 'error')
    }
  }

  const rename = async (): Promise<void> => {
    const playlist = found[0]
    const to = answer.newName
    if (!playlist || !to || busy) return
    setBusy(true)
    setError(null)
    try {
      await clientApi().updatePlaylist(playlist.id, { name: to })
      await refresh()
      showUndoToast(
        `Renamed to “${to}”`,
        () => clientApi().updatePlaylist(playlist.id, { name: playlist.name }).then(refresh),
        { tone: 'good', failed: 'Couldn’t undo that' },
      )
      onDone()
    } catch (caught) {
      setError(failureText('Couldn’t rename it', caught))
    } finally {
      setBusy(false)
    }
  }

  const toggle = (id: number): void =>
    setTicked(current => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <View style={styles.body} testID="playlists-answer">
      <AnswerHead>
        {renaming
          ? 'Rename this playlist?'
          : found.length === 1
            ? 'Delete this playlist?'
            : 'Delete these playlists?'}
      </AnswerHead>
      {(renaming ? found.slice(0, 1) : found).map(playlist => {
        const on = ticked.has(playlist.id)
        const meta = [
          plural(playlist.songCount, 'song', 'songs'),
          isLive(playlist) ? FOLLOWS_LABEL : null,
        ]
          .filter(Boolean)
          .join(' · ')
        const row = (
          <>
            <PlaylistCover playlist={playlist} size={40} />
            <View style={styles.text}>
              <Text style={styles.name} numberOfLines={1}>
                {renaming ? (
                  <>
                    <Text style={styles.old}>{playlist.name}</Text>
                    <Text style={styles.arrow}>{'  →  '}</Text>
                    {answer.newName}
                  </>
                ) : (
                  playlist.name
                )}
              </Text>
              <Text style={styles.meta}>{meta}</Text>
            </View>
          </>
        )
        return renaming ? (
          <View key={playlist.id} style={styles.row}>
            {row}
          </View>
        ) : (
          <CheckRow
            key={playlist.id}
            checked={on}
            label={playlist.name}
            onPress={() => toggle(playlist.id)}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            {row}
            <Checkbox checked={on} />
          </CheckRow>
        )
      })}
      {answer.unknown.length > 0 ? (
        <AnswerNote>
          No playlist here is called {answer.unknown.map(name => `“${name}”`).join(' or ')}.
        </AnswerNote>
      ) : null}
      {error ? <StatusLine>{error}</StatusLine> : null}
      <AnswerActions>
        <Button label="Cancel" onPress={onDone} />
        {renaming ? (
          <Button
            label="Rename"
            variant="primary"
            busy={busy}
            onPress={() => void rename()}
            testID="playlists-answer-rename"
          />
        ) : (
          <Button
            label={
              chosen.length === 0
                ? 'Delete'
                : `Delete ${plural(chosen.length, 'playlist', 'playlists')}`
            }
            variant="danger"
            disabled={chosen.length === 0}
            busy={busy}
            onPress={() => void remove()}
            testID="playlists-answer-delete"
          />
        )}
      </AnswerActions>
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  body: { gap: space.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: 6,
    paddingHorizontal: space.xs,
    borderRadius: radius.coverSm,
  },
  pressed: { opacity: 0.7 },
  text: { flex: 1, minWidth: 0, gap: 2 },
  name: { color: theme.colors.textPrimary, fontSize: type.body, fontWeight: '500' },
  old: { color: theme.colors.textMuted, fontWeight: '400' },
  arrow: { color: theme.colors.textMuted },
  meta: { color: theme.colors.textMuted, fontSize: type.small },
}))
