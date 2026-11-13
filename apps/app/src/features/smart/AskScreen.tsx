import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  KeyboardAvoidingView,
  Text,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type TextInput,
} from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import Reanimated, {
  Easing,
  FadeInRight,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'
import { useLocalSearchParams, useNavigation } from 'expo-router'
import type { NativeStackNavigationProp } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { beforeTurn, joinedArtists } from '@selfmp3/shared'
import { iconSize, space, textStyle, type, useLibrary } from '@selfmp3/client'
import { ServerAway } from '../../connection/ServerAway'
import { reachedConnection } from '../../connection/via'
import { usePlayingSongId } from '../../player/PlayerProvider'
import { fonts } from '../../ports/fonts'
import { keyboardAvoidBehavior } from '../../ports/keyboard'
import { NarrowerContentWidth, useContentWidth } from '../../shell/contentWidth'
import { isComposing } from '../../shell/composing'
import { useEscape } from '../../shell/useEscape'
import { setPageFoot } from '../../shell/pageFoot'
import { useLayoutFlags } from '../../shell/useLayout'
import { usePageBack } from '../../ui/useBackTo'
import { BackButton } from '../../ui/components/BackButton'
import { X } from '../../ui/components/Icons'
import { IconButton } from '../../ui/components/IconButton'
import { EASE_OUT_POINTS, MOVE_MS } from '../../ui/motion.model'
import { useMotionReduced } from '../../ui/motion'
import { Chip } from '../../ui/components/Chip'
import { Kbd } from '../../ui/components/Kbd'
import { SafeAreaView } from '../../ui/components/SafeAreaView'
import { ScrollView } from '../../ui/components/Scroll'
import { pageFrame } from '../../ui/surfaces'
import { useSvgId } from '../../ui/useSvgId'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'
import { roomTitle } from '../room/room.model'
import { useRoom } from '../room/room.store'
import { AddingToRoom } from '../room/RoomPicks'
import { SONG_LIST_MAX_WIDTH } from '../../ui/components/SongRow'
import { AnswerView } from './AnswerScreen'
import { AskField, type DraftHandle } from './AskField'
import { ThreadTurn, type Answered } from './AskTurn'
import type { AnswerKeys } from './answerKeys'
import { forgetThread, keepThread, keptThread, newThread } from './askThread.store'
import {
  afterStop,
  namedObjects,
  outdatedCards,
  retried,
  scrollToShow,
  type Turn,
  type TurnList,
} from './askTurns.model'
import { askSuggestions } from './smart.model'
import { tagsMostPlayed } from '../tag/tag.model'
import { waitingArtists } from '../tags/tags.model'
import { useSmartServer } from './useSmartServer'

/** Names each turn, across the app's life: two pages' turns never share one. */
let nextTurn = 1

/**
 * Ask (docs/features/ai.md, "The Ask page"): `/ask?q=…` from Search's Enter or
 * its Ask card, and from the palette's Ask row on a computer.
 *
 * A conversation (2026-11-12, after the workbench's log of one-line results
 * left a follow-up leaning on words nobody could see any more). Every turn
 * stays on the page in full: what was asked, Ask's own words, and its cards,
 * each acted on where it stands, a proposal done with folding to what came of
 * it. On a computer the conversation is the whole page, a column in the
 * middle, its field at the foot, an empty one starting with the field in the
 * middle (A1 + A2, 2026-11-12). A reply with a list brings it in beside, at
 * full size, the conversation narrowing to a pane (B1): the newest list opens
 * by itself, a list's card opens that one, lit while it is, and its ✕ gives
 * the conversation the page back until a newer list comes (C1). On a phone
 * the conversation is the page, and a list's card opens it as a page of its
 * own whose ‹ comes back to the same place in the conversation.
 *
 * The field asks the next question, after everything before it (F1: the
 * server hears each earlier question with what was shown for it, the songs
 * by handle, and answers the newest). Nothing is picked as what the words are
 * about: the list open is sent as what is on the screen, Ask works out the
 * rest from the conversation, and each reply says which earlier answers it
 * was made from ("From “Calm study night”"). While one is worked on its send
 * is a Stop, which takes the turn back off the page and its words back into
 * the field. ‹ goes back to Search with the question still typed; a
 * conversation is not kept after it.
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
    lists: [],
    kinds: [],
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
  const named = useMemo(() => namedObjects(turns), [turns])
  const outdated = useMemo(() => outdatedCards(turns), [turns])
  // The newest list of the conversation: what opens by itself beside it.
  const newest = useMemo(
    () => [...turns].reverse().find(turn => turn.lists.length > 0)?.lists[0] ?? null,
    [turns],
  )
  // The list open: on a computer the newest, until a card opens another or
  // its ✕ closes it; a new list opens itself again. On a phone none, until a
  // card opens one; a new question comes back to the conversation.
  const [picked, setPicked] = useState<{ since: number | null; list: TurnList | null }>({
    since: latestId,
    list: null,
  })
  // The newest list when ✕ closed it: closed until a newer one comes.
  const [closedOn, setClosedOn] = useState<string | null>(null)
  const pickedNow = picked.since === latestId ? picked.list : null
  const openList = wide
    ? (pickedNow ?? (newest && newest.id !== closedOn ? newest : null))
    : pickedNow
  const openId = openList?.id ?? null
  // What is on the screen as the words are asked: the list open, or on a
  // phone the newest list, the one just above the field.
  const screen = (openList ?? (wide ? null : newest))?.handle ?? null
  // On a phone with a list open, the list is the page and the conversation waits under it.
  const listPage = !wide && openList !== null
  // The answer's keys (a review's ticks) while the field has nothing typed, and
  // the review is on the page: letters are a follow-up.
  const answerKeys = !typing && !working && !listPage ? keys : null

  // The conversation follows its foot while you are at it — a new question,
  // an answer coming in — and is left alone once you scroll back up.
  const scroller = useRef<ScrollView>(null)
  const following = useRef(true)
  const view = useRef({ y: 0, height: 0 })
  const spans = useRef(new Map<number, { y: number; height: number }>())

  // Words from the field empty it; words from a button (Get it, a Try) leave
  // whatever was being typed there.
  const ask = (words: string, fromField = false): void => {
    const asked = words.trim()
    if (!asked || working || !server.api) return
    // Asked with what is on the screen: the router decides whether the words change it or act on it.
    setTurns(was => [...was, turnFor(asked, was, screen)])
    setKeys(null)
    following.current = true
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
  const open = useCallback(
    (list: TurnList | null) => {
      setPicked({ since: latestId, list })
      setClosedOn(null)
    },
    [latestId],
  )
  // ✕ on the list beside: the conversation has the page again.
  const closeBeside = useCallback(() => {
    setPicked({ since: latestId, list: null })
    setClosedOn(newest?.id ?? null)
  }, [latestId, newest])

  const toFoot = useCallback(() => {
    if (following.current) scroller.current?.scrollToEnd({ animated: true })
  }, [])
  const scrolled = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, layoutMeasurement, contentSize } = event.nativeEvent
    view.current = { y: contentOffset.y, height: layoutMeasurement.height }
    following.current =
      contentOffset.y + layoutMeasurement.height >= contentSize.height - FOLLOW_SLACK
  }, [])
  // The conversation made shorter while its end was in view — the keyboard
  // coming up, on either phone — keeps its end in view, and moves to it as the
  // keyboard rises: its new height is laid out as the keyboard sets off.
  // Waiting for keyboardDidShow scrolled it once the keyboard had settled, a
  // jerk after the move; keyboardWillShow came before the keyboard's room was
  // taken, when the end was still where it had been.
  const conversationHeight = useRef(0)
  const resized = useCallback(
    (event: LayoutChangeEvent) => {
      const { height } = event.nativeEvent.layout
      const shorter = height < conversationHeight.current
      conversationHeight.current = height
      if (shorter) toFoot()
    },
    [toFoot],
  )
  const laidOut = useCallback((id: number, event: LayoutChangeEvent) => {
    const { y, height } = event.nativeEvent.layout
    spans.current.set(id, { y, height })
  }, [])
  // A "From" line pressed: its turn back in view, lit for a moment, and its list open beside.
  const [flash, setFlash] = useState<number | null>(null)
  useEffect(() => {
    if (flash === null) return undefined
    const timer = setTimeout(() => setFlash(null), FLASH_MS)
    return () => clearTimeout(timer)
  }, [flash])
  const showFrom = useCallback(
    (handle: string) => {
      const object = named.get(handle)
      if (!object) return
      const span = spans.current.get(object.turnId)
      const y = span ? scrollToShow(span, view.current, space.md) : null
      if (y !== null) scroller.current?.scrollTo({ y, animated: true })
      setFlash(object.turnId)
      if (wide && object.list) open(object.list)
    },
    [named, wide, open],
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

  const reachable = server.reach.state === 'reachable'
  const listHeight = Math.max(240, window.height * 0.55)
  // On a computer with no list beside: the conversation is the page (A1), and
  // before anything is asked its field waits in the middle (A2).
  const alone = wide && openList === null
  const starting = alone && turns.length === 0 && reachable
  useEscape(wide && openList !== null, closeBeside)
  const pageWidth = useContentWidth()
  // The rows' context beside: the page less the conversation, and never past what rows use.
  const besideMax = Math.max(
    0,
    Math.min((pageWidth ?? Infinity) - THREAD_WIDTH, SONG_LIST_MAX_WIDTH),
  )
  const reduced = useMotionReduced()
  const besideIn = useMemo(
    () =>
      reduced
        ? undefined
        : FadeInRight.duration(MOVE_MS.sheetUp).easing(Easing.bezier(...EASE_OUT_POINTS)),
    [reduced],
  )
  const pushed = usePushedPage(wide ? null : openList, window.width, reduced)

  useEffect(() => () => setPageFoot(0), [])
  const { top } = useSafeAreaInsets()
  const frame = pageFrame(wide)
  // ‹ lets the conversation go: the same question asked again starts afresh.
  const leave = useCallback(() => {
    forgetThread(thread)
    back()
  }, [thread, back])
  const via = reachedConnection(server.reach)?.baseUrl ?? null

  const dock = (
    <View
      style={[styles.dock, wide && styles.dockWide, wide && styles.column]}
      // The toasts rise above the field rather than cover it.
      onLayout={event => setPageFoot(wide ? 0 : event.nativeEvent.layout.height)}
    >
      <AskField
        inputRef={field}
        draftRef={draft}
        onTyping={setTyping}
        onSend={words => ask(words, true)}
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
  )

  const conversation = (
    <Reanimated.View
      style={[
        styles.thread,
        wide && (alone ? styles.threadAlone : styles.threadWide),
        !wide && pushed.underStyle,
      ]}
      // Under a phone's list page: there to slide back to, not to press or read.
      pointerEvents={listPage ? 'none' : 'auto'}
      accessibilityElementsHidden={listPage}
      importantForAccessibility={listPage ? 'no-hide-descendants' : 'auto'}
      testID="ask-thread"
    >
      <View style={[styles.threadHead, { paddingTop: top + frame.paddingTop }]}>
        <BackButton to="/search" always onPress={leave} testID="ask-back" />
        <Text style={styles.threadTitle} accessibilityRole="header">
          Ask
        </Text>
      </View>
      {starting ? (
        // A2: nothing asked yet, the field waits in the middle of the page under a line.
        <View style={styles.startTop}>
          <Text style={styles.startLine} accessibilityRole="header">
            What should we listen to?
          </Text>
        </View>
      ) : (
        <ScrollView
          ref={scroller}
          style={styles.turns}
          contentContainerStyle={[styles.turnsContent, wide && styles.column]}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          scrollEventThrottle={64}
          onScroll={scrolled}
          onContentSizeChange={toFoot}
          onLayout={resized}
        >
          {!reachable ? (
            <ServerAway reach={server.reach} need="ai" testID="ask-server" />
          ) : (
            turns.map((turn, index) => (
              <ThreadTurn
                key={turn.id}
                turn={turn}
                number={index + 1}
                latest={turn.id === latestId}
                via={via}
                listHeight={listHeight}
                named={named}
                openId={wide ? openId : null}
                outdated={outdated.get(turn.id)}
                flash={flash === turn.id}
                onOpen={open}
                onShowFrom={showFrom}
                onLayout={laidOut}
                onAnswered={answered}
                onSettle={settle}
                onRetry={retry}
                // A dead end's suggestions, and Tidy up's "ask about the rest": the next turn.
                onAsk={askFromAnswer}
                onKeys={turn.id === latestId ? setKeys : undefined}
              />
            ))
          )}
          {turns.length === 0 && reachable ? <Suggestions onAsk={ask} /> : null}
        </ScrollView>
      )}
      {/* The conversation goes under the field rather than stopping at a line (C1). */}
      {wide ? dock : <FootFade color={theme.colors.surface0} />}
      {starting ? (
        <View style={styles.startFoot}>
          <Suggestions onAsk={ask} centred />
        </View>
      ) : null}
    </Reanimated.View>
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
            {conversation}
            {wide ? (
              openList ? (
                <NarrowerContentWidth max={besideMax}>
                  {/* B1: comes in from the right when a list first opens; another one swaps in place. */}
                  <Reanimated.View
                    style={[styles.beside, styles.besideWide]}
                    entering={besideIn}
                    testID="ask-beside"
                  >
                    <AnswerView
                      key={openList.id}
                      id={openList.id}
                      inAsk
                      top={
                        <View style={styles.closeRow}>
                          <IconButton
                            label="Close the list"
                            size={36}
                            onPress={closeBeside}
                            testID="ask-beside-close"
                          >
                            <X size={iconSize.field} tone="textSecondary" />
                          </IconButton>
                        </View>
                      }
                      lead={openList.lead}
                    />
                  </Reanimated.View>
                </NarrowerContentWidth>
              ) : null
            ) : pushed.page ? (
              <Reanimated.View
                key={pushed.page.id}
                style={[styles.listPage, pushed.pageStyle]}
                onLayout={pushed.arrived}
                testID="ask-list-page"
              >
                <AnswerView
                  key={pushed.page.id}
                  id={pushed.page.id}
                  inAsk
                  top={
                    <BackButton
                      to="/search"
                      always
                      onPress={() => open(null)}
                      testID="ask-to-thread"
                    />
                  }
                  lead={pushed.page.lead}
                />
              </Reanimated.View>
            ) : null}
          </View>
          {wide ? null : dock}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </AddingToRoom.Provider>
  )
}

/**
 * A phone's list as a page pushed over the conversation, the way the stack
 * pushes every other page: it slides in from the right while the conversation
 * eases a little to the left under it, and Back runs the same move the other
 * way. The slide starts once the page has laid out, not as it mounts: a list's
 * first frame can take longer than the slide, which would arrive all but done.
 * A list let go stays drawn until it has slid off.
 */
function usePushedPage(list: TurnList | null, width: number, reduced: boolean) {
  const pushed = useSharedValue(0)
  // The list last open, drawn while it slides off once let go.
  const [shown, setShown] = useState(list)
  if (list && list !== shown) setShown(list)
  useEffect(() => {
    if (list) {
      // Opened again while still sliding off: it is laid out already, so back it comes.
      if (pushed.get() > 0) pushed.set(withTiming(1, PAGE_TIMING))
      return
    }
    pushed.set(
      reduced
        ? 0
        : withTiming(0, PAGE_TIMING, done => {
            if (done) runOnJS(setShown)(null)
          }),
    )
  }, [list, reduced, pushed])
  const arrived = useCallback(() => {
    if (list) pushed.set(reduced ? 1 : withTiming(1, PAGE_TIMING))
  }, [list, reduced, pushed])
  const pageStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: (1 - pushed.get()) * width }],
  }))
  const underStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -pushed.get() * width * UNDER_SHIFT }],
  }))
  return { page: list ?? (reduced ? null : shown), arrived, pageStyle, underStyle }
}

/** The conversation's foot fading into the ground the field floats over. */
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
 * (`askSuggestions`), at the foot of the empty conversation just above the
 * field (L1, 2026-10-25), or on a computer under the field in the middle of
 * the page (A2). A press asks it.
 */
function Suggestions({
  onAsk,
  centred = false,
}: {
  onAsk: (words: string) => void
  /** Under the field in the middle of an empty page (A2): in a row, no label. */
  centred?: boolean
}): ReactNode {
  const { data: library } = useLibrary()
  const lines = useMemo(() => {
    if (!library) return []
    const tags = tagsMostPlayed(library.tags, library.songs).map(standing => standing.tag)
    const untagged = waitingArtists(library.songs, 1, library).artists[0]?.name ?? null
    const top = joinedArtists(library.songs, library)[0]?.name ?? null
    return askSuggestions(tags, untagged, top)
  }, [library])
  if (lines.length === 0) return null
  if (centred) {
    return (
      <View style={styles.suggestionsCentred} testID="ask-suggestions">
        {lines.map(line => (
          <Chip key={line} label={line} selected={false} onPress={() => onAsk(line)} />
        ))}
      </View>
    )
  }
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

/**
 * The conversation's narrowest beside the list on a computer: room for a
 * review's rows and a list's card. On a wide screen it has whatever the list's
 * rows leave (`SONG_LIST_MAX_WIDTH`), its turns held to `COLUMN_WIDTH`.
 */
const THREAD_WIDTH = 440

/** The conversation's column on a computer with nothing beside it: a reading width (A1). */
const COLUMN_WIDTH = 720

/** How a phone's list page comes in and goes out. */
const PAGE_TIMING = { duration: MOVE_MS.place, easing: Easing.bezier(...EASE_OUT_POINTS) }

/** How far the conversation eases left under a phone's list page, of the page's width: the stack's push. */
const UNDER_SHIFT = 0.3

/** How near its foot the conversation still counts as followed. */
const FOLLOW_SLACK = 64

/** How long a turn a "From" line brought back stays lit. */
const FLASH_MS = 1600

const styles = StyleSheet.create(theme => ({
  screen: { flex: 1, backgroundColor: theme.colors.surface0 },
  page: { flex: 1 },
  // A phone's page is the conversation or a list; a computer's is both, side by side.
  body: { flex: 1, minHeight: 0 },
  bodyWide: { flexDirection: 'row' },
  // A phone's list, a page over the conversation.
  listPage: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: theme.colors.surface0,
  },
  thread: { flex: 1, minHeight: 0 },
  // On a computer with nothing beside it, the whole page on the ground (A1).
  threadAlone: { flex: 1 },
  // A column in the middle of the conversation, the turns and the field alike, on a computer.
  column: { width: '100%', maxWidth: COLUMN_WIDTH, alignSelf: 'center' },
  // A2: the line above the field in the middle of the page, and the suggestions under it.
  startTop: { flex: 1, justifyContent: 'flex-end', alignItems: 'center', padding: space.lg },
  startLine: {
    ...textStyle('page'),
    fontFamily: fonts.display,
    color: theme.colors.textPrimary,
    textAlign: 'center',
  },
  startFoot: { flex: 1, paddingHorizontal: space.lg },
  closeRow: { flexDirection: 'row', justifyContent: 'flex-end' },
  // On a computer beside a list, a pane a step up from the ground, its field at the foot.
  // It keeps 440 and takes only what the list beside can't use (`besideWide`).
  threadWide: {
    flexGrow: 1,
    flexShrink: 0,
    flexBasis: THREAD_WIDTH,
    backgroundColor: theme.colors.surface1,
  },
  threadHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.snug,
    paddingHorizontal: space.lg,
    paddingBottom: space.sm,
  },
  threadTitle: {
    ...textStyle('large'),
    fontFamily: fonts.display,
    color: theme.colors.textPrimary,
  },
  turns: { flex: 1, minHeight: 0 },
  turnsContent: {
    flexGrow: 1,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    paddingBottom: space.xl,
    gap: space.xl,
  },
  beside: { flex: 1, minWidth: 0, minHeight: 0 },
  // The list grows first, up to what its rows use; past that the conversation has the rest.
  besideWide: { flexGrow: 1000, flexShrink: 1, flexBasis: 0, maxWidth: SONG_LIST_MAX_WIDTH },
  fade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: space.xl,
  },
  // At the foot of the empty conversation, just above the field.
  suggestions: { marginTop: 'auto', gap: space.sm },
  suggestionsLabel: { color: theme.colors.textMuted, fontSize: type.small },
  suggestion: { alignItems: 'flex-start' },
  suggestionsCentred: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: space.sm,
    maxWidth: COLUMN_WIDTH,
    alignSelf: 'center',
  },
  // The field floats over the conversation's fading foot (C1), with room
  // under it before the player bar or the phone's edge.
  dock: {
    paddingHorizontal: space.lg,
    paddingTop: space.xs,
    paddingBottom: space.md,
    gap: space.sm,
  },
  // On a computer: at the pane's foot, under the conversation it continues.
  dockWide: { paddingBottom: space.xl },
  keys: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: space.md },
  keysText: { color: theme.colors.textMuted, fontSize: type.small },
}))
