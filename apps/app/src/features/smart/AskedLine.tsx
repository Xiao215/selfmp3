import type { ReactNode } from 'react'
import { View, type StyleProp, type ViewStyle } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { coverSize, iconSize, radius } from '@selfmp3/client'
import { Sparkle } from '../../ui/components/Icons'
import { SongLine } from '../../ui/components/SongLine'
import { askedSub } from './askTurns.model'
import type { AskedThread } from './askThread.store'

/**
 * A conversation kept from earlier, as Recent lists it (E1): Ask's sparkle in
 * a round where a song line has its cover, the first question, and how many
 * were asked and when. Search's Recent and the palette's draw the same line.
 *
 * Given `onPress` it is pressable; without, it is the face alone, for the
 * palette, whose rows own their press and their highlight.
 */
export function AskedLine({
  thread,
  now,
  onPress,
  trailing,
  testID,
  style,
}: {
  thread: AskedThread
  now: Date
  onPress?: () => void
  trailing?: ReactNode
  testID?: string
  style?: StyleProp<ViewStyle>
}): ReactNode {
  const sub = askedSub(thread, now)
  return (
    <SongLine
      cover={
        <View style={styles.figure}>
          <Sparkle size={iconSize.item} />
        </View>
      }
      title={thread.asked}
      sub={sub}
      trailing={trailing}
      onPress={onPress}
      accessibilityLabel={`${thread.asked}, asked, ${sub}`}
      testID={testID}
      style={style}
    />
  )
}

const styles = StyleSheet.create(theme => ({
  figure: {
    width: coverSize.line,
    height: coverSize.line,
    borderRadius: radius.pill,
    backgroundColor: theme.colors.accentPill,
    alignItems: 'center',
    justifyContent: 'center',
  },
}))
