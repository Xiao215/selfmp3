import { useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { colors, HIT_TARGET, radius, space, type } from '@selfmp3/client'
import { useAccent } from '../accent'
import { Popover } from './Popover'
import { SheetItem } from './Sheet'
import { Check, ChevronDown } from './Icons'

/**
 * Choose one of a few things.
 *
 * The web app's `Select`, which is a button showing the current value and a
 * list of the rest. Here it is that button and a `Popover`, so above the
 * breakpoint the options appear beside the control and below it they arrive as
 * a sheet — decided by the primitive, not by the caller, which is foundation 5.
 *
 * Not a native picker: the web app's list is styled to match everything around
 * it, and an iOS wheel beside it would be a different control wearing the same
 * label.
 */
export function Select<T extends string>({
  value,
  options,
  onChange,
  label,
  testID,
}: {
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (value: T) => void
  /** What is being chosen, e.g. "Sort by". Read out before the current value. */
  label: string
  testID?: string
}): ReactNode {
  const accent = useAccent()
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<View>(null)
  const current = options.find(option => option.value === value)

  return (
    <>
      <Pressable
        ref={anchorRef}
        style={({ pressed }) => [
          styles.control,
          pressed && styles.controlPressed,
          // Open, the control keeps the accent edge the web gives it.
          open && { borderColor: accent.accent },
        ]}
        onPress={() => setOpen(true)}
        testID={testID}
        // The web's control is a combobox named by what is chosen, with the
        // current value as its content.
        accessibilityRole="combobox"
        accessibilityLabel={label}
        accessibilityValue={{ text: current?.label ?? '' }}
        accessibilityState={{ expanded: open }}
      >
        <Text style={styles.value} numberOfLines={1}>
          {current?.label ?? label}
        </Text>
        <View style={open && styles.chevronOpen}>
          <ChevronDown size={15} color={colors.textMuted} />
        </View>
      </Pressable>

      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={anchorRef}
        title={label}
        titleTone="label"
      >
        {options.map(option => (
          <SheetItem
            key={option.value}
            label={option.label}
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
        ))}
      </Popover>
    </>
  )
}

const styles = StyleSheet.create({
  control: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    minHeight: HIT_TARGET,
    paddingHorizontal: space.md,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
  },
  controlPressed: {
    backgroundColor: colors.surface3,
  },
  chevronOpen: { transform: [{ rotate: '180deg' }] },
  /* Every option keeps the room, so the labels line up whether ticked or not. */
  checkSlot: { width: 14, alignItems: 'center' },
  value: {
    color: colors.textPrimary,
    fontSize: type.body,
    flexShrink: 1,
  },
})
