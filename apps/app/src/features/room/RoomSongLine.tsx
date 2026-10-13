import { useState } from 'react'
import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import type { Song } from '@selfmp3/shared'
import { space, type } from '@selfmp3/client'
import { roomTrack } from '../../player/roomTracks'
import { Button } from '../../ui/components/Button'
import { RoomFace } from './RoomFace'
import { entryOfTrack, memberOf, nameOf } from './room.model'
import { useRoom } from './room.store'
import { useGetSongs } from './useGetSongs'

/**
 * Under a room's song in Now Playing, where a library song has its tags
 * (mock R5): who brought it, and — when it is not yours — Get it, which has
 * your own server import it from the link it came from (G1).
 */
export function RoomSongLine({ song }: { song: Song }): ReactNode {
  const { state } = useRoom()
  const track = roomTrack(song.id)
  const entryId = state ? entryOfTrack(state, song.id) : null
  const entry = state?.entries.find(candidate => candidate.id === entryId)
  const by = state && entry ? memberOf(state, entry.addedBy) : undefined
  const owner = state && entry ? memberOf(state, entry.owner) : undefined
  const yours = track?.yours !== null && track?.yours !== undefined
  const source = entry?.song.sourceUrl ?? null
  const { reachable, get } = useGetSongs({ enabled: !yours && source !== null })
  const [asked, setAsked] = useState(false)
  if (!state || !entry) return null

  const getIt = async (): Promise<void> => {
    setAsked(true)
    if (!(await get([entry.song]))) setAsked(false)
  }

  const whose = owner && owner.id !== state.you ? owner : by
  const line = yours
    ? `${nameOf(state, by)} added it · in your library`
    : entry.from
      ? `${entry.from}’s, from a shared playlist · not in your library`
      : entry.song.link
        ? `${nameOf(state, by)} added it from a link`
        : whose?.id === state.you
          ? 'You brought this'
          : `${nameOf(state, whose)} brought this · not in your library`
  return (
    <View style={styles.line} testID="now-playing-room-line">
      {by ? <RoomFace name={by.name} colour={by.colour} picture={by.picture} size={22} /> : null}
      <Text style={styles.text} numberOfLines={1}>
        {line}
      </Text>
      {!yours && source && reachable && whose?.id !== state.you ? (
        <Button
          label={asked ? 'Getting' : 'Get it'}
          disabled={asked}
          onPress={() => void getIt()}
          testID="now-playing-get-it"
        />
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  line: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 36 },
  text: { flex: 1, minWidth: 0, color: theme.colors.textSecondary, fontSize: type.sub },
}))
