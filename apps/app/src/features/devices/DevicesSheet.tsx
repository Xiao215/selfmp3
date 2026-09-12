import type { ReactNode } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { colors, relativeTime, shortDeviceName, space, type } from '@selfmp3/client'

import { Sheet, SheetItem } from '../../ui/components/Sheet'
import { Devices, Remote } from '../../ui/components/Icons'
import { useDeviceContext } from './DevicesProvider'

/**
 * What else is playing, and what to do about it.
 *
 * The web app's devices popover, as the phone's sheet — below the breakpoint
 * that is what a popover is, and `Popover` would render exactly this. It is a
 * `Sheet` directly because the control that opens it lives in the mini player,
 * which has no anchor worth measuring.
 *
 * Two actions per device, and they are opposites: **Play here** pulls that
 * device's queue and position over and stops it there; **Play there** pushes
 * this one's over and stops here. Both are `handoffTarget` in
 * `packages/client`, which is why they behave the same on every device.
 */
export function DevicesSheet({ open, onClose }: { open: boolean; onClose: () => void }): ReactNode {
  const devices = useDeviceContext()

  return (
    <Sheet open={open} onClose={onClose} title="Devices" testID="devices-sheet">
      <View style={styles.self}>
        <Devices size={15} color={colors.textSecondary} />
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
              icon={<Remote size={16} color={colors.textSecondary} />}
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
    </Sheet>
  )
}

const styles = StyleSheet.create({
  self: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingBottom: space.sm,
  },
  selfName: {
    color: colors.textPrimary,
    fontSize: type.body,
    fontWeight: '600',
    flexShrink: 1,
  },
  selfNote: {
    color: colors.textMuted,
    fontSize: type.small,
  },
  empty: {
    color: colors.textMuted,
    fontSize: type.small,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
})
