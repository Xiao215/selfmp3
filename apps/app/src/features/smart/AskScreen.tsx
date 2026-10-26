import { memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
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
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
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
import { NarrowerContentWidth, useContentWidth } from '../../shell/contentWidth'
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
import { ScrollView, type ScrollView as ScrollNode } from '../../ui/components/Scroll'
import { StatusLine } from '../../ui/components/StatusLine'
import { NO_AUTOFILL } from '../../ui/noAutofill'
import { useSongsById } from '../../ui/songsById'
import { PAGE_TOP_PHONE, PAGE_TOP_WIDE, floating } from '../../ui/surfaces'
import { useSvgId } from '../../ui/useSvgId'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'
import { roomTitle } from '../room/room.model'
import { useRoom } from '../room/room.store'
import { AddingToRoom } from '../room/RoomPicks'
import { AnswerBody } from './AnswerBody'
import { AnswerView } from './AnswerScreen'
import { AnswerActions, CLOSED } from './AnswerParts'
import { SelectableText } from '../../ports/selectableText'
import type { AnswerKeys } from './answerKeys'
import { askKept } from './askKept'
import { forgetThread, keepThread, keptThread } from './askThread.store'
import {
  keepAnswer,
  keptAnswer,
  shownOnServer,
  understandingOf,
  useKeptAnswer,
} from './answers.store'
import {
  afterStop,
  beforeTurn,
  newestList,
  retried,
  tooLongToAsk,
  type Turn,
} from './askTurns.model'
import { ListBeside } from './listBeside'
import { answerRecap, askSuggestions, picksHere } from './smart.model'
import { tagsMostPlayed } from '../tag/tag.model'
import { waitingArtists } from '../tags/tags.model'
import { StopButton } from './StopButton'
import { newTicket, useAskProgress } from './useAskProgress'
import { useSmartServer } from './useSmartServer'
import { Working } from './Working'

/**
 * An ask's query key: the server it went to, the turn, every question of the
 * conversation up to this one, and the song playing then. A turn drawn again
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
) {
  return viaKey(via, 'ai', 'ask', turn, asked, playing)
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
 *
 * Redone 2026-10-26 (Xiao picked A2 B1 C1): on a computer a list answered
 * opens beside the thread (`AnswerView`), the thread a pane at its side; the
 * one field changes that list while it wears the list's chip, and floats over
 * the thread's fading foot with room under it.
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
  // The list a computer shows beside the thread (A2), and the one the field's
  // chip changes (B1): the newest, until another card is pressed; × closes it.
  const newest = newestList(turns)
  // A card pressed, or ×, chooses while that list is the newest; a newer one opens itself.
  const [chosen, setChosen] = useState<{ newest: string | null; open: string | null }>({
    newest,
    open: newest,
  })
  const open = chosen.newest === newest ? chosen.open : newest
  // The list whose chip was let go (its ×, or ⌫ in an empty field): the next words are a question.
  const [letGoOf, setLetGoOf] = useState<string | null>(null)
  const besideHere = wide && !adding
  const target = besideHere ? open : newest
  const changing = useKeptAnswer(target !== null && target !== letGoOf ? target : undefined)
  const beside = useMemo(
    () =>
      besideHere
        ? {
            open,
            show: (id: string) => {
              setChosen({ newest, open: id })
              setLetGoOf(null)
            },
          }
        : null,
    [besideHere, open, newest],
  )
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
  const markTop = useCallback((y: number) => {
    latestTop.current = Math.max(0, y - space.sm)
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
  const pageWidth = useContentWidth()
  const listOpen = beside !== null && open !== null
  // Beside a list the thread is a pane a step up from the ground; alone, it is the page.
  const ground = listOpen ? theme.colors.surface1 : theme.colors.surface0

  return (
    <AddingToRoom.Provider value={addingTo}>
      <ListBeside.Provider value={beside}>
        <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
          <View style={styles.split}>
            <NarrowerContentWidth max={listOpen ? THREAD : COLUMN}>
              <KeyboardAvoidingView
                style={[
                  styles.page,
                  wide && styles.pageWide,
                  listOpen && styles.pageBeside,
                  { backgroundColor: ground },
                ]}
                behavior={keyboardAvoidBehavior}
                testID="ask-screen"
                // A computer's keys for a review on the page, the field keeping the focus.
                {...(answerKeys ? { onKeyDownCapture: passToAnswer } : {})}
              >
                <View style={styles.head}>
                  <View style={styles.headSide}>
                    <BackButton
                      to="/search"
                      always
                      // ‹ lets the conversation go: the same question asked again starts afresh.
                      onPress={() => {
                        forgetThread(opened)
                        back()
                      }}
                      testID="ask-back"
                    />
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
                  <View style={styles.thread}>
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
                          shrank.current = {
                            by: threadHeight.current - height,
                            at: scrolled.current,
                          }
                        }
                        threadHeight.current = height
                      }}
                    >
                      {turns.length === 0 ? <Suggestions onAsk={ask} /> : null}
                      {turns.map((turn, index) => (
                        <TurnView
                          key={turn.id}
                          turn={turn}
                          latest={index === turns.length - 1}
                          via={reachedConnection(server.reach)?.baseUrl ?? null}
                          titleOf={titleOf}
                          listHeight={listHeight}
                          onAnswered={answered}
                          onSettle={settle}
                          onRetry={retry}
                          // A dead end's suggestions, and Tidy up's "ask about the rest": the next turn.
                          onAsk={askFromAnswer}
                          onKeys={index === turns.length - 1 ? setKeys : undefined}
                          onTop={index === turns.length - 1 ? markTop : undefined}
                        />
                      ))}
                    </ScrollView>
                    {/* The thread goes under the field rather than stopping at a line (C1). */}
                    <FootFade color={ground} />
                  </View>
                )}

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
                            label: changingLabel(changing, server.onDevice),
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
            </NarrowerContentWidth>
            {listOpen ? (
              <NarrowerContentWidth max={Math.max(0, (pageWidth ?? 0) - THREAD)}>
                <View style={styles.listPane} testID="ask-list">
                  <AnswerView
                    key={open}
                    id={open}
                    onClose={() => setChosen({ newest, open: null })}
                  />
                </View>
              </NarrowerContentWidth>
            ) : null}
          </View>
        </SafeAreaView>
      </ListBeside.Provider>
    </AddingToRoom.Provider>
  )
}

/** The chip's words: how many songs the field's words would change. */
function changingLabel(
  list: NonNullable<ReturnType<typeof keptAnswer>>,
  onDevice: (serverId: number) => number | undefined,
): string {
  // The songs its list shows, as the list counts them.
  const count = list.order?.length ?? picksHere(list.result, onDevice).length
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
 * One turn: what was asked, in its bubble, and its answer under it — the
 * steps while it is worked on, a way to try again when it failed, the line it
 * was answered with once it is settled.
 */
const TurnView = memo(function TurnView({
  turn,
  latest,
  via,
  titleOf,
  listHeight,
  onAnswered,
  onSettle,
  onRetry,
  onAsk,
  onKeys,
  onTop,
}: {
  turn: Turn
  latest: boolean
  via: string | null
  titleOf: (serverId: number) => string | undefined
  listHeight: number
  onAnswered: (id: number, recap: string, list: string | null) => void
  onSettle: (id: number, outcome: string) => void
  /** Try again, before it is asked again. */
  onRetry: (id: number) => void
  onAsk: (words: string) => void
  onKeys?: (keys: AnswerKeys | null) => void
  /** Where it starts in the thread, for the newest. */
  onTop?: (y: number) => void
}): ReactNode {
  const server = useSmartServer()
  const router = useRouter()
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
      ? viaKey(via, 'ai', 'change', turn.id, turn.change, turn.asked)
      : askKey(via, turn.id, [...said.map(each => each.asked), turn.asked], turn.playing),
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
            understanding: understandingOf(list),
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
  // Its list, once it has songs to show: the chip's and the one opened beside the thread.
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
      {tooLong ? (
        <StatusLine testID="ask-too-long">
          {`That’s too long to ask: Ask takes up to ${ASK_TEXT_MAX} characters.`}
        </StatusLine>
      ) : waiting ? (
        <Working steps={FIRST_STEPS} live={live} outline={false} testID="ask-waiting" />
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

/** The thread's width with a list open beside it (A2). */
const THREAD = 440

const styles = StyleSheet.create(theme => ({
  screen: { flex: 1, backgroundColor: theme.colors.surface0 },
  split: { flex: 1, flexDirection: 'row' },
  page: { flex: 1 },
  // Alone, the thread keeps to the middle column of the row.
  pageWide: {
    maxWidth: COLUMN,
    width: '100%',
    marginHorizontal: 'auto',
    paddingTop: PAGE_TOP_WIDE - PAGE_TOP_PHONE,
  },
  // The thread as a pane beside the list (A2). A flex basis, not `flex: 0`,
  // which the web reads as a basis of nothing.
  pageBeside: {
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: THREAD,
    maxWidth: THREAD,
    marginHorizontal: 0,
  },
  listPane: { flex: 1, minWidth: 0 },
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
  thread: { flex: 1, minHeight: 0 },
  fade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: space.xl },
  turns: {
    flexGrow: 1,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    paddingBottom: space.lg,
    gap: 28,
  },
  // At the foot of the empty thread, just above the field.
  suggestions: { marginTop: 'auto', gap: space.sm },
  suggestionsLabel: { color: theme.colors.textMuted, fontSize: type.small },
  suggestion: { alignItems: 'flex-start' },
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
  // The field floats over the thread's fading foot (C1), with room under it
  // before the player bar or the phone's edge.
  dock: {
    paddingHorizontal: space.lg,
    paddingTop: space.xs,
    paddingBottom: space.md,
    gap: space.sm,
  },
  dockWide: { paddingBottom: space.xl },
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
