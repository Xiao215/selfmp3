import { memo } from 'react'
import type { ReactNode } from 'react'
import { Animated, Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useRouter, type Href } from 'expo-router'
import { motion, radius, space, type, iconSize } from '@selfmp3/client'
import { Button } from '../../ui/components/Button'
import { Check, ChevronRight, Sparkle } from '../../ui/components/Icons'
import { useFade } from '../../ui/motion'
import { useSaveUpNext } from '../lists/useSaveUpNext'
import { Press } from '../../ui/components/Press'

/**
 * The line over Up next's songs (docs/features/lists.md, D1): what they came
 * from, by its name now, and Save when it is not a playlist yet.
 *
 * The name opens what it names. Save is shown only when saving would make
 * something new — a tag or a playlist played as it is has none — and once
 * pressed it turns into "Saved" where it stood, so you can see it worked. In a
 * narrow rail the name gives way; the button never does.
 *
 * Given `summary`, it is the computer rail's one head line: "From night · 9
 * songs · 33 min", with `end` (Clear the rest) at its end and Save left to
 * the rail's head (`saves`).
 */
export const UpNextSource = memo(function UpNextSource({
  onOpen,
  go,
  summary,
  end,
  saves = true,
}: {
  onOpen?: () => void
  /** Follows the link instead of the router's push (`useQueueEdits`). */
  go?: (href: Href) => void
  /** How much is to come ("9 songs · 33 min"), said after the name on the same line. */
  summary?: string
  /** At the line's end. */
  end?: ReactNode
  /** Save on this line; the rail puts it in its head instead (`SaveUpNext`). */
  saves?: boolean
}): ReactNode {
  const { theme } = useUnistyles()
  const router = useRouter()
  const { line } = useSaveUpNext()
  const oneLine = summary !== undefined
  if (!line && !oneLine) return null

  const open = line?.link
    ? (): void => {
        onOpen?.()
        if (go) go(line.link as Href)
        else router.navigate(line.link as Href)
      }
    : undefined

  return (
    <View style={styles.row} testID="up-next-source">
      {line ? (
        <Press
          feedback="dim"
          onPress={open}
          disabled={!open}
          accessibilityRole={open ? 'link' : 'text'}
          accessibilityLabel={open ? `Open ${line.label}` : `Playing from ${line.label}`}
          style={[styles.name, oneLine && styles.nameFirst]}
        >
          {line.asked ? <Sparkle size={iconSize.small} /> : null}
          {oneLine ? <Text style={styles.from}>From</Text> : null}
          <Text
            style={[styles.label, oneLine && styles.labelNamed]}
            numberOfLines={1}
            testID="up-next-source-name"
          >
            {line.label}
          </Text>
          {open && !oneLine ? (
            <ChevronRight size={iconSize.small} color={theme.colors.textMuted} />
          ) : null}
        </Press>
      ) : null}
      {oneLine ? (
        <Text style={styles.summary} numberOfLines={1}>
          {line ? `· ${summary}` : summary}
        </Text>
      ) : null}
      {saves ? <SaveUpNext /> : null}
      {end ? <View style={styles.end}>{end}</View> : null}
    </View>
  )
})

/**
 * Save, when saving Up next would make something new, turning into "Saved"
 * where it stood once pressed.
 */
export function SaveUpNext(): ReactNode {
  const { theme } = useUnistyles()
  const { line, plan, saving, save } = useSaveUpNext()
  const saved = line?.saved === true
  const savedIn = useFade(saved, motion.base, motion.fast)
  return saved ? (
    <Animated.View style={[styles.saved, { opacity: savedIn }]} testID="up-next-saved">
      <Check size={iconSize.sub} color={theme.colors.good} />
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
  ) : null
}

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
    paddingVertical: space.xs,
    borderRadius: radius.pill,
  },
  label: {
    color: theme.colors.textSecondary,
    fontSize: type.sub,
    fontWeight: '500',
    flexShrink: 1,
  },
  from: { color: theme.colors.textMuted, fontSize: type.small },
  labelNamed: { color: theme.colors.textPrimary, fontSize: type.small, fontWeight: '600' },
  // On the one head line the name is what gives way last: the counts shrink first.
  nameFirst: { flexShrink: 0, maxWidth: '50%' },
  summary: {
    flexShrink: 1,
    minWidth: 0,
    color: theme.colors.textMuted,
    fontSize: type.small,
    fontVariant: ['tabular-nums'],
  },
  saved: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.sm,
  },
  end: { marginLeft: 'auto' },
  savedText: { color: theme.colors.good, fontSize: type.sub, fontWeight: '600' },
}))
