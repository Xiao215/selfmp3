import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  KeyboardAvoidingView,
  Text,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type TextInput,
} from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useLocalSearchParams, useNavigation } from 'expo-router'
import type { NativeStackNavigationProp } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { beforeTurn, joinedArtists, plural } from '@selfmp3/shared'
import { iconSize, radius, space, textStyle, type, useLibrary } from '@selfmp3/client'
import { ServerAway } from '../../connection/ServerAway'
import { reachedConnection } from '../../connection/via'
import { usePlayingSongId } from '../../player/PlayerProvider'
import { fonts } from '../../ports/fonts'
import { keyboardAvoidBehavior } from '../../ports/keyboard'
import { NarrowerContentWidth, useContentWidth } from '../../shell/contentWidth'
import { isComposing } from '../../shell/composing'
import { setPageFoot } from '../../shell/pageFoot'
import { useLayoutFlags } from '../../shell/useLayout'
import { usePageBack } from '../../ui/useBackTo'
import { BackButton } from '../../ui/components/BackButton'
import { Sparkle } from '../../ui/components/Icons'
import { Chip } from '../../ui/components/Chip'
import { Kbd } from '../../ui/components/Kbd'
import { Press } from '../../ui/components/Press'
import { Spinner } from '../../ui/components/Spinner'
import { SafeAreaView } from '../../ui/components/SafeAreaView'
import { ScrollView } from '../../ui/components/Scroll'
import { pageFrame } from '../../ui/surfaces'
import { useSvgId } from '../../ui/useSvgId'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'
import { PlaylistCover } from '../playlists/PlaylistCover'
import { roomTitle } from '../room/room.model'
import { useRoom } from '../room/room.store'
import { AddingToRoom } from '../room/RoomPicks'
import { AskField, type DraftHandle } from './AskField'
import { Stage, TurnStage, type Answered } from './AskTurn'
import type { AnswerKeys } from './answerKeys'
import { forgetThread, keepThread, keptThread, newThread } from './askThread.store'
import { type keptAnswer, useKeptAnswer } from './answers.store'
import { afterStop, retried, scrollToShow, type Turn } from './askTurns.model'
import { askSuggestions, picksHere } from './smart.model'
import { tagsMostPlayed } from '../tag/tag.model'
import { waitingArtists } from '../tags/tags.model'
import { useSmartServer } from './useSmartServer'

/** Names each turn, across the app's life: two pages' turns never share one. */
let nextTurn = 1

/**
 * Ask (docs/features/ai.md, "The Ask page"): `/ask?q=…` from Search's Enter or
 * its Ask card, and from the palette's Ask row on a computer.
 *
 * A workbench (S1, 2026-10-27, after the chat column, A2's split and R1's
 * stage). On a computer the page is two parts: a narrow log of what was
 * asked, each with a line of what came of it, the field at the log's foot
 * under the conversation it continues; and beside it the answer you're on,
 * always filled — a list as the list itself (`AnswerView`), words beside the
 * songs they name, anything else as it would be shown on its own, and while
 * it is worked on, the question and its steps where the answer will be.
 * Pressing a line of the log puts that answer there. On a phone the log is a
 * page of its own: a new question opens its answer full screen, and its ‹
 * comes back to the log. A reply of several cards stands as one column of
 * them, each under its heading (`AnswerBody`); a list among them opens on the
 * stage in their place, its ‹ back to the cards. Every turn stays drawn, hidden when it is not the
 * one shown, so a question still being answered is not given up by looking
 * at another.
 *
 * The field asks the next question, after everything before it (F1: the
 * server hears each earlier question with what was shown for it, the songs
 * by handle, and answers the newest). On a list it wears the list's chip:
 * the words go with that list as what is on the screen, and Ask decides
 * whether they change it or act on it ("Ask decides", 2026-10-27). While
 * one is worked on its send is a Stop, which takes the turn back off the page
 * and its words back into the field. ‹ goes back to Search with the question
 * still typed; a conversation is not kept after it.
 *
 * `?to=room` asks for the room you are in, as Search does when adding to it
 * (A2): songs answered are added there rather than played.
 */
export function AskScreen(): ReactNode {
  const params = useLocalSearchParams<{ q?: string; to?: string; thread?: string }>()
  const { state: room } = useRoom()
  const adding = params.to === 'room' ? room : null
  const addingTo = useMemo(() => (adding ? { title: roomTitle(adding) } : null), [adding])
  const { wide, finePointer } = useLayoutFlags()
  const { theme } = useUnistyles()
  const window = useWindowDimensions()
  const server = useSmartServer()
  const playingId = usePlayingSongId()

  const playingNow = (): number | null =>
    playingId === null ? null : (server.onServer(playingId) ?? null)
  const turnFor = (asked: string, was: readonly Turn[], screen: string | null = null): Turn => ({
    id: nextTurn++,
    asked,
    playing: playingNow(),
    screen,
    before: beforeTurn(was, was.length, screen),
    answered: null,
    outcomes: {},
    objects: [],
    list: null,
    listHandle: null,
    line: null,
  })
  const opened = typeof params.q === 'string' ? params.q.trim() : ''
  // A visit's conversation is its thread, named in the address: a page drawn
  // again finds the conversation it had, a new visit starts its own, and one
  // reloaded, its turns gone, doesn't ask its question again (`askThread.store`).
  const [thread] = useState(() => (typeof params.thread === 'string' ? params.thread : newThread()))
  const [turns, setTurns] = useState<readonly Turn[]>(
    () => keptThread(thread) ?? (opened ? [turnFor(opened, [])] : []),
  )
  // Its words wait in the field instead, asked again only with a press.
  const [unasked] = useState(() => (turns.length === 0 ? opened : ''))
  useEffect(() => keepThread(thread, turns), [thread, turns])
  // On the page's own route: the router refuses before the app's layout is up, as on a reload.
  const navigation = useNavigation<NativeStackNavigationProp<Record<string, object | undefined>>>()
  useEffect(() => {
    if (params.thread !== thread) navigation.setParams({ thread })
  }, [params.thread, thread, navigation])
  const { back } = usePageBack('/search')
  // The words typed are the field's own (`AskField`): kept here, every key
  // would draw the whole conversation again. The page only hears whether
  // there are any.
  const [typing, setTyping] = useState(false)
  const [keys, setKeys] = useState<AnswerKeys | null>(null)
  const field = useRef<TextInput>(null)
  const draft = useRef<DraftHandle>(null)
  useEffect(() => {
    if (unasked) draft.current?.write(unasked)
  }, [unasked])

  const latest = turns.at(-1)
  const latestId = latest?.id ?? null
  const working = latest !== undefined && latest.answered === null
  // The answer shown: the newest, until a line of the log is pressed; a new
  // question shows its own. On a phone, none is the log itself.
  const [chosen, setChosen] = useState<{ latest: number | null; shown: number | null }>({
    latest: latestId,
    shown: latestId,
  })
  const picked = chosen.latest === latestId ? chosen.shown : latestId
  const shownId = wide ? (picked ?? latestId) : picked
  const onLog = !wide && (shownId === null || turns.length === 0)
  const shownTurn = turns.find(turn => turn.id === shownId)
  // The list shown wears the field's chip, "↳ these songs" (B1): what words
  // that point at songs mean. Let go (its ×, or ⌫ in an empty field), the
  // words are asked with nothing on the screen.
  const [letGoOf, setLetGoOf] = useState<string | null>(null)
  const target = onLog ? null : (shownTurn?.list ?? null)
  const changing = useKeptAnswer(target !== null && target !== letGoOf ? target : undefined)
  const changingSongs = changing ? changingCount(changing, server.onDevice) : 0
  // The answer on the screen, by its object's handle: the list while it wears
  // the chip, or any other answer that showed songs.
  const screen =
    onLog || (target !== null && !changing)
      ? null
      : (shownTurn?.listHandle ?? shownTurn?.objects[0]?.handle ?? null)
  // The answer's keys (a review's ticks) while the field has nothing typed: letters are a follow-up.
  const answerKeys = !typing && !working ? keys : null

  // Words from the field empty it; words from a button (Get it, a Try) leave
  // whatever was being typed there.
  const ask = (words: string, fromField = false): void => {
    const asked = words.trim()
    if (!asked || working || !server.api) return
    // Asked with what is on the screen: the router decides whether the words change it or act on it.
    setTurns(was => [...was, turnFor(asked, was, screen)])
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
  const answered = useCallback((id: number, came: Answered) => {
    setTurns(was => was.map(turn => (turn.id === id ? { ...turn, ...came } : turn)))
  }, [])
  const settle = useCallback((id: number, card: number, outcome: string) => {
    setTurns(was =>
      was.map(turn =>
        turn.id === id ? { ...turn, outcomes: { ...turn.outcomes, [card]: outcome } } : turn,
      ),
    )
  }, [])
  // Try again: the turn is worked on again, with its Stop, and the next question waits for it.
  const retry = useCallback((id: number) => setTurns(was => retried(was, id)), [])

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
  // ‹ lets the conversation go: the same question asked again starts afresh.
  const leave = useCallback(() => {
    forgetThread(thread)
    back()
  }, [thread, back])
  const show = useCallback(
    (id: number | null) => {
      setChosen({ latest: latestId, shown: id })
      setLetGoOf(null)
    },
    [latestId],
  )
  // On a phone an answer's ‹ comes back to the log; on a computer the log is beside it.
  const top = wide ? null : (
    <View style={styles.answerTop}>
      <BackButton to="/search" always onPress={() => show(null)} testID="ask-to-log" />
    </View>
  )

  const dock = (
    <View
      style={[styles.dock, wide && styles.dockWide]}
      // The toasts rise above the field rather than cover it.
      onLayout={event => setPageFoot(wide ? 0 : event.nativeEvent.layout.height)}
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
                label:
                  changingSongs === 1
                    ? 'this song'
                    : `these ${plural(changingSongs, 'song', 'songs')}`,
                name: changing.result.understanding.name,
                onLetGo: () => setLetGoOf(changing.id),
              }
            : null
        }
        placeholder={
          changing
            ? // The chip already says which songs.
              changingSongs === 1
              ? 'Ask about it…'
              : 'Ask about them…'
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
  )

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
          <View style={[styles.body, wide && styles.bodyWide]}>
            {wide || onLog ? (
              <Log
                turns={turns}
                shownId={wide ? shownId : null}
                onShow={show}
                onBack={leave}
                dock={wide ? dock : null}
              >
                {turns.length === 0 && server.reach.state === 'reachable' ? (
                  <Suggestions onAsk={ask} />
                ) : null}
              </Log>
            ) : null}
            <NarrowerContentWidth max={wide ? Math.max(0, (pageWidth ?? 0) - LOG_WIDTH) : 10000}>
              <View style={[styles.answerArea, onLog && styles.hidden]}>
                {server.reach.state !== 'reachable' ? (
                  <Stage top={top}>
                    <ServerAway reach={server.reach} need="ai" testID="ask-server" />
                  </Stage>
                ) : (
                  turns.map((turn, index) => (
                    <TurnStage
                      key={turn.id}
                      turn={turn}
                      number={index + 1}
                      shown={turn.id === shownId}
                      latest={turn.id === latestId}
                      top={top}
                      via={reachedConnection(server.reach)?.baseUrl ?? null}
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
              </View>
            </NarrowerContentWidth>
            {/* The page goes under the field rather than stopping at a line (C1). */}
            {wide ? null : <FootFade color={theme.colors.surface0} />}
          </View>
          {wide ? null : dock}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </AddingToRoom.Provider>
  )
}

/**
 * What was asked, one line each, the newest last: under each question what
 * came of it (`logLine`), and the one shown lit. On a computer the field is
 * at its foot; on a phone it is the page a question's answer comes back to.
 */
function Log({
  turns,
  shownId,
  onShow,
  onBack,
  dock,
  children,
}: {
  turns: readonly Turn[]
  /** The answer shown beside it, lit; none on a phone. */
  shownId: number | null
  onShow: (id: number) => void
  onBack: () => void
  /** The field, on a computer. */
  dock: ReactNode
  /** Under the lines: before any question, what to ask. */
  children?: ReactNode
}): ReactNode {
  const { wide } = useLayoutFlags()
  const { top } = useSafeAreaInsets()
  const frame = pageFrame(wide)
  // The log follows the conversation: a new question, the answer shown, and
  // the field growing under it each bring the line they are about into view
  // (on a phone, the newest). Lines below the field went unseen from about
  // the eleventh question on. Scrolling back through it is left alone.
  const scroller = useRef<ScrollView>(null)
  const lines = useRef(new Map<number, { y: number; height: number }>())
  const view = useRef({ y: 0, height: 0 })
  const toShow = shownId ?? turns.at(-1)?.id ?? null
  const wanted = useRef<number | null>(null)
  const reveal = useCallback(() => {
    const id = wanted.current
    const line = id === null ? undefined : lines.current.get(id)
    if (!line || view.current.height === 0) return
    wanted.current = null
    const y = scrollToShow(line, view.current, space.sm)
    if (y !== null) scroller.current?.scrollTo({ y, animated: true })
  }, [])
  useEffect(() => {
    wanted.current = toShow
    reveal()
  }, [toShow, turns.length, reveal])
  return (
    <View style={[styles.log, wide && styles.logWide]} testID="ask-log">
      <View style={[styles.logHead, { paddingTop: top + frame.paddingTop }]}>
        <BackButton to="/search" always onPress={onBack} testID="ask-back" />
        <Text style={styles.logTitle} accessibilityRole="header">
          Ask
        </Text>
      </View>
      <ScrollView
        ref={scroller}
        style={styles.logLines}
        contentContainerStyle={styles.logLinesContent}
        keyboardShouldPersistTaps="handled"
        scrollEventThrottle={64}
        onScroll={event => {
          view.current = { ...view.current, y: event.nativeEvent.contentOffset.y }
        }}
        onLayout={event => {
          const { height } = event.nativeEvent.layout
          if (height === view.current.height) return
          view.current = { ...view.current, height }
          wanted.current = toShow
          reveal()
        }}
      >
        {turns.map(turn => (
          <LogLine
            key={turn.id}
            turn={turn}
            shown={turn.id === shownId}
            onPress={() => onShow(turn.id)}
            onLayout={({ nativeEvent: { layout } }) => {
              lines.current.set(turn.id, { y: layout.y, height: layout.height })
              if (turn.id === wanted.current) reveal()
            }}
          />
        ))}
        {children}
      </ScrollView>
      {dock}
    </View>
  )
}

/** One question in the log: a picture of what came of it, the question, and its line. */
function LogLine({
  turn,
  shown,
  onPress,
  onLayout,
}: {
  turn: Turn
  shown: boolean
  onPress: () => void
  onLayout: (event: LayoutChangeEvent) => void
}): ReactNode {
  const { theme } = useUnistyles()
  const server = useSmartServer()
  const list = useKeptAnswer(turn.list ?? undefined)
  const ids = list
    ? (list.order ?? picksHere(list.result, server.onDevice).map(pick => pick.songId))
    : []
  const waiting = turn.answered === null
  const line = waiting ? 'Working on it…' : (turn.line ?? 'Couldn’t answer that')
  return (
    <Press
      feedback="dim"
      onPress={onPress}
      onLayout={onLayout}
      accessibilityRole="button"
      accessibilityState={{ selected: shown }}
      accessibilityLabel={`${turn.asked}: ${line}`}
      style={[styles.logLine, shown && styles.logLineShown]}
      testID={`ask-log-${turn.id}`}
    >
      <View style={styles.logArt}>
        {ids.length > 0 ? (
          <PlaylistCover songIds={ids} size={LOG_ART} />
        ) : waiting ? (
          <Spinner />
        ) : (
          <Sparkle size={iconSize.small} color={theme.colors.textSecondary} />
        )}
      </View>
      <View style={styles.logText}>
        <Text style={styles.logAsked} numberOfLines={1}>
          {turn.asked}
        </Text>
        <Text style={styles.logSaid} numberOfLines={1}>
          {line}
        </Text>
      </View>
    </Press>
  )
}

/** How many songs the field's words would change: the songs its list shows, as the list counts them. */
function changingCount(
  list: NonNullable<ReturnType<typeof keptAnswer>>,
  onDevice: (serverId: number) => number | undefined,
): number {
  return list.order?.length ?? picksHere(list.result, onDevice).length
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

/** The log's width beside the answer on a computer (S1). */
const LOG_WIDTH = 360

/** A line of the log's picture: its list's covers, or what it is waiting on. */
const LOG_ART = 40

const styles = StyleSheet.create(theme => ({
  screen: { flex: 1, backgroundColor: theme.colors.surface0 },
  page: { flex: 1 },
  // A phone's page is the log or an answer; a computer's is both, side by side.
  body: { flex: 1, minHeight: 0 },
  bodyWide: { flexDirection: 'row' },
  answerArea: { flex: 1, minWidth: 0, minHeight: 0 },
  hidden: { display: 'none' },
  fade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: space.xl },
  answerTop: { flexDirection: 'row' },
  log: { flex: 1, minHeight: 0 },
  // On a computer, a pane a step up from the ground, its field at the foot.
  logWide: {
    flex: 0,
    flexBasis: LOG_WIDTH,
    width: LOG_WIDTH,
    backgroundColor: theme.colors.surface1,
  },
  logHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.snug,
    paddingHorizontal: space.lg,
    paddingBottom: space.md,
  },
  logTitle: { ...textStyle('large'), fontFamily: fonts.display, color: theme.colors.textPrimary },
  logLines: { flex: 1, minHeight: 0 },
  logLinesContent: {
    flexGrow: 1,
    paddingHorizontal: space.sm,
    gap: space.xs,
    paddingBottom: space.lg,
  },
  logLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.snug,
    borderRadius: radius.card,
  },
  logLineShown: { backgroundColor: theme.colors.accentPill },
  logArt: {
    width: LOG_ART,
    height: LOG_ART,
    borderRadius: radius.coverSm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface2,
    overflow: 'hidden',
  },
  logText: { flex: 1, minWidth: 0, gap: 2 },
  logAsked: { color: theme.colors.textPrimary, fontSize: type.body, fontWeight: '600' },
  logSaid: { color: theme.colors.textMuted, fontSize: type.sub },
  // At the foot of the empty thread, just above the field.
  suggestions: { marginTop: 'auto', gap: space.sm },
  suggestionsLabel: { color: theme.colors.textMuted, fontSize: type.small },
  suggestion: { alignItems: 'flex-start' },
  // The field floats over the thread's fading foot (C1), with room under it
  // before the player bar or the phone's edge.
  dock: {
    paddingHorizontal: space.lg,
    paddingTop: space.xs,
    paddingBottom: space.md,
    gap: space.sm,
  },
  // On a computer: at the log's foot, under the conversation it continues.
  dockWide: { paddingBottom: space.xl },
  keys: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: space.md },
  keysText: { color: theme.colors.textMuted, fontSize: type.small },
}))
