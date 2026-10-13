import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import type { Href } from 'expo-router'
import { space } from '@selfmp3/client'
import { useLayoutValue } from '../../shell/useLayout'
import { pageFrame, pageTitle, bodyText } from '../surfaces'
import { BackButton } from './BackButton'
import { Button } from './Button'
import { SafeAreaView } from './SafeAreaView'

/**
 * A page whose address names something that is not there: a tag renamed since
 * the link was made, a song removed, an answer forgotten, a room that ended.
 *
 * One page for all of them, so each says it the same way — the way back where
 * every page has it, the name of what is missing as the page's title, one
 * line on why, and the one place worth going instead. Each had built its own:
 * two faces for the title, a header role on some and not others, a way back
 * on two, and a room code that was not one had no way out at all.
 *
 * `back` is where the ‹ falls back to with nothing behind it; `action` is the
 * button under the line, which most of them want because a link from
 * outside has nothing behind it.
 */
export function MissingPage({
  title,
  line,
  back,
  action,
  testID,
}: {
  title: string
  line?: string
  back?: Href
  action?: { label: string; onPress: () => void; testID?: string }
  testID?: string
}): ReactNode {
  const wide = useLayoutValue(layout => layout.wide)
  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={[styles.body, pageFrame(wide)]} testID={testID}>
        {back === undefined ? null : <BackButton to={back} />}
        <Text style={styles.title} accessibilityRole="header">
          {title}
        </Text>
        {line ? <Text style={styles.line}>{line}</Text> : null}
        {action ? (
          <Button label={action.label} onPress={action.onPress} testID={action.testID} />
        ) : null}
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create(theme => ({
  screen: { flex: 1, backgroundColor: theme.colors.surface0 },
  body: { gap: space.md, alignItems: 'flex-start' },
  title: pageTitle(theme.colors),
  line: {
    ...bodyText(theme.colors),
    maxWidth: 460,
  },
}))
