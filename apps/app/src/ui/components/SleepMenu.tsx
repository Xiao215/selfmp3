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
  const running = player.sleepTimerEndsAt !== null
  const title = running ? `Stopping in ${remaining}` : 'Sleep timer'

  const items = (
    <>
      {SLEEP_OPTIONS.map(minutes => (
        <SheetItem
          key={minutes}
          label={`${minutes} minutes`}
          onPress={() => {
            player.setSleepTimer(minutes)
            onClose()
          }}
        />
      ))}
      {running ? (
        <SheetItem
          label="Cancel timer"
          danger
          onPress={() => {
            player.setSleepTimer(null)
            onClose()
          }}
        />
      ) : null}
    </>
  )

  if (!anchorRef) {
    return (
      <Sheet open={open} onClose={onClose} title={title} titleTone="label" testID="sleep-menu">
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
      title={title}
      titleTone="label"
      width={180}
      testID="sleep-menu"
    >
      <Text style={styles.menuTitle}>{title}</Text>
      {items}
    </Popover>
  )
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
