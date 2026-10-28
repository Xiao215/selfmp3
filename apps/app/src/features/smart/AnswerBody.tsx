import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useRouter } from 'expo-router'
import { artistOr, plural, type AskCard as Answer, type AskReply } from '@selfmp3/shared'
import { radius, space, type, textStyle, iconSize } from '@selfmp3/client'
import { ROW_COVER_SIZE } from '../../offline/coverStore'
import { useArt } from '../../offline/useArt'
import { usePlayerCommands } from '../../player/PlayerProvider'
import { copyText } from '../../ports/clipboard'
import { SelectableText } from '../../ports/selectableText'
import { Button } from '../../ui/components/Button'
import { Check, Copy as CopyIcon } from '../../ui/components/Icons'
import { useSongsById } from '../../ui/songsById'
import { showToast } from '../../ui/toast'
import { foundSource } from '../lists/lists.model'
import { cardHeading, rangeWords } from './smart.model'
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
import { AnswerActions, AnswerHead, AnswerLine, CLOSED } from './AnswerParts'
import { ClarifyAnswer } from './ClarifyAnswer'
import { label } from '../../ui/surfaces'
import { ScrollView } from '../../ui/components/Scroll'

/**
 * Answers that are a proposal: once acted on or put aside (Apply, Close, Not
 * now), the card folds to the line it was answered with. The rest stay as
 * they are, since playing a song from an answer is not the end of it.
 */
const SETTLES: ReadonlySet<Answer['kind']> = new Set([
  'tags',
  'tidy',
  'copies',
  'remember',
  'playlists',
  'playlistSongs',
])

/** Cards a computer's keys work on while the field is empty: the reviews. */
export const TAKES_KEYS: ReadonlySet<Answer['kind']> = new Set([
  'tags',
  'tidy',
  'copies',
  'playlistSongs',
])

/**
 * What one reply to Ask shows (S1, docs/features/ai.md): its own words, then
 * each card in the order asked. A turn of the Ask page (`AskScreen`) draws it
 * under what was asked.
 *
 * Several cards read as parts of one answer, not a chat: one column, each
 * card under a quiet heading of what it is (`cardHeading`), tone on tone as
 * the cards always are. A proposal done with folds to what came of it
 * (`outcomes`, by the card's place), its siblings left as they are. Only the
 * first list asked to play plays as it comes, and only the first review
 * still open takes the computer's keys.
 */
export function AnswerBody({
  reply,
  text,
  outcomes,
  onSettle,
  onOpenPage,
  listHeight,
  onKeys,
  onAsk,
  onCarriedOut,
  onOpenList,
  beside = false,
}: {
  reply: AskReply
  text: string
  /** What came of each proposal done with, by its card's place. */
  outcomes: Readonly<Record<number, string>>
  /** A proposal acted on or put aside: what came of it ("Fixed 31 songs", `CLOSED`). */
  onSettle: (index: number, outcome: string) => void
  onOpenPage: () => void
  listHeight: number
  onKeys?: (keys: AnswerKeys | null) => void
  onAsk?: (text: string) => void
  /** A playback card, once done: what it came to, in its line. */
  onCarriedOut?: (index: number, said: string) => void
  /** A list among other cards opens on the stage, by its kept id, rather than as a page. */
  onOpenList?: (keptId: string) => void
  /** Room to the side (Ask on a computer): words with the songs they name beside them. */
  beside?: boolean
}): ReactNode {
  const several = reply.cards.length > 1
  const playsNow = reply.cards.findIndex(card => card.kind === 'songs' && card.lead === 'play')
  const takesKeys = reply.cards.findIndex(
    (card, index) => TAKES_KEYS.has(card.kind) && outcomes[index] === undefined,
  )
  return (
    <View style={styles.reply}>
      {reply.say ? <Words text={reply.say} copy={false} testID="ask-reply-say" /> : null}
      {reply.cards.map((card, index) => {
        const heading = several ? cardHeading(card) : null
        const outcome = outcomes[index]
        return (
          <View
            // A reply's cards never move: their places are their names (`t2.1`).
            key={index}
            style={styles.part}
            testID={`ask-answer-${card.kind}`}
          >
            {heading ? (
              <Text style={styles.heading} accessibilityRole="header">
                {heading}
              </Text>
            ) : null}
            {outcome !== undefined ? (
              <Outcome answer={card} outcome={outcome} />
            ) : (
              <AnswerCard
                answer={card}
                text={text}
                onDone={done =>
                  SETTLES.has(card.kind) && done ? onSettle(index, done) : undefined
                }
                onOpenPage={onOpenPage}
                listHeight={listHeight}
                onKeys={index === takesKeys ? onKeys : undefined}
                onAsk={onAsk}
                onCarriedOut={onCarriedOut && (said => onCarriedOut(index, said))}
                playNow={index === playsNow}
                onOpenList={several ? onOpenList : undefined}
                beside={beside}
              />
            )}
          </View>
        )
      })}
    </View>
  )
}

/**
 * A proposal once it is done with (S1): what the model said stays as it was,
 * and the review gives way to one line on what came of it, ticked when
 * something was done.
 */
function Outcome({ answer, outcome }: { answer: Answer; outcome: string }): ReactNode {
  const { theme } = useUnistyles()
  const said = answer.kind === 'tidy' ? answer.tidy.reply : null
  const done = outcome !== CLOSED
  return (
    <View style={styles.outcome}>
      {said ? <SelectableText style={styles.answer}>{said}</SelectableText> : null}
      <View style={styles.outcomeLine} testID="ask-turn-outcome">
        {done ? (
          <View style={styles.tick}>
            <Check size={iconSize.tiny} color={theme.colors.onPrimary} />
          </View>
        ) : null}
        <Text style={done ? styles.outcomeDone : styles.outcomeClosed}>{outcome}</Text>
      </View>
    </View>
  )
}

/**
 * One card of a reply, by its kind: every card is a proposal with its own
 * button, and nothing changes until it is pressed — except controlling what
 * plays ("skip this song"), which is done at once, and a list asked to play.
 */
function AnswerCard({
  answer,
  text,
  onDone,
  onOpenPage,
  listHeight,
  onKeys,
  onAsk,
  onCarriedOut,
  playNow,
  onOpenList,
  beside,
}: {
  answer: Answer
  text: string
  /** Done with the card: a proposal says what came of it ("Fixed 31 songs", `CLOSED`). */
  onDone: (outcome?: string) => void
  onOpenPage: () => void
  listHeight: number
  onKeys?: (keys: AnswerKeys | null) => void
  onAsk?: (text: string) => void
  onCarriedOut?: (said: string) => void
  /** The reply's first list asked to play: played as it comes. */
  playNow: boolean
  onOpenList?: (keptId: string) => void
  beside: boolean
}): ReactNode {
  const router = useRouter()
  switch (answer.kind) {
    case 'songs':
      return (
        <SongsAnswerCard
          answer={answer}
          text={text}
          onPlayed={onDone}
          onOpen={onOpenPage}
          playNow={playNow}
          onOpenHere={onOpenList}
        />
      )
    case 'together':
      return <TogetherAnswer answer={answer} text={text} onDone={onDone} onOpen={onOpenPage} />
    case 'find':
      return <Found answer={answer} text={text} onDone={onDone} />
    case 'explore': {
      const words = (
        <Words
          text={answer.say}
          testID="ask-explore-say"
          // Music it told you about that you don't have: asked for next, as Get it.
          get={answer.get && onAsk ? () => onAsk(`Get ${answer.get}`) : undefined}
        />
      )
      const picks = (
        <SongPicks
          picks={answer.songIds.slice(0, 20).map(songId => ({ songId, why: null }))}
          text={text}
          onDone={onDone}
        />
      )
      // With room, the songs it names stand beside the words, in a card of their
      // own, rather than trailing under them (S1); a narrow page wraps them under.
      return beside && answer.songIds.length > 0 ? (
        <View style={styles.beside}>
          <View style={styles.besideWords}>{words}</View>
          <View style={styles.besideSongs}>{picks}</View>
        </View>
      ) : (
        <>
          {words}
          {picks}
        </>
      )
    }
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
      return <LibraryAnswer answer={answer} text={text} height={listHeight} onDone={onDone} />
    case 'stats':
      return (
        <>
          <AnswerHead>
            {plural(answer.plays, 'play', 'plays')} · {Math.round(answer.minutes)} min in{' '}
            {rangeWords(answer.range)}
          </AnswerHead>
          {/* As many as were asked for, up to 50: a long list scrolls in its own space. */}
          <ScrollView style={{ maxHeight: listHeight }}>
            {answer.items.map((item, index) => (
              <AnswerLine key={item.label} numberOfLines={1}>
                {index + 1}. {item.label}
                <Text style={styles.muted}> · {plural(item.plays, 'play', 'plays')}</Text>
              </AnswerLine>
            ))}
          </ScrollView>
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
    case 'clarify':
      return <ClarifyAnswer answer={answer} onAsk={onAsk} />
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
  text,
  onDone,
}: {
  answer: Extract<Answer, { kind: 'find' }>
  text: string
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
      <SongPicks picks={here} text={text} onDone={onDone} />
    </>
  )
}

/**
 * Songs an answer names (server ids), as rows: pressing one plays them from
 * it, named for the words asked (`foundSource`).
 */
function SongPicks({
  picks,
  text,
  onDone,
}: {
  picks: readonly { songId: number; why: string | null }[]
  text: string
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
            player.playFrom(ids, index, { source: foundSource(text) })
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
  beside: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: space.xl },
  besideWords: { flexGrow: 1, flexShrink: 1, flexBasis: 340, minWidth: 0 },
  besideSongs: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 300,
    minWidth: 0,
    padding: space.sm,
    borderRadius: radius.card,
    backgroundColor: theme.colors.surface1,
  },
  words: { gap: space.xs },
  wordsActions: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  muted: { color: theme.colors.textMuted, fontSize: type.small, fontWeight: '400' },
  reply: { gap: space.xl },
  part: { gap: space.sm },
  heading: label(theme.colors),
  outcome: { gap: space.md },
  outcomeLine: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  tick: {
    width: 20,
    height: 20,
    borderRadius: radius.pill,
    backgroundColor: theme.colors.good,
    alignItems: 'center',
    justifyContent: 'center',
  },
  outcomeDone: { color: theme.colors.textPrimary, ...textStyle('body') },
  outcomeClosed: { color: theme.colors.textSecondary, ...textStyle('body') },
}))
