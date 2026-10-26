import { useContext, useRef } from 'react'
import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useRouter } from 'expo-router'
import { formatLongDuration, plural, type AskAnswer } from '@selfmp3/shared'
import { radius, space, type, iconSize } from '@selfmp3/client'
import { usePlayerCommands } from '../../player/PlayerProvider'
import { Button, PlayButton } from '../../ui/components/Button'
import { ChevronRight, Play } from '../../ui/components/Icons'
import { SONG_ACTION_LABELS } from '../../ui/songActions.model'
import { useAccent } from '../../ui/accent'
import { useSongsById } from '../../ui/songsById'
import { PlaylistCover } from '../playlists/PlaylistCover'
import { addSongsToRoom } from '../room/addSongsToRoom'
import { AddingToRoom } from '../room/RoomPicks'
import type { ListSource } from '../lists/lists.model'
import { useFlyToUpNext } from '../queue/useFlyToUpNext'
import { keepAnswer, useKeptAnswer } from './answers.store'
import { ListBeside } from './listBeside'
import { answerSongs } from './smart.model'
import { useSmartServer } from './useSmartServer'
import { Press } from '../../ui/components/Press'
import { rowTitle, textColumn, lineSub } from '../../ui/surfaces'

/**
 * Ask's answer when it is songs, in its thread (docs/features/lists.md, C1):
 * one card. ▶ plays it straight away — Up next wears the question as its
 * name, and Save is there once you know you like it. The card itself opens the
 * list to look before listening: beside the thread on a computer (A2,
 * 2026-10-26), where the open one wears the accent, and as a page on a phone.
 * An answer about what plays after this song (A8) leads with Play next
 * instead. Asked while Search is adding to a room (A2), it adds them to the room.
 */
export function SongsAnswerCard({
  answer,
  text,
  onPlayed,
  onOpen,
}: {
  answer: Extract<AskAnswer, { kind: 'songs' }>
  text: string
  /** After Play or Play next: Search has done its job. */
  onPlayed: () => void
  /** Before the answer's page opens. */
  onOpen: () => void
}): ReactNode {
  const { theme } = useUnistyles()
  const accent = useAccent()
  const router = useRouter()
  const server = useSmartServer()
  const player = usePlayerCommands()
  const fly = useFlyToUpNext()
  const coverRef = useRef<View>(null)
  const known = useSongsById()
  // Kept from the first, so a change made here (`ChangeIt`) is the answer shown.
  const id = keepAnswer(text, answer.describe)
  const kept = useKeptAnswer(id)
  const result = kept?.result ?? answer.describe
  const songs = answerSongs(result, kept?.order ?? null, server.onDevice, known)
  const ids = songs.map(song => song.id)
  const seconds = songs.reduce((sum, song) => sum + song.duration, 0)
  const next = answer.lead === 'next'
  const room = useContext(AddingToRoom)
  const beside = useContext(ListBeside)

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
    if (beside) return beside.show(id)
    onOpen()
    router.push({ pathname: '/answer', params: { id } })
  }

  // The card opens the list and the button plays: siblings, since a button
  // cannot hold another one. Ask's field changes it (B1).
  return (
    <View style={[styles.card, beside?.open === id && { borderColor: accent.accent }]}>
      <Press
        feedback="dim"
        onPress={open}
        accessibilityRole="button"
        accessibilityLabel={`Open the ${plural(ids.length, 'song', 'songs')} picked for “${text}”`}
        style={styles.opens}
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
        <ChevronRight size={iconSize.field} color={theme.colors.textMuted} />
      </Press>
      {room ? (
        <Button
          label={`Add to ${room.title}`}
          variant="primary"
          onPress={() => void addSongsToRoom(ids, room.title).then(onPlayed)}
          testID="songs-answer-room"
        />
      ) : next ? (
        // Asked what plays after this song, it plays them next, and says so:
        // "Add to Up next" puts songs at the end everywhere else (T-383).
        <Button
          label={SONG_ACTION_LABELS.playNext}
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
          icon={<Play color={theme.colors.onPrimary} />}
          onPress={() => {
            fly(coverRef.current, ids)
            player.playFrom(ids, 0, { source, whole: true })
            onPlayed()
          }}
          testID="songs-answer-play"
        />
      )}
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
    // Kept, so the card does not move when it is the list open beside the thread.
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  opens: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: space.md },
  text: textColumn,
  title: rowTitle(theme.colors),
  meta: { color: theme.colors.textMuted, fontSize: type.small },
  line: lineSub(theme.colors),
}))
