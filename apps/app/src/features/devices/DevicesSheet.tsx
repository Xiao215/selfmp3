import type { ReactNode, RefObject } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import type { View as RNView } from 'react-native'
import { relativeTime, shortDeviceName, space, type } from '@selfmp3/client'

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
  const { wide } = useLayout()

  const list = (
    <>
      <View style={styles.self}>
        <Devices size={15} color={theme.colors.textSecondary} />
        <Text style={styles.selfName} numberOfLines={1}>
          {shortDeviceName(devices.name)}
        </Text>
        <Text style={styles.selfNote}>this device</Text>
      </View>

      {devices.others.length === 0 ? (
        <Text style={styles.empty}>
          {devices.connected
            ? 'Nothing else is signed in right now.'
            : 'Looking for your other devices…'}
        </Text>
      ) : (
        devices.others.map(device => (
          <View key={device.id} testID={`device-${device.id}`}>
            <SheetItem
              icon={<Remote size={16} color={theme.colors.textSecondary} />}
              label={shortDeviceName(device.name)}
              detail={
                device.state.playing
                  ? 'Playing now'
                  : `Last seen ${relativeTime(device.lastSeenAt)}`
              }
              onPress={() => {
                devices.playHere(device)
                onClose()
              }}
            />
            <SheetItem
              label="Play there instead"
              onPress={() => {
                devices.playOn(device)
                onClose()
              }}
            />
          </View>
        ))
      )}
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
  empty: {
    color: theme.colors.textMuted,
    fontSize: type.small,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
}))
