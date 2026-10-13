import type { ReactNode } from 'react'
import { View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { useRouter } from 'expo-router'
import { artistOr, plural, type AskAnswer } from '@selfmp3/shared'
import { space } from '@selfmp3/client'
import { Button } from '../../ui/components/Button'
import { SongLine } from '../../ui/components/SongLine'
import { AnswerHead, AnswerNote } from './AnswerParts'

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
      <AnswerHead>
        {albums ? 'Albums on 网易云' : 'Songs on 网易云'} for “{answer.words}”
      </AnswerHead>
      {answer.items.map(item => (
        <SongLine
          key={item.url}
          style={styles.row}
          artUri={item.cover}
          title={item.title}
          sub={`${artistOr(item.artist)} · ${haveText(item)}`}
          trailing={
            <Button
              label={item.have >= item.tracks && item.tracks > 0 ? 'Open' : 'Import'}
              variant={item.have >= item.tracks && item.tracks > 0 ? 'secondary' : 'primary'}
              onPress={() => open(item.url)}
              testID="ask-get-music-open"
            />
          }
        />
      ))}
      <AnswerNote>Import shows what each one holds before anything is downloaded.</AnswerNote>
    </View>
  )
}

function haveText(item: { kind: 'album' | 'song'; tracks: number; have: number }): string {
  if (item.kind === 'song') return item.have > 0 ? 'You have it' : 'Not in your library'
  if (item.have === 0) return plural(item.tracks, 'song', 'songs')
  if (item.have >= item.tracks) return `${plural(item.tracks, 'song', 'songs')} · you have them all`
  return `${plural(item.tracks, 'song', 'songs')} · you have ${item.have}`
}

const styles = StyleSheet.create({
  body: { gap: space.sm },
  row: { paddingHorizontal: 0 },
})
