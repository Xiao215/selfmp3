import { useState } from 'react'
import type { ReactNode } from 'react'
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useMutation } from '@tanstack/react-query'
import type { DescribeResult, Understanding } from '@selfmp3/shared'
import { clientApi, failureText, radius, space, useLibrary } from '@selfmp3/client'
import { ServerAway } from '../../connection/ServerAway'
import { ROW_COVER_SIZE } from '../../offline/coverStore'
import { useArt } from '../../offline/useArt'
import { useAccent } from '../../ui/accent'
import { Button } from '../../ui/components/Button'
import { Checkbox } from '../../ui/components/Checkbox'
import { Chip } from '../../ui/components/Chip'
import { Cover } from '../../ui/components/Cover'
import { X } from '../../ui/components/Icons'
import { followRules } from '../library/saveTags'
import { describeNotes, onlyTags, parts, picksHere, tagIdsFor } from '../smart/smart.model'
import { useSmartServer } from '../smart/useSmartServer'
import { newPlaylist } from './playlists.model'

/**
 * A1c · Describe a playlist (docs/features/ai.md), inside New playlist.
 *
 * You write what you want; the server says what it understood, as chips you
 * can take away, and picks songs from inside them with a reason for each.
 * Taking a chip away does not read the words again: Pick again chooses from
 * what the remaining chips let in. What is made is an ordinary playlist of the
 * picks, or, when what was understood is tags and nothing else, one that
 * follows them and keeps itself filled.
 */
export function DescribePlaylist({
  name,
  onCreated,
  onCancel,
}: {
  /** The name typed above, which wins over the one the words suggest. */
  name: string
  onCreated: (playlistId: number) => void
  onCancel: () => void
}): ReactNode {
  const { theme } = useUnistyles()
  const accent = useAccent()
  const server = useSmartServer()
  const { data: library } = useLibrary()
  const artFor = useArt(ROW_COVER_SIZE)

  const [text, setText] = useState('')
  const [focused, setFocused] = useState(false)
  const [result, setResult] = useState<DescribeResult | null>(null)
  /** The chips as they stand after taking some away; null while they are the answer's. */
  const [edited, setEdited] = useState<Understanding | null>(null)
  const [left, setLeft] = useState<ReadonlySet<number>>(new Set())
  const [keepFilled, setKeepFilled] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const ask = useMutation({
    mutationFn: (input: { text: string; understanding: Understanding | null }) => {
      if (!server.api) throw new Error('your server isn’t reachable')
      return server.api.describePlaylist(input)
    },
    onSuccess: answer => {
      setResult(answer)
      setEdited(null)
      setLeft(new Set())
      setKeepFilled(false)
    },
  })

  const tags = library?.tags ?? []
  const songsById = new Map((library?.songs ?? []).map(song => [song.id, song]))
  const understanding = edited ?? result?.understanding ?? null
  const picks = result
    ? picksHere(result, server.onDevice).filter(
        pick => !left.has(pick.songId) && songsById.has(pick.songId),
      )
    : []
  const follows = understanding !== null && onlyTags(understanding) && keepFilled
  const ready = result !== null && edited === null && (follows || picks.length > 0)

  const pick = (): void => {
    const words = text.trim()
    if (!words || ask.isPending) return
    setError(null)
    ask.mutate({ text: words, understanding: edited })
  }

  const create = async (): Promise<void> => {
    if (!understanding || !ready || busy) return
    setBusy(true)
    setError(null)
    const title = name.trim() || understanding.name
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
        onCreated((await clientApi().createPlaylist(input)).id)
        return
      }
      const input = newPlaylist('manual', title)
      if (!input) return
      const created = await clientApi().createPlaylist(input)
      await clientApi().addToPlaylist(created.id, { songIds: picks.map(each => each.songId) })
      onCreated(created.id)
    } catch (caught) {
      setError(failureText(`Couldn’t make “${title}”`, caught))
    } finally {
      setBusy(false)
    }
  }

  const reachable = server.reach.state === 'reachable'

  return (
    <View style={styles.body}>
      <TextInput
        style={[styles.words, focused && { borderColor: accent.accent }]}
        value={text}
        onChangeText={setText}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder="calm piano for reading, a few Genshin ones are fine"
        placeholderTextColor={theme.colors.textMuted}
        accessibilityLabel="Describe the playlist"
        multiline
        maxLength={500}
        testID="describe-words"
      />

      {!reachable ? <ServerAway reach={server.reach} need="ai" testID="describe-server" /> : null}

      {understanding ? (
        <View style={styles.understood} testID="describe-understood">
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
          ) : result ? (
            describeNotes(result, picks.length).map(note => (
              <Text key={note} style={styles.hint}>
                {note}
              </Text>
            ))
          ) : null}
        </View>
      ) : null}

      {result && !edited && picks.length > 0 ? (
        <ScrollView style={styles.list} testID="describe-picks">
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

      {understanding && !edited && onlyTags(understanding) ? (
        <Pressable
          onPress={() => setKeepFilled(on => !on)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: keepFilled }}
          accessibilityLabel="Follow these tags and keep it filled"
          style={styles.checkRow}
        >
          <Checkbox checked={keepFilled} />
          <Text style={styles.checkLabel}>Follow these tags and keep it filled</Text>
        </Pressable>
      ) : null}

      {ask.isPending ? (
        <Text style={styles.hint} accessibilityLiveRegion="polite">
          Reading your library. This can take half a minute.
        </Text>
      ) : null}
      {ask.error ? (
        <Text style={styles.error}>{failureText('Couldn’t pick songs', ask.error)}</Text>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.actions}>
        <Button label="Cancel" onPress={onCancel} />
        {result === null || edited !== null ? (
          <Button
            label={result ? 'Pick again' : 'Pick songs'}
            variant="primary"
            disabled={!text.trim() || !server.api}
            busy={ask.isPending}
            onPress={pick}
            testID="describe-pick"
          />
        ) : (
          <>
            <Button label="Try again" onPress={pick} busy={ask.isPending} disabled={!server.api} />
            <Button
              label="Create"
              variant="primary"
              disabled={!ready}
              busy={busy}
              onPress={() => void create()}
              testID="describe-create"
            />
          </>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  body: { gap: space.sm },
  words: {
    minHeight: 64,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    color: theme.colors.textPrimary,
    fontSize: 14,
    textAlignVertical: 'top',
    backgroundColor: theme.colors.surface3,
    borderWidth: 1,
    borderColor: theme.colors.surface3,
    borderRadius: radius.card,
  },
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
  // Short enough that the sheet's own buttons stay on a laptop's screen.
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
