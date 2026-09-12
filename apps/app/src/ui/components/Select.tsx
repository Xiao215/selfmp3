import { useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { colors, HIT_TARGET, radius, space, type } from '@selfmp3/client'
import { Popover } from './Popover'
import { SheetItem } from './Sheet'
import { ChevronDown } from './Icons'

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
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<View>(null)
  const current = options.find(option => option.value === value)

  return (
    <>
      <Pressable
        ref={anchorRef}
        style={({ pressed }) => [styles.control, pressed && styles.controlPressed]}
        onPress={() => setOpen(true)}
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={`${label} ${current?.label ?? ''}`.trim()}
        accessibilityState={{ expanded: open }}
      >
        <Text style={styles.value} numberOfLines={1}>
          {current?.label ?? label}
        </Text>
        <ChevronDown size={15} color={colors.textMuted} />
      </Pressable>

      <Popover open={open} onClose={() => setOpen(false)} anchorRef={anchorRef} title={label}>
        {options.map(option => (
          <SheetItem
            key={option.value}
            label={option.label}
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
  value: {
    color: colors.textPrimary,
    fontSize: type.body,
    flexShrink: 1,
  },
})
