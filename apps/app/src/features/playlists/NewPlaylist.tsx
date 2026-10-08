import { useState } from 'react'
import type { ReactNode } from 'react'
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useRouter } from 'expo-router'
import { useMutation } from '@tanstack/react-query'
import { plural, formatLongDuration, type Tag } from '@selfmp3/shared'
import {
  ApiError,
  failureText,
  radius,
  space,
  type,
  uniqueName,
  useCreatePlaylist,
  useLibrary,
} from '@selfmp3/client'
import { ServerAway } from '../../connection/ServerAway'
import { useAccent } from '../../ui/accent'
import { Button } from '../../ui/components/Button'
import { Chip } from '../../ui/components/Chip'
import { useSmartSwitches } from '../smart/useSmartSwitches'
import { ListMusic, Sparkle, Tag as TagIcon } from '../../ui/components/Icons'
import { Sheet } from '../../ui/components/Sheet'
import { followRules } from '../lists/followRules'
import { AddSongsSheet } from '../playlistDetail/AddSongsSheet'
import { SongsAnswer } from '../smart/SongsAnswer'
import { useSmartServer } from '../smart/useSmartServer'
import { newPlaylist } from './playlists.model'

/** Where the sheet is: the kind first, then what the kind needs, then the name. */
type Step = 'kind' | 'tags' | 'describe' | 'name'
/** What is being made: songs picked by hand, a playlist that fills from tags, or one Ask picks. */
type Kind = 'pick' | 'follow' | 'describe'

/**
 * Making a playlist, from wherever it is started: the sidebar's ＋, the
 * playlists page's New and its New tile, the phone's ＋.
 *
 * The kind first, then a name (L2, docs/features/lists.md), so nothing typed
 * goes anywhere it was not sent:
 *
 * - **Pick songs**: a name, then picking its songs. It is only made when the
 *   first ones are confirmed, with them: a playlist exists once it has a song
 *   (docs/UI-MIGRATION.md, Phase 5), so cancelling leaves nothing behind.
 * - **Fills from tags**: the tags, then a name (theirs, to start with). It
 *   follows them and keeps itself filled; **Stop filling** on the playlist
 *   keeps every song.
 * - **Describe it**, when Ask is on: what you want to hear, then a name (the
 *   words, to start with), then the songs it picked from your own, each with a
 *   reason (SongsAnswer).
 */
export function NewPlaylist({ open, onClose }: { open: boolean; onClose: () => void }): ReactNode {
  const { theme } = useUnistyles()
  const accent = useAccent()
  const router = useRouter()
  const { mutateAsync: createPlaylist } = useCreatePlaylist()
  const server = useSmartServer()
  const { data: library } = useLibrary()
  const switches = useSmartSwitches()

  const [step, setStep] = useState<Step>('kind')
  const [kind, setKind] = useState<Kind>('pick')
  const [tagIds, setTagIds] = useState<readonly number[]>([])
  const [words, setWords] = useState('')
  const [name, setName] = useState('')
  const [focused, setFocused] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Named, and picking its songs: the playlist does not exist yet. */
  const [picking, setPicking] = useState<string | null>(null)

  const describe = useMutation({
    mutationFn: (text: string) => {
      if (!server.api) throw new ApiError(0, 'no server to ask', 'offline')
      return server.api.describePlaylist({ text, understanding: null })
    },
  })

  const tags: readonly Tag[] = library?.tags ?? []
  const chosen = tagIds.flatMap(id => tags.filter(tag => tag.id === id))
  const tagsName = chosen.map(tag => tag.name).join(' · ')
  const songs = library?.songs ?? []
  // What it would hold, worked out here rather than asked of the server: the
  // whole library is already in memory, and a count that lags behind the
  // choice is worse than no count.
  const matching = songs.filter(song => tagIds.some(id => song.tagIds.includes(id)))
  const seconds = matching.reduce((total, song) => total + song.duration, 0)
  const offered = [...tags].sort(
    (a, b) => b.songCount - a.songCount || a.name.localeCompare(b.name),
  )

  const reset = (): void => {
    setStep('kind')
    setTagIds([])
    setWords('')
    setName('')
    setError(null)
    setPicking(null)
    describe.reset()
  }

  const finish = (id: number): void => {
    reset()
    onClose()
    router.push({ pathname: '/playlists/[id]', params: { id: String(id) } })
  }

  const cancel = (): void => {
    reset()
    onClose()
  }

  const choose = (next: Kind): void => {
    setKind(next)
    setError(null)
    if (next === 'follow') setStep('tags')
    else if (next === 'describe') setStep('describe')
    else toName(uniqueName('New playlist', library?.playlists.map(each => each.name) ?? []))
  }

  /** On to the name, which starts as what was just chosen or said. */
  function toName(start: string): void {
    setName(start)
    setStep('name')
  }

  /** Back one step: from the name to what the kind asked for, and from there to the kinds. */
  const back = (): void => {
    setError(null)
    describe.reset()
    if (step === 'name' && kind === 'follow') setStep('tags')
    else if (step === 'name' && kind === 'describe') setStep('describe')
    else setStep('kind')
  }

  /** Made with its first songs, in one go; a failure is the picker's to show. */
  const createWith = async (songIds: readonly number[]): Promise<void> => {
    const input = newPlaylist('manual', picking ?? '')
    if (!input) return
    finish((await createPlaylist({ input, songIds })).id)
  }

  const follow = async (): Promise<void> => {
    if (chosen.length === 0 || busy) return
    setBusy(true)
    setError(null)
    const title = name.trim() || tagsName
    try {
      const input = newPlaylist('live', title, {
        rules: followRules({ tagIds, sort: 'addedAt', descending: true }),
      })
      if (!input) return
      finish((await createPlaylist({ input })).id)
    } catch (caught) {
      setError(failureText(`Couldn’t make “${title}”`, caught))
    } finally {
      setBusy(false)
    }
  }

  /** The name step's button: what the kind does once it is named. */
  const make = (): void => {
    const title = name.trim()
    if (!title) return
    if (kind === 'pick') setPicking(title)
    else if (kind === 'follow') void follow()
    else if (!describe.isPending) describe.mutate(words.trim())
  }

  const toggleTag = (tag: Tag): void =>
    setTagIds(current =>
      current.includes(tag.id) ? current.filter(id => id !== tag.id) : [...current, tag.id],
    )

  if (picking !== null) {
    return (
      <AddSongsSheet
        open={open}
        onClose={cancel}
        targetName={picking}
        target={{ kind: 'new', create: createWith }}
      />
    )
  }

  const answer = step === 'name' && kind === 'describe' ? describe.data : undefined
  const field = (props: {
    value: string
    onChangeText: (text: string) => void
    onSubmit: () => void
    placeholder: string
    label: string
    testID: string
  }): ReactNode => (
    <View style={[styles.field, focused && { borderColor: accent.accent }]}>
      <TextInput
        // One field per step: a new key starts the next one focused, with its own text.
        key={props.testID}
        style={styles.input}
        value={props.value}
        onChangeText={props.onChangeText}
        onSubmitEditing={props.onSubmit}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={props.placeholder}
        placeholderTextColor={theme.colors.textMuted}
        accessibilityLabel={props.label}
        autoFocus
        // A name that starts as a suggestion is replaced by the first letter typed.
        selectTextOnFocus
        autoCorrect={false}
        returnKeyType="done"
        submitBehavior="submit"
        testID={props.testID}
      />
    </View>
  )

  return (
    <Sheet open={open} onClose={cancel} title="New playlist" testID="new-playlist">
      <View style={styles.body}>
        {step === 'kind' ? (
          <>
            <Option
              icon={<ListMusic size={16} color={theme.colors.textSecondary} />}
              title="Pick songs"
              sub="Start empty and add songs"
              onPress={() => choose('pick')}
              testID="new-playlist-pick"
            />
            <Option
              icon={<TagIcon size={16} color={theme.colors.textSecondary} />}
              title="Fills from tags"
              sub="Grows as you tag songs"
              onPress={() => choose('follow')}
              testID="new-playlist-follow"
            />
            {switches.ask ? (
              <Option
                icon={<Sparkle size={16} />}
                title="Describe it"
                sub="Ask picks songs from your library"
                onPress={() => choose('describe')}
                testID="new-playlist-describe"
              />
            ) : null}
          </>
        ) : step === 'tags' ? (
          <>
            <ScrollView
              style={styles.tagScroll}
              contentContainerStyle={styles.chips}
              testID="new-playlist-tags"
            >
              {offered.map(tag => (
                <Chip
                  key={tag.id}
                  compact
                  label={tag.name}
                  hue={tag.hue}
                  count={tag.songCount}
                  selected={tagIds.includes(tag.id)}
                  onPress={() => toggleTag(tag)}
                />
              ))}
            </ScrollView>
            <Text style={styles.hint}>
              {chosen.length === 0
                ? 'Choose one or more tags'
                : `${plural(matching.length, 'song', 'songs')} · ${formatLongDuration(seconds)}`}
            </Text>
          </>
        ) : step === 'describe' ? (
          field({
            value: words,
            onChangeText: setWords,
            onSubmit: () => {
              if (words.trim()) toName(words.trim())
            },
            placeholder: 'rainy evening, no live songs',
            label: 'What you want to hear',
            testID: 'new-playlist-words',
          })
        ) : answer ? (
          <SongsAnswer
            result={answer}
            text={words.trim()}
            name={name}
            onSaved={finish}
            onCancel={cancel}
          />
        ) : (
          field({
            value: name,
            onChangeText: setName,
            onSubmit: make,
            placeholder: 'Name',
            label: 'Playlist name',
            testID: 'new-playlist-field',
          })
        )}

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

        {answer ? null : (
          <View style={styles.actions}>
            {step === 'kind' ? (
              <Button label="Cancel" onPress={cancel} />
            ) : (
              <Button label="Back" onPress={back} testID="new-playlist-back" />
            )}
            {step === 'tags' ? (
              <Button
                label="Next"
                variant="primary"
                disabled={chosen.length === 0}
                onPress={() => toName(tagsName)}
                testID="new-playlist-next"
              />
            ) : step === 'describe' ? (
              <Button
                label="Next"
                variant="primary"
                disabled={!words.trim()}
                onPress={() => toName(words.trim())}
                testID="new-playlist-next"
              />
            ) : step === 'name' ? (
              <Button
                label={kind === 'follow' ? 'Create' : 'Pick songs'}
                variant="primary"
                disabled={!name.trim()}
                busy={busy || describe.isPending}
                onPress={make}
                testID="new-playlist-next"
              />
            ) : null}
          </View>
        )}
      </View>
    </Sheet>
  )
}

/** One kind of playlist: a row with what it is and what it does. */
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
    fontSize: type.body,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  // A long tag list scrolls inside the sheet rather than pushing its buttons off.
  tagScroll: { maxHeight: 260 },
  hint: {
    color: theme.colors.textMuted,
    fontSize: type.small,
    flexShrink: 1,
    paddingHorizontal: 4,
  },
  error: { color: theme.colors.danger, fontSize: type.small },
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
  optionTitle: { color: theme.colors.textPrimary, fontSize: type.sub, fontWeight: '600' },
  optionSub: { color: theme.colors.textMuted, fontSize: type.small },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: space.sm,
    marginTop: space.xs,
  },
}))
