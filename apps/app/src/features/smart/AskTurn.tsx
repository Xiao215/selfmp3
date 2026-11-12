import { memo, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { View } from 'react-native'
import Reanimated from 'react-native-reanimated'
import { useFadeMotion } from '../../ui/rowMotion'
import { StyleSheet } from 'react-native-unistyles'
import { useRouter } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  AI_ERROR,
  ASK_TEXT_MAX,
  answerRecap,
  objectsOf,
  tooLongToAsk,
  type AskReply,
  type ShownList,
} from '@selfmp3/shared'
import { ApiError, failureText, space } from '@selfmp3/client'
import { ASKS_MODEL } from '../../connection/refetchFailed'
import { viaKey } from '../../connection/via'
import { useLayoutFlags } from '../../shell/useLayout'
import { BackButton } from '../../ui/components/BackButton'
import { Button } from '../../ui/components/Button'
import { ScrollView } from '../../ui/components/Scroll'
import { StatusLine } from '../../ui/components/StatusLine'
import { pageFrame } from '../../ui/surfaces'
import { AddingToRoom } from '../room/RoomPicks'
import { AnswerBody, TAKES_KEYS } from './AnswerBody'
import { AskedLabel, AskedTitle } from './AskedTitle'
import { AnswerView } from './AnswerScreen'
import { AnswerActions } from './AnswerParts'
import type { AnswerKeys } from './answerKeys'
import { askKept } from './askKept'
import { keepAnswer, shownOnServer, understandingOf, useKeptAnswers } from './answers.store'
import type { Turn } from './askTurns.model'
import { logLine } from './smart.model'
import { newTicket, useAskProgress } from './useAskProgress'
import { useSmartServer } from './useSmartServer'
import { Working } from './Working'

/**
 * An ask's query key: the server it went to, the turn, every question of the
 * conversation up to this one, the song playing then and the answer on the
 * screen. A turn drawn again
 * (Back from its list) is the same answer, kept for as long as the app is
 * open; the same words in a new turn are asked again, so "pause" said twice
 * pauses twice and a change said again changes the list as it is now. The
 * server remembers what the model said, so asking again costs little.
 */
function askKey(
  via: string | null,
  turn: number,
  asked: readonly string[],
  playing: number | null,
  screen: string | null,
) {
  return viaKey(via, 'ai', 'ask', turn, asked, playing, screen)
}

/** What a turn's reply came to, as `TurnStage` tells the page. */
export type Answered = Pick<Turn, 'answered' | 'list' | 'listHandle' | 'line' | 'objects'>

/** What a turn that failed was answered with, for the turns after it. */
const FAILED = '(This could not be answered.)'

/** The steps that stand in until the server says its own. */
const FIRST_STEPS = [
  { doing: 'Reading what you asked', done: 'Read what you asked' },
  { doing: 'Working on the answer', after: 3000 },
]

/** An answer that is not only a list: its way back at the top on a phone, the rest scrolling under it. */
export function Stage({
  top,
  hidden = false,
  testID,
  children,
}: {
  top: ReactNode
  hidden?: boolean
  testID?: string
  children: ReactNode
}): ReactNode {
  const { wide } = useLayoutFlags()
  const insets = useSafeAreaInsets()
  const frame = pageFrame(wide)
  return (
    <View style={[styles.stage, hidden && styles.hidden]} testID={testID}>
      <ScrollView
        style={styles.stage}
        contentContainerStyle={[
          styles.stageContent,
          frame,
          { paddingTop: insets.top + frame.paddingTop },
        ]}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
      >
        {top}
        {children}
      </ScrollView>
    </View>
  )
}

/**
 * One turn on the stage: what was asked as the title, and its answer under it
 * — the step running now while it is worked on, a way to try again when it
 * failed, the line it was answered with once it is settled. A list is the
 * list itself, its head carrying the title. Off the stage it stays drawn,
 * hidden, so its request goes on.
 */
export const TurnStage = memo(function TurnStage({
  turn,
  number,
  shown: onStage,
  latest,
  top,
  via,
  listHeight,
  onAnswered,
  onSettle,
  onRetry,
  onAsk,
  onKeys,
}: {
  turn: Turn
  /** Its place on the page, 1 for the first: its objects' handles say it (`objectsOf`). */
  number: number
  /** On the stage; otherwise drawn but hidden. */
  shown: boolean
  latest: boolean
  /** On a phone, the way back to the log; on a computer, nothing: the log is beside it. */
  top: ReactNode
  via: string | null
  listHeight: number
  onAnswered: (id: number, came: Answered) => void
  onSettle: (id: number, card: number, outcome: string) => void
  /** Try again, before it is asked again. */
  onRetry: (id: number) => void
  onAsk: (words: string) => void
  onKeys?: (keys: AnswerKeys | null) => void
}): ReactNode {
  const server = useSmartServer()
  const router = useRouter()
  const { wide } = useLayoutFlags()
  const room = useContext(AddingToRoom)
  const said = turn.before
  // More than the server takes is said here rather than sent to be refused.
  const tooLong = tooLongToAsk(turn.asked)
  // Names the request, so how it is going can be asked after while it runs,
  // and its answer collected if the response is lost (`askKept`). A new one
  // each time: a Stop meant for one request must not reach the next.
  const [ticket, setTicket] = useState<string | null>(null)
  const answer = useQuery<AskReply>({
    queryKey: askKey(
      via,
      turn.id,
      [...said.map(each => each.asked), turn.asked],
      turn.playing,
      turn.screen,
    ),
    // Read, so React Query drops the request when nobody watches it any more:
    // Stop, the page left. The server stops asking the model with it.
    queryFn: async ({ signal }) => {
      const named = newTicket()
      setTicket(named)
      return askKept(
        server.api!,
        {
          text: turn.asked,
          context: {
            playing: turn.playing,
            screen: turn.screen,
            // The language to answer in when the words alone cannot say.
            locale: Intl.DateTimeFormat().resolvedOptions().locale,
          },
          ticket: named,
          before: said,
        },
        signal,
      )
    },
    enabled: server.api !== null && !tooLong,
    ...ASKS_MODEL,
    staleTime: Infinity,
  })
  // Asked again after it failed (Try again) is waiting too.
  const waiting = !tooLong && (answer.isPending || (answer.isError && answer.isFetching))
  const live = useAskProgress(ticket, waiting)
  // The answer, or why there is none, fades in where the steps stood.
  const { entering: answerIn } = useFadeMotion()
  const data = answer.data
  // Each songs card is an answer kept on its own (`answers.store`), by its place.
  const keptIds = useMemo(
    () =>
      data?.cards.map(card =>
        card.kind === 'songs' ? keepAnswer(turn.asked, card.describe) : undefined,
      ) ?? [],
    [data, turn.asked],
  )
  const keptAnswers = useKeptAnswers()
  // A list changed in words (Change it) is told as it is now shown, not as it first came.
  const shown = useMemo(() => {
    if (!data) return undefined
    const cards = data.cards.map((card, index) => {
      const kept = keptIds[index] === undefined ? undefined : keptAnswers.get(keptIds[index])
      return card.kind === 'songs' && kept ? { ...card, describe: kept.result } : card
    })
    return { ...data, cards }
  }, [data, keptIds, keptAnswers])
  // Each list as it is shown now, by its card's place: what the follow-ups name.
  const shownLists = useMemo(() => {
    const lists = new Map<number, ShownList>()
    keptIds.forEach((id, index) => {
      const kept = id === undefined ? undefined : keptAnswers.get(id)
      if (kept) {
        lists.set(index, {
          songIds: shownOnServer(kept, server.onServer),
          understanding: understandingOf(kept),
        })
      }
    })
    return lists
  }, [keptIds, keptAnswers, server.onServer])
  // A playback card is told as what it came to on this device ("Nothing is playing."), by its place.
  const [carried, setCarried] = useState<Readonly<Record<number, string>>>({})
  const carriedOut = useCallback(
    (index: number, came: string) => setCarried(was => ({ ...was, [index]: came })),
    [],
  )
  // The lists that stand on the stage: one to play or keep, with songs, not for a room.
  const stageLists = data
    ? data.cards.flatMap((card, index) => {
        const id = keptIds[index]
        return card.kind === 'songs' &&
          card.lead !== 'next' &&
          !room &&
          id !== undefined &&
          card.describe.picks.length > 0
          ? [{ id, index, lead: card.lead }]
          : []
      })
    : []
  // A reply that is one list is the list itself; among other cards, one is opened by pressing it.
  const alone = data?.cards.length === 1 ? (stageLists[0] ?? null) : null
  const [opened, setOpened] = useState<string | null>(null)
  const openedList = stageLists.find(each => each.id === opened) ?? null
  const onStageList = alone ?? openedList
  // Its list: the one on the stage, or the reply's first; what the field's chip changes.
  const listed = onStageList ?? stageLists[0] ?? null
  const recap = waiting
    ? null
    : shown
      ? answerRecap(shown, carried)
      : answer.isError || tooLong
        ? FAILED
        : null
  // What the log says under the question: a part per card, what came of each in its place.
  const line = waiting || !shown ? null : logLine(shown, { ...carried, ...turn.outcomes })
  // What it showed, for the follow-ups to name by handle: each list as it is shown now.
  const objects = useMemo(
    () => (recap === null || !shown ? [] : objectsOf(shown, number, shownLists)),
    [recap, shown, number, shownLists],
  )
  const list = listed?.id ?? null
  const listHandle = listed ? `t${number}.${listed.index + 1}` : null
  useEffect(() => {
    if (
      recap !== null &&
      (recap !== turn.answered ||
        list !== turn.list ||
        listHandle !== turn.listHandle ||
        line !== turn.line ||
        JSON.stringify(objects) !== JSON.stringify(turn.objects))
    ) {
      onAnswered(turn.id, { answered: recap, list, listHandle, line, objects })
    }
  }, [recap, list, listHandle, line, objects, turn, onAnswered])
  // Done with when every review in it is: only the newest answer's keys work, and only while one is open.
  const settled =
    data !== undefined &&
    data.cards.every(
      (card, index) => !TAKES_KEYS.has(card.kind) || turn.outcomes[index] !== undefined,
    )
  useEffect(() => {
    if (!onKeys || settled) return undefined
    return () => onKeys(null)
  }, [onKeys, settled])
  const settleCard = useCallback(
    (index: number, outcome: string) => onSettle(turn.id, index, outcome),
    [onSettle, turn.id],
  )

  // A list on the stage is the list itself: the reply's only card, or one opened from among its cards.
  if (onStageList !== null && data) {
    return (
      <View style={[styles.stage, !onStage && styles.hidden]} testID={`ask-turn-${turn.id}`}>
        <AnswerView
          key={onStageList.id}
          id={onStageList.id}
          asked={turn.asked}
          said={alone ? data.say : null}
          top={
            alone ? (
              top
            ) : (
              // Back to the reply's cards, on a phone and a computer alike.
              <BackButton
                to="/search"
                always
                onPress={() => setOpened(null)}
                testID="ask-to-reply"
              />
            )
          }
          lead={onStageList.lead}
          playNow={alone !== null && onStageList.lead === 'play'}
        />
      </View>
    )
  }
  return (
    <Stage top={top} hidden={!onStage} testID={`ask-turn-${turn.id}`}>
      {waiting && !wide ? (
        <View style={styles.working}>
          <AskedLabel label={room ? `Asking for ${room.title}` : 'Asking'} />
          <AskedTitle asked={turn.asked} center testID="ask-turn-asked" />
          <Working steps={FIRST_STEPS} live={live} stage testID="ask-waiting" />
        </View>
      ) : waiting ? (
        // On a computer the question and its steps stand where its answer will be.
        <View style={[styles.answered, styles.answeredWide]}>
          <View style={styles.asked}>
            <AskedLabel label={room ? `Asking for ${room.title}` : 'Asking'} />
            <AskedTitle asked={turn.asked} testID="ask-turn-asked" />
          </View>
          <Working steps={FIRST_STEPS} live={live} testID="ask-waiting" />
        </View>
      ) : (
        <Reanimated.View entering={answerIn} style={[styles.answered, wide && styles.answeredWide]}>
          <View style={styles.asked}>
            <AskedLabel label={room ? `Asked for ${room.title}` : 'You asked'} />
            <AskedTitle asked={turn.asked} testID="ask-turn-asked" />
          </View>
          {tooLong ? (
            <StatusLine testID="ask-too-long">
              {`That’s too long to ask: Ask takes up to ${ASK_TEXT_MAX} characters.`}
            </StatusLine>
          ) : answer.error ? (
            <View style={styles.failed}>
              <StatusLine>{failureText('Couldn’t answer that', answer.error)}</StatusLine>
              {latest ? (
                <AnswerActions>
                  {settingsHelp(answer.error) ? (
                    <Button label="Open Settings" onPress={() => router.navigate('/settings')} />
                  ) : null}
                  <Button
                    label="Try again"
                    onPress={() => {
                      onRetry(turn.id)
                      void answer.refetch()
                    }}
                  />
                </AnswerActions>
              ) : null}
            </View>
          ) : data ? (
            <AnswerBody
              reply={data}
              text={turn.asked}
              outcomes={turn.outcomes}
              // A proposal acted on or put aside becomes what came of it; anything
              // else stays to come back to.
              onSettle={settleCard}
              listHeight={listHeight}
              onKeys={latest && !settled ? onKeys : undefined}
              onAsk={onAsk}
              onCarriedOut={carriedOut}
              onOpenList={setOpened}
              beside={wide}
            />
          ) : null}
        </Reanimated.View>
      )}
    </Stage>
  )
})

/**
 * A model's failure Settings can help with: none set up, not reached, or its
 * key refused. A busy or muddled model is only a matter of trying again.
 */
function settingsHelp(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.code === AI_ERROR.off ||
      error.code === AI_ERROR.unreachable ||
      error.code === AI_ERROR.refused)
  )
}

/** The widest an answer that is not a list is set, on a big window. */
const ANSWER_MAX = 1100

const styles = StyleSheet.create({
  // Every answer fills the answer side; the ones not shown are drawn and hidden.
  stage: { ...StyleSheet.absoluteFillObject },
  hidden: { display: 'none' },
  stageContent: { flexGrow: 1, gap: space.xl, paddingBottom: space.xl },
  // While it is worked on, the question and its step in the middle of the page.
  working: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.lg,
    paddingHorizontal: space.lg,
    // Lifted a little off true centre, over the field below.
    paddingBottom: space.gutterWide,
  },
  answered: { gap: space.xl },
  // Wide enough for words beside their songs, not so wide a line runs on.
  answeredWide: { maxWidth: ANSWER_MAX },
  asked: { gap: space.sm },
  failed: { gap: space.sm },
})
