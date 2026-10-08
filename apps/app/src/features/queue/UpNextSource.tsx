import { memo } from 'react'
import type { ReactNode } from 'react'
import { Animated, Pressable, Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useRouter, type Href } from 'expo-router'
import { motion, radius, space, type } from '@selfmp3/client'
import { Button } from '../../ui/components/Button'
import { Check, ChevronRight, Sparkle } from '../../ui/components/Icons'
import { useFade } from '../../ui/motion'
import { useSaveUpNext } from '../lists/useSaveUpNext'

/**
 * The line over Up next's songs (docs/features/lists.md, D1): what they came
 * from, by its name now, and Save when it is not a playlist yet.
 *
 * The name opens what it names. Save is shown only when saving would make
 * something new — a tag or a playlist played as it is has none — and once
 * pressed it turns into "Saved" where it stood, so you can see it worked. In a
 * narrow rail the name gives way; the button never does.
 */
export const UpNextSource = memo(function UpNextSource({
  onOpen,
}: {
  onOpen?: () => void
}): ReactNode {
  const { theme } = useUnistyles()
  const router = useRouter()
  const { line, plan, saving, save } = useSaveUpNext()
  const saved = line?.saved === true
  const savedIn = useFade(saved, motion.base, motion.fast)
  if (!line) return null

  const open = line.link
    ? (): void => {
        onOpen?.()
        router.navigate(line.link as Href)
      }
    : undefined

  return (
    <View style={styles.row} testID="up-next-source">
      <Pressable
        onPress={open}
        disabled={!open}
        accessibilityRole={open ? 'link' : 'text'}
        accessibilityLabel={open ? `Open ${line.label}` : `Playing from ${line.label}`}
        style={({ pressed }) => [styles.name, pressed && styles.pressed]}
      >
        {line.asked ? <Sparkle size={12} /> : null}
        <Text style={styles.label} numberOfLines={1} testID="up-next-source-name">
          {line.label}
        </Text>
        {open ? <ChevronRight size={12} color={theme.colors.textMuted} /> : null}
      </Pressable>
      {saved ? (
        <Animated.View style={[styles.saved, { opacity: savedIn }]} testID="up-next-saved">
          <Check size={13} color={theme.colors.good} />
          <Text style={styles.savedText}>Saved</Text>
        </Animated.View>
      ) : plan ? (
        <View style={styles.end}>
          <Button
            label="Save"
            accessibilityLabel={`Save as a playlist: ${plan.name}`}
            busy={saving}
            onPress={save}
            testID="up-next-save"
          />
        </View>
      ) : null}
    </View>
  )
})

const styles = StyleSheet.create(theme => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 32,
  },
  name: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    flexShrink: 1,
    minWidth: 0,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  label: {
    color: theme.colors.textSecondary,
    fontSize: type.sub,
    fontWeight: '500',
    flexShrink: 1,
  },
  pressed: { opacity: 0.6 },
  saved: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: space.sm,
  },
  end: { marginLeft: 'auto' },
  savedText: { color: theme.colors.good, fontSize: type.sub, fontWeight: '600' },
}))
