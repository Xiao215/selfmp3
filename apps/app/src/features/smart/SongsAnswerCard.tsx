import { useContext, useRef } from 'react'
import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useRouter } from 'expo-router'
import { formatLongDuration, plural, type AskCard } from '@selfmp3/shared'
import { radius, space, type, iconSize } from '@selfmp3/client'
import { usePlayerCommands } from '../../player/PlayerProvider'
import { Button, PlayButton } from '../../ui/components/Button'
import { ChevronRight, Play } from '../../ui/components/Icons'
import { SONG_ACTION_LABELS } from '../../ui/songActions.model'
import { useSongsById } from '../../ui/songsById'
import { PlaylistCover } from '../playlists/PlaylistCover'
import { addSongsToRoom } from '../room/addSongsToRoom'
import { AddingToRoom } from '../room/RoomPicks'
import type { ListSource } from '../lists/lists.model'
import { useFlyToUpNext } from '../queue/useFlyToUpNext'
import { keepAnswer, useKeptAnswer } from './answers.store'
import { listChange } from './askTurns.model'
import { answerSongs, describeNotes } from './smart.model'
import { useSmartServer } from './useSmartServer'
import { usePlayAsItComes, useSaveAnswer } from './useAnswerLead'
import { Press } from '../../ui/components/Press'
import { rowTitle, textColumn, lineSub } from '../../ui/surfaces'

/** The earlier list a list was made from (`AskReply.from`): its name and songs, by the server's id. */
export interface ChangedFrom {
  readonly label: string
  readonly songIds: readonly number[]
}

/**
 * Ask's answer when it is songs, in its conversation (docs/features/lists.md,
 * C1): one card. ▶ plays it straight away — Up next wears the question as its
 * name, and Save is there once you know you like it. The card itself opens the
 * list, to look before listening: beside the conversation on a computer, lit
 * while it is the one open there, and as a page of its own on a phone
 * (`onOpenHere`). An answer about what plays after this song (A8) leads with
 * Play next instead. Asked while Search is adding to a room (A2), it adds them
 * to the room.
 *
 * It does what the words led with: the reply's first list asked to play plays
 * as it comes (`playNow`), and one asked to keep leads with Save. Made from an
 * earlier list ("less anime"), it says how many songs went and came, so each
 * card stays the list as it was at that point of the conversation.
 */
export function SongsAnswerCard({
  answer,
  text,
  onPlayed,
  playNow = false,
  onOpenHere,
  openId = null,
  changedFrom = null,
}: {
  answer: Extract<AskCard, { kind: 'songs' }>
  text: string
  /** After Play or Play next: Search has done its job. */
  onPlayed: () => void
  /** Played as it comes: the first list of a reply asked to play. */
  playNow?: boolean
  /** Opens its list beside the reply's cards, instead of as a page. */
  onOpenHere?: (keptId: string) => void
  /** The list open beside the conversation: this card is lit when it is this one. */
  openId?: string | null
  /** The earlier list this one was made from: the card says what went and came. */
  changedFrom?: ChangedFrom | null
}): ReactNode {
  const { theme } = useUnistyles()
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
  usePlayAsItComes(id, ids, playNow && !room)
  const { save, saving, saved } = useSaveAnswer(result, ids)
  const isOpen = openId === id
  // Counted on the server's ids, as the earlier list was told.
  const change = changedFrom
    ? listChange(
        changedFrom.songIds,
        songs.flatMap(song => server.onServer(song.id) ?? []),
      )
    : null

  if (ids.length === 0) {
    // Why there are none, when the answer says: a name it lacks, the songs
    // that fit and none suited, or picks not on this device yet.
    const why = describeNotes(result, 0).slice(1)
    return (
      <Text style={styles.line} testID="songs-answer-none">
        {why.length > 0 ? why.join(' ') : 'No song of yours fits that. Try other words for it.'}
      </Text>
    )
  }

  const source: ListSource = {
    kind: 'answer',
    text,
    name: result.understanding.name,
    answerId: id,
  }
  const open = (): void => {
    if (onOpenHere) return onOpenHere(id)
    router.push({ pathname: '/answer', params: { id } })
  }

  // The card opens the list and the button plays: siblings, since a button
  // cannot hold another one. Ask's field changes it (B1).
  return (
    <View style={[styles.card, isOpen && styles.cardOpen]}>
      <Press
        feedback="dim"
        onPress={open}
        accessibilityRole="button"
        accessibilityState={onOpenHere ? { selected: isOpen } : undefined}
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
          {change && changedFrom ? (
            <Text style={styles.meta} numberOfLines={1} testID="songs-answer-change">
              {change.removed > 0 ? <Text style={styles.removed}>−{change.removed}</Text> : null}
              {change.removed > 0 && change.added > 0 ? ' · ' : null}
              {change.added > 0 ? <Text style={styles.added}>+{change.added}</Text> : null}
              {` from “${changedFrom.label}”`}
            </Text>
          ) : null}
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
      ) : answer.lead === 'save' ? (
        // Asked to keep: the one Save, of exactly these songs, by the list's name.
        <Button
          label={saved !== null ? 'Saved' : saving ? 'Saving…' : 'Save'}
          accessibilityLabel={`Save as “${result.understanding.name}”`}
          variant="primary"
          disabled={saving || saved !== null}
          onPress={() => void save()}
          testID="songs-answer-save"
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
  },
  // Open beside the cards: lit as the log's line for the answer shown is.
  cardOpen: { backgroundColor: theme.colors.accentPill },
  opens: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: space.md },
  text: textColumn,
  title: rowTitle(theme.colors),
  meta: { color: theme.colors.textMuted, fontSize: type.small },
  removed: { color: theme.colors.danger },
  added: { color: theme.colors.good },
  line: lineSub(theme.colors),
}))
