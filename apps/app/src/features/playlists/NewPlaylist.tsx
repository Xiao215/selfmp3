import { useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useRouter } from 'expo-router'
import { useMutation } from '@tanstack/react-query'
import { plural, formatLongDuration, type Tag, NAME_MAX } from '@selfmp3/shared'
import {
  failureText,
  radius,
  space,
  type,
  uniqueName,
  useCreatePlaylist,
  useLibrary,
  iconSize,
} from '@selfmp3/client'
import { ServerAway } from '../../connection/ServerAway'
import { noServerToAsk } from '../../connection/via'
import { TextField } from '../../ui/components/TextField'
import { Button } from '../../ui/components/Button'
import { StatusLine } from '../../ui/components/StatusLine'
import { Chip } from '../../ui/components/Chip'
import { useSmartSwitches } from '../smart/useSmartSwitches'
import { ListMusic, Sparkle, Tag as TagIcon } from '../../ui/components/Icons'
import { Sheet } from '../../ui/components/Sheet'
import { followRules } from '../lists/followRules'
import { combinedName, tagsWithIds, type TagMatch } from '../lists/lists.model'
import { Segmented } from '../../ui/components/Segmented'
import { AddSongsSheet } from '../playlistDetail/AddSongsSheet'
import { SongsAnswer } from '../smart/SongsAnswer'
import { useSmartServer } from '../smart/useSmartServer'
import { newPlaylist } from './playlists.model'
import { ScrollView } from '../../ui/components/Scroll'
import { AnswerActions } from '../smart/AnswerParts'
import { Press } from '../../ui/components/Press'
import { smallTitle } from '../../ui/surfaces'

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
  const router = useRouter()
  const { mutateAsync: createPlaylist } = useCreatePlaylist()
  const server = useSmartServer()
  const { data: library } = useLibrary()
  const switches = useSmartSwitches()

  const [step, setStep] = useState<Step>('kind')
  const [kind, setKind] = useState<Kind>('pick')
  const [tagIds, setTagIds] = useState<readonly number[]>([])
  // Songs with any of the tags, or with all of them (C1), as the Combined page has it.
  const [match, setMatch] = useState<TagMatch>('any')
  const [words, setWords] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Named, and picking its songs: the playlist does not exist yet. */
  const [picking, setPicking] = useState<string | null>(null)
  /**
   * Which opening of the sheet this is; Cancel starts the next. A playlist
   * still being made for a cancelled one is not opened, and its failure is
   * not shown (R3-M5). The ref is what an answer checks, the state what it
   * was asked in.
   */
  const [round, setRound] = useState(0)
  const latestRound = useRef(0)

  const describe = useMutation({
    mutationFn: (text: string) => {
      if (!server.api) throw noServerToAsk()
      return server.api.describePlaylist({ text, understanding: null })
    },
  })

  const tags: readonly Tag[] = library?.tags ?? []
  const chosen = tagsWithIds(tagIds, tags)
  const tagsName = combinedName(
    chosen.map(tag => tag.name),
    match,
  )
  const songs = library?.songs ?? []
  // What it would hold, worked out here rather than asked of the server: the
  // whole library is already in memory, and a count that lags behind the
  // choice is worse than no count.
  const matching = songs.filter(song =>
    match === 'all'
      ? tagIds.every(id => song.tagIds.includes(id))
      : tagIds.some(id => song.tagIds.includes(id)),
  )
  const seconds = matching.reduce((total, song) => total + song.duration, 0)
  const offered = [...tags].sort(
    (a, b) => b.songCount - a.songCount || a.name.localeCompare(b.name),
  )

  const reset = (): void => {
    setStep('kind')
    setTagIds([])
    setMatch('any')
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
    latestRound.current += 1
    setRound(latestRound.current)
    reset()
    onClose()
  }

  /** `finish`, unless the sheet was cancelled since `asked`. */
  const finishFor =
    (asked: number) =>
    (id: number): void => {
      if (latestRound.current === asked) finish(id)
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
    finishFor(round)((await createPlaylist({ input, songIds })).id)
  }

  const follow = async (): Promise<void> => {
    if (chosen.length === 0 || busy) return
    setBusy(true)
    setError(null)
    const title = name.trim() || tagsName
    try {
      const input = newPlaylist('live', title, {
        rules: followRules({ tagIds, match, sort: 'addedAt', descending: true }),
      })
      if (!input) return
      finishFor(round)((await createPlaylist({ input })).id)
    } catch (caught) {
      if (latestRound.current === round) setError(failureText(`Couldn’t make “${title}”`, caught))
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
    limit?: { readonly maxLength: number | null }
    testID: string
  }): ReactNode => (
    <TextField
      // One field per step: a new key starts the next one focused, with its own text.
      key={props.testID}
      raised
      value={props.value}
      onChangeText={props.onChangeText}
      onSubmitEditing={props.onSubmit}
      placeholder={props.placeholder}
      accessibilityLabel={props.label}
      limit={props.limit}
      autoFocus
      // A name that starts as a suggestion is replaced by the first letter typed.
      selectTextOnFocus
      returnKeyType="done"
      submitBehavior="submit"
      testID={props.testID}
    />
  )

  return (
    <Sheet open={open} onClose={cancel} title="New playlist" testID="new-playlist">
      <View style={styles.body}>
        {step === 'kind' ? (
          <>
            <Option
              icon={<ListMusic size={iconSize.item} color={theme.colors.textSecondary} />}
              title="Pick songs"
              sub="Start empty and add songs"
              onPress={() => choose('pick')}
              testID="new-playlist-pick"
            />
            <Option
              icon={<TagIcon size={iconSize.item} color={theme.colors.textSecondary} />}
              title="Fills from tags"
              sub="Grows as you tag songs"
              onPress={() => choose('follow')}
              testID="new-playlist-follow"
            />
            {switches.ask ? (
              <Option
                icon={<Sparkle size={iconSize.item} />}
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
            {chosen.length > 1 ? (
              <Segmented
                label="Songs with"
                size="small"
                value={match}
                onChange={setMatch}
                options={[
                  { value: 'any', label: 'Any of them' },
                  { value: 'all', label: 'All of them' },
                ]}
                style={styles.match}
              />
            ) : null}
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
            onSaved={finishFor(round)}
            onCancel={cancel}
          />
        ) : (
          field({
            value: name,
            onChangeText: setName,
            onSubmit: make,
            placeholder: 'Name',
            label: 'Playlist name',
            limit: { maxLength: NAME_MAX },
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
          <StatusLine>{failureText('Couldn’t pick songs', describe.error)}</StatusLine>
        ) : null}
        {error ? <StatusLine>{error}</StatusLine> : null}

        {answer ? null : (
          <AnswerActions>
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
          </AnswerActions>
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
  return (
    <Press
      feedback="wash"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={styles.option}
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
    </Press>
  )
}

const styles = StyleSheet.create(theme => ({
  body: { gap: space.sm, padding: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.tight },
  // A long tag list scrolls inside the sheet rather than pushing its buttons off.
  tagScroll: { maxHeight: 260 },
  match: { alignSelf: 'flex-start' },
  hint: {
    color: theme.colors.textMuted,
    fontSize: type.small,
    flexShrink: 1,
    paddingHorizontal: space.xs,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.snug,
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
  optionTitle: smallTitle(theme.colors),
  optionSub: { color: theme.colors.textMuted, fontSize: type.small },
}))
