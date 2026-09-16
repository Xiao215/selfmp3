import { useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Pressable, Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { HIT_TARGET, radius, space, type } from '@selfmp3/client'
import { useLayout } from '../../shell/useLayout'
import { useAccent } from '../accent'
import { Popover } from './Popover'
import { SheetItem } from './Sheet'
import { Check, ChevronDown } from './Icons'

interface SelectOption<T> {
  readonly value: T
  readonly label: string
  /** A quieter note beside the label, e.g. how sure a match is. */
  readonly hint?: string
  readonly disabled?: boolean
}

interface SelectGroup<T> {
  readonly label: string
  readonly options: readonly SelectOption<T>[]
}

/**
 * Choose one of a few things.
 *
 * A button showing the current value and a list of the rest, and a `Popover`,
 * so above the breakpoint the options appear beside the control and below it
 * they arrive as a sheet — decided by the primitive, not by the caller, which
 * is foundation 5.
 *
 * Options come flat, or in labelled groups (the smart-playlist field list:
 * Text, Tags, Numbers…). Three sizes: the ordinary control, `small` for a row
 * of them, and `inline` for one that sits inside a sentence ("Match all of
 * these rules").
 *
 * Not a native picker: the list is styled to match everything around it, and
 * an iOS wheel beside it would be a different control wearing the same label.
 */
export function Select<T extends string | number>({
  value,
  options,
  groups,
  onChange,
  label,
  testID,
  size = 'normal',
}: {
  value: T
  options?: readonly SelectOption<T>[]
  groups?: readonly SelectGroup<T>[]
  onChange: (value: T) => void
  /** What is being chosen, e.g. "Sort by". Read out before the current value. */
  label: string
  testID?: string
  size?: 'normal' | 'small' | 'inline'
}): ReactNode {
  const { theme } = useUnistyles()
  const accent = useAccent()
  const { dense } = useLayout()
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<View>(null)
  const all = groups ? groups.flatMap(group => group.options) : (options ?? [])
  const current = all.find(option => option.value === value)

  const item = (option: SelectOption<T>): ReactNode => (
    <SheetItem
      key={String(option.value)}
      label={option.label}
      detail={option.hint}
      role="option"
      disabled={option.disabled}
      icon={
        <View style={styles.checkSlot}>
          {option.value === value ? <Check size={14} color={accent.accent} /> : null}
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
      <Pressable
        ref={anchorRef}
        style={({ pressed }) => [
          styles.control,
          size === 'normal' && dense && styles.controlDense,
          size === 'small' && styles.controlSmall,
          size === 'inline' && styles.controlInline,
          pressed && styles.controlPressed,
          // Open, the control keeps an accent edge.
          open && { borderColor: accent.accent },
        ]}
        onPress={() => setOpen(true)}
        testID={testID}
        // This control is a combobox named by what is chosen, with the
        // current value as its content.
        accessibilityRole="combobox"
        accessibilityLabel={label}
        accessibilityValue={{ text: current?.label ?? '' }}
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
          {current?.label ?? label}
        </Text>
        <View style={open && styles.chevronOpen}>
          <ChevronDown size={size === 'normal' ? 15 : 12} color={theme.colors.textMuted} />
        </View>
      </Pressable>

      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={anchorRef}
        title={label}
        titleTone="label"
      >
        {groups
          ? groups.map((group, index) => (
              <View key={group.label}>
                <Text style={[styles.groupLabel, index > 0 && styles.groupDivided]}>
                  {group.label.toUpperCase()}
                </Text>
                {group.options.map(item)}
              </View>
            ))
          : all.map(item)}
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
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: radius.sm,
  },
  /* `.select-trigger` with a mouse: 7 by 10, 13-point type. */
  controlDense: {
    minHeight: 36,
    paddingLeft: 10,
    paddingRight: 9,
  },
  /* `.select-trigger-small`: 5 by 8, 12-point type. */
  controlSmall: {
    minHeight: 30,
    gap: 6,
    paddingLeft: space.sm,
    paddingRight: 7,
  },
  /* `.select-trigger-inline`: part of a sentence, on a lighter ground. */
  controlInline: {
    minHeight: 0,
    gap: 4,
    paddingVertical: 2,
    paddingLeft: 6,
    paddingRight: 4,
    backgroundColor: theme.colors.surface3,
  },
  valueDense: {
    fontSize: 13,
  },
  valueSmall: {
    fontSize: 12,
    fontWeight: '600',
  },
  valueInline: {
    fontSize: 13,
    fontWeight: '600',
  },
  controlPressed: {
    backgroundColor: theme.colors.surface3,
  },
  chevronOpen: { transform: [{ rotate: '180deg' }] },
  /* Every option keeps the room, so the labels line up whether ticked or not. */
  checkSlot: { width: 14, alignItems: 'center' },
  value: {
    color: theme.colors.textPrimary,
    fontSize: type.body,
    flexShrink: 1,
  },
  groupLabel: {
    color: theme.colors.textMuted,
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.7,
    paddingTop: 6,
    paddingHorizontal: 10,
    paddingBottom: 4,
  },
  groupDivided: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    marginTop: 4,
    paddingTop: 9,
  },
}))
