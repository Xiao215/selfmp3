import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { useRouter } from 'expo-router'
import { plural, type AskAnswer } from '@selfmp3/shared'
import { radius, space } from '@selfmp3/client'
import { Button } from '../../ui/components/Button'
import { Cover } from '../../ui/components/Cover'

/**
 * Music to import (docs/features/ai.md, "Getting music"): what 网易云 lists
 * for what you asked, each with how much of it you have. Import opens with
 * the one you choose, and its review shows the songs you have and finds a
 * song 网易云 only previews on YouTube instead.
 */
export function GetMusicAnswer({
  answer,
  onDone,
}: {
  answer: Extract<AskAnswer, { kind: 'getMusic' }>
  onDone: () => void
}): ReactNode {
  const router = useRouter()
  const open = (url: string): void => {
    onDone()
    router.navigate({ pathname: '/import', params: { url } })
  }
  const albums = answer.items.every(item => item.kind === 'album')

  return (
    <View style={styles.body} testID="ask-get-music">
      <Text style={styles.head}>
        {albums ? 'Albums on 网易云' : 'Songs on 网易云'} for “{answer.words}”
      </Text>
      {answer.items.map(item => (
        <View key={item.url} style={styles.row}>
          <Cover uri={item.cover} title={item.title} size={44} />
          <View style={styles.text}>
            <Text style={styles.title} numberOfLines={2}>
              {item.title}
              <Text style={styles.muted}> · {item.artist || 'Unknown artist'}</Text>
            </Text>
            <Text style={styles.meta} numberOfLines={1}>
              {haveText(item)}
            </Text>
          </View>
          <Button
            label={item.have >= item.tracks && item.tracks > 0 ? 'Open' : 'Import'}
            variant={item.have >= item.tracks && item.tracks > 0 ? 'secondary' : 'primary'}
            onPress={() => open(item.url)}
            testID="ask-get-music-open"
          />
        </View>
      ))}
      <Text style={styles.note}>
        Import shows what each one holds before anything is downloaded.
      </Text>
    </View>
  )
}

function haveText(item: { kind: 'album' | 'song'; tracks: number; have: number }): string {
  if (item.kind === 'song') return item.have > 0 ? 'You have it' : 'Not in your library'
  if (item.have === 0) return plural(item.tracks, 'song', 'songs')
  if (item.have >= item.tracks) return `${plural(item.tracks, 'song', 'songs')} · you have them all`
  return `${plural(item.tracks, 'song', 'songs')} · you have ${item.have}`
}

const styles = StyleSheet.create(theme => ({
  body: { gap: space.sm },
  head: { color: theme.colors.textPrimary, fontSize: 15.5, fontWeight: '600' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 5,
    paddingHorizontal: space.xs,
    borderRadius: radius.coverSm,
  },
  text: { flex: 1, minWidth: 0, gap: 2 },
  title: { color: theme.colors.textPrimary, fontSize: 13.5, fontWeight: '500' },
  muted: { color: theme.colors.textMuted, fontWeight: '400' },
  meta: { color: theme.colors.textMuted, fontSize: 12 },
  note: { color: theme.colors.textMuted, fontSize: 12, lineHeight: 17 },
}))
