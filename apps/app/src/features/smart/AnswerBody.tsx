import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useRouter } from 'expo-router'
import { artistOr, plural, type AskAnswer as Answer } from '@selfmp3/shared'
import { radius, space, type, textStyle, iconSize } from '@selfmp3/client'
import { ROW_COVER_SIZE } from '../../offline/coverStore'
import { useArt } from '../../offline/useArt'
import { usePlayerCommands } from '../../player/PlayerProvider'
import { copyText } from '../../ports/clipboard'
import { SelectableText } from '../../ports/selectableText'
import { Button } from '../../ui/components/Button'
import { Copy as CopyIcon, Sparkle } from '../../ui/components/Icons'
import { useSongsById } from '../../ui/songsById'
import { showToast } from '../../ui/toast'
import { rangeWords } from './smart.model'
import { GetMusicAnswer } from './GetMusicAnswer'
import { LibraryAnswer } from './LibraryAnswer'
import { PlaybackAnswer } from './PlaybackAnswer'
import { PlaylistSongsAnswer } from './PlaylistSongsAnswer'
import { PlaylistsAnswer } from './PlaylistsAnswer'
import { RememberAnswer } from './RememberAnswer'
import { SongsAnswerCard } from './SongsAnswerCard'
import { TogetherAnswer } from '../room/TogetherAnswer'
import { TagsReview } from './TagsReview'
import { TidyReview } from './TidyReview'
import { CopiesReview } from './CopiesReview'
import type { AnswerKeys } from './answerKeys'
import { useSmartServer } from './useSmartServer'
import { AnswerSongLine } from './AnswerSongLine'
import { AnswerActions, AnswerHead, AnswerLine } from './AnswerParts'
import { Press } from '../../ui/components/Press'

/**
 * What one answer to Ask shows, by its kind (S1, docs/features/ai.md): every
 * answer is a proposal with its own button, and nothing changes until it is
 * pressed — except controlling what plays ("skip this song"), which is done at
 * once. A turn of the Ask page (`AskScreen`) draws one under what was asked.
 */
export function AnswerBody({
  answer,
  text,
  onDone,
  onOpenPage,
  listHeight,
  onKeys,
  onAsk,
  onCarriedOut,
}: {
  answer: Answer
  text: string
  /** Done with the answer: a proposal says what came of it ("Fixed 31 songs", `CLOSED`). */
  onDone: (outcome?: string) => void
  onOpenPage: () => void
  listHeight: number
  onKeys?: (keys: AnswerKeys | null) => void
  onAsk?: (text: string) => void
  /** A playback answer, once done: what it came to, in its line. */
  onCarriedOut?: (said: string) => void
}): ReactNode {
  const router = useRouter()
  switch (answer.kind) {
    case 'songs':
      return <SongsAnswerCard answer={answer} text={text} onPlayed={onDone} onOpen={onOpenPage} />
    case 'together':
      return <TogetherAnswer answer={answer} text={text} onDone={onDone} onOpen={onOpenPage} />
    case 'find':
      return <Found answer={answer} onDone={onDone} />
    case 'explore':
      return (
        <>
          <Words
            text={answer.say}
            testID="ask-explore-say"
            // Music it told you about that you don't have: asked for next, as Get it.
            get={answer.get && onAsk ? () => onAsk(`Get ${answer.get}`) : undefined}
          />
          <SongPicks
            picks={answer.songIds.slice(0, 20).map(songId => ({ songId, why: null }))}
            onDone={onDone}
          />
        </>
      )
    case 'tags':
      return (
        <TagsReview
          card
          review={answer.review}
          height={listHeight}
          onClose={onDone}
          onKeys={onKeys}
        />
      )
    case 'tidy':
      return (
        <TidyReview
          card
          result={answer.tidy}
          height={listHeight}
          onClose={onDone}
          onKeys={onKeys}
          onAsk={onAsk}
        />
      )
    case 'copies':
      return (
        <CopiesReview
          card
          result={answer.copies}
          height={listHeight}
          onClose={onDone}
          onKeys={onKeys}
        />
      )
    case 'remember':
      return <RememberAnswer note={answer.note} onDone={onDone} />
    case 'playback':
      return <PlaybackAnswer answer={answer} onCarriedOut={onCarriedOut} />
    case 'getMusic':
      return <GetMusicAnswer answer={answer} onDone={onDone} />
    case 'playlists':
      return <PlaylistsAnswer answer={answer} onDone={onDone} />
    case 'playlistSongs':
      return (
        <PlaylistSongsAnswer answer={answer} height={listHeight} onDone={onDone} onKeys={onKeys} />
      )
    case 'library':
      return <LibraryAnswer answer={answer} height={listHeight} onDone={onDone} />
    case 'stats':
      return (
        <>
          <AnswerHead>
            {plural(answer.plays, 'play', 'plays')} · {Math.round(answer.minutes)} min in{' '}
            {rangeWords(answer.range)}
          </AnswerHead>
          {answer.items.map((item, index) => (
            <AnswerLine key={item.label} numberOfLines={1}>
              {index + 1}. {item.label}
              <Text style={styles.muted}> · {plural(item.plays, 'play', 'plays')}</Text>
            </AnswerLine>
          ))}
          <AnswerActions>
            <Button
              label="Open Stats"
              onPress={() => {
                onDone()
                router.navigate('/stats')
              }}
            />
          </AnswerActions>
        </>
      )
    case 'open':
      return (
        <>
          <Words text={answer.say} copy={false} />
          <AnswerActions>
            <Button
              label={`Open ${answer.place[0]!.toUpperCase()}${answer.place.slice(1)}`}
              onPress={() => {
                onDone()
                router.navigate(`/${answer.place}`)
              }}
            />
          </AnswerActions>
        </>
      )
    case 'none':
      return (
        <>
          <Words text={answer.say} copy={false} testID="ask-none-say" />
          {onAsk && answer.try.length > 0 ? (
            <View style={styles.tries}>
              <Text style={styles.muted}>Try</Text>
              {answer.try.map(each => (
                <Press
                  key={each}
                  onPress={() => onAsk(each)}
                  accessibilityRole="button"
                  accessibilityLabel={`Ask: ${each}`}
                  wrap={styles.tryPlace}
                  style={styles.try}
                  testID="ask-try"
                >
                  {/* Its own size, however long the words beside it wrap. */}
                  <View style={styles.tryIcon}>
                    <Sparkle size={iconSize.sub} />
                  </View>
                  <Text style={styles.tryText} numberOfLines={2}>
                    {each}
                  </Text>
                </Press>
              ))}
            </View>
          ) : null}
        </>
      )
  }
}

/**
 * An answer in words: selectable in part (`SelectableText`), with Copy for
 * all of it under them.
 */
function Words({
  text,
  copy = true,
  get,
  testID,
}: {
  text: string
  /** A sentence or two of the app's own words has nothing worth copying. */
  copy?: boolean
  /** Asks for the music the words are about, when you don't have it. */
  get?: () => void
  testID?: string
}): ReactNode {
  const { theme } = useUnistyles()
  return (
    <View style={styles.words}>
      <SelectableText style={styles.answer} testID={testID}>
        {text}
      </SelectableText>
      {copy || get ? (
        <View style={styles.wordsActions}>
          {get ? (
            <Button label="Get it" variant="primary" size="small" onPress={get} testID="ask-get" />
          ) : null}
          {copy ? (
            <Button
              label="Copy"
              variant="text"
              size="small"
              icon={<CopyIcon size={iconSize.sub} color={theme.colors.textSecondary} />}
              onPress={() =>
                void copyText(text).then(done => {
                  if (done) showToast('Copied', 'good')
                })
              }
              testID="ask-copy"
            />
          ) : null}
        </View>
      ) : null}
    </View>
  )
}

/** A half-remembered song: the few that fit, best first. Pressing one plays them from it. */
function Found({
  answer,
  onDone,
}: {
  answer: Extract<Answer, { kind: 'find' }>
  onDone: () => void
}): ReactNode {
  const server = useSmartServer()
  const songsById = useSongsById()
  const here = answer.picks.filter(pick => {
    const id = server.onDevice(pick.songId)
    return id !== undefined && songsById.has(id)
  })
  if (here.length === 0) {
    return <AnswerLine>No song of yours fits that. Try other words for it.</AnswerLine>
  }
  return (
    <>
      <AnswerHead>{here.length === 1 ? 'Found one' : `Found ${here.length}`}</AnswerHead>
      <SongPicks picks={here} onDone={onDone} />
    </>
  )
}

/** Songs an answer names (server ids), as rows: pressing one plays them from it. */
function SongPicks({
  picks,
  onDone,
}: {
  picks: readonly { songId: number; why: string | null }[]
  onDone: () => void
}): ReactNode {
  const server = useSmartServer()
  const player = usePlayerCommands()
  const songsById = useSongsById()
  const artFor = useArt(ROW_COVER_SIZE)
  const found = picks.flatMap(pick => {
    const id = server.onDevice(pick.songId)
    const song = id === undefined ? undefined : songsById.get(id)
    return song ? [{ song, why: pick.why }] : []
  })
  if (found.length === 0) return null
  const ids = found.map(each => each.song.id)
  return (
    <>
      {found.map(({ song, why }, index) => (
        <AnswerSongLine
          key={song.id}
          song={song}
          onPlay={() => {
            player.playFrom(ids, index, {
              source: { kind: 'songs', origin: 'found', name: 'Search' },
            })
            onDone()
          }}
          artUri={artFor(song)}
          sub={why ? `${artistOr(song.artist)} · ${why}` : artistOr(song.artist)}
        />
      ))}
    </>
  )
}

const styles = StyleSheet.create(theme => ({
  answer: { color: theme.colors.textPrimary, ...textStyle('body') },
  words: { gap: space.xs },
  wordsActions: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  muted: { color: theme.colors.textMuted, fontSize: type.small, fontWeight: '400' },
  tries: { gap: space.tight, marginTop: space.xs },
  tryPlace: { alignSelf: 'flex-start', maxWidth: '100%' },
  try: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: 7,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    backgroundColor: theme.colors.surface2,
  },
  tryIcon: { flexShrink: 0 },
  tryText: { flexShrink: 1, color: theme.colors.textPrimary, fontSize: type.sub },
}))
