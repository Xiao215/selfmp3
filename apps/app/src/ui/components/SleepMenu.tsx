import { useEffect, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { formatDuration } from '@selfmp3/shared'
import { space } from '@selfmp3/client'
import { usePlayer } from '../../player/PlayerProvider'
import { Popover } from './Popover'
import { Sheet, SheetItem } from './Sheet'

const SLEEP_OPTIONS = [15, 30, 45, 60, 90] as const

/**
 * The sleep timer's choices: the web's `SleepMenu`.
 *
 * Beside the button that opened it on a computer, above the player bar; as a
 * sheet on a phone, where the now-playing screen's Sleep opens it with nothing
 * to anchor to.
 *
 * "End of this song" first, since it is the one that fits how people fall
 * asleep to music — at a natural stop, not mid-verse — then the minutes, then
 * Off, ticked while no timer runs. Off used to be a red "Cancel timer" that
 * only appeared once a timer was set, so there was nowhere to see that none
 * was.
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
  const remaining = useRemaining(player.sleepTimerEndsAt)
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
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (endsAt === null) return undefined
    const timer = setInterval(() => setNow(Date.now()), 5_000)
    return () => clearInterval(timer)
  }, [endsAt])
  if (sleepAtSongEnd) return 'End of song'
  if (endsAt === null) return null
  return `${Math.max(1, Math.ceil((endsAt - now) / 60_000))} min`
}

/** "12:04" until the timer runs out, ticking once a second while it is set. */
function useRemaining(endsAt: number | null): string {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (endsAt === null) return undefined
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [endsAt])
  return endsAt === null ? '' : formatDuration(Math.max(0, endsAt - now) / 1000)
}

const styles = StyleSheet.create(theme => ({
  menuTitle: {
    color: theme.colors.textMuted,
    fontSize: 12,
    paddingHorizontal: 10,
    paddingTop: space.sm,
    paddingBottom: 6,
  },
}))
