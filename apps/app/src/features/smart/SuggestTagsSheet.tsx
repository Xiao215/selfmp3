import { useState } from 'react'
import type { ReactNode } from 'react'
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useQuery } from '@tanstack/react-query'
import { plural } from '@selfmp3/shared'
import { failureText, radius, space, useBulkTag, useCreateTag, useLibrary } from '@selfmp3/client'
import { ServerAway } from '../../connection/ServerAway'
import { Button } from '../../ui/components/Button'
import { Chip } from '../../ui/components/Chip'
import { Check, X } from '../../ui/components/Icons'
import { Sheet } from '../../ui/components/Sheet'
import { showToast } from '../../ui/toast'
import { suggestionsHere, type SuggestionHere } from './smart.model'
import { useSmartServer } from './useSmartServer'

/**
 * A7 · Suggest tags (docs/features/ai.md), opened from the untagged card.
 *
 * One row per tag, so 99 songs of Mandarin pop are one decision. A row's tag
 * is drawn dashed until it is taken: it is a suggestion, not yours yet. Look
 * through lists its songs and lets any be left out; Take is the ordinary
 * "add this tag to these songs" edit, and a tag that does not exist yet is
 * made first.
 */
export function SuggestTagsSheet({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}): ReactNode {
  const server = useSmartServer()
  const { data: library } = useLibrary()
  const createTag = useCreateTag()
  const bulkTag = useBulkTag()
  const { theme } = useUnistyles()

  const [opened, setOpened] = useState<string | null>(null)
  const [left, setLeft] = useState<ReadonlySet<number>>(new Set())
  const [taken, setTaken] = useState<ReadonlySet<string>>(new Set())
  const [taking, setTaking] = useState<string | null>(null)

  const via = server.reach.state === 'reachable' ? server.reach.connection.baseUrl : null
  const answer = useQuery({
    queryKey: ['via-server', via, 'ai', 'tag-suggestions'],
    queryFn: () => server.api!.tagSuggestions(),
    enabled: open && server.api !== null,
    retry: false,
    staleTime: 10 * 60_000,
  })

  const tags = library?.tags ?? []
  const songsById = new Map((library?.songs ?? []).map(song => [song.id, song]))
  const rows = answer.data ? suggestionsHere(answer.data.suggestions, server.onDevice, tags) : []
  const untaken = rows.filter(row => !taken.has(row.suggestion.tag))
  const songsOf = (row: SuggestionHere): number[] =>
    row.songIds.filter(id => !left.has(id) && songsById.get(id)?.tagIds.length === 0)

  const take = async (row: SuggestionHere): Promise<boolean> => {
    const songIds = songsOf(row)
    if (songIds.length === 0) return true
    setTaking(row.suggestion.tag)
    try {
      const tag = row.tag ?? (await createTag.mutateAsync({ name: row.suggestion.tag }))
      await bulkTag.mutateAsync({ songIds, tagId: tag.id, action: 'add' })
      setTaken(current => new Set([...current, row.suggestion.tag]))
      return true
    } catch {
      // The mutations say what failed themselves.
      return false
    } finally {
      setTaking(null)
    }
  }

  const takeAll = async (): Promise<void> => {
    let songs = 0
    for (const row of untaken) {
      const count = songsOf(row).length
      if (!(await take(row))) return
      songs += count
    }
    showToast(`Tagged ${plural(songs, 'song', 'songs')}`, 'good')
    onClose()
  }

  let body: ReactNode
  if (server.reach.state !== 'reachable') {
    body = <ServerAway reach={server.reach} need="ai" testID="suggest-tags-server" />
  } else if (answer.isPending) {
    body = (
      <View style={styles.waiting} accessibilityLiveRegion="polite" testID="suggest-tags-waiting">
        <ActivityIndicator color={theme.colors.textMuted} />
        <Text style={styles.hint}>Reading your untagged songs. This can take half a minute.</Text>
      </View>
    )
  } else if (answer.error) {
    body = (
      <View style={styles.waiting}>
        <Text style={styles.error}>{failureText('Couldn’t suggest tags', answer.error)}</Text>
        <Button label="Try again" onPress={() => void answer.refetch()} />
      </View>
    )
  } else if (rows.length === 0) {
    body = <Text style={styles.hint}>Nothing to suggest: every song here has a tag.</Text>
  } else {
    body = (
      <ScrollView style={styles.list} testID="suggest-tags-list">
        {rows.map(row => {
          const { suggestion } = row
          const done = taken.has(suggestion.tag)
          const count = songsOf(row).length
          const looking = opened === suggestion.tag
          return (
            <View key={suggestion.tag} style={styles.suggestion}>
              <View style={styles.head}>
                <Chip
                  compact
                  label={suggestion.isNew && !row.tag ? `New: ${suggestion.tag}` : suggestion.tag}
                  hue={row.tag?.hue}
                  selected={done}
                  dashed={!done}
                  onPress={() => setOpened(looking ? null : suggestion.tag)}
                />
                <View style={styles.text}>
                  <Text style={styles.title} numberOfLines={1}>
                    {plural(count, 'song', 'songs')} · {suggestion.who}
                  </Text>
                  <Text style={styles.why} numberOfLines={2}>
                    {suggestion.why}
                    {suggestion.from === 'library' ? ' · from your library' : ''}
                  </Text>
                </View>
                {done ? (
                  <View style={styles.done}>
                    <Check size={14} color={theme.colors.textMuted} />
                    <Text style={styles.why}>Added</Text>
                  </View>
                ) : (
                  <View style={styles.rowActions}>
                    <Button
                      label={looking ? 'Hide' : 'Look through'}
                      onPress={() => setOpened(looking ? null : suggestion.tag)}
                    />
                    {/* Quiet, like AddSongsSheet's +: the accent is Take all's alone. */}
                    <Button
                      label="Take"
                      disabled={count === 0 || taking !== null}
                      busy={taking === suggestion.tag}
                      onPress={() => void take(row)}
                      testID={`suggest-tags-take-${suggestion.tag}`}
                    />
                  </View>
                )}
              </View>
              {looking && !done
                ? songsOf(row).map(id => {
                    const song = songsById.get(id)!
                    return (
                      <View key={id} style={styles.song}>
                        <Text style={styles.songTitle} numberOfLines={1}>
                          {song.title}
                          <Text style={styles.why}> · {song.artist || 'Unknown artist'}</Text>
                        </Text>
                        <Pressable
                          onPress={() => setLeft(current => new Set([...current, id]))}
                          accessibilityRole="button"
                          accessibilityLabel={`Leave ${song.title} out`}
                          style={({ pressed }) => [styles.leave, pressed && styles.pressed]}
                        >
                          <X size={13} color={theme.colors.textMuted} />
                        </Pressable>
                      </View>
                    )
                  })
                : null}
            </View>
          )
        })}
        {answer.data && answer.data.unsure.length > 0 ? (
          <Text style={[styles.hint, styles.unsure]}>
            Left alone: {answer.data.unsure.map(each => `${each.who} (${each.why})`).join(' · ')}
          </Text>
        ) : null}
      </ScrollView>
    )
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Suggested tags"
      subtitle={
        answer.data
          ? `For ${plural(answer.data.untagged, 'song', 'songs')} without a tag`
          : 'For songs without a tag'
      }
      width={640}
      testID="suggest-tags"
    >
      <View style={styles.body}>
        {body}
        <View style={styles.actions}>
          <Button label="Close" onPress={onClose} />
          <Button
            label="Take all"
            variant="primary"
            disabled={untaken.length === 0 || taking !== null}
            onPress={() => void takeAll()}
            testID="suggest-tags-take-all"
          />
        </View>
      </View>
    </Sheet>
  )
}

const styles = StyleSheet.create(theme => ({
  body: { gap: space.sm, padding: space.sm },
  list: { maxHeight: 460 },
  suggestion: {
    gap: 4,
    paddingVertical: space.sm,
    paddingHorizontal: space.sm,
    marginBottom: space.xs,
    borderRadius: radius.card,
    backgroundColor: theme.colors.surface2,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  text: { flex: 1, minWidth: 160 },
  title: { color: theme.colors.textPrimary, fontSize: 13.5, fontWeight: '600' },
  why: { color: theme.colors.textMuted, fontSize: 12 },
  rowActions: { flexDirection: 'row', gap: 6 },
  done: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  song: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingLeft: space.sm },
  songTitle: { flex: 1, color: theme.colors.textPrimary, fontSize: 12.5 },
  leave: {
    width: 26,
    height: 26,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.6 },
  waiting: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.sm },
  hint: { color: theme.colors.textMuted, fontSize: 12, flexShrink: 1 },
  unsure: { paddingTop: space.xs },
  error: { color: theme.colors.danger, fontSize: 12, flexShrink: 1 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: space.sm },
}))
