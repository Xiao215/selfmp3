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
import { SongFacts } from './SongFacts'

/**
 * What the app knows about a song, with "Fix song info…" beside the facts it
 * fixes: the end of the song's own page, and the Details tab of a computer's
 * Now Playing. The tab was the page's block pasted across, and a rename of
 * the button had to be made in both.
 *
 * A friend's song in a room is not in your library, so there is nothing of
 * yours to fix.
 */
export function SongAbout({
  song,
  plays,
  testID,
  style,
}: {
  song: Song
  /** The play count among the facts; the song's page says it in a sentence of its own. */
  plays: boolean
  testID?: string
  style?: StyleProp<ViewStyle>
}): ReactNode {
  const [fixing, setFixing] = useState(false)
  return (
    <View style={[styles.about, style]}>
      <SongFacts song={song} plays={plays} />
      {isRoomTrackId(song.id) ? null : (
        <View style={styles.fix}>
          <Button
            label="Fix song info…"
            icon={<Sparkles size={15} tone="textSecondary" />}
            onPress={() => setFixing(true)}
            testID={testID}
          />
        </View>
      )}
      {fixing ? <FixMetadata song={song} onClose={() => setFixing(false)} /> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  about: { gap: 18 },
  fix: { alignItems: 'flex-start' },
})
