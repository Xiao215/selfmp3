import { useRef } from 'react'
import type { ReactNode } from 'react'
import { Pressable, Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useRouter } from 'expo-router'
import { formatLongDuration, plural, type AskAnswer } from '@selfmp3/shared'
import { radius, space } from '@selfmp3/client'
import { usePlayer } from '../../player/PlayerProvider'
import { Button, PlayButton } from '../../ui/components/Button'
import { ChevronRight, Play } from '../../ui/components/Icons'
import { useSongsById } from '../../ui/songsById'
import { PlaylistCover } from '../playlists/PlaylistCover'
import type { ListSource } from '../lists/lists.model'
import { useFlyToUpNext } from '../queue/useFlyToUpNext'
import { keepAnswer, useKeptAnswer } from './answers.store'
import { ChangeIt } from './ChangeIt'
import { picksHere } from './smart.model'
import { useSmartServer } from './useSmartServer'

/**
 * Ask's answer when it is songs, as it sits in Search (docs/features/lists.md,
 * C1): one card. ▶ plays it straight away — Up next wears the question as its
 * name, and Save is there once you know you like it. The card itself opens the
 * answer as a page, to look before listening. An answer about what plays
 * after this song (A8) leads with Add to Up next instead.
 */
export function SongsAnswerCard({
  answer,
  text,
  onPlayed,
  onOpen,
}: {
  answer: Extract<AskAnswer, { kind: 'songs' }>
  text: string
  /** After Play or Add to Up next: Search has done its job. */
  onPlayed: () => void
  /** Before the answer's page opens. */
  onOpen: () => void
}): ReactNode {
  const { theme } = useUnistyles()
  const router = useRouter()
  const server = useSmartServer()
  const player = usePlayer()
  const fly = useFlyToUpNext()
  const coverRef = useRef<View>(null)
  const known = useSongsById()
  // Kept from the first, so a change made here (`ChangeIt`) is the answer shown.
  const id = keepAnswer(text, answer.describe)
  const kept = useKeptAnswer(id)
  const result = kept?.result ?? answer.describe
  const picked = picksHere(result, server.onDevice)
    .map(pick => pick.songId)
    .filter(each => known.has(each))
  const order = kept?.order
  const ids = order ? order.filter(each => picked.includes(each)) : picked
  const seconds = ids.reduce((sum, id) => sum + (known.get(id)?.duration ?? 0), 0)
  const next = answer.lead === 'next'

  if (ids.length === 0) {
    return <Text style={styles.line}>No song of yours fits that. Try other words for it.</Text>
  }

  const source: ListSource = {
    kind: 'answer',
    text,
    name: result.understanding.name,
    answerId: id,
  }
  const open = (): void => {
    onOpen()
    router.push({ pathname: '/answer', params: { id } })
  }

  // The card opens the page and the button plays: siblings, since a button
  // cannot hold another one. Under it, the answer can be changed in words.
  return (
    <View style={styles.stack}>
      <View style={styles.card}>
        <Pressable
          onPress={open}
          accessibilityRole="button"
          accessibilityLabel={`Open the ${plural(ids.length, 'song', 'songs')} picked for “${text}”`}
          style={({ pressed }) => [styles.opens, pressed && styles.pressed]}
          testID="songs-answer-card"
        >
          <View ref={coverRef} collapsable={false}>
            <PlaylistCover songIds={ids} size={56} />
          </View>
          <View style={styles.text}>
            <Text style={styles.title} numberOfLines={1}>
              {next ? 'Up next' : result.understanding.name}
            </Text>
            <Text style={styles.meta} numberOfLines={1}>
              {plural(ids.length, 'song', 'songs')} · {formatLongDuration(seconds)}
            </Text>
          </View>
          <ChevronRight size={14} color={theme.colors.textMuted} />
        </Pressable>
        {next ? (
          <Button
            label="Add to Up next"
            variant="primary"
            onPress={() => {
              fly(coverRef.current, ids)
              player.playNext(ids)
              onPlayed()
            }}
            testID="songs-answer-next"
          />
        ) : (
          <PlayButton
            label={`Play the songs picked for “${text}”`}
            size={40}
            icon={<Play size={16} color={theme.colors.onPrimary} />}
            onPress={() => {
              fly(coverRef.current, ids)
              player.playFrom(ids, 0, { source })
              onPlayed()
            }}
            testID="songs-answer-play"
          />
        )}
      </View>
      <ChangeIt answerId={id} />
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  stack: { gap: space.sm },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.sm,
    borderRadius: radius.card,
    backgroundColor: theme.colors.surface2,
  },
  opens: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: space.md },
  pressed: { opacity: 0.8 },
  text: { flex: 1, minWidth: 0, gap: 2 },
  title: { color: theme.colors.textPrimary, fontSize: 15, fontWeight: '600' },
  meta: { color: theme.colors.textMuted, fontSize: 12.5 },
  line: { color: theme.colors.textSecondary, fontSize: 13.5, lineHeight: 19 },
}))
