import { useState } from 'react'
import type { ReactNode } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useMutation } from '@tanstack/react-query'
import type { DescribeResult, Understanding } from '@selfmp3/shared'
import { failureText, radius, space, useCreatePlaylist, useLibrary } from '@selfmp3/client'
import { ROW_COVER_SIZE } from '../../offline/coverStore'
import { useArt } from '../../offline/useArt'
import { Button } from '../../ui/components/Button'
import { Checkbox } from '../../ui/components/Checkbox'
import { Chip } from '../../ui/components/Chip'
import { Cover } from '../../ui/components/Cover'
import { X } from '../../ui/components/Icons'
import { useSongsById } from '../../ui/songsById'
import { followRules } from '../library/saveTags'
import { newPlaylist } from '../playlists/playlists.model'
import { describeNotes, onlyTags, parts, picksHere, tagIdsFor } from './smart.model'
import { useSmartServer } from './useSmartServer'

/**
 * Songs picked from a description (docs/features/ai.md): what it understood,
 * as chips that can be taken away, and the picks, each with a reason. New
 * playlist's Let it pick (N1); Search's Ask shows its songs as a card and a
 * page instead (`SongsAnswerCard`, `AnswerScreen`), to be played before kept.
 *
 * Taking a chip away does not read the words again: Pick again chooses from
 * what the remaining chips let in. Keeping it makes an ordinary playlist of the
 * picks, or, when what was understood is tags and nothing else, one that
 * follows them.
 */
export function SongsAnswer({
  result: first,
  text,
  name,
  onSaved,
  onCancel,
}: {
  result: DescribeResult
  text: string
  /** A name typed elsewhere, which wins over the one the words suggest. */
  name?: string
  onSaved: (playlistId: number) => void
  onCancel?: () => void
}): ReactNode {
  const { theme } = useUnistyles()
  const server = useSmartServer()
  const { data: library } = useLibrary()
  const { mutateAsync: createPlaylist } = useCreatePlaylist()
  const artFor = useArt(ROW_COVER_SIZE)

  const [result, setResult] = useState(first)
  /** The chips as they stand after taking some away; null while they are the answer's. */
  const [edited, setEdited] = useState<Understanding | null>(null)
  const [left, setLeft] = useState<ReadonlySet<number>>(new Set())
  const [keepFilled, setKeepFilled] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const again = useMutation({
    mutationFn: (understanding: Understanding) => {
      if (!server.api) throw new Error('your server isn’t reachable')
      return server.api.describePlaylist({ text, understanding })
    },
    onSuccess: answer => {
      setResult(answer)
      setEdited(null)
      setLeft(new Set())
      setKeepFilled(false)
    },
  })

  const tags = library?.tags ?? []
  const songsById = useSongsById()
  const understanding = edited ?? result.understanding
  const picks = picksHere(result, server.onDevice).filter(
    pick => !left.has(pick.songId) && songsById.has(pick.songId),
  )
  const follows = onlyTags(understanding) && keepFilled
  const ready = edited === null && (follows || picks.length > 0)

  const save = async (): Promise<void> => {
    if (!ready || busy) return
    setBusy(true)
    setError(null)
    const title = name?.trim() || understanding.name
    try {
      if (follows) {
        const input = newPlaylist('live', title, {
          rules: followRules({
            tagIds: tagIdsFor(understanding.anyTags, tags),
            sort: 'addedAt',
            descending: true,
          }),
        })
        if (!input) return
        onSaved((await createPlaylist({ input })).id)
        return
      }
      const input = newPlaylist('manual', title)
      if (!input) return
      const created = await createPlaylist({ input, songIds: picks.map(each => each.songId) })
      onSaved(created.id)
    } catch (caught) {
      setError(failureText(`Couldn’t make “${title}”`, caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={styles.body} testID="songs-answer">
      <View style={styles.understood} testID="songs-answer-understood">
        <Text style={styles.label}>Understood as</Text>
        <View style={styles.chips}>
          {parts(understanding, tags).map(part => {
            const takeAway = (): void => setEdited(part.without(understanding))
            return (
              <Chip
                key={part.key}
                compact
                label={part.label}
                hue={part.hue}
                selected={false}
                onPress={takeAway}
                onRemove={takeAway}
              />
            )
          })}
          {understanding.brief ? <Text style={styles.brief}>“{understanding.brief}”</Text> : null}
        </View>
        {edited ? (
          <Text style={styles.hint}>Changed. Pick again to choose from what these let in.</Text>
        ) : (
          describeNotes(result, picks.length).map(note => (
            <Text key={note} style={styles.hint}>
              {note}
            </Text>
          ))
        )}
      </View>

      {!edited && picks.length > 0 ? (
        <ScrollView style={styles.list} testID="songs-answer-picks">
          {picks.map(each => {
            const song = songsById.get(each.songId)!
            return (
              <View key={song.id} style={styles.row}>
                <Cover uri={artFor(song)} title={song.album || song.title} size={36} />
                <View style={styles.text}>
                  <Text style={styles.title} numberOfLines={1}>
                    {song.title}
                  </Text>
                  <Text style={styles.why} numberOfLines={1}>
                    {each.why ?? (song.artist || 'Unknown artist')}
                  </Text>
                </View>
                <Pressable
                  onPress={() => setLeft(current => new Set([...current, song.id]))}
                  accessibilityRole="button"
                  accessibilityLabel={`Leave out ${song.title}`}
                  style={({ pressed }) => [styles.leave, pressed && styles.pressed]}
                >
                  <X size={14} color={theme.colors.textMuted} />
                </Pressable>
              </View>
            )
          })}
        </ScrollView>
      ) : null}

      {!edited && onlyTags(understanding) ? (
        <Pressable
          onPress={() => setKeepFilled(on => !on)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: keepFilled }}
          accessibilityLabel="Fill it from these tags as they grow"
          style={styles.checkRow}
        >
          <Checkbox checked={keepFilled} />
          <Text style={styles.checkLabel}>Fill it from these tags as they grow</Text>
        </Pressable>
      ) : null}

      {again.isPending ? (
        <Text style={styles.hint} accessibilityLiveRegion="polite">
          Picking again from what is left.
        </Text>
      ) : null}
      {again.error ? (
        <Text style={styles.error}>{failureText('Couldn’t pick again', again.error)}</Text>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.actions}>
        {onCancel ? <Button label="Cancel" onPress={onCancel} /> : null}
        {edited ? (
          <Button
            label="Pick again"
            variant="primary"
            disabled={!server.api}
            busy={again.isPending}
            onPress={() => again.mutate(edited)}
            testID="songs-answer-again"
          />
        ) : (
          <Button
            label="Create"
            variant="primary"
            disabled={!ready}
            busy={busy}
            onPress={() => void save()}
            testID="songs-answer-save"
          />
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  body: { gap: space.sm },
  understood: { gap: 6 },
  label: {
    color: theme.colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.9,
    textTransform: 'uppercase',
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  brief: { color: theme.colors.textSecondary, fontSize: 12.5, fontStyle: 'italic' },
  hint: { color: theme.colors.textMuted, fontSize: 12, flexShrink: 1 },
  // Short enough that the buttons under it stay on a laptop's screen.
  list: { maxHeight: 220 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 5 },
  text: { flex: 1, minWidth: 0 },
  title: { color: theme.colors.textPrimary, fontSize: 13, fontWeight: '500' },
  why: { color: theme.colors.textMuted, fontSize: 11.5 },
  leave: {
    width: 30,
    height: 30,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.6 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 4 },
  checkLabel: { color: theme.colors.textPrimary, fontSize: 13.5, flexShrink: 1 },
  error: { color: theme.colors.danger, fontSize: 12 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: space.sm, marginTop: space.xs },
}))
