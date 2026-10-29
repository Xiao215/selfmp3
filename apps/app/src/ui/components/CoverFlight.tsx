import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { Animated, Text, View } from 'react-native'
import { queueSections } from '@selfmp3/shared'
import { type } from '@selfmp3/client'
import { usePlayer } from '../../player/PlayerProvider'
import { StyleSheet } from 'react-native-unistyles'
import { MOVE_MS } from '../motion.model'
import { ease, spring, timing, useMotionReduced } from '../motion'
import {
  currentFlights,
  flightsUnderway,
  landFlight,
  landingCount,
  registerUpNextTarget,
  subscribeFlights,
  type Flight,
} from '../coverFlight'
import { Cover } from './Cover'
import { artShadow } from '../surfaces'
import { CONTROL_SCALE } from '../textScale'

/**
 * Where flying covers are drawn (`ui/coverFlight.ts`): over everything, under
 * nothing a finger needs. Each cover lifts from what was pressed and lands on
 * the Up next button, a stagger behind the one before; the button swells once
 * as they arrive. Only position, size and opacity move, on the native driver.
 * With less motion asked for, the covers land at once and the button does
 * not swell.
 */
export function CoverFlight(): ReactNode {
  const flights = useSyncExternalStore(subscribeFlights, currentFlights, currentFlights)
  if (flights.length === 0) return null
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} aria-hidden>
      {flights.map(flight => (
        <OneFlight key={flight.id} flight={flight} />
      ))}
    </View>
  )
}

function OneFlight({ flight }: { flight: Flight }): ReactNode {
  const [progress] = useState(() => flight.uris.map(() => new Animated.Value(0)))
  useEffect(() => {
    let flying = progress.length
    progress.forEach((value, index) =>
      timing(
        value,
        1,
        MOVE_MS.flight,
        () => {
          flying -= 1
          if (flying === 0) landFlight(flight.id)
        },
        { easing: ease.out, delay: index * MOVE_MS.flightStagger },
      ),
    )
  }, [progress, flight.id])

  const { from, to } = flight
  // A cover the size of what it left, but never a wall: a page's whole head
  // sends a cover-sized one, not a head-sized one.
  const size = Math.min(from.width, from.height, 72)
  const landing = Math.min(to.width, to.height) * 0.6
  // The ghost wears the cover's corners, so the shadow it casts is round too.
  const corners = Math.round(size / 6)
  const startX = from.x + from.width / 2 - size / 2
  const startY = from.y + from.height / 2 - size / 2
  const dx = to.x + to.width / 2 - (startX + size / 2)
  const dy = to.y + to.height / 2 - (startY + size / 2)

  return (
    <>
      {[...flight.uris].reverse().map((uri, reversed) => {
        const index = flight.uris.length - 1 - reversed
        const value = progress[index]!
        return (
          <Animated.View
            key={index}
            testID={`cover-flight-${index}`}
            style={[
              styles.ghost,
              {
                left: startX + index * 6,
                top: startY + index * 6,
                width: size,
                height: size,
                borderRadius: corners,
                opacity: value.interpolate({ inputRange: [0, 0.75, 1], outputRange: [1, 1, 0] }),
                transform: [
                  {
                    translateX: value.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0, dx - index * 6],
                    }),
                  },
                  {
                    translateY: value.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0, dy - index * 6],
                    }),
                  },
                  {
                    scale: value.interpolate({
                      inputRange: [0, 1],
                      outputRange: [1, landing / size],
                    }),
                  },
                ],
              },
            ]}
          >
            <Cover uri={uri} title="" size={size} radius={corners} />
          </Animated.View>
        )
      })}
    </>
  )
}

/**
 * Around the button that opens Up next: registers it as where covers land,
 * and swells once when they do. It wears how many songs are waiting after the
 * one playing, as a small count on its shoulder (O2, 2026-10-25), which ticks
 * up as covers land rather than the moment the songs are queued: the songs
 * arrive with their covers. Nothing waiting, no count.
 */
export function UpNextTarget({ children }: { children: ReactNode }): ReactNode {
  const reduced = useMotionReduced()
  const landed = useSyncExternalStore(subscribeFlights, landingCount, landingCount)
  const flying = useSyncExternalStore(subscribeFlights, flightsUnderway, flightsUnderway)
  const { queue } = usePlayer()
  const waiting = queueSections(queue).next.length
  const [scale] = useState(() => new Animated.Value(1))
  const [bump] = useState(() => new Animated.Value(1))
  // The count the badge says: held while covers are on their way in, so it
  // ticks up as they land; anything else (a song played on, one removed)
  // says itself at once.
  const [shown, setShown] = useState(waiting)
  if (shown !== waiting && !(flying > 0 && waiting > shown)) setShown(waiting)
  // The landing last answered: those before this button was drawn are not its
  // to answer, and a change of Reduce Motion is not a new landing.
  const answered = useRef(landed)
  useEffect(() => {
    if (answered.current === landed) return
    answered.current = landed
    if (reduced) return
    timing(scale, 1.12, MOVE_MS.landing, () => spring(scale, 1), { easing: ease.out })
    timing(bump, 1.25, MOVE_MS.landing, () => spring(bump, 1), { easing: ease.out })
  }, [landed, reduced, scale, bump])
  const held = useRef<View | null>(null)
  const ref = useCallback((node: View | null) => {
    registerUpNextTarget(node, held.current)
    held.current = node
  }, [])
  const [style] = useState(() => ({ transform: [{ scale }] }))
  const [badgeMotion] = useState(() => ({ transform: [{ scale: bump }] }))
  return (
    <Animated.View ref={ref} collapsable={false} style={style}>
      {children}
      {shown > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={[styles.count, badgeMotion]}
          accessibilityLabel={`${shown} waiting`}
          testID="up-next-count"
        >
          <Text style={styles.countText} maxFontSizeMultiplier={CONTROL_SCALE}>
            {shown > 99 ? '99+' : shown}
          </Text>
        </Animated.View>
      ) : null}
    </Animated.View>
  )
}

/** The count's height. */
const COUNT = 16

const styles = StyleSheet.create(theme => ({
  // A flying cover is artwork, so it casts what artwork casts, from the
  // palette: the leaning cover's shadow, a soft one on Paper.
  ghost: { position: 'absolute', ...artShadow(theme.colors, 'lean') },
  // On the button's shoulder, in the accent: a count, not a warning.
  count: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: COUNT,
    height: COUNT,
    paddingHorizontal: 4,
    borderRadius: COUNT / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.accent,
  },
  countText: {
    color: theme.colors.onAccent,
    fontSize: type.tiny,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
}))
