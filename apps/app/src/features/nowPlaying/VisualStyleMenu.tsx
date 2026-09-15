import type { ReactNode, RefObject } from 'react'
import { Text, View } from 'react-native'
import type { View as RNView } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { space } from '@selfmp3/client'
import { Check, Refresh } from '../../ui/components/Icons'
import { Popover } from '../../ui/components/Popover'
import { SheetItem } from '../../ui/components/Sheet'
import type { SongVisualChoice } from './visualChoice'
import { VISUAL_KINDS, VISUAL_NAMES } from './visuals.model'

/**
 * "Style ▾": which visual a song with no lyrics shows, and the way back to
 * lyrics if there turn out to be some.
 *
 * Auto names what it picked, so choosing it is never a guess. A choice is for
 * this song on this device (`visualChoice.ts`). "Look for lyrics again" asks
 * the lookup afresh, clearing the answer it saved that the song has none.
 *
 * A panel over the pill on a computer and a sheet on a phone — `Popover`
 * decides, from the width.
 */
export function VisualStyleMenu({
  open,
  onClose,
  anchorRef,
  visual,
  following,
  onLookAgain,
}: {
  open: boolean
  onClose: () => void
  anchorRef: RefObject<RNView | null>
  visual: SongVisualChoice
  /** What the visual follows (`motionCaption`), said quietly under the styles. */
  following: string
  onLookAgain: () => void
}): ReactNode {
  const { theme } = useUnistyles()
  const mark = (on: boolean): ReactNode =>
    on ? <Check size={15} color={theme.colors.textPrimary} /> : <View style={styles.blank} />

  return (
    <Popover
      open={open}
      onClose={onClose}
      anchorRef={anchorRef}
      placement="above"
      width={220}
      title="Style"
      titleTone="label"
      testID="visual-style-menu"
    >
      <SheetItem
        icon={mark(!visual.chosen)}
        label="Auto"
        detail={VISUAL_NAMES[visual.auto]}
        active={!visual.chosen}
        onPress={() => {
          visual.choose(null)
          onClose()
        }}
      />
      <View style={styles.divider} />
      {VISUAL_KINDS.map(kind => {
        const on = visual.chosen && visual.kind === kind
        return (
          <SheetItem
            key={kind}
            icon={mark(on)}
            label={VISUAL_NAMES[kind]}
            active={on}
            onPress={() => {
              visual.choose(kind)
              onClose()
            }}
          />
        )
      })}
      <Text style={styles.following} numberOfLines={1}>
        {following}
      </Text>
      <View style={styles.divider} />
      <SheetItem
        icon={<Refresh size={15} color={theme.colors.textSecondary} />}
        label="Look for lyrics again"
        onPress={() => {
          onLookAgain()
          onClose()
        }}
      />
    </Popover>
  )
}

const styles = StyleSheet.create(theme => ({
  divider: { height: 1, backgroundColor: theme.colors.border, marginVertical: space.xs },
  blank: { width: 15, height: 15 },
  following: {
    color: theme.colors.textMuted,
    fontSize: 11,
    paddingHorizontal: space.md,
    paddingTop: space.xs,
  },
}))
