import { useLayoutEffect, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { formatDuration } from '@selfmp3/shared'
import { space, type } from '@selfmp3/client'
import { usePlayer } from '../../player/PlayerProvider'
import { Popover } from './Popover'
import { Sheet, SheetItem } from './Sheet'

const SLEEP_OPTIONS = [15, 30, 45, 60, 90] as const

/**
 * The sleep timer's choices.
 *
 * Beside the button that opened it on a computer, above the player bar; as a
 * sheet on a phone, where the now-playing screen's Sleep opens it with nothing
 * to anchor to.
 *
 * "End of this song" first, since it is the one that fits how people fall
 * asleep to music — at a natural stop, not mid-verse — then the minutes, then
 * Off, ticked while no timer runs. Off is always listed: a control that
 * appeared only once a timer was set would leave nowhere to see that none is.
 */
export function SleepMenu({
  open,
  onClose,
  anchorRef,
}: {
  open: boolean
  onClose: () => void
  anchorRef?: RefObject<View | null>
}): ReactNode {
  const player = usePlayer()
  // Ticking only while the menu is up: it is mounted for as long as the bar
  // or the page that opens it is, and a closed menu has nothing to count.
  const now = useClock(player.sleepTimerEndsAt, 1_000, open)
  const remaining =
    player.sleepTimerEndsAt === null
      ? ''
      : formatDuration(Math.max(0, player.sleepTimerEndsAt - now) / 1000)
  const off = player.sleepTimerEndsAt === null && !player.sleepAtSongEnd
  const status = player.sleepAtSongEnd
    ? 'Stops when this song ends'
    : player.sleepTimerEndsAt !== null
      ? `Stops in ${remaining}`
      : undefined
  const choose = (choice: number | 'song-end' | null): void => {
    player.setSleepTimer(choice)
    onClose()
  }

  const items = (
    <>
      <SheetItem
        label="End of this song"
        detail={player.sleepAtSongEnd ? '✓' : undefined}
        active={player.sleepAtSongEnd}
        // With nothing loaded there is no song to end.
        disabled={player.current === null}
        onPress={() => choose('song-end')}
      />
      {SLEEP_OPTIONS.map(minutes => (
        <SheetItem key={minutes} label={`${minutes} minutes`} onPress={() => choose(minutes)} />
      ))}
      <SheetItem
        label="Off"
        detail={off ? '✓' : undefined}
        active={off}
        onPress={() => choose(null)}
      />
    </>
  )

  if (!anchorRef) {
    return (
      <Sheet
        open={open}
        onClose={onClose}
        title="Sleep timer"
        subtitle={status}
        testID="sleep-menu"
      >
        {items}
      </Sheet>
    )
  }

  return (
    <Popover
      open={open}
      onClose={onClose}
      anchorRef={anchorRef}
      placement="above"
      title="Sleep timer"
      titleTone="label"
      width={200}
      testID="sleep-menu"
    >
      <Text style={styles.menuTitle}>{status ?? 'Sleep timer'}</Text>
      {items}
    </Popover>
  )
}

/**
 * "24 min" until the timer runs out, "End of song" while it waits for the song
 * to end, or null with none set: the label a button wears while the timer runs.
 * Whole minutes rounded up, so it never says 0.
 */
export function useSleepMinutesLeft(endsAt: number | null): string | null {
  const { sleepAtSongEnd } = usePlayer()
  const now = useClock(endsAt, 5_000, true)
  if (sleepAtSongEnd) return 'End of song'
  if (endsAt === null) return null
  return `${Math.max(1, Math.ceil((endsAt - now) / 60_000))} min`
}

/**
 * The time, read again every `everyMs` while a timer is set and `ticking`
 * says anybody is looking — and read afresh before the first paint once it
 * starts, so a menu opened long after the last tick does not show where the
 * timer was then.
 */
function useClock(endsAt: number | null, everyMs: number, ticking: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useLayoutEffect(() => {
    if (endsAt === null || !ticking) return undefined
    const read = (): void => setNow(Date.now())
    read()
    const timer = setInterval(read, everyMs)
    return () => clearInterval(timer)
  }, [endsAt, everyMs, ticking])
  return now
}

const styles = StyleSheet.create(theme => ({
  menuTitle: {
    color: theme.colors.textMuted,
    fontSize: type.small,
    paddingHorizontal: 10,
    paddingTop: space.sm,
    paddingBottom: 6,
  },
}))
