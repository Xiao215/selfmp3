import { memo, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Text, View, type LayoutChangeEvent } from 'react-native'
import Reanimated from 'react-native-reanimated'
import { StyleSheet } from 'react-native-unistyles'
import { useRouter } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import {
  AI_ERROR,
  ASK_TEXT_MAX,
  answerRecap,
  objectsOf,
  tooLongToAsk,
  type AskReply,
  type ShownList,
} from '@selfmp3/shared'
import { ApiError, failureText, radius, space, textStyle, type } from '@selfmp3/client'
import { ASKS_MODEL } from '../../connection/refetchFailed'
import { viaKey } from '../../connection/via'
import { useFadeMotion } from '../../ui/rowMotion'
import { Button } from '../../ui/components/Button'
import { Press } from '../../ui/components/Press'
import { StatusLine } from '../../ui/components/StatusLine'
import { AddingToRoom } from '../room/RoomPicks'
import { AnswerBody, TAKES_KEYS } from './AnswerBody'
import { AnswerActions } from './AnswerParts'
import type { AnswerKeys } from './answerKeys'
import { askKept } from './askKept'
import { keepAnswer, shownOnServer, understandingOf, useKeptAnswers } from './answers.store'
import { fromLine, type Named, type Turn, type TurnList } from './askTurns.model'
import { newTicket, useAskProgress } from './useAskProgress'
import { useSmartServer } from './useSmartServer'
import { Working } from './Working'

/**
 * An ask's query key: the server it went to, the turn, every question of the
 * conversation up to this one, the song playing then and the list open then.
 * A turn drawn again is the same answer, kept for as long as the app is open;
 * the same words in a new turn are asked again, so "pause" said twice pauses
 * twice and a change said again changes the list as it is now. The server
 * remembers what the model said, so asking again costs little.
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

/** What a turn's reply came to, as `ThreadTurn` tells the page. */
export type Answered = Pick<Turn, 'answered' | 'lists' | 'objects'>

/** What a turn that failed was answered with, for the turns after it. */
const FAILED = '(This could not be answered.)'

/** The steps that stand in until the server says its own. */
const FIRST_STEPS = [
  { doing: 'Reading what you asked', done: 'Read what you asked' },
  { doing: 'Working on the answer', after: 3000 },
]

/**
 * One turn of Ask's conversation (2026-11-12, after the workbench's log): what
 * was asked, on the right as yours, and under it the reply in full — the
 * steps running now while it is worked on, a way to try again when it failed,
 * its own words and its cards once it came. Nothing of it is cut to a line,
 * so a later follow-up never leans on words the page no longer shows.
 *
 * A reply made from earlier answers says so first ("From “Calm study
 * night”"): pressing it brings that turn back into view. A list in it opens
 * beside the conversation, or as a page on a phone (`onOpen`).
 */
export const ThreadTurn = memo(function ThreadTurn({
  turn,
  number,
  latest,
  via,
  listHeight,
  named,
  openId,
  flash,
  onOpen,
  onShowFrom,
  onLayout,
  onAnswered,
  onSettle,
  onRetry,
  onAsk,
  onKeys,
}: {
  turn: Turn
  /** Its place on the page, 1 for the first: its objects' handles say it (`objectsOf`). */
  number: number
  latest: boolean
  via: string | null
  listHeight: number
  /** Every earlier answer, by handle (`namedObjects`): what its "From" line names. */
  named: ReadonlyMap<string, Named>
  /** The list open beside the conversation, by its kept id: its card is lit. */
  openId: string | null
  /** Just brought back into view by a later "From" line: lit for a moment. */
  flash: boolean
  onOpen: (list: TurnList) => void
  /** A "From" line pressed: the earlier answer it names, by handle. */
  onShowFrom: (handle: string) => void
  onLayout: (id: number, event: LayoutChangeEvent) => void
  onAnswered: (id: number, came: Answered) => void
  onSettle: (id: number, card: number, outcome: string) => void
  /** Try again, before it is asked again. */
  onRetry: (id: number) => void
  onAsk: (words: string) => void
  onKeys?: (keys: AnswerKeys | null) => void
}): ReactNode {
  const server = useSmartServer()
  const router = useRouter()
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
  // The lists that open beside it: ones to play or keep, with songs, not for a room.
  const lists = useMemo<TurnList[]>(
    () =>
      data
        ? data.cards.flatMap((card, index) => {
            const id = keptIds[index]
            return card.kind === 'songs' &&
              card.lead !== 'next' &&
              !room &&
              id !== undefined &&
              card.describe.picks.length > 0
              ? [{ id, handle: `t${number}.${index + 1}`, lead: card.lead }]
              : []
          })
        : [],
    [data, keptIds, room, number],
  )
  const recap = waiting
    ? null
    : shown
      ? answerRecap(shown, carried)
      : answer.isError || tooLong
        ? FAILED
        : null
  // What it showed, for the follow-ups to name by handle: each list as it is shown now.
  const objects = useMemo(
    () => (recap === null || !shown ? [] : objectsOf(shown, number, shownLists)),
    [recap, shown, number, shownLists],
  )
  useEffect(() => {
    if (
      recap !== null &&
      (recap !== turn.answered ||
        JSON.stringify(lists) !== JSON.stringify(turn.lists) ||
        JSON.stringify(objects) !== JSON.stringify(turn.objects))
    ) {
      onAnswered(turn.id, { answered: recap, lists, objects })
    }
  }, [recap, lists, objects, turn, onAnswered])
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
  // A list of its own opens beside it; one for a room or Up next, as a page.
  const openHere = useCallback(
    (id: string) => {
      const list = lists.find(each => each.id === id)
      if (list) onOpen(list)
      else router.push({ pathname: '/answer', params: { id } })
    },
    [lists, onOpen, router],
  )
  // The earlier answers it was made from, as the page still shows them.
  const from = (data?.from ?? []).flatMap(handle => {
    const object = named.get(handle)
    return object ? [{ handle, ...object }] : []
  })
  const fromWords = fromLine(from.map(each => each.label))
  const firstFrom = from[0]?.handle ?? null
  // A list made from an earlier list says what went and came.
  const earlierList = from.find(each => each.kind === 'songs') ?? null
  const changedFrom = useMemo(
    () => (earlierList ? { label: earlierList.label, songIds: earlierList.songIds } : null),
    [earlierList?.label, earlierList?.songIds], // eslint-disable-line react-hooks/exhaustive-deps -- the same earlier list is the same change
  )

  return (
    <View
      style={styles.turn}
      onLayout={event => onLayout(turn.id, event)}
      testID={`ask-turn-${turn.id}`}
    >
      <View style={styles.mine}>
        {room ? <Text style={styles.forRoom}>{`For ${room.title}`}</Text> : null}
        <Text style={styles.mineText} selectable testID="ask-turn-asked">
          {turn.asked}
        </Text>
      </View>
      <View style={[styles.reply, flash && styles.replyFlash]}>
        {fromWords && firstFrom ? (
          <Press
            feedback="dim"
            onPress={() => onShowFrom(firstFrom)}
            accessibilityRole="button"
            accessibilityLabel={`${fromWords}: show it`}
            style={styles.from}
            testID="ask-turn-from"
          >
            <Text style={styles.fromMark}>↰</Text>
            <Text style={styles.fromText} numberOfLines={1}>
              {fromWords}
            </Text>
          </Press>
        ) : null}
        {waiting ? (
          <Working steps={FIRST_STEPS} live={live} testID="ask-waiting" />
        ) : (
          <Reanimated.View entering={answerIn} style={styles.answered}>
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
                onOpenList={openHere}
                openList={openId}
                changedFrom={changedFrom}
              />
            ) : null}
          </Reanimated.View>
        )}
      </View>
    </View>
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

const styles = StyleSheet.create(theme => ({
  turn: { gap: space.md },
  // Yours, on the right as in any chat: a step up from the ground.
  mine: {
    alignSelf: 'flex-end',
    maxWidth: '85%',
    gap: 2,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.card,
    borderBottomRightRadius: radius.coverSm,
    backgroundColor: theme.colors.surface3,
  },
  mineText: { color: theme.colors.textPrimary, ...textStyle('body') },
  forRoom: { color: theme.colors.textMuted, fontSize: type.small },
  // The same room around it lit or not, so a flash moves nothing.
  reply: {
    gap: space.sm,
    marginHorizontal: -space.sm,
    padding: space.sm,
    borderRadius: radius.card,
  },
  replyFlash: { backgroundColor: theme.colors.accentPill },
  answered: { gap: space.md },
  failed: { gap: space.sm },
  from: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingLeft: space.sm,
    paddingRight: space.snug,
    paddingVertical: space.xs,
    borderRadius: radius.pill,
    backgroundColor: theme.colors.surface2,
  },
  fromMark: { color: theme.colors.accent, fontSize: type.small, fontWeight: '700' },
  fromText: { flexShrink: 1, color: theme.colors.textSecondary, fontSize: type.small },
}))
