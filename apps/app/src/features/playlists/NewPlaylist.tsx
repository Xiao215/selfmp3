import { useState } from 'react'
import type { ReactNode } from 'react'
import { Pressable, Text, TextInput, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useRouter } from 'expo-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { plural, formatLongDuration, type Tag } from '@selfmp3/shared'
import { clientApi, failureText, queryKeys, radius, space, useLibrary } from '@selfmp3/client'
import { ServerAway } from '../../connection/ServerAway'
import { isComposing } from '../../shell/composing'
import { useAccent } from '../../ui/accent'
import { Button } from '../../ui/components/Button'
import { Chip } from '../../ui/components/Chip'
import { Ask, ListMusic } from '../../ui/components/Icons'
import { Sheet } from '../../ui/components/Sheet'
import { followRules } from '../library/saveTags'
import { AddSongsSheet } from '../playlistDetail/AddSongsSheet'
import { exactTag, matchingTags } from '../smart/smart.model'
import { SongsAnswer } from '../smart/SongsAnswer'
import { useSmartServer } from '../smart/useSmartServer'
import { newPlaylist } from './playlists.model'

/**
 * Making a playlist, from wherever it is started: the sidebar's ＋, the
 * playlists page's New, the phone's ＋.
 *
 * One field, no kinds (N1, docs/features/ai.md). What is typed decides what
 * the playlist is, rather than a name first and then a choice of how to fill it:
 *
 * - letters that are a tag's name offer the tag, and a tag picked sits in the
 *   field as a chip. A playlist of tags follows them and keeps itself filled,
 *   and is named after them; **Stop following** on the playlist keeps every song.
 * - anything typed can be a description: **Let it pick** reads it and picks
 *   from your own songs, each with a reason (SongsAnswer).
 * - or it is simply the name of a playlist you fill yourself, which goes
 *   straight into picking its songs and is only made when the first ones are
 *   confirmed, with them: a playlist exists once it has a song
 *   (docs/UI-MIGRATION.md, Phase 5), so cancelling leaves nothing behind.
 *
 * The name comes last, on its own, and is the playlist page's to change.
 */
export function NewPlaylist({ open, onClose }: { open: boolean; onClose: () => void }): ReactNode {
  const { theme } = useUnistyles()
  const accent = useAccent()
  const router = useRouter()
  const client = useQueryClient()
  const server = useSmartServer()
  const { data: library } = useLibrary()

  const [text, setText] = useState('')
  const [focused, setFocused] = useState(false)
  const [tagIds, setTagIds] = useState<readonly number[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Named, and picking its songs: the playlist does not exist yet. */
  const [picking, setPicking] = useState<string | null>(null)
  /** The words sent to be picked from, while their answer is the one shown. */
  const [asked, setAsked] = useState<string | null>(null)

  const describe = useMutation({
    mutationFn: (words: string) => {
      if (!server.api) throw new Error('your server isn’t reachable')
      return server.api.describePlaylist({ text: words, understanding: null })
    },
  })

  const tags: readonly Tag[] = library?.tags ?? []
  const chosen = tagIds.flatMap(id => tags.filter(tag => tag.id === id))
  const typed = text.trim()
  const offered = matchingTags(text, tags, tagIds)
  const songs = library?.songs ?? []
  // What it would hold, worked out here rather than asked of the server: the
  // whole library is already in memory, and a count that lags behind the chips
  // is worse than no count.
  const matching = songs.filter(song => tagIds.some(id => song.tagIds.includes(id)))
  const seconds = matching.reduce((total, song) => total + song.duration, 0)
  const tagsName = chosen.map(tag => tag.name).join(' · ')

  const reset = (): void => {
    setText('')
    setTagIds([])
    setError(null)
    setPicking(null)
    setAsked(null)
    describe.reset()
  }

  const finish = (id: number): void => {
    void client.invalidateQueries({ queryKey: queryKeys.library })
    reset()
    onClose()
    router.push({ pathname: '/playlists/[id]', params: { id: String(id) } })
  }

  const cancel = (): void => {
    reset()
    onClose()
  }

  /** Made with its first songs, in one go; a failure is the picker's to show. */
  const createWith = async (songIds: readonly number[]): Promise<void> => {
    const input = newPlaylist('manual', picking ?? '')
    if (!input) return
    const created = await clientApi().createPlaylist(input)
    await clientApi().addToPlaylist(created.id, { songIds: [...songIds] })
    finish(created.id)
  }

  const follow = async (): Promise<void> => {
    if (chosen.length === 0 || busy) return
    setBusy(true)
    setError(null)
    try {
      const input = newPlaylist('live', tagsName, {
        rules: followRules({ tagIds, sort: 'addedAt', descending: true }),
      })
      if (!input) return
      finish((await clientApi().createPlaylist(input)).id)
    } catch (caught) {
      setError(failureText(`Couldn’t make “${tagsName}”`, caught))
    } finally {
      setBusy(false)
    }
  }

  /** The words, with any tags already chosen as the places to pick from. */
  const letItPick = (): void => {
    if (!typed || describe.isPending) return
    const words = chosen.length > 0 ? `${chosen.map(tag => tag.name).join(', ')}: ${typed}` : typed
    setAsked(words)
    describe.mutate(words)
  }

  const addTag = (tag: Tag): void => {
    setTagIds(current => [...current, tag.id])
    setText('')
    setAsked(null)
  }
  const removeTag = (tagId: number): void => {
    setTagIds(current => current.filter(id => id !== tagId))
    setAsked(null)
  }

  /** ↵: a tag typed in full is picked; other words are a description; chips alone are followed. */
  const submit = (): void => {
    const exact = exactTag(text, tags)
    if (exact && !tagIds.includes(exact.id)) addTag(exact)
    else if (typed) letItPick()
    else void follow()
  }

  if (picking !== null) {
    return (
      <AddSongsSheet
        open={open}
        onClose={cancel}
        playlistName={picking}
        target={{ kind: 'new', create: createWith }}
      />
    )
  }

  const answer = asked !== null ? describe.data : undefined

  return (
    <Sheet open={open} onClose={cancel} title="New playlist" testID="new-playlist">
      <View style={styles.body}>
        <View style={[styles.field, focused && { borderColor: accent.accent }]}>
          {chosen.map(tag => (
            <Chip
              key={tag.id}
              compact
              label={tag.name}
              hue={tag.hue}
              selected
              onPress={() => removeTag(tag.id)}
              onRemove={() => removeTag(tag.id)}
            />
          ))}
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={next => {
              setText(next)
              setAsked(null)
            }}
            onKeyPress={event => {
              // Backspace in an empty field takes the last chip back out.
              if (event.nativeEvent.key !== 'Backspace' || text !== '' || tagIds.length === 0)
                return
              if (isComposing(event.nativeEvent as { isComposing?: boolean })) return
              removeTag(tagIds[tagIds.length - 1]!)
            }}
            onSubmitEditing={submit}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={
              chosen.length > 0
                ? 'Another tag, or say what you want from them'
                : 'A tag, a name, or what you want to hear'
            }
            placeholderTextColor={theme.colors.textMuted}
            accessibilityLabel="Tags to follow, a name, or a description"
            autoFocus
            autoCorrect={false}
            returnKeyType="done"
            submitBehavior="submit"
            testID="new-playlist-field"
          />
        </View>

        {answer ? (
          <SongsAnswer result={answer} text={asked ?? typed} onSaved={finish} onCancel={cancel} />
        ) : (
          <>
            {offered.length > 0 ? (
              <View style={styles.chips} testID="new-playlist-tags">
                {offered.map(tag => (
                  <Chip
                    key={tag.id}
                    compact
                    label={tag.name}
                    hue={tag.hue}
                    count={tag.songCount}
                    selected={false}
                    onPress={() => addTag(tag)}
                  />
                ))}
              </View>
            ) : null}

            {chosen.length > 0 && !typed ? (
              <Text style={styles.hint}>
                {plural(matching.length, 'song', 'songs')} · {formatLongDuration(seconds)} · keeps
                itself filled as you tag more
              </Text>
            ) : null}

            {typed ? (
              <Option
                icon={<Ask size={16} color={theme.colors.textSecondary} />}
                title={
                  chosen.length > 0
                    ? `Let it pick from ${tagsName}: “${typed}”`
                    : `Let it pick songs for “${typed}”`
                }
                sub="Picks from your own songs, with a reason for each"
                onPress={letItPick}
                testID="new-playlist-describe"
              />
            ) : null}
            {typed && chosen.length === 0 ? (
              <Option
                icon={<ListMusic size={16} color={theme.colors.textSecondary} />}
                title={`An empty playlist called “${typed}”`}
                sub="Add songs yourself"
                onPress={() => setPicking(typed)}
                testID="new-playlist-empty"
              />
            ) : null}

            {!typed && chosen.length === 0 ? (
              <Text style={styles.hint}>
                Type a tag to follow, a name for a playlist you fill yourself, or what you want to
                hear and let it pick.
              </Text>
            ) : null}

            {describe.isPending ? (
              <Text style={styles.hint} accessibilityLiveRegion="polite">
                Reading your library. This can take half a minute.
              </Text>
            ) : null}
            {describe.error && server.reach.state !== 'reachable' ? (
              <ServerAway reach={server.reach} need="ai" testID="new-playlist-server" />
            ) : describe.error ? (
              <Text style={styles.error}>{failureText('Couldn’t pick songs', describe.error)}</Text>
            ) : null}
            {error ? <Text style={styles.error}>{error}</Text> : null}

            <View style={styles.actions}>
              <Button label="Cancel" onPress={cancel} />
              {typed ? (
                <Button
                  label="Pick songs"
                  variant="primary"
                  busy={describe.isPending}
                  onPress={letItPick}
                  testID="new-playlist-next"
                />
              ) : (
                <Button
                  label="Create"
                  variant="primary"
                  disabled={chosen.length === 0}
                  busy={busy}
                  onPress={() => void follow()}
                  testID="new-playlist-next"
                />
              )}
            </View>
          </>
        )}
      </View>
    </Sheet>
  )
}

/** One way the typed words can go: a row with what it does and what it means. */
function Option({
  icon,
  title,
  sub,
  onPress,
  testID,
}: {
  icon: ReactNode
  title: string
  sub: string
  onPress: () => void
  testID: string
}): ReactNode {
  const { theme } = useUnistyles()
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={({ pressed }) => [
        styles.option,
        pressed && { backgroundColor: theme.colors.surface3 },
      ]}
      testID={testID}
    >
      <View style={styles.optionIcon}>{icon}</View>
      <View style={styles.optionText}>
        <Text style={styles.optionTitle} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.optionSub} numberOfLines={1}>
          {sub}
        </Text>
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create(theme => ({
  body: { gap: space.sm, padding: space.sm },
  // One field holding the chosen tags and the words, as a chip input does.
  field: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    minHeight: 40,
    paddingHorizontal: space.sm,
    paddingVertical: 5,
    // A control on the sheet, which is a card on a phone and the control
    // surface as a dialog, so the field is raised above both. The edge only
    // carries the focus ring: at rest it is the fill's own colour.
    backgroundColor: theme.colors.surface3,
    borderWidth: 1,
    borderColor: theme.colors.surface3,
    borderRadius: radius.card,
  },
  input: {
    flexGrow: 1,
    flexBasis: 160,
    minHeight: 28,
    paddingHorizontal: 4,
    color: theme.colors.textPrimary,
    fontSize: 14,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  hint: { color: theme.colors.textMuted, fontSize: 12, flexShrink: 1 },
  error: { color: theme.colors.danger, fontSize: 12 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 7,
    paddingHorizontal: space.sm,
    borderRadius: radius.coverSm + 4,
  },
  optionIcon: {
    width: 30,
    height: 30,
    borderRadius: radius.pill,
    backgroundColor: theme.colors.surface3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionText: { flex: 1, minWidth: 0 },
  optionTitle: { color: theme.colors.textPrimary, fontSize: 13.5, fontWeight: '600' },
  optionSub: { color: theme.colors.textMuted, fontSize: 12 },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: space.sm,
    marginTop: space.xs,
  },
}))
