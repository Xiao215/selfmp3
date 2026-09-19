import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { useRouter } from 'expo-router'
import { Button } from '../../ui/components/Button'
import { SafeAreaView } from '../../ui/components/SafeAreaView'
import { pageTitle } from '../../ui/surfaces'

/**
 * A tag or an artist the address names and the library does not hold: a tag
 * renamed or deleted since the link was made, an artist whose songs are gone.
 */
export function PlaceMissing({ kind, name }: { kind: 'tag' | 'artist'; name: string }): ReactNode {
  const router = useRouter()
  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.body} testID="place-missing">
        <Text style={styles.title} accessibilityRole="header">
          {kind === 'tag' ? 'No such tag' : 'No such artist'}
        </Text>
        <Text style={styles.text}>
          {kind === 'tag'
            ? `Nothing here is tagged “${name}”. It may have been renamed or deleted.`
            : `No song here is by “${name}”.`}
        </Text>
        <Button
          label={kind === 'tag' ? 'All tags' : 'Home'}
          onPress={() => router.replace(kind === 'tag' ? '/tags' : '/')}
        />
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create(theme => ({
  screen: { flex: 1, backgroundColor: theme.colors.surface0 },
  body: { padding: 24, gap: 12, alignItems: 'flex-start' },
  title: pageTitle(theme.colors),
  text: { color: theme.colors.textSecondary, fontSize: 15, lineHeight: 22 },
}))
