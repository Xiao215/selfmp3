import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import {
  Keyboard,
  KeyboardAvoidingView,
  Text,
  // eslint-disable-next-line @typescript-eslint/no-restricted-imports -- the dock is its own field, its send turning into Stop in place, as ChangeField's does
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useLocalSearchParams } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import type { AskAnswer, AskTurn } from '@selfmp3/shared'
import { failureText, iconSize, radius, space, textStyle, type } from '@selfmp3/client'
import { ServerAway } from '../../connection/ServerAway'
import { reachedConnection, viaKey } from '../../connection/via'
import { usePlayer } from '../../player/PlayerProvider'
import { keyboardAvoidBehavior } from '../../ports/keyboard'
import { NarrowerContentWidth } from '../../shell/contentWidth'
import { isComposing } from '../../shell/composing'
import { setPageFoot } from '../../shell/pageFoot'
import { useLayout } from '../../shell/useLayout'
import { useAccent } from '../../ui/accent'
import { BackButton } from '../../ui/components/BackButton'
import { Button } from '../../ui/components/Button'
import { IconButton } from '../../ui/components/IconButton'
import { Check, ChevronRight, Sparkle } from '../../ui/components/Icons'
import { Kbd } from '../../ui/components/Kbd'
import { SafeAreaView } from '../../ui/components/SafeAreaView'
import { ScrollView, type ScrollView as ScrollNode } from '../../ui/components/Scroll'
import { StatusLine } from '../../ui/components/StatusLine'
import { NO_AUTOFILL } from '../../ui/noAutofill'
import { useSongsById } from '../../ui/songsById'
import { PAGE_TOP_PHONE, PAGE_TOP_WIDE } from '../../ui/surfaces'
import { roomTitle } from '../room/room.model'
import { useRoom } from '../room/room.store'
import { AddingToRoom } from '../room/RoomPicks'
import { AnswerBody } from './AnswerBody'
import { AnswerActions, CLOSED } from './AnswerParts'
import { SelectableText } from '../../ports/selectableText'
import type { AnswerKeys } from './answerKeys'
import { askKept } from './askKept'
import { answerRecap } from './smart.model'
import { StopButton } from './StopButton'
import { newTicket, useAskProgress } from './useAskProgress'
import { useSmartServer } from './useSmartServer'
import { Working } from './Working'

/** One thing asked on the page, and what came of it once it has come. */
interface Turn {
  /** Names it among the page's turns: its words can repeat. */
  readonly id: number
  readonly asked: string
  /** The song playing when it was asked, by the server's id: what "this" meant then (A8). */
  readonly playing: number | null
  /** What its answer showed, in words, for the turns after it; null until it is answered. */
  readonly answered: string | null
  /**
   * What came of a proposal once it was acted on or put aside ("Fixed 31
   * songs", `CLOSED`): the turn keeps the model's words and this line (S1).
   */
  readonly outcome: string | null
}

/**
 * An ask's query key: the server it went to, every question of the
 * conversation up to this one, and the song playing then. The same
 * conversation asked again is the same answer, kept for as long as the app is
 * open: a model's answer is not something to fetch twice.
 */
function askKey(via: string | null, asked: readonly string[], playing: number | null) {
  return viaKey(via, 'ai', 'ask', asked, playing)
}

/** Names each turn, across the app's life: two pages' turns never share one. */
let nextTurn = 1

/** What a turn that failed was answered with, for the turns after it. */
const FAILED = '(This could not be answered.)'

/** The steps that stand in until the server says its own. */
const FIRST_STEPS = [
  { doing: 'Reading what you asked', done: 'Read what you asked' },
  { doing: 'Working on the answer', after: 3000 },
]

/**
 * Answers that are a proposal: once acted on or put aside (Apply, Close, Not
 * now), the turn folds to the line it was answered with. The rest stay as
 * they are, since playing a song from an answer is not the end of it.
 */
const SETTLES: ReadonlySet<AskAnswer['kind']> = new Set([
  'tags',
  'tidy',
  'copies',
  'remember',
  'playlists',
  'playlistSongs',
])

/**
 * Ask, as a conversation (docs/features/ai.md, "The Ask page"; Xiao picked
 * A1 B2 C1 D1 E1 F1, 2026-10-24): `/ask?q=…` from Search's Enter or its Ask
 * card, and from the palette's Ask row on a computer.
 *
 * Each turn is what you said, in a bubble on the right, and its answer under
 * it, as it would be shown on its own; the turns stay, oldest at the top. The
 * field at the foot asks the next one, after everything before it (F1: the
 * server hears each earlier question with what was shown for it, and answers
 * the newest). While one is worked on its send is a Stop, which takes the
 * turn back off the page and its words back into the field. ‹ goes back to
 * Search with the question still typed; a conversation is not kept after it.
 *
 * `?to=room` asks for the room you are in, as Search does when adding to it
 * (A2): songs answered are added there rather than played.
 */
export function AskScreen(): ReactNode {
  const params = useLocalSearchParams<{ q?: string; to?: string }>()
  const { state: room } = useRoom()
  const adding = params.to === 'room' ? room : null
  const addingTo = useMemo(() => (adding ? { title: roomTitle(adding) } : null), [adding])
  const { wide, finePointer } = useLayout()
  const window = useWindowDimensions()
  const server = useSmartServer()
  const player = usePlayer()
  const songsById = useSongsById()

  const playingNow = (): number | null => {
    const id = player.current?.id
    return id === undefined ? null : (server.onServer(id) ?? null)
  }
  const turnFor = (asked: string): Turn => ({
    id: nextTurn++,
    asked,
    playing: playingNow(),
    answered: null,
    outcome: null,
  })
  const [turns, setTurns] = useState<readonly Turn[]>(() => {
    const first = typeof params.q === 'string' ? params.q.trim() : ''
    return first ? [turnFor(first)] : []
  })
  const [draft, setDraft] = useState('')
  const [keys, setKeys] = useState<AnswerKeys | null>(null)
  const field = useRef<TextInput>(null)
  const scroll = useRef<ScrollNode>(null)
  /** Where the newest turn starts in the thread, to show an answer from its top. */
  const latestTop = useRef(0)
  /** How far the thread is scrolled, and how tall it is, to keep its foot in view as it shrinks. */
  const scrolled = useRef(0)
  const threadHeight = useRef(0)
  /** The thread's last shrink: by how much, and where it was scrolled to then. */
  const shrank = useRef<{ by: number; at: number } | null>(null)
  // The keyboard takes room from the thread's foot. Once it is up, what was at
  // the foot is moved up by that room, as a messages app keeps it; moved while
  // the keyboard still rises, the scroll was lost to the page's own move.
  useEffect(() => {
    const risen = Keyboard.addListener('keyboardDidShow', () => {
      const lost = shrank.current
      shrank.current = null
      if (lost) scroll.current?.scrollTo({ y: lost.at + lost.by, animated: true })
    })
    return () => risen.remove()
  }, [])

  const latest = turns.at(-1)
  const working = latest !== undefined && latest.answered === null
  // The answer's keys (a review's ticks) while the field has nothing typed: letters are a follow-up.
  const answerKeys = draft === '' && !working ? keys : null

  const ask = (words: string): void => {
    const asked = words.trim()
    if (!asked || working || !server.api) return
    setTurns(was => [...was, turnFor(asked)])
    setKeys(null)
    setDraft('')
  }
  // Stop: the turn being worked on comes off the page, its words back in the field to change.
  const stop = (): void => {
    if (!latest || !working) return
    setTurns(was => was.slice(0, -1))
    setDraft(latest.asked)
    field.current?.focus()
  }
  const answered = useCallback((id: number, recap: string) => {
    setTurns(was => was.map(turn => (turn.id === id ? { ...turn, answered: recap } : turn)))
  }, [])
  const settle = useCallback((id: number, outcome: string) => {
    setTurns(was => was.map(turn => (turn.id === id ? { ...turn, outcome } : turn)))
  }, [])
  const titleOf = useCallback(
    (serverId: number) => {
      const id = server.onDevice(serverId)
      const song = id === undefined ? undefined : songsById.get(id)
      return song ? `${song.title} — ${song.artist}` : undefined
    },
    [server, songsById],
  )

  // A new turn scrolls to the foot, where it is; its answer arriving, to the
  // turn's top, so a long answer is read from its start.
  const count = turns.length
  const lastAnswered = latest?.answered != null
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (lastAnswered) scroll.current?.scrollTo({ y: latestTop.current, animated: true })
      else scroll.current?.scrollToEnd({ animated: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [count, lastAnswered])

  const passToAnswer = (event: {
    key: string
    metaKey: boolean
    ctrlKey: boolean
    nativeEvent: { isComposing?: boolean }
    preventDefault: () => void
    stopPropagation: () => void
  }): void => {
    // An input method's keys are its own while it composes (pinyin, kana).
    if (isComposing(event.nativeEvent)) return
    if (!answerKeys?.press(event.key, event.metaKey || event.ctrlKey)) return
    event.preventDefault()
    event.stopPropagation()
  }

  const listHeight = Math.max(240, window.height * 0.55)
  useEffect(() => () => setPageFoot(0), [])

  return (
    <AddingToRoom.Provider value={addingTo}>
      <NarrowerContentWidth max={COLUMN}>
        <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
          <KeyboardAvoidingView
            style={[styles.page, wide && styles.pageWide]}
            behavior={keyboardAvoidBehavior}
            testID="ask-screen"
            // A computer's keys for a review on the page, the field keeping the focus.
            {...(answerKeys ? { onKeyDownCapture: passToAnswer } : {})}
          >
            <View style={styles.head}>
              <View style={styles.headSide}>
                <BackButton to="/search" always testID="ask-back" />
              </View>
              <View style={styles.title}>
                <Sparkle size={iconSize.small} />
                <Text style={styles.titleText} accessibilityRole="header">
                  {adding ? `Ask for ${roomTitle(adding)}` : 'Ask'}
                </Text>
              </View>
              {/* Balances the ‹, so the title sits in the middle. */}
              <View style={styles.headSide} />
            </View>

            {server.reach.state !== 'reachable' ? (
              <View style={styles.away}>
                <ServerAway reach={server.reach} need="ai" testID="ask-server" />
              </View>
            ) : (
              <ScrollView
                ref={scroll}
                style={styles.thread}
                contentContainerStyle={styles.turns}
                keyboardDismissMode="interactive"
                keyboardShouldPersistTaps="handled"
                onScroll={event => {
                  scrolled.current = event.nativeEvent.contentOffset.y
                }}
                scrollEventThrottle={16}
                onLayout={event => {
                  const height = event.nativeEvent.layout.height
                  if (height < threadHeight.current) {
                    shrank.current = { by: threadHeight.current - height, at: scrolled.current }
                  }
                  threadHeight.current = height
                }}
              >
                {turns.length === 0 ? (
                  <Text style={styles.empty}>
                    Ask for music, about a song or an artist, or about your library.
                  </Text>
                ) : null}
                {turns.map((turn, index) => (
                  <TurnView
                    key={turn.id}
                    turn={turn}
                    before={turns.slice(0, index).map(each => ({
                      asked: each.asked,
                      // What was proposed, and what came of it once it did.
                      answered: each.outcome
                        ? `${each.answered ?? ''}\nThen: ${each.outcome}`
                        : (each.answered ?? ''),
                    }))}
                    latest={index === turns.length - 1}
                    via={reachedConnection(server.reach)?.baseUrl ?? null}
                    titleOf={titleOf}
                    listHeight={listHeight}
                    onAnswered={answered}
                    onSettle={settle}
                    // A dead end's suggestions, and Tidy up's "ask about the rest": the next turn.
                    onAsk={ask}
                    onKeys={index === turns.length - 1 ? setKeys : undefined}
                    onTop={
                      index === turns.length - 1
                        ? y => {
                            latestTop.current = Math.max(0, y - space.sm)
                          }
                        : undefined
                    }
                  />
                ))}
              </ScrollView>
            )}

            <View
              style={styles.dock}
              // The toasts rise above the field rather than cover it.
              onLayout={event => setPageFoot(event.nativeEvent.layout.height)}
            >
              <AskField
                inputRef={field}
                value={draft}
                onChangeText={setDraft}
                onSend={() => ask(draft)}
                onStop={working ? stop : null}
                placeholder={turns.length === 0 ? 'Ask anything…' : 'Ask a follow-up…'}
                autoFocus={turns.length === 0}
              />
              {finePointer && answerKeys ? (
                <View style={styles.keys}>
                  {answerKeys.hints.map(([caps, word]) => (
                    <Text key={word} style={styles.keysText}>
                      {caps.map((cap, at) => (
                        <Text key={cap}>
                          {at > 0 ? ' ' : ''}
                          <Kbd>{cap}</Kbd>
                        </Text>
                      ))}{' '}
                      {word}
                    </Text>
                  ))}
                </View>
              ) : null}
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </NarrowerContentWidth>
    </AddingToRoom.Provider>
  )
}

/**
 * One turn: what was asked, in its bubble, and its answer under it — the
 * steps while it is worked on, a way to try again when it failed, the line it
 * was answered with once it is settled.
 */
function TurnView({
  turn,
  before,
  latest,
  via,
  titleOf,
  listHeight,
  onAnswered,
  onSettle,
  onAsk,
  onKeys,
  onTop,
}: {
  turn: Turn
  /** The conversation before it, as it was when it was asked. */
  before: readonly AskTurn[]
  latest: boolean
  via: string | null
  titleOf: (serverId: number) => string | undefined
  listHeight: number
  onAnswered: (id: number, recap: string) => void
  onSettle: (id: number, outcome: string) => void
  onAsk: (words: string) => void
  onKeys?: (keys: AnswerKeys | null) => void
  /** Where it starts in the thread, for the newest. */
  onTop?: (y: number) => void
}): ReactNode {
  const server = useSmartServer()
  // What it follows on from is fixed when it is asked: a later recap is not a new question.
  const [said] = useState(before)
  // Names the request, so how it is going can be asked after while it runs,
  // and its answer collected if the response is lost (`askKept`). A new one
  // each time: a Stop meant for one request must not reach the next.
  const [ticket, setTicket] = useState<string | null>(null)
  const answer = useQuery({
    queryKey: askKey(via, [...said.map(each => each.asked), turn.asked], turn.playing),
    // Read, so React Query drops the request when nobody watches it any more:
    // Stop, the page left. The server stops asking the model with it.
    queryFn: ({ signal }) => {
      const named = newTicket()
      setTicket(named)
      return askKept(
        server.api!,
        { text: turn.asked, playing: turn.playing, ticket: named, before: said },
        signal,
      )
    },
    enabled: server.api !== null,
    retry: false,
    staleTime: Infinity,
  })
  // Asked again after it failed (Try again) is waiting too.
  const waiting = answer.isPending || (answer.isError && answer.isFetching)
  const live = useAskProgress(ticket, waiting)
  const data = answer.data
  const recap = data ? answerRecap(data, titleOf) : answer.isError ? FAILED : null
  useEffect(() => {
    if (recap !== null && recap !== turn.answered) onAnswered(turn.id, recap)
  }, [recap, turn.answered, turn.id, onAnswered])
  const settled = turn.outcome !== null
  // Only the newest answer's keys work, and only while it is shown whole.
  useEffect(() => {
    if (!onKeys || settled) return undefined
    return () => onKeys(null)
  }, [onKeys, settled])

  const settles = data !== undefined && SETTLES.has(data.kind)
  return (
    <View
      style={styles.turn}
      onLayout={onTop ? event => onTop(event.nativeEvent.layout.y) : undefined}
      testID={`ask-turn-${turn.id}`}
    >
      <View style={styles.bubble}>
        <Text style={styles.bubbleText} selectable testID="ask-turn-asked">
          {turn.asked}
        </Text>
      </View>
      {waiting ? (
        <Working steps={FIRST_STEPS} live={live} outline={false} testID="ask-waiting" />
      ) : answer.error ? (
        <View style={styles.failed}>
          <StatusLine>{failureText('Couldn’t answer that', answer.error)}</StatusLine>
          {latest ? (
            <AnswerActions>
              <Button label="Try again" onPress={() => void answer.refetch()} />
            </AnswerActions>
          ) : null}
        </View>
      ) : turn.outcome !== null && data ? (
        <Outcome answer={data} outcome={turn.outcome} />
      ) : data ? (
        <View testID={`ask-answer-${data.kind}`}>
          <AnswerBody
            answer={data}
            text={turn.asked}
            // A proposal acted on or put aside becomes what came of it; anything
            // else stays to come back to.
            onDone={outcome => (settles && outcome ? onSettle(turn.id, outcome) : undefined)}
            onOpenPage={() => undefined}
            listHeight={listHeight}
            onKeys={latest && !settled ? onKeys : undefined}
            onAsk={onAsk}
          />
        </View>
      ) : null}
    </View>
  )
}

/**
 * A proposal once it is done with (S1): what the model said stays as it was,
 * and the review gives way to one line on what came of it, ticked when
 * something was done.
 */
function Outcome({ answer, outcome }: { answer: AskAnswer; outcome: string }): ReactNode {
  const { theme } = useUnistyles()
  const said = answer.kind === 'tidy' ? answer.tidy.reply : null
  const done = outcome !== CLOSED
  return (
    <View style={styles.outcome}>
      {said ? <SelectableText style={styles.said}>{said}</SelectableText> : null}
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
 * The field at the foot of the page: one line with a send once there are
 * words, and while an answer is worked on, a Stop where the send was. Enter
 * sends; a browser keeps the focus in it, since the next follow-up is likely.
 */
function AskField({
  inputRef,
  value,
  onChangeText,
  onSend,
  onStop,
  placeholder,
  autoFocus,
}: {
  inputRef: RefObject<TextInput | null>
  value: string
  onChangeText: (value: string) => void
  onSend: () => void
  /** While an answer is worked on: what Stop does. */
  onStop: (() => void) | null
  placeholder: string
  autoFocus: boolean
}): ReactNode {
  const { theme } = useUnistyles()
  const accent = useAccent()
  const [focused, setFocused] = useState(false)
  const words = value.trim().length > 0
  return (
    <View style={[styles.field, focused && { borderColor: accent.accent }]}>
      <Sparkle size={iconSize.small} />
      <TextInput
        {...NO_AUTOFILL}
        ref={inputRef}
        value={value}
        onChangeText={onChangeText}
        onSubmitEditing={onStop ? undefined : onSend}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        autoFocus={autoFocus}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.textMuted}
        returnKeyType="send"
        submitBehavior="submit"
        blurOnSubmit={false}
        accessibilityLabel="Ask"
        testID="ask-follow-up-input"
        style={styles.input}
      />
      {onStop ? (
        <StopButton onPress={onStop} size={34} testID="ask-stop" />
      ) : (
        <View style={!words && styles.sendAway} pointerEvents={words ? 'auto' : 'none'}>
          <IconButton
            label="Send"
            filled="accent"
            size={34}
            onPress={onSend}
            testID="ask-follow-up-send"
          >
            <ChevronRight size={iconSize.field} color={theme.colors.onPrimary} />
          </IconButton>
        </View>
      )}
    </View>
  )
}

/** The column a computer's Ask keeps to, as Search's does. */
const COLUMN = 760

const styles = StyleSheet.create(theme => ({
  screen: { flex: 1, backgroundColor: theme.colors.surface0 },
  page: { flex: 1 },
  pageWide: {
    maxWidth: COLUMN,
    width: '100%',
    alignSelf: 'center',
    paddingTop: PAGE_TOP_WIDE - PAGE_TOP_PHONE,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    paddingTop: PAGE_TOP_PHONE,
    paddingBottom: space.sm,
  },
  headSide: { width: 48, flexDirection: 'row' },
  title: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.tight,
  },
  titleText: { color: theme.colors.textPrimary, fontSize: type.body, fontWeight: '600' },
  away: { flex: 1, paddingHorizontal: space.md },
  thread: { flex: 1 },
  turns: { paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.lg, gap: 28 },
  empty: { color: theme.colors.textMuted, ...textStyle('body'), paddingTop: space.lg },
  turn: { gap: space.md },
  // What you said: on the right, in the accent's tint, as a message you sent.
  bubble: {
    alignSelf: 'flex-end',
    maxWidth: '82%',
    paddingVertical: space.sm,
    paddingHorizontal: space.roomy,
    borderRadius: 20,
    borderBottomRightRadius: radius.coverSm,
    backgroundColor: theme.colors.accentPill,
  },
  bubbleText: { color: theme.colors.textPrimary, ...textStyle('body') },
  failed: { gap: space.sm },
  outcome: { gap: space.md },
  said: { color: theme.colors.textPrimary, ...textStyle('body') },
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
  dock: {
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    paddingBottom: space.sm,
    gap: space.sm,
    backgroundColor: theme.colors.surface0,
  },
  field: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingLeft: 18,
    paddingRight: space.sm,
    borderRadius: radius.pill,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.surface3,
  },
  input: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.textPrimary,
    fontSize: type.body,
    paddingVertical: space.sm,
  },
  sendAway: { opacity: 0 },
  keys: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: space.md },
  keysText: { color: theme.colors.textMuted, fontSize: type.small },
}))
