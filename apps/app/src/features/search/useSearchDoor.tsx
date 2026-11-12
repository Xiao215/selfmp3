import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { StyleSheet as RNStyleSheet, View } from 'react-native'
import Reanimated, {
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'
import { useNavigation, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { StyleSheet } from 'react-native-unistyles'
import { iconSize, space, type } from '@selfmp3/client'
import { stackMoves } from '../../ports/stackMoves'
import { quietNextStepTo } from '../../shell/pageStep'
import { useLayoutValue } from '../../shell/useLayout'
import { SearchField } from '../../ui/components/SearchField'
import { useMotionReduced } from '../../ui/motion'
import { EASE_OUT_POINTS, MOVE_MS } from '../../ui/motion.model'
import { PAGE_TOP_PHONE } from '../../ui/surfaces'
import {
  DOOR_HINT,
  listenAsDoor,
  markDoorArrival,
  SEARCH_HINT,
  SEARCH_KEYBOARD,
} from './searchDoor'

/** A field's place in the window: its top-left corner and its width. */
interface FieldFrame {
  readonly x: number
  readonly y: number
  readonly width: number
}

/** The way between Home's field and Search's: how far apart, and the two widths. */
interface Way {
  readonly dx: number
  readonly dy: number
  readonly from: number
  readonly to: number
}

/** Rising to open Search, or set at the top to come back down from it. */
type Flight = 'open' | 'back'

/** How far Home's page drifts up as it fades from under the rising field. */
const PAGE_DRIFT = 12

/** How long Home waits, once Search has arrived over it, before putting its own field back. */
const SETTLE_MS = 150

const MOVE = {
  duration: MOVE_MS.searchDoor,
  easing: Easing.bezier(...EASE_OUT_POINTS),
} as const

/**
 * Home's half of the move between its search field and Search's
 * (`searchDoor.ts`). A phone only: a computer's field is the sidebar's row,
 * which opens the palette. With Reduce Motion, or in a browser, the field
 * simply opens Search.
 *
 * Pressed, the field is measured and a copy of Search's head is laid over
 * Home: the field rises into its place there and narrows as Cancel comes in
 * beside it, while Home fades and drifts up from under it. The copy's field
 * is a real one and takes the focus straight away, so the keyboard comes up
 * with the move rather than after it. Once the move has landed Search
 * arrives, drawn exactly as the copy's last frame, and its own field takes
 * the focus and the keyboard over.
 *
 * Coming back, Search asks for the copy to be set at the top while it is
 * still over Home. Home is revealed in that state and plays the move
 * backwards.
 *
 * `doorRef` and `doorStyle` go on a view around the field, `pageStyle` on a
 * view around the rest of the page, and `flight` over the page.
 */
export function useSearchDoor(
  openSearch: () => void,
  wide: boolean,
): {
  doorRef: RefObject<View | null>
  doorStyle: ReturnType<typeof useAnimatedStyle>
  pageStyle: ReturnType<typeof useAnimatedStyle>
  open: () => void
  flight: ReactNode
} {
  const router = useRouter()
  const navigation = useNavigation()
  const reduced = useMotionReduced()
  const moves = stackMoves && !wide && !reduced
  const doorRef = useRef<View>(null)
  const [flight, setFlightState] = useState<Flight | null>(null)
  // Read by the press, the focus and Search's calls, which come between renders.
  const flightRef = useRef<Flight | null>(null)
  const setFlight = useCallback((next: Flight | null) => {
    flightRef.current = next
    setFlightState(next)
  }, [])
  /** 0 with the field in Home, 1 with it at the top of Search. */
  const progress = useSharedValue(0)
  /** 1 once the copy's place is known: the copy shows, and Home's own field hides. */
  const placed = useSharedValue(0)
  const way = useSharedValue<Way>({ dx: 0, dy: 0, from: 0, to: 0 })
  /** Where Home's field was pressed, kept for the way back. */
  const pressedAt = useRef<FieldFrame | null>(null)
  const typed = useRef('')

  const rest = useCallback(() => {
    setFlight(null)
    placed.set(0)
    progress.set(0)
    typed.current = ''
  }, [setFlight, placed, progress])

  const arrive = useCallback(() => {
    quietNextStepTo('/search')
    markDoorArrival()
    const words = typed.current.trim()
    router.navigate(words ? { pathname: '/search', params: { q: words } } : '/search')
  }, [router])

  /**
   * The copy's field is laid out where Search's will be: the move can start.
   * Only rising: coming back, Home is under Search and out of the window,
   * where nothing measures true, so the way back is the way it came.
   */
  const land = useCallback(
    (at: FieldFrame) => {
      const from = pressedAt.current
      if (!from || flightRef.current !== 'open') return
      way.set({ dx: from.x - at.x, dy: from.y - at.y, from: from.width, to: at.width })
      placed.set(1)
      progress.set(
        withTiming(1, MOVE, finished => {
          if (finished) scheduleOnRN(arrive)
        }),
      )
    },
    [way, placed, progress, arrive],
  )

  const open = useCallback(() => {
    // A second press while the field is already on its way is the same press.
    if (flightRef.current !== null) return
    const node = doorRef.current
    if (!moves || !node) {
      openSearch()
      return
    }
    node.measureInWindow((x, y, width) => {
      if (!(width > 0)) {
        openSearch()
        return
      }
      pressedAt.current = { x, y, width }
      setFlight('open')
    })
  }, [moves, openSearch, setFlight])

  useEffect(
    () =>
      listenAsDoor({
        settle: () => {
          setTimeout(() => {
            if (flightRef.current === 'open') rest()
          }, SETTLE_MS)
        },
        comeBack: () => {
          if (!moves || pressedAt.current === null) return false
          setFlight('back')
          progress.set(1)
          placed.set(1)
          return true
        },
      }),
    [moves, progress, placed, rest, setFlight],
  )

  // Home in front again. Back from Search, the field comes down; any other
  // way (Search never came, a swipe back), the page is simply put right.
  useEffect(
    () =>
      navigation.addListener('focus', () => {
        if (flightRef.current === 'back') {
          progress.set(
            withTiming(0, MOVE, finished => {
              if (finished) scheduleOnRN(rest)
            }),
          )
        } else if (flightRef.current === 'open') {
          rest()
        }
      }),
    [navigation, progress, rest],
  )

  const doorStyle = useAnimatedStyle(() => ({ opacity: 1 - placed.value }))
  const pageStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.6], [1, 0], Extrapolation.CLAMP),
    transform: [{ translateY: -PAGE_DRIFT * progress.value }],
  }))

  return {
    doorRef,
    doorStyle,
    pageStyle,
    open,
    flight:
      flight === null ? null : (
        <DoorFlight
          rising={flight === 'open'}
          progress={progress}
          placed={placed}
          way={way}
          onLand={land}
          onType={text => {
            typed.current = text
          }}
        />
      ),
  }
}

/**
 * The copy of Search's head the field travels through: laid out exactly as
 * Search lays its own out (`SearchScreen`'s head), with the field carried
 * from where it was pressed by a translation and a width.
 */
function DoorFlight({
  rising,
  progress,
  placed,
  way,
  onLand,
  onType,
}: {
  rising: boolean
  progress: SharedValue<number>
  placed: SharedValue<number>
  way: SharedValue<Way>
  onLand: (at: FieldFrame) => void
  onType: (text: string) => void
}): ReactNode {
  const dense = useLayoutValue(layout => layout.dense)
  // The inset from its first layout: a safe-area view pads only a frame
  // later, and the field measured before that aimed at the status bar.
  const { top } = useSafeAreaInsets()
  const slot = useRef<View>(null)
  const landed = useRef(false)
  const [words, setWords] = useState('')

  const fieldStyle = useAnimatedStyle(() => {
    if (placed.value === 0) return { opacity: 0, width: '100%', transform: [] }
    const { dx, dy, from, to } = way.value
    const left = 1 - progress.value
    return {
      opacity: 1,
      width: to + (from - to) * left,
      transform: [{ translateX: dx * left }, { translateY: dy * left }],
    }
  })
  const cancelStyle = useAnimatedStyle(() => ({
    opacity: placed.value * interpolate(progress.value, [0.2, 1], [0, 1], Extrapolation.CLAMP),
    transform: [
      { translateX: interpolate(progress.value, [0.2, 1], [18, 0], Extrapolation.CLAMP) },
    ],
  }))
  const doorHintStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.45], [1, 0], Extrapolation.CLAMP),
  }))
  const searchHintStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0.35, 0.8], [0, 1], Extrapolation.CLAMP),
  }))

  return (
    <View style={RNStyleSheet.absoluteFill}>
      <View style={[styles.head, { paddingTop: top + PAGE_TOP_PHONE }]}>
        <View
          ref={slot}
          style={styles.slot}
          onLayout={() => {
            if (landed.current) return
            landed.current = true
            slot.current?.measureInWindow((x, y, width) => onLand({ x, y, width }))
          }}
        >
          <Reanimated.View style={fieldStyle}>
            <SearchField
              {...SEARCH_KEYBOARD}
              autoFocus={rising}
              editable={rising}
              value={words}
              onChangeText={text => {
                setWords(text)
                onType(text)
              }}
              placeholder=""
              accessibilityLabel="Search"
              trailing={null}
            />
            {words === '' ? (
              <View pointerEvents="none" style={[styles.hints, dense && styles.hintsDense]}>
                <Reanimated.Text style={[styles.hint, doorHintStyle]} numberOfLines={1}>
                  {DOOR_HINT}
                </Reanimated.Text>
                <Reanimated.Text
                  style={[styles.hint, styles.hintOver, searchHintStyle]}
                  numberOfLines={1}
                >
                  {SEARCH_HINT}
                </Reanimated.Text>
              </View>
            ) : null}
          </Reanimated.View>
        </View>
        <Reanimated.Text style={[styles.cancel, cancelStyle]}>Cancel</Reanimated.Text>
      </View>
    </View>
  )
}

/** Where a field's words start: its edge, its padding, the magnifier and the gap after it. */
function wordsStart(padding: number): number {
  return 1.5 + padding + iconSize.medium + space.sm + 2
}

const styles = StyleSheet.create(theme => ({
  // As `SearchScreen`'s head, so the field lands exactly on Search's own.
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
  },
  slot: { flex: 1 },
  cancel: { color: theme.colors.accent, fontSize: type.body, fontWeight: '600' },
  hints: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: wordsStart(space.lg),
    right: space.lg,
    justifyContent: 'center',
  },
  hintsDense: { left: wordsStart(space.md), right: space.md },
  hint: { color: theme.colors.textMuted, fontSize: type.body },
  hintOver: { position: 'absolute', left: 0, right: 0 },
}))
