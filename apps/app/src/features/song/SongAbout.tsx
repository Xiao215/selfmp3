import { useState } from 'react'
import type { ReactNode } from 'react'
import { View } from 'react-native'
import type { StyleProp, ViewStyle } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import type { Song } from '@selfmp3/shared'
import { isRoomTrackId } from '@selfmp3/client'
import { Button } from '../../ui/components/Button'
import { Sparkles } from '../../ui/components/Icons'
import { FixMetadata } from '../metadata/FixMetadata'
import { SongFacts, SoundStrip } from './SongFacts'
import { SONG_ACTION_LABELS } from '../../ui/songActions.model'

/**
 * What the app knows about a song — how it sounds, then one quiet line about
 * the file — with "Fix song info…" beside the facts it fixes: the end of the
 * song's own page, and the Details tab of a computer's Now Playing. The song's
 * page draws the Sound strip higher up itself (`sound={false}`). The tab was the page's block pasted across, and a rename of
 * the button had to be made in both.
 *
 * A friend's song in a room is not in your library, so there is nothing of
 * yours to fix.
 */
export function SongAbout({
  song,
  plays,
  sound = true,
  testID,
  style,
}: {
  song: Song
  /** The play count among the facts; the song's page says it in a sentence of its own. */
  plays: boolean
  /** The Sound strip first: the page that has it higher up leaves it out. */
  sound?: boolean
  testID?: string
  style?: StyleProp<ViewStyle>
}): ReactNode {
  const [fixing, setFixing] = useState(false)
  return (
    <View style={[styles.about, style]}>
      {sound ? <SoundStrip song={song} /> : null}
      <SongFacts
        song={song}
        plays={plays}
        end={
          isRoomTrackId(song.id) ? null : (
            <Button
              label={SONG_ACTION_LABELS.fixInfo}
              icon={<Sparkles tone="textSecondary" />}
              onPress={() => setFixing(true)}
              testID={testID}
            />
          )
        }
      />
      {fixing ? <FixMetadata song={song} onClose={() => setFixing(false)} /> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  about: { gap: 18 },
})
