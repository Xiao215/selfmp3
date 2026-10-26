import {
  memo,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { ReactNode, RefObject } from 'react'
import {
  KeyboardAvoidingView,
  Text,
  // eslint-disable-next-line @typescript-eslint/no-restricted-imports -- the dock is its own field, its send turning into Stop in place, as ChangeField's does
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { AI_ERROR, ASK_TEXT_MAX, joinedArtists, plural, type AskAnswer } from '@selfmp3/shared'
import {
  ApiError,
  failureText,
  iconSize,
  radius,
  space,
  textStyle,
  type,
  useLibrary,
} from '@selfmp3/client'
import { ServerAway } from '../../connection/ServerAway'
import { reachedConnection, viaKey } from '../../connection/via'
import { usePlayer } from '../../player/PlayerProvider'
import { keyboardAvoidBehavior } from '../../ports/keyboard'
import { NarrowerContentWidth } from '../../shell/contentWidth'
import { isComposing } from '../../shell/composing'
import { setPageFoot } from '../../shell/pageFoot'
import { useLayoutFlags } from '../../shell/useLayout'
import { useAccent } from '../../ui/accent'
import { usePageBack } from '../../ui/useBackTo'
import { BackButton } from '../../ui/components/BackButton'
import { Button } from '../../ui/components/Button'
import { IconButton } from '../../ui/components/IconButton'
import { Check, ChevronRight, Sparkle, X } from '../../ui/components/Icons'
import { Chip } from '../../ui/components/Chip'
import { Kbd } from '../../ui/components/Kbd'
import { SafeAreaView } from '../../ui/components/SafeAreaView'
import { ScrollView } from '../../ui/components/Scroll'
import { StatusLine } from '../../ui/components/StatusLine'
import { NO_AUTOFILL } from '../../ui/noAutofill'
import { useSongsById } from '../../ui/songsById'
import { floating, pageFrame } from '../../ui/surfaces'
import { useSvgId } from '../../ui/useSvgId'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'
import { roomTitle } from '../room/room.model'
import { useRoom } from '../room/room.store'
import { AddingToRoom } from '../room/RoomPicks'
import { AnswerBody } from './AnswerBody'
import { AskedLabel, AskedTitle } from './AskedTitle'
import { AnswerView } from './AnswerScreen'
import { AnswerActions, CLOSED } from './AnswerParts'
import { SelectableText } from '../../ports/selectableText'
import type { AnswerKeys } from './answerKeys'
import { askKept } from './askKept'
import { forgetThread, keepThread, keptThread } from './askThread.store'
import { keepAnswer, keptAnswer, shownOnServer, useKeptAnswer } from './answers.store'
import { afterStop, beforeTurn, retried, tooLongToAsk, type Turn } from './askTurns.model'
import { answerRecap, askSuggestions } from './smart.model'
import { tagsMostPlayed } from '../tag/tag.model'
import { waitingArtists } from '../tags/tags.model'
import { StopButton } from './StopButton'
import { newTicket, useAskProgress } from './useAskProgress'
import { useSmartServer } from './useSmartServer'
import { Working } from './Working'

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
 * Ask (docs/features/ai.md, "The Ask page"): `/ask?q=…` from Search's Enter or
 * its Ask card, and from the palette's Ask row on a computer.
 *
 * A stage (R1, 2026-10-26, after the chat column of A1 B2 C1 D1 E1 F1 and the
 * split of A2): one turn at a time fills the page, what was asked set as its
 * title in the serif and its answer under it — a list as the list itself
 * (`AnswerView`), anything else as it would be shown on its own. While it is
 * worked on, the title and the step running now stand in the middle of the
 * page. What was said before is a trail of chips beside ‹; pressing one puts
 * that turn back on the stage. Every turn stays drawn, hidden off the stage,
 * so a question still being answered is not given up by looking at another.
 *
 * The field at the foot asks the next one, after everything before it (F1:
 * the server hears each earlier question with what was shown for it, and
 * answers the newest). On a list it wears the list's chip and changes it
 * (B1). While one is worked on its send is a Stop, which takes the turn back
 * off the page and its words back into the field. ‹ goes back to Search with
 * the question still typed; a conversation is not kept after it.
 *
 * `?to=room` asks for the room you are in, as Search does when adding to it
 * (A2): songs answered are added there rather than played.
 */
export function AskScreen(): ReactNode {
  const params = useLocalSearchParams<{ q?: string; to?: string }>()
  const { state: room } = useRoom()
  const adding = params.to === 'room' ? room : null
  const addingTo = useMemo(() => (adding ? { title: roomTitle(adding) } : null), [adding])
  const { wide, finePointer } = useLayoutFlags()
  const { theme } = useUnistyles()
  const window = useWindowDimensions()
  const server = useSmartServer()
  const player = usePlayer()
  const songsById = useSongsById()

  const playingNow = (): number | null => {
    const id = player.current?.id
    return id === undefined ? null : (server.onServer(id) ?? null)
  }
  const turnFor = (asked: string, was: readonly Turn[], change: string | null = null): Turn => ({
    id: nextTurn++,
    asked,
    playing: playingNow(),
    before: beforeTurn(was, was.length),
    answered: null,
    outcome: null,
    change,
    list: null,
  })
  const opened = typeof params.q === 'string' ? params.q.trim() : ''
  // A page drawn again finds the conversation it had (`askThread.store`).
  const [turns, setTurns] = useState<readonly Turn[]>(
    () => keptThread(opened) ?? (opened ? [turnFor(opened, [])] : []),
  )
  useEffect(() => keepThread(opened, turns), [opened, turns])
  const { back } = usePageBack('/search')
  // The words typed are the field's own (`AskField`): kept here, every key
  // would draw the whole conversation again. The page only hears whether
  // there are any.
  const [typing, setTyping] = useState(false)
  const [keys, setKeys] = useState<AnswerKeys | null>(null)
  const field = useRef<TextInput>(null)
  const draft = useRef<DraftHandle>(null)

  const latest = turns.at(-1)
  const latestId = latest?.id ?? null
  const working = latest !== undefined && latest.answered === null
  // The turn on the stage: the newest, until a chip of the trail is pressed;
  // a new question takes the stage again.
  const [chosen, setChosen] = useState<{ latest: number | null; shown: number | null }>({
    latest: latestId,
    shown: latestId,
  })
  const shownId = chosen.latest === latestId ? chosen.shown : latestId
  const shownTurn = turns.find(turn => turn.id === shownId)
  // The list on the stage is what the field's chip changes (B1), until the
  // chip is let go (its ×, or ⌫ in an empty field): then words are a question.
  const [letGoOf, setLetGoOf] = useState<string | null>(null)
  const target = shownTurn?.list ?? null
  const changing = useKeptAnswer(target !== null && target !== letGoOf ? target : undefined)
  // The answer's keys (a review's ticks) while the field has nothing typed: letters are a follow-up.
  const answerKeys = !typing && !working ? keys : null

  // Words from the field empty it; words from a button (Get it, a Try) leave
  // whatever was being typed there.
  const ask = (words: string, fromField = false): void => {
    const asked = words.trim()
    if (!asked || working || !server.api) return
    // Typed while the chip is on, the words change that list.
    const change = fromField && changing ? changing.id : null
    setTurns(was => [...was, turnFor(asked, was, change)])
    setKeys(null)
    if (fromField) draft.current?.write('')
  }
  // Stop: the turn being worked on comes off the page, its words back in the
  // field to change, unless something new is typed there already.
  const stop = (): void => {
    if (!latest || !working) return
    setTurns(was => was.slice(0, -1))
    draft.current?.write(afterStop(draft.current.read(), latest.asked))
    field.current?.focus()
  }
  // The turns are drawn once per change to them, not per key: what they are
  // handed keeps from draw to draw.
  const askNow = useRef(ask)
  useEffect(() => {
    askNow.current = ask
  })
  const askFromAnswer = useCallback((words: string) => askNow.current(words), [])
  const answered = useCallback((id: number, recap: string, list: string | null) => {
    setTurns(was => was.map(turn => (turn.id === id ? { ...turn, answered: recap, list } : turn)))
  }, [])
  const settle = useCallback((id: number, outcome: string) => {
    setTurns(was => was.map(turn => (turn.id === id ? { ...turn, outcome } : turn)))
  }, [])
  // Try again: the turn is worked on again, with its Stop, and the next question waits for it.
  const retry = useCallback((id: number) => setTurns(was => retried(was, id)), [])
  const titleOf = useCallback(
    (serverId: number) => {
      const id = server.onDevice(serverId)
      const song = id === undefined ? undefined : songsById.get(id)
      return song ? `${song.title} — ${song.artist}` : undefined
    },
    [server, songsById],
  )

  const passToAnswer = (event: {
    key: string
    metaKey: boolean
    ctrlKey: boolean
    target: unknown
    nativeEvent: { isComposing?: boolean }
    preventDefault: () => void
    stopPropagation: () => void
  }): void => {
    // An input method's keys are its own while it composes (pinyin, kana).
    if (isComposing(event.nativeEvent)) return
    // Another field's keys are its own: an answer's Change it takes Enter and spaces.
    if (event.target !== field.current && isTextField(event.target)) return
    if (!answerKeys?.press(event.key, event.metaKey || event.ctrlKey)) return
    event.preventDefault()
    event.stopPropagation()
  }

  const listHeight = Math.max(240, window.height * 0.55)
  useEffect(() => () => setPageFoot(0), [])
  // ‹ lets the conversation go: the same question asked again starts afresh.
  const leave = useCallback(() => {
    forgetThread(opened)
    back()
  }, [opened, back])
  const show = useCallback(
    (id: number) => {
      setChosen({ latest: latestId, shown: id })
      setLetGoOf(null)
    },
    [latestId],
  )
  const trail = <Trail turns={turns} shownId={shownId} onShow={show} onBack={leave} />

  return (
    <AddingToRoom.Provider value={addingTo}>
      <SafeAreaView style={styles.screen} edges={['bottom']}>
        <KeyboardAvoidingView
          style={styles.page}
          behavior={keyboardAvoidBehavior}
          testID="ask-screen"
          // A computer's keys for a review on the page, the field keeping the focus.
          {...(answerKeys ? { onKeyDownCapture: passToAnswer } : {})}
        >
          <View style={styles.stageArea}>
            {server.reach.state !== 'reachable' ? (
              <Stage trail={trail}>
                <ServerAway reach={server.reach} need="ai" testID="ask-server" />
              </Stage>
            ) : turns.length === 0 ? (
              <Stage trail={trail}>
                <Suggestions onAsk={ask} />
              </Stage>
            ) : (
              turns.map(turn => (
                <TurnStage
                  key={turn.id}
                  turn={turn}
                  shown={turn.id === shownId}
                  latest={turn.id === latestId}
                  trail={trail}
                  via={reachedConnection(server.reach)?.baseUrl ?? null}
                  titleOf={titleOf}
                  listHeight={listHeight}
                  onAnswered={answered}
                  onSettle={settle}
                  onRetry={retry}
                  // A dead end's suggestions, and Tidy up's "ask about the rest": the next turn.
                  onAsk={askFromAnswer}
                  onKeys={turn.id === latestId && turn.id === shownId ? setKeys : undefined}
                />
              ))
            )}
            {/* The stage goes under the field rather than stopping at a line (C1). */}
            <FootFade color={theme.colors.surface0} />
          </View>

          <View
            style={[styles.dock, wide && styles.dockWide]}
            // The toasts rise above the field rather than cover it.
            onLayout={event => setPageFoot(event.nativeEvent.layout.height)}
          >
            <AskField
              inputRef={field}
              draftRef={draft}
              onTyping={setTyping}
              onSend={words => ask(words, true)}
              onStop={working ? stop : null}
              chip={
                changing
                  ? {
                      label: changingLabel(changing),
                      name: changing.result.understanding.name,
                      onLetGo: () => setLetGoOf(changing.id),
                    }
                  : null
              }
              placeholder={
                changing
                  ? 'Change these songs…'
                  : turns.length === 0
                    ? 'Ask anything…'
                    : 'Ask a follow-up…'
              }
              autoFocus={turns.length === 0}
            />
            {finePointer && (answerKeys || (changing && !typing)) ? (
              <View style={styles.keys}>
                {(answerKeys?.hints ?? LET_GO_HINT).map(([caps, word]) => (
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
    </AddingToRoom.Provider>
  )
}

/**
 * The way back and what was said, at the top of the stage: ‹, then a chip
 * for each question, the one on the stage lit. One question needs no trail:
 * it is the title.
 */
function Trail({
  turns,
  shownId,
  onShow,
  onBack,
}: {
  turns: readonly Turn[]
  shownId: number | null
  onShow: (id: number) => void
  onBack: () => void
}): ReactNode {
  return (
    <View style={styles.trail}>
      <BackButton to="/search" always onPress={onBack} testID="ask-back" />
      {turns.length > 1 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.trailScroll}
          contentContainerStyle={styles.trailChips}
          accessibilityRole="list"
          accessibilityLabel="What you asked"
        >
          {turns.map((turn, index) => (
            <View key={turn.id} style={styles.trailStep}>
              {index > 0 ? <Text style={styles.trailArrow}>›</Text> : null}
              <View style={styles.trailChip}>
                <Chip
                  compact
                  label={turn.asked}
                  selected={turn.id === shownId}
                  onPress={() => onShow(turn.id)}
                  testID={`ask-trail-${turn.id}`}
                />
              </View>
            </View>
          ))}
        </ScrollView>
      ) : null}
    </View>
  )
}

/** A page of the stage that is not a list: the trail at its top, the rest scrolling under it. */
function Stage({
  trail,
  hidden = false,
  testID,
  children,
}: {
  trail: ReactNode
  hidden?: boolean
  testID?: string
  children: ReactNode
}): ReactNode {
  const { wide } = useLayoutFlags()
  const { top } = useSafeAreaInsets()
  const frame = pageFrame(wide)
  return (
    <View style={[styles.stage, hidden && styles.hidden]} testID={testID}>
      <ScrollView
        style={styles.stage}
        contentContainerStyle={[styles.stageContent, frame, { paddingTop: top + frame.paddingTop }]}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
      >
        {trail}
        {children}
      </ScrollView>
    </View>
  )
}

/** The chip's words: how many songs the field's words would change. */
function changingLabel(list: NonNullable<ReturnType<typeof keptAnswer>>): string {
  const count = list.order?.length ?? list.result.picks.length
  return count === 1 ? 'this song' : `these ${plural(count, 'song', 'songs')}`
}

/** Under an empty field with the chip on: how to ask something new instead. */
const LET_GO_HINT: readonly (readonly [readonly string[], string])[] = [
  [['⌫'], 'asks something new instead'],
]

/** The thread's foot fading into the ground the field floats over. */
function FootFade({ color }: { color: string }): ReactNode {
  const id = useSvgId('ask-foot')
  return (
    <View pointerEvents="none" style={styles.fade}>
      <Svg width="100%" height="100%" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={color} stopOpacity={0} />
            <Stop offset="1" stopColor={color} stopOpacity={1} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </View>
  )
}

/**
 * Before the first question, three things to ask, made from this library
 * (`askSuggestions`), at the foot of the empty thread just above the field
 * (L1, 2026-10-25). A press asks it.
 */
function Suggestions({ onAsk }: { onAsk: (words: string) => void }): ReactNode {
  const { data: library } = useLibrary()
  const lines = useMemo(() => {
    if (!library) return []
    const tags = tagsMostPlayed(library.tags, library.songs).map(standing => standing.tag)
    const untagged = waitingArtists(library.songs, 1, library).artists[0]?.name ?? null
    const top = joinedArtists(library.songs, library)[0]?.name ?? null
    return askSuggestions(tags, untagged, top)
  }, [library])
  if (lines.length === 0) return null
  return (
    <View style={styles.suggestions} testID="ask-suggestions">
      <Text style={styles.suggestionsLabel}>Try</Text>
      {lines.map(line => (
        <View key={line} style={styles.suggestion}>
          <Chip label={line} selected={false} onPress={() => onAsk(line)} />
        </View>
      ))}
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
const TurnStage = memo(function TurnStage({
  turn,
  shown: onStage,
  latest,
  trail,
  via,
  titleOf,
  listHeight,
  onAnswered,
  onSettle,
  onRetry,
  onAsk,
  onKeys,
}: {
  turn: Turn
  /** On the stage; otherwise drawn but hidden. */
  shown: boolean
  latest: boolean
  trail: ReactNode
  via: string | null
  titleOf: (serverId: number) => string | undefined
  listHeight: number
  onAnswered: (id: number, recap: string, list: string | null) => void
  onSettle: (id: number, outcome: string) => void
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
  // A change is told by what the list was first asked as: its page, its Save
  // and its Up next carry those words.
  const [text] = useState(() =>
    turn.change ? (keptAnswer(turn.change)?.text ?? turn.asked) : turn.asked,
  )
  // More than the server takes is said here rather than sent to be refused.
  const tooLong = tooLongToAsk(turn.asked)
  // Names the request, so how it is going can be asked after while it runs,
  // and its answer collected if the response is lost (`askKept`). A new one
  // each time: a Stop meant for one request must not reach the next.
  const [ticket, setTicket] = useState<string | null>(null)
  const answer = useQuery<AskAnswer>({
    queryKey: turn.change
      ? viaKey(via, 'ai', 'change', turn.change, turn.asked)
      : askKey(via, [...said.map(each => each.asked), turn.asked], turn.playing),
    // Read, so React Query drops the request when nobody watches it any more:
    // Stop, the page left. The server stops asking the model with it.
    queryFn: async ({ signal }) => {
      const named = newTicket()
      setTicket(named)
      if (turn.change) {
        // Said with the chip: the list changed as Change it changes one, the
        // songs shown that still fit kept in their places (B1).
        const list = keptAnswer(turn.change)
        if (!list) throw new Error('That list is gone. Ask for it again.')
        const describe = await server.api!.refineAnswer(
          {
            text: list.text,
            understanding: list.result.understanding,
            change: turn.asked,
            shown: shownOnServer(list, server.onServer),
            ticket: named,
          },
          signal,
        )
        return { kind: 'songs', lead: 'play', describe }
      }
      return askKept(
        server.api!,
        { text: turn.asked, playing: turn.playing, ticket: named, before: said },
        signal,
      )
    },
    enabled: server.api !== null && !tooLong,
    retry: false,
    staleTime: Infinity,
  })
  // Asked again after it failed (Try again) is waiting too.
  const waiting = !tooLong && (answer.isPending || (answer.isError && answer.isFetching))
  const live = useAskProgress(ticket, waiting)
  const data = answer.data
  // A list changed in words (Change it) is told as it is now shown, not as it first came.
  const keptId = data?.kind === 'songs' ? keepAnswer(text, data.describe) : undefined
  const kept = useKeptAnswer(keptId)
  const shown = data?.kind === 'songs' && kept ? { ...data, describe: kept.result } : data
  // A playback answer is told as what it came to on this device ("Nothing is playing.").
  const [carried, setCarried] = useState<string | null>(null)
  const recap = waiting
    ? null
    : shown
      ? shown.kind === 'playback' && carried !== null
        ? carried
        : answerRecap(shown, titleOf)
      : answer.isError || tooLong
        ? FAILED
        : null
  // Its list, once it has songs to show: the stage's, and what the field's chip changes.
  const list =
    keptId !== undefined && data?.kind === 'songs' && data.describe.picks.length > 0 ? keptId : null
  useEffect(() => {
    if (recap !== null && (recap !== turn.answered || list !== turn.list)) {
      onAnswered(turn.id, recap, list)
    }
  }, [recap, list, turn.answered, turn.list, turn.id, onAnswered])
  const settled = turn.outcome !== null
  // Only the newest answer's keys work, and only while it is shown whole.
  useEffect(() => {
    if (!onKeys || settled) return undefined
    return () => onKeys(null)
  }, [onKeys, settled])

  const settles = data !== undefined && SETTLES.has(data.kind)
  // A list to play is the list itself on the stage; one played next, or for
  // a room, keeps its card, whose button says so.
  if (list !== null && data?.kind === 'songs' && data.lead !== 'next' && !room) {
    return (
      <View style={[styles.stage, !onStage && styles.hidden]} testID={`ask-turn-${turn.id}`}>
        <AnswerView id={list} asked={turn.asked} top={trail} />
      </View>
    )
  }
  return (
    <Stage trail={trail} hidden={!onStage} testID={`ask-turn-${turn.id}`}>
      {waiting ? (
        <View style={styles.working}>
          <AskedLabel label={room ? `Asking for ${room.title}` : 'Asking'} />
          <AskedTitle asked={turn.asked} center testID="ask-turn-asked" />
          <Working steps={FIRST_STEPS} live={live} stage testID="ask-waiting" />
        </View>
      ) : (
        <NarrowerContentWidth max={COLUMN}>
          <View style={[styles.answered, wide && styles.answeredWide]}>
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
            ) : turn.outcome !== null && data ? (
              <Outcome answer={data} outcome={turn.outcome} />
            ) : data ? (
              <View testID={`ask-answer-${data.kind}`}>
                <AnswerBody
                  answer={data}
                  text={text}
                  // A proposal acted on or put aside becomes what came of it; anything
                  // else stays to come back to.
                  onDone={outcome => (settles && outcome ? onSettle(turn.id, outcome) : undefined)}
                  onOpenPage={() => undefined}
                  listHeight={listHeight}
                  onKeys={latest && !settled ? onKeys : undefined}
                  onAsk={onAsk}
                  onCarriedOut={setCarried}
                />
              </View>
            ) : null}
          </View>
        </NarrowerContentWidth>
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

/** Whether a key went to a field you type in: the dock's or another (`passToAnswer`). */
function isTextField(target: unknown): boolean {
  if (typeof target !== 'object' || target === null) return false
  const element = target as { tagName?: unknown; isContentEditable?: unknown }
  return (
    element.tagName === 'INPUT' ||
    element.tagName === 'TEXTAREA' ||
    element.isContentEditable === true
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

/** The field's words, read and written by the page: Stop puts a question back. */
interface DraftHandle {
  read: () => string
  write: (words: string) => void
}

/**
 * The field at the foot of the page: one line with a send once there are
 * words, and while an answer is worked on, a Stop where the send was. Enter
 * sends; a browser keeps the focus in it, since the next follow-up is likely.
 *
 * After a list it wears the list as a chip, "↳ these 19 songs" (B1,
 * 2026-10-26): what is typed then changes that list. Its ×, or ⌫ in the
 * empty field, lets the list go, and the words are a question again. The one
 * field does what the song card's own Change it did.
 */
function AskField({
  inputRef,
  draftRef,
  onTyping,
  onSend,
  onStop,
  chip,
  placeholder,
  autoFocus,
}: {
  inputRef: RefObject<TextInput | null>
  draftRef: RefObject<DraftHandle | null>
  /** Whether anything is typed, each time that changes. */
  onTyping: (typing: boolean) => void
  onSend: (words: string) => void
  /** While an answer is worked on: what Stop does. */
  onStop: (() => void) | null
  /** The list what is typed changes, and how to let it go. */
  chip: { label: string; name: string; onLetGo: () => void } | null
  placeholder: string
  autoFocus: boolean
}): ReactNode {
  const { theme } = useUnistyles()
  const accent = useAccent()
  const [focused, setFocused] = useState(false)
  const [value, setValue] = useState('')
  const typed = useRef(value)
  const change = (next: string): void => {
    typed.current = next
    setValue(next)
    onTyping(next !== '')
  }
  useImperativeHandle(draftRef, () => ({ read: () => typed.current, write: change }))
  const words = value.trim().length > 0
  return (
    <View style={[styles.field, focused && { borderColor: accent.accent }]}>
      {chip ? (
        <View style={styles.chip} testID="ask-chip" accessibilityLabel={`Changing ${chip.name}`}>
          <Text style={styles.chipText} numberOfLines={1}>
            {`↳ ${chip.label}`}
          </Text>
          <IconButton
            label="Ask something new instead"
            size={22}
            onPress={() => {
              chip.onLetGo()
              inputRef.current?.focus()
            }}
            testID="ask-chip-let-go"
          >
            <X size={iconSize.tiny} color={theme.colors.textSecondary} />
          </IconButton>
        </View>
      ) : (
        <Sparkle size={iconSize.small} />
      )}
      <TextInput
        {...NO_AUTOFILL}
        ref={inputRef}
        value={value}
        onChangeText={change}
        onSubmitEditing={onStop ? undefined : () => onSend(value)}
        onKeyPress={event => {
          if (chip && event.nativeEvent.key === 'Backspace' && typed.current === '') chip.onLetGo()
        }}
        maxLength={ASK_TEXT_MAX}
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
            onPress={() => onSend(value)}
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
  stageArea: { flex: 1, minHeight: 0 },
  // Every turn fills the stage; the ones off it are drawn and hidden.
  stage: { ...StyleSheet.absoluteFillObject },
  hidden: { display: 'none' },
  stageContent: { flexGrow: 1, gap: space.xl, paddingBottom: space.xl },
  fade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: space.xl },
  trail: { flexDirection: 'row', alignItems: 'center', gap: space.snug, minWidth: 0 },
  trailScroll: { flexShrink: 1 },
  trailChips: { alignItems: 'center', gap: space.tight },
  trailStep: { flexDirection: 'row', alignItems: 'center', gap: space.tight },
  // A long question is cut short on its chip: the title says it whole.
  trailChip: { maxWidth: 240 },
  trailArrow: { color: theme.colors.textMuted, fontSize: type.body },
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
  answeredWide: { maxWidth: COLUMN },
  asked: { gap: space.sm },
  // At the foot of the empty thread, just above the field.
  suggestions: { marginTop: 'auto', gap: space.sm },
  suggestionsLabel: { color: theme.colors.textMuted, fontSize: type.small },
  suggestion: { alignItems: 'flex-start' },
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
  // The field floats over the thread's fading foot (C1), with room under it
  // before the player bar or the phone's edge.
  dock: {
    paddingHorizontal: space.lg,
    paddingTop: space.xs,
    paddingBottom: space.md,
    gap: space.sm,
  },
  // On a computer the field keeps to the reading column, in the middle.
  dockWide: { paddingBottom: space.xl, width: '100%', maxWidth: COLUMN, alignSelf: 'center' },
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
    ...floating(theme.colors),
  },
  chip: {
    flexShrink: 1,
    maxWidth: '45%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingLeft: space.snug,
    paddingRight: space.xs,
    paddingVertical: space.xs,
    marginLeft: -space.sm,
    borderRadius: radius.pill,
    backgroundColor: theme.colors.accentPill,
  },
  chipText: { flexShrink: 1, color: theme.colors.textPrimary, fontSize: type.small },
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
