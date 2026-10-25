import { useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Animated, Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { HIT_TARGET, motion, radius, space, type, iconSize } from '@selfmp3/client'
import { useLayoutValue } from '../../shell/useLayout'
import { useFade } from '../motion'
import { Popover } from './Popover'
import { Press } from './Press'
import { SheetItem } from './Sheet'
import { Check, ChevronDown } from './Icons'

interface SelectOption<T> {
  readonly value: T
  readonly label: string
  /** A quieter note beside the label, e.g. how sure a match is. */
  readonly hint?: string
  readonly disabled?: boolean
}

/**
 * Choose one of a few things.
 *
 * A button showing the current value and a list of the rest, and a `Popover`,
 * so above the breakpoint the options appear beside the control and below it
 * they arrive as a sheet — decided by the primitive, not by the caller, which
 * is foundation 5.
 *
 * Three sizes: the ordinary control, `small` for a row of them, and `inline`
 * for one that sits inside a sentence ("Match all of these rules").
 *
 * Not a native picker: the list is styled to match everything around it, and
 * an iOS wheel beside it would be a different control wearing the same label.
 *
 * The chevron turns over the same length the panel takes to grow (`motion.base`,
 * `Popover`), rather than flipping at the first frame while the list is still
 * opening: one press, one move.
 */
export function Select<T extends string | number>({
  value,
  options,
  onChange,
  label,
  testID,
  size = 'normal',
  shown,
  foot,
}: {
  value: T
  options: readonly SelectOption<T>[]
  onChange: (value: T) => void
  /** What is being chosen, e.g. "Sort by". Read out before the current value. */
  label: string
  testID?: string
  size?: 'normal' | 'small' | 'inline'
  /** What the button says, when it says more than the chosen option: "Recently added · newest". */
  shown?: string
  /**
   * Under the options, a control that goes with them — Library's way round
   * for its sort. Changing it leaves the list open.
   */
  foot?: ReactNode
}): ReactNode {
  const dense = useLayoutValue(layout => layout.dense)
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<View>(null)
  const turn = useFade(open, motion.base, motion.base)
  // Built once: the same rotation node for the life of the control.
  const chevron = useMemo(
    () => ({
      transform: [
        { rotate: turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] }) },
      ],
    }),
    [turn],
  )
  const current = options.find(option => option.value === value)

  const item = (option: SelectOption<T>): ReactNode => (
    <SheetItem
      key={String(option.value)}
      label={option.label}
      detail={option.hint}
      role="option"
      disabled={option.disabled}
      icon={
        <View style={styles.checkSlot}>
          {option.value === value ? <Check size={iconSize.field} tone="accent" /> : null}
        </View>
      }
      active={option.value === value}
      onPress={() => {
        onChange(option.value)
        setOpen(false)
      }}
    />
  )

  return (
    <>
      <Press
        ref={anchorRef}
        depth="control"
        style={({ pressed }) => [
          styles.control,
          size === 'normal' && dense && styles.controlDense,
          size === 'small' && styles.controlSmall,
          size === 'inline' && styles.controlInline,
          pressed && styles.controlPressed,
          // Open, the control stays lit.
          open && styles.fieldOpen,
        ]}
        // A toggle, not an open: the popover leaves a hole over this control
        // so that pressing it again reaches it, and what opened the list is
        // what a second press on it should close.
        onPress={() => setOpen(shown => !shown)}
        testID={testID}
        // This control is a combobox named by what is chosen, with the
        // current value as its content.
        accessibilityRole="combobox"
        accessibilityLabel={label}
        accessibilityValue={{ text: shown ?? current?.label ?? '' }}
        accessibilityState={{ expanded: open }}
      >
        <Text
          style={[
            styles.value,
            size === 'normal' && dense && styles.valueDense,
            size === 'small' && styles.valueSmall,
            size === 'inline' && styles.valueInline,
          ]}
          numberOfLines={1}
        >
          {shown ?? current?.label ?? label}
        </Text>
        <Animated.View style={chevron}>
          <ChevronDown
            size={size === 'normal' ? iconSize.button : iconSize.small}
            tone="textMuted"
          />
        </Animated.View>
      </Press>

      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={anchorRef}
        title={label}
        titleTone="label"
      >
        {options.map(item)}
        {foot ? <View style={styles.foot}>{foot}</View> : null}
      </Popover>
    </>
  )
}

const styles = StyleSheet.create(theme => ({
  control: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    minHeight: HIT_TARGET,
    paddingHorizontal: space.md,
    backgroundColor: theme.colors.surface2,
    borderRadius: radius.pill,
  },
  // Open, the control is a step lighter: tone, not an edge.
  fieldOpen: { backgroundColor: theme.colors.surface3 },
  /* With a mouse: 7 by 10, 13-point type. */
  controlDense: {
    minHeight: 36,
    paddingLeft: space.snug,
    paddingRight: 9,
  },
  /* `small`: 5 by 8, 12-point type. */
  controlSmall: {
    minHeight: 30,
    gap: space.tight,
    paddingLeft: space.sm,
    paddingRight: 7,
  },
  /* `inline`: part of a sentence, on a lighter ground. */
  controlInline: {
    minHeight: 0,
    gap: space.xs,
    paddingVertical: 2,
    paddingLeft: space.tight,
    paddingRight: space.xs,
    backgroundColor: theme.colors.surface3,
  },
  valueDense: {
    fontSize: type.sub,
  },
  valueSmall: {
    fontSize: type.small,
    fontWeight: '600',
  },
  valueInline: {
    fontSize: type.sub,
    fontWeight: '600',
  },
  controlPressed: {
    backgroundColor: theme.colors.surface3,
  },
  foot: { paddingHorizontal: space.sm, paddingTop: space.tight, paddingBottom: space.xs },
  /* Every option keeps the room, so the labels line up whether ticked or not. */
  checkSlot: { width: 14, alignItems: 'center' },
  value: {
    color: theme.colors.textPrimary,
    fontSize: type.body,
    flexShrink: 1,
  },
}))
