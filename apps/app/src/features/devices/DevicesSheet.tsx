import type { ReactNode, RefObject } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import type { View as RNView } from 'react-native'
import { shortDeviceName, space, type } from '@selfmp3/client'
import { formatRelative } from '@selfmp3/shared'

import { ServerAway } from '../../connection/ServerAway'
import { usePlayer } from '../../player/PlayerProvider'
import { useLayout } from '../../shell/useLayout'
import { Popover } from '../../ui/components/Popover'
import { Sheet, SheetItem } from '../../ui/components/Sheet'
import { Devices, Remote } from '../../ui/components/Icons'
import { useDeviceContext } from './DevicesProvider'

/**
 * What else is playing, and what to do about it.
 *
 * The devices list: beside the control that opened it at desktop width, and a
 * sheet below the breakpoint. It is a `Sheet` directly rather than a `Popover`
 * because on a phone that control lives in the mini player, which has no
 * anchor worth measuring.
 *
 * Two actions per device, and they are opposites: **Play here** pulls that
 * device's queue and position over and stops it there; **Play there** pushes
 * this one's over and stops here. Both are `handoffTarget` in
 * `packages/client`, which is why they behave the same on every device.
 *
 * An action that cannot work is drawn and disabled rather than left out, and
 * the row says why — a device playing something this library has no number
 * for, or a song here that is not in the bucket for any other device to find.
 * A missing button is indistinguishable from a feature that does not exist;
 * a greyed one with a reason beside it is an answer.
 *
 * With no server in reach there is nothing to list at all, and the same card
 * every other screen shows says so (`ServerAway`). A bucket cannot hold a
 * connection between two devices open: this is the one thing here that really
 * does need the server awake.
 */
export function DevicesSheet({
  open,
  onClose,
  anchorRef,
}: {
  open: boolean
  onClose: () => void
  /**
   * The control that opened it. At desktop width the list opens beside it;
   * without one it is a sheet.
   */
  anchorRef?: RefObject<RNView | null>
}): ReactNode {
  const { theme } = useUnistyles()
  const devices = useDeviceContext()
  const player = usePlayer()
  const { wide } = useLayout()
  // Something is loaded here, but no other device could be told which song.
  const unshareable = player.current !== null && !devices.canPlayOn

  const list = (
    <>
      <View style={styles.self}>
        <Devices size={15} color={theme.colors.textSecondary} />
        <Text style={styles.selfName} numberOfLines={1}>
          {shortDeviceName(devices.name)}
        </Text>
        <Text style={styles.selfNote}>this device</Text>
      </View>

      {devices.reach && devices.reach.state !== 'reachable' ? (
        <View style={styles.away}>
          <ServerAway reach={devices.reach} need="devices" testID="devices-server" />
        </View>
      ) : devices.others.length === 0 ? (
        <Text style={styles.empty}>
          {devices.connected
            ? 'Nothing else is signed in right now.'
            : 'Looking for your other devices…'}
        </Text>
      ) : (
        devices.others.map(device => {
          // Blank after translation: it is playing a song this library has no
          // number for, so there is nothing here that could be taken over.
          const named = device.state.songId !== null
          return (
            <View key={device.id} testID={`device-${device.id}`}>
              <SheetItem
                icon={<Remote size={16} color={theme.colors.textSecondary} />}
                label={shortDeviceName(device.name)}
                detail={
                  !named
                    ? device.state.playing
                      ? 'Playing something not in your bucket'
                      : `Nothing loaded · ${formatRelative(device.lastSeenAt)}`
                    : device.state.playing
                      ? 'Playing now'
                      : `Last seen ${formatRelative(device.lastSeenAt)}`
                }
                disabled={!named}
                onPress={() => {
                  devices.playHere(device)
                  onClose()
                }}
              />
              <SheetItem
                label="Play there instead"
                disabled={!devices.canPlayOn}
                onPress={() => {
                  devices.playOn(device)
                  onClose()
                }}
              />
            </View>
          )
        })
      )}

      {unshareable && devices.others.length > 0 ? (
        <Text style={styles.empty}>
          This song isn’t in your bucket yet, so no other device can find it.
        </Text>
      ) : null}
    </>
  )

  if (wide && anchorRef) {
    return (
      <Popover
        open={open}
        onClose={onClose}
        anchorRef={anchorRef}
        placement="above"
        width={300}
        testID="devices-sheet"
      >
        {list}
      </Popover>
    )
  }

  return (
    <Sheet open={open} onClose={onClose} title="Devices" testID="devices-sheet">
      {list}
    </Sheet>
  )
}

const styles = StyleSheet.create(theme => ({
  self: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingBottom: space.sm,
  },
  selfName: {
    color: theme.colors.textPrimary,
    fontSize: type.body,
    fontWeight: '600',
    flexShrink: 1,
  },
  selfNote: {
    color: theme.colors.textMuted,
    fontSize: type.small,
  },
  away: { paddingHorizontal: space.md, paddingBottom: space.sm },
  empty: {
    color: theme.colors.textMuted,
    fontSize: type.small,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
}))
