import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useRouter } from 'expo-router'
import { plural, type AskCard } from '@selfmp3/shared'
import { iconSize, radius, space, type } from '@selfmp3/client'
import { Button } from '../../ui/components/Button'
import { ChevronRight, People } from '../../ui/components/Icons'
import { Press } from '../../ui/components/Press'
import { rowTitle, textColumn, lineSub } from '../../ui/surfaces'
import { useSongsById } from '../../ui/songsById'
import { PlaylistCover } from '../playlists/PlaylistCover'
import { keepAnswer, useKeptAnswer } from '../smart/answers.store'
import { answerSongs } from '../smart/smart.model'
import { useSmartServer } from '../smart/useSmartServer'
import { addSongsToRoom } from './addSongsToRoom'
import { roomTitle, youMay } from './room.model'
import { useRoom } from './room.store'
import { openRoomSheet } from './roomSheets.store'

/**
 * Ask's answer for listening with friends (docs/features/ai.md): out of a
 * room, Start a room — with the songs the words asked for, or empty — which
 * opens Together to start it from, so nothing starts without your press; in a
 * room, the songs added to it, or the room's sheet. Only the device knows
 * whether it is in a room, so the answer is drawn from that.
 */
export function TogetherAnswer({
  answer,
  text,
  onDone,
  onOpen,
}: {
  answer: Extract<AskCard, { kind: 'together' }>
  text: string
  /** Search has done its job: the sheet opens over the page underneath. */
  onDone: () => void
  /** Before the answer's page opens. */
  onOpen: () => void
}): ReactNode {
  const { theme } = useUnistyles()
  const router = useRouter()
  const server = useSmartServer()
  const known = useSongsById()
  const { state } = useRoom()
  // Kept as Ask's songs answers are, so the card opens the same answer page.
  const id = answer.describe ? keepAnswer(text, answer.describe) : null
  const kept = useKeptAnswer(id ?? undefined)
  const result = kept?.result ?? answer.describe
  const ids = result
    ? answerSongs(result, kept?.order ?? null, server.onDevice, known).map(song => song.id)
    : []
  const name = result?.understanding.name ?? 'Ask'

  if (result && ids.length === 0) {
    return <Text style={styles.line}>No song of yours fits that. Try other words for it.</Text>
  }

  const go = (): void => {
    onDone()
    if (state) {
      if (ids.length > 0) void addSongsToRoom(ids, roomTitle(state))
      else openRoomSheet()
    } else if (ids.length > 0) openRoomSheet({ kind: 'songs', name, songIds: ids })
    else openRoomSheet({ kind: 'empty' })
  }
  const label = state
    ? ids.length > 0
      ? `Add to ${roomTitle(state)}`
      : 'Open the room'
    : 'Start a room'
  const canAdd = !state || ids.length === 0 || youMay(state, 'add')

  return (
    <View style={styles.card} testID="together-answer">
      {id && ids.length > 0 ? (
        <Press
          feedback="dim"
          onPress={() => {
            onOpen()
            router.push({ pathname: '/answer', params: { id } })
          }}
          accessibilityRole="button"
          accessibilityLabel={`Open the ${plural(ids.length, 'song', 'songs')} picked for “${text}”`}
          style={styles.opens}
        >
          <PlaylistCover songIds={ids} size={56} />
          <View style={styles.text}>
            <Text style={styles.title} numberOfLines={1}>
              {name}
            </Text>
            <Text style={styles.meta} numberOfLines={1}>
              {plural(ids.length, 'song', 'songs')}
            </Text>
          </View>
          <ChevronRight size={iconSize.field} color={theme.colors.textMuted} />
        </Press>
      ) : (
        <View style={styles.opens}>
          <View style={styles.mark}>
            <People size={iconSize.nav} color={theme.colors.textPrimary} />
          </View>
          <Text style={[styles.title, styles.text]} numberOfLines={2}>
            {state ? roomTitle(state) : 'Listen together'}
          </Text>
        </View>
      )}
      {canAdd ? (
        <Button label={label} variant="primary" onPress={go} testID="together-answer-go" />
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.sm,
    borderRadius: radius.card,
    backgroundColor: theme.colors.surface2,
  },
  opens: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: space.md },
  mark: {
    width: 56,
    height: 56,
    borderRadius: radius.cover,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface3,
  },
  text: textColumn,
  title: rowTitle(theme.colors),
  meta: { color: theme.colors.textMuted, fontSize: type.small },
  line: lineSub(theme.colors),
}))
