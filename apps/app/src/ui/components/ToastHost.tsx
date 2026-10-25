import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import {
  Animated,
  Easing,
  PanResponder,
  StyleSheet as RNStyleSheet,
  Text,
  View,
} from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import type { Song } from '@selfmp3/shared'
import { hitSlopFor, leading, motion, radius, space, type, iconSize } from '@selfmp3/client'
import { useLayoutValue } from '../../shell/useLayout'
import { useArt } from '../../offline/useArt'
import { ROW_COVER_SIZE } from '../../offline/coverStore'
import { useAccent } from '../accent'
import {
  currentToasts,
  dismissToast,
  subscribeToasts,
  type Toast,
  type ToastTone,
  type ToastWords,
} from '../toast'
import { Cover } from './Cover'
import { IconButton } from './IconButton'
import { X } from './Icons'
import { Press } from './Press'
import { floating } from '../surfaces'
import { ease, motionMs, nativeDriver, spring, timing } from '../motion'

/**
 * Mounted once, in the shell's toast row: every message raised with `showToast`.
 *
 * A dismissed message stays drawn while it fades. The store forgets a message
 * the moment it is dismissed, and one that simply vanished read as something
 * having gone wrong; so the host keeps the ones on their way out beside the
 * ones still up, in the order they were raised, and lets each go once its fade
 * has finished.
 */
export function ToastHost(): ReactNode {
  const toasts = useSyncExternalStore(subscribeToasts, currentToasts, currentToasts)
  const [seen, setSeen] = useState(toasts)
  const [leaving, setLeaving] = useState<readonly Toast[]>([])

  // Worked out while rendering rather than in an effect, so a dismissed
  // message never has a frame in which it is gone before its fade begins.
  if (seen !== toasts) {
    const gone = seen.filter(old => !toasts.some(toast => toast.id === old.id))
    setSeen(toasts)
    if (gone.length > 0) setLeaving(current => [...current, ...gone])
  }

  const forget = useCallback((id: number) => {
    setLeaving(current => current.filter(toast => toast.id !== id))
  }, [])

  const shown = [...toasts, ...leaving].sort((a, b) => a.id - b.id)
  return (
    <>
      {shown.map(toast => (
        <ToastItem
          key={toast.id}
          toast={toast}
          leaving={!toasts.some(up => up.id === toast.id)}
          onGone={forget}
        />
      ))}
    </>
  )
}

function ToastItem({
  toast,
  leaving,
  onGone,
}: {
  toast: Toast
  leaving: boolean
  onGone: (id: number) => void
}): ReactNode {
  // From 0, and the animated value from the first render: swapping a plain
  // number for an Animated value after mount leaves react-native-web drawing
  // the number (see Popover).
  const [shown] = useState(() => new Animated.Value(0))

  // `since` too: a message folded into this one starts its time again.
  useEffect(() => {
    if (leaving || toast.autoDismissMs <= 0) return undefined
    const left = toast.autoDismissMs - (Date.now() - toast.since)
    const timer = setTimeout(() => dismissToast(toast.id), Math.max(0, left))
    return () => clearTimeout(timer)
  }, [toast.id, toast.autoDismissMs, toast.since, leaving])

  useEffect(() => {
    const animation = Animated.timing(shown, {
      toValue: leaving ? 0 : 1,
      duration: motionMs(leaving ? motion.base : motion.fast),
      easing: ease.out,
      useNativeDriver: nativeDriver,
    })
    animation.start(({ finished }) => {
      if (finished && leaving) onGone(toast.id)
    })
    return () => animation.stop()
  }, [leaving, shown, onGone, toast.id])

  const dismiss = useCallback(() => dismissToast(toast.id), [toast.id])
  const last = toast.actions.length - 1
  return (
    <Animated.View
      style={[
        styles.slot,
        {
          opacity: shown,
          transform: [
            { translateY: shown.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) },
          ],
        },
      ]}
      pointerEvents={leaving ? 'none' : 'box-none'}
    >
      <ToastCard
        tone={toast.tone}
        words={toast}
        art={toast.art ?? (toast.songs.length > 0 ? <ToastCovers songs={toast.songs} /> : null)}
        timed={
          toast.actions.length > 0 && toast.autoDismissMs > 0
            ? { since: toast.since, ms: toast.autoDismissMs }
            : null
        }
        onDismiss={dismiss}
        closable={toast.autoDismissMs <= 0}
      >
        {toast.actions.map((action, index) => (
          <ToastButton
            key={action.label}
            label={action.label}
            tone={toast.tone}
            filled={index === last}
            onPress={() => {
              // The message has been answered; leaving it up invites a second press.
              dismiss()
              action.onPress()
            }}
          />
        ))}
      </ToastCard>
    </Animated.View>
  )
}

/** Past this, a message let go of goes; short of it, it springs back. */
const SWIPE_AWAY = 72

/**
 * One message as it is drawn (docs/ui-mock: the notifications canvas, A1 B1 C2):
 * a card a step lighter than anything under it, with what it is about at its
 * start — a song's cover, a friend's face — then its words, then what you can
 * do. Its tone is its ground: a good, warning or failed message is washed in
 * that colour, so it is told apart before it is read. A message with nothing
 * but a few words is a capsule its own width.
 *
 * Swiped down or sideways it goes; only a message that stays until it is
 * dismissed — a failure — carries a ✕. One with something to press has a bar
 * along its foot that empties with its time.
 *
 * Shared with the offer to continue from another device (`ResumeToast`), which
 * is drawn beside these but is not one of them.
 */
export function ToastCard({
  tone,
  words,
  art,
  timed,
  onDismiss,
  closable,
  children,
}: {
  tone: ToastTone
  words: ToastWords
  art?: ReactNode
  /** The bar's time: from `since`, `ms` long. */
  timed: { since: number; ms: number } | null
  onDismiss: () => void
  closable: boolean
  /** Its buttons (`ToastButton`). */
  children?: ReactNode
}): ReactNode {
  const { theme } = useUnistyles()
  const accent = useAccent()
  const finePointer = useLayoutValue(layout => layout.finePointer)
  const swipe = useSwipeAway(onDismiss)
  const wash =
    tone === 'good'
      ? theme.colors.goodWash
      : tone === 'warn'
        ? theme.colors.warningWash
        : tone === 'error'
          ? theme.colors.dangerWash
          : null
  const capsule = !art && !words.over && !words.under && !children && !closable
  return (
    <Animated.View
      {...swipe.handlers}
      // One stylesheet entry beside the drag: an animated view flattens its
      // styles into one object, which Unistyles cannot follow two of.
      style={[capsule ? styles.capsule : art ? styles.card : styles.cardWordsFirst, swipe.style]}
      role={tone === 'error' ? 'alert' : 'status'}
      accessibilityActions={DISMISS_ACTIONS}
      onAccessibilityAction={onDismiss}
      onAccessibilityEscape={onDismiss}
    >
      {wash || timed ? (
        <View
          style={[RNStyleSheet.absoluteFill, capsule ? styles.clipCapsule : styles.clip]}
          pointerEvents="none"
        >
          {wash ? <View style={[RNStyleSheet.absoluteFill, { backgroundColor: wash }]} /> : null}
          {timed ? (
            <TimeLeft
              since={timed.since}
              ms={timed.ms}
              color={tone === 'info' ? accent.accent : theme.colors.textSecondary}
            />
          ) : null}
        </View>
      ) : null}
      {art}
      <View style={styles.words}>
        {words.over ? (
          <Text style={styles.over} numberOfLines={1}>
            {words.over}
          </Text>
        ) : null}
        <Text style={styles.say} numberOfLines={words.over ? 1 : 2}>
          {words.say}
        </Text>
        {words.under ? (
          <Text style={styles.under} numberOfLines={2}>
            {words.under}
          </Text>
        ) : null}
      </View>
      {children}
      {closable ? (
        <IconButton onPress={onDismiss} label="Dismiss" size={finePointer ? 28 : 40}>
          <X size={iconSize.field} color={theme.colors.textSecondary} />
        </IconButton>
      ) : null}
    </Animated.View>
  )
}

const DISMISS_ACTIONS = [{ name: 'dismiss', label: 'Dismiss' }]

/**
 * A word on a message. The last of them is the answer most people want —
 * Undo — and is filled; one before it (Open) is the words alone. On a washed
 * message the fill is the ink's veil, since the accent on green or red reads
 * as a third colour.
 */
export function ToastButton({
  label,
  tone,
  filled,
  onPress,
  children,
}: {
  label: string
  tone: ToastTone
  filled: boolean
  onPress: () => void
  /** Drawn instead of the label: Continue's play mark. */
  children?: ReactNode
}): ReactNode {
  const { theme } = useUnistyles()
  const accent = useAccent()
  const plain = tone === 'info'
  return (
    <Press
      feedback="wash"
      onPress={onPress}
      hitSlop={hitSlopFor(BUTTON_HEIGHT)}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[
        children ? styles.round : styles.button,
        filled && !children && { backgroundColor: plain ? accent.accentPill : theme.colors.veil },
      ]}
    >
      {children ?? (
        <Text
          style={[
            styles.buttonLabel,
            { color: filled && plain ? accent.accent : theme.colors.textPrimary },
          ]}
        >
          {label}
        </Text>
      )}
    </Press>
  )
}

const BUTTON_HEIGHT = 36

/** The covers of what a message is about: one, or the last three fanned when several were folded together. */
function ToastCovers({ songs }: { songs: readonly Song[] }): ReactNode {
  const artFor = useArt(ROW_COVER_SIZE)
  const fanned = songs.slice(-3)
  if (fanned.length === 1) {
    const [song] = fanned
    return song ? <Cover uri={artFor(song)} title={song.title} size={ART} /> : null
  }
  const step = 14
  return (
    <View style={{ width: ART + step * (fanned.length - 1), height: ART }}>
      {fanned.map((song, index) => {
        // The newest in front and whole; the ones before it smaller behind it.
        const size = ART - (fanned.length - 1 - index) * 6
        return (
          <View
            key={`${song.id}-${index}`}
            style={[styles.fanned, { left: index * step, top: (ART - size) / 2 }]}
          >
            <Cover uri={artFor(song)} title={song.title} size={size} />
          </View>
        )
      })}
    </View>
  )
}

/** A message's picture: a cover, or a face. */
export const ART = 44

/**
 * The bar along a message's foot, emptying as its time runs out: how long Undo
 * has left, which was a guess.
 */
function TimeLeft({ since, ms, color }: { since: number; ms: number; color: string }): ReactNode {
  const [left] = useState(() => new Animated.Value(1))
  useEffect(() => {
    const gone = Math.min(1, (Date.now() - since) / ms)
    left.setValue(1 - gone)
    // Linear, and not skipped under Reduce Motion: it is a clock, not a flourish.
    const animation = Animated.timing(left, {
      toValue: 0,
      duration: ms * (1 - gone),
      easing: Easing.linear,
      useNativeDriver: nativeDriver,
    })
    animation.start()
    return () => animation.stop()
  }, [since, ms, left])
  return (
    <Animated.View
      style={[styles.bar, { backgroundColor: color, transform: [{ scaleX: left }] }]}
    />
  )
}

/**
 * A message dragged down or sideways, and let go: past `SWIPE_AWAY` (or
 * flung) it carries on out and is dismissed; short of it, it springs back.
 * On the JavaScript side, as a drag is, and on its own view, apart from the
 * fade in and out the native driver moves.
 */
function useSwipeAway(onAway: () => void): {
  handlers: ReturnType<typeof PanResponder.create>['panHandlers']
  style: object
} {
  const [x] = useState(() => new Animated.Value(0))
  const [y] = useState(() => new Animated.Value(0))
  // Made again only when `onAway` is (its callers keep it steady): a
  // responder made anew mid-drag forgets the drag.
  const responder = useMemo(
    () =>
      PanResponder.create({
        // A tap belongs to the button under it; only a drag is the message's.
        onMoveShouldSetPanResponder: (_, drag) => Math.abs(drag.dx) > 8 || drag.dy > 8,
        onPanResponderMove: (_, drag) => {
          x.setValue(drag.dx)
          y.setValue(Math.max(0, drag.dy))
        },
        onPanResponderRelease: (_, drag) => {
          const sideways = Math.abs(drag.dx) > SWIPE_AWAY || Math.abs(drag.vx) > 0.6
          const down = drag.dy > SWIPE_AWAY / 2 || drag.vy > 0.6
          if (sideways) {
            timing(x, Math.sign(drag.dx || 1) * 480, motion.fast, onAway, {
              easing: ease.out,
              native: false,
            })
          } else if (down) {
            timing(y, 160, motion.fast, onAway, { easing: ease.out, native: false })
          } else {
            spring(x, 0, { native: false })
            spring(y, 0, { native: false })
          }
        },
        onPanResponderTerminate: () => {
          spring(x, 0, { native: false })
          spring(y, 0, { native: false })
        },
      }),
    [x, y, onAway],
  )
  const [style] = useState(() => ({
    opacity: x.interpolate({
      inputRange: [-240, 0, 240],
      outputRange: [0, 1, 0],
      extrapolate: 'clamp',
    }),
    transform: [{ translateX: x }, { translateY: y }],
  }))
  return { handlers: responder.panHandlers, style }
}

const styles = StyleSheet.create(theme => ({
  slot: { width: '100%', alignItems: 'center' },
  card: {
    width: '100%',
    maxWidth: 440,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.snug,
    borderRadius: radius.card,
    backgroundColor: theme.colors.toast,
    // A drag on it is a swipe, not a selection of its words.
    userSelect: 'none',
    ...floating(theme.colors),
  },
  /** With no picture to start it, the words keep off the rounded edge. */
  cardWordsFirst: {
    width: '100%',
    maxWidth: 440,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.snug,
    paddingLeft: space.lg,
    borderRadius: radius.card,
    backgroundColor: theme.colors.toast,
    // A drag on it is a swipe, not a selection of its words.
    userSelect: 'none',
    ...floating(theme.colors),
  },
  capsule: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 46,
    paddingVertical: space.sm,
    paddingHorizontal: space.gutter,
    borderRadius: radius.pill,
    backgroundColor: theme.colors.toast,
    ...floating(theme.colors),
  },

  /** Its wash and its bar, cut to its corners; the card itself is not clipped, or its shadow would be. */
  clip: { borderRadius: radius.card, overflow: 'hidden' },
  clipCapsule: { borderRadius: radius.pill, overflow: 'hidden' },
  words: { flexShrink: 1, flexGrow: 1, gap: 1 },
  over: { color: theme.colors.textSecondary, fontSize: type.sub, lineHeight: leading.sub },
  say: {
    color: theme.colors.textPrimary,
    fontSize: type.body,
    lineHeight: leading.body,
    fontWeight: '600',
  },
  under: { color: theme.colors.textSecondary, fontSize: type.sub, lineHeight: leading.sub },
  button: {
    height: BUTTON_HEIGHT,
    paddingHorizontal: space.roomy,
    borderRadius: radius.pill,
    justifyContent: 'center',
  },
  round: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.textPrimary,
  },
  buttonLabel: { fontSize: type.body, fontWeight: '600' },
  fanned: {
    position: 'absolute',
    borderRadius: radius.cover + 2,
    borderWidth: 2,
    borderColor: theme.colors.toast,
    margin: -2,
  },
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 3,
    opacity: 0.7,
    transformOrigin: 'left',
  },
}))
