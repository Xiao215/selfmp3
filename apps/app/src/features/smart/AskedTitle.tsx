import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { iconSize, tracking } from '@selfmp3/client'
import { Sparkle } from '../../ui/components/Icons'
import { listHeadText } from '../../ui/components/ListHead'
import { headroom, nameTitle, serif } from '../../ui/surfaces'

/**
 * What was asked, as the title of Ask's stage (R1, 2026-10-26): in the serif,
 * as a person's name tops their page, a step down for a longer question and
 * another for a long one, so a sentence still fits where a word would.
 */
export function AskedTitle({
  asked,
  center = false,
  testID,
}: {
  asked: string
  center?: boolean
  testID?: string
}): ReactNode {
  const step = asked.length <= 40 ? styles.short : asked.length <= 120 ? styles.long : styles.longer
  return (
    <Text
      style={[step, center && styles.center]}
      accessibilityRole="header"
      selectable
      testID={testID}
    >
      {asked}
    </Text>
  )
}

/** The line over the title: "Asking" while it works, "You asked" once it is answered. */
export function AskedLabel({ label }: { label: string }): ReactNode {
  return (
    <View style={listHeadText.kind}>
      <Sparkle size={iconSize.tiny} />
      <Text style={listHeadText.kindText}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  short: nameTitle(theme.colors),
  long: { ...serif(theme.colors, 'page'), ...headroom('page'), letterSpacing: tracking.serif },
  longer: { ...serif(theme.colors, 'large'), ...headroom('large') },
  center: { textAlign: 'center' },
}))
